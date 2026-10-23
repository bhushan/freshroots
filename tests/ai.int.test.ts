import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { generateExplanation, generateSummary, type AiDeps, type Generator } from "@/lib/ai/service";
import { runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { createTestStore, sample } from "./helpers/db";

let store: Store;
beforeEach(async () => {
  store = await createTestStore();
  const files: SampleFile[] = [
    { dataset: "distributors", name: "d", text: sample("distributor_master.csv") },
    { dataset: "calendar", name: "c", text: sample("calendar.csv") },
    { dataset: "skus", name: "s", text: sample("sku_master.csv") },
    { dataset: "weekly_sales", name: "w", text: sample("weekly_sales.csv") },
    { dataset: "inventory", name: "i", text: sample("current_inventory.csv") },
  ];
  await loadSampleData(store, files);
  const run = await runAnalysis(store);
  if (!run.ok) throw new Error(run.message);
});

const goodSummary = JSON.stringify({
  headline: "Five SKUs are below their stock minimums.",
  bullets: ["SKU001 is High Demand and below six weeks of cover.", "SKU006 holds more than 14 weeks of stock."],
  skusToWatch: ["SKU001", "SKU006"],
});
const goodExplain = JSON.stringify({
  summary: "SKU001 is flagged because recent demand is above its 12-week level and cover is short.",
  drivers: ["Adjusted 4-week average exceeds 1.2 times the adjusted 12-week average."],
  caveats: [],
});

function deps(generate: Generator | null, over: Partial<AiDeps> = {}): AiDeps {
  return { generate, model: "gemini-test", limits: { perMinute: 5, perDay: 50 }, timeoutMs: 500, ...over };
}
const ok = (text: string): Generator => vi.fn(async () => ({ text, inputTokens: 100, outputTokens: 50 }));
const recCount = async () => (await store.db.select({ n: count() }).from(t.recommendations))[0].n;

describe("configuration", () => {
  it("reports NOT_CONFIGURED without a generator and records nothing", async () => {
    const r = await generateSummary(store, deps(null));
    expect(r).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(await store.db.select({ n: count() }).from(t.aiUsage)).toEqual([{ n: 0 }]);
  });
});

describe("summary", () => {
  it("returns validated content and records usage", async () => {
    const gen = ok(goodSummary);
    const r = await generateSummary(store, deps(gen));
    expect(r).toMatchObject({ ok: true, cached: false });
    if (r.ok) expect(r.data.headline).toMatch(/five skus/i);
    const usage = await store.db.select().from(t.aiUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ kind: "summary", status: "ok", model: "gemini-test", inputTokens: 100, outputTokens: 50 });
  });

  it("serves a repeat request from the stored response without spending quota", async () => {
    const gen = ok(goodSummary);
    await generateSummary(store, deps(gen));
    const again = await generateSummary(store, deps(gen));
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("sends only computed metrics and flags, never raw CSV rows", async () => {
    const gen = ok(goodSummary);
    await generateSummary(store, deps(gen));
    const req = (gen as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.prompt).toContain("SKU001");
    expect(req.prompt).toContain("HIGH_DEMAND");
    expect(req.prompt).not.toMatch(/SKU_ID,Week|Units_Sold/);
    expect(req.system).toMatch(/deterministic/i);
    expect(req.system).toMatch(/only/i);
  });
});

describe("explanation", () => {
  it("explains one SKU and caches per SKU", async () => {
    const gen = ok(goodExplain);
    const a = await generateExplanation(store, "SKU001", deps(gen));
    expect(a).toMatchObject({ ok: true, cached: false });
    await generateExplanation(store, "SKU001", deps(gen));
    expect(gen).toHaveBeenCalledTimes(1);
    await generateExplanation(store, "SKU001", deps(ok(goodExplain)));
    const req = (gen as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.prompt).toContain("STOCKOUT_RISK");
    expect(req.prompt).toContain("REORDER_HIGH_DEMAND");
  });

  it("returns NOT_FOUND for a SKU that is not in the latest run", async () => {
    expect(await generateExplanation(store, "SKU404", deps(ok(goodExplain)))).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("failures never touch calculated results", () => {
  it("handles malformed JSON", async () => {
    const before = await recCount();
    const r = await generateSummary(store, deps(ok("not json at all")));
    expect(r).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    expect(await recCount()).toBe(before);
    expect((await store.db.select().from(t.aiUsage))[0]).toMatchObject({ status: "error", errorCode: "INVALID_RESPONSE" });
  });

  it("handles output that fails schema validation", async () => {
    const r = await generateSummary(store, deps(ok(JSON.stringify({ headline: "x" }))));
    expect(r).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("rejects output that mentions a SKU that was not in the input", async () => {
    const bad = JSON.stringify({ headline: "SKU999 is out of stock.", bullets: ["SKU999 needs 100 units."], skusToWatch: [] });
    expect(await generateSummary(store, deps(ok(bad)))).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
  });

  it("accepts fenced JSON", async () => {
    const r = await generateSummary(store, deps(ok("```json\n" + goodSummary + "\n```")));
    expect(r.ok).toBe(true);
  });

  it("maps a 429 to a quota message that never suggests enabling billing", async () => {
    const quota = vi.fn(async () => {
      throw Object.assign(new Error("RESOURCE_EXHAUSTED: quota"), { status: 429 });
    });
    const r = await generateSummary(store, deps(quota));
    expect(r).toMatchObject({ ok: false, code: "QUOTA" });
    if (!r.ok) {
      expect(r.message).toMatch(/free-tier/i);
      expect(r.message).not.toMatch(/enable billing|upgrade|add a payment/i);
      expect(r.message).toMatch(/no paid plan/i);
    }
    expect((await store.db.select().from(t.aiUsage))[0]).toMatchObject({ status: "quota" });
  });

  it("times out a hung request", async () => {
    const hung: Generator = () => new Promise(() => {});
    const r = await generateSummary(store, deps(hung, { timeoutMs: 20 }));
    expect(r).toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("reports other provider errors without leaking their text", async () => {
    const broken = vi.fn(async () => {
      throw Object.assign(new Error("secret-ish upstream detail"), { status: 503 });
    });
    const r = await generateSummary(store, deps(broken));
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    if (!r.ok) expect(r.message).not.toMatch(/secret-ish/);
  });
});

describe("throttling", () => {
  it("blocks calls over the per-minute cap without calling Gemini", async () => {
    const gen = ok(goodExplain);
    const d = deps(gen, { limits: { perMinute: 2, perDay: 50 } });
    await generateExplanation(store, "SKU001", d);
    await generateExplanation(store, "SKU003", d);
    const third = await generateExplanation(store, "SKU004", d);
    expect(third).toMatchObject({ ok: false, code: "THROTTLED" });
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("blocks calls over the daily cap", async () => {
    const gen = ok(goodExplain);
    const d = deps(gen, { limits: { perMinute: 100, perDay: 1 } });
    await generateExplanation(store, "SKU001", d);
    expect(await generateExplanation(store, "SKU003", d)).toMatchObject({ ok: false, code: "THROTTLED" });
  });

  it("still serves cached answers when throttled", async () => {
    const gen = ok(goodExplain);
    const d = deps(gen, { limits: { perMinute: 1, perDay: 50 } });
    await generateExplanation(store, "SKU001", d);
    expect(await generateExplanation(store, "SKU001", d)).toMatchObject({ ok: true, cached: true });
  });
});
