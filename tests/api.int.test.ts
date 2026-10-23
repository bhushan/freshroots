import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import type { AiDeps } from "@/lib/ai/service";
import {
  aiExplainHandler,
  aiSummaryHandler,
  analysisRunHandler,
  exportCsvHandler,
  loginHandler,
  reviewHandler,
} from "@/lib/api/handlers";
import { reviewBody, skuIdParam } from "@/lib/api/schemas";
import { createSessionToken, type AuthEnv } from "@/lib/auth/session";
import { runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { createTestStore, sample } from "./helpers/db";

const SECRET = "s".repeat(40);
const env: AuthEnv = { ADMIN_PASSWORD: "pw-123", SESSION_SECRET: SECRET };
const token = createSessionToken(SECRET);

let store: Store;
let recId: string;
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
  const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.skuId, "SKU001"));
  recId = rec.id;
});

describe("input schemas", () => {
  it("accepts a valid review body and strips control characters from notes", () => {
    const r = reviewBody.parse({ type: "override", overrideQty: 10, note: "  buffer\u0000 stock  ", reviewer: "Raghav" });
    expect(r.note).toBe("buffer stock");
  });

  it("rejects unknown fields, bad types, negative and fractional quantities, and oversized notes", () => {
    for (const bad of [
      { type: "delete" },
      { type: "approve", extra: 1 },
      { type: "override", overrideQty: -1 },
      { type: "override", overrideQty: 1.5 },
      { type: "override", overrideQty: "12" },
      { type: "approve", note: "x".repeat(501) },
      { type: "approve", reviewer: "" },
      {},
    ]) {
      expect(reviewBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("restricts SKU ids", () => {
    expect(skuIdParam.safeParse("SKU001").success).toBe(true);
    for (const bad of ["", "../etc", "SKU 1", "a".repeat(40), "SKU001;drop"]) {
      expect(skuIdParam.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("access gate on every mutation", () => {
  it("is read-only in demo mode (no ADMIN_PASSWORD)", async () => {
    const demo: AuthEnv = { SESSION_SECRET: SECRET };
    expect((await reviewHandler({ store, env: demo, token, recId, rawBody: { type: "approve" } })).status).toBe(403);
    expect((await analysisRunHandler({ store, env: demo, token })).status).toBe(403);
    expect((await aiSummaryHandler({ store, env: demo, token, deps: aiDeps() })).status).toBe(403);
    expect((await aiExplainHandler({ store, env: demo, token, skuId: "SKU001", deps: aiDeps() })).status).toBe(403);
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, recId));
    expect(rec.reviewStatus).toBe("pending");
  });

  it("returns 401 without a valid session", async () => {
    expect((await reviewHandler({ store, env, token: undefined, recId, rawBody: { type: "approve" } })).status).toBe(401);
    expect((await reviewHandler({ store, env, token: "bad.token", recId, rawBody: { type: "approve" } })).status).toBe(401);
    expect((await analysisRunHandler({ store, env, token: undefined })).status).toBe(401);
  });
});

describe("review endpoint", () => {
  it("returns 400 with issues for an invalid body, before touching the database", async () => {
    const res = await reviewHandler({ store, env, token, recId, rawBody: { type: "nope" } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "INVALID_REQUEST" });
  });

  it("returns 400 for a malformed recommendation id", async () => {
    expect((await reviewHandler({ store, env, token, recId: "not-a-uuid", rawBody: { type: "approve" } })).status).toBe(400);
  });

  it("approves and persists", async () => {
    const res = await reviewHandler({ store, env, token, recId, rawBody: { type: "approve", reviewer: "Raghav", note: "go" } });
    expect(res.status).toBe(200);
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, recId));
    expect(rec).toMatchObject({ reviewStatus: "approved", finalQty: 750 });
  });

  it("maps domain errors to status codes", async () => {
    await reviewHandler({ store, env, token, recId, rawBody: { type: "approve" } });
    expect((await reviewHandler({ store, env, token, recId, rawBody: { type: "reject" } })).status).toBe(409);
    expect((await reviewHandler({ store, env, token, recId: "00000000-0000-4000-8000-000000000000", rawBody: { type: "approve" } })).status).toBe(404);
    const [other] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.skuId, "SKU003"));
    expect((await reviewHandler({ store, env, token, recId: other.id, rawBody: { type: "override" } })).status).toBe(422);
  });
});

describe("analysis endpoint", () => {
  it("runs the analysis for an authenticated planner", async () => {
    const res = await analysisRunHandler({ store, env, token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ summary: { totalSkus: 15 } });
  });
});

describe("AI endpoints", () => {
  it("returns 503 when Gemini is not configured, and nothing else changes", async () => {
    const res = await aiSummaryHandler({ store, env, token, deps: aiDeps(null) });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "NOT_CONFIGURED" });
  });

  it("returns 429 for quota exhaustion", async () => {
    const quota = vi.fn(async () => {
      throw Object.assign(new Error("quota"), { status: 429 });
    });
    const res = await aiSummaryHandler({ store, env, token, deps: aiDeps(quota) });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "QUOTA" });
  });

  it("rejects an invalid SKU id with 400", async () => {
    expect((await aiExplainHandler({ store, env, token, skuId: "../x", deps: aiDeps() })).status).toBe(400);
  });

  it("returns the explanation on success", async () => {
    const gen = vi.fn(async () => ({
      text: JSON.stringify({ summary: "SKU001 needs attention.", drivers: ["Cover is short."], caveats: [] }),
    }));
    const res = await aiExplainHandler({ store, env, token, skuId: "SKU001", deps: aiDeps(gen) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { summary: "SKU001 needs attention." }, cached: false });
  });
});

describe("login", () => {
  it("issues a session only for the right password", async () => {
    const ok = await loginHandler({ env, rawBody: { password: "pw-123" } });
    expect(ok.status).toBe(200);
    expect(ok.sessionToken).toBeTruthy();
    const bad = await loginHandler({ env, rawBody: { password: "wrong" }, delayMs: 0 });
    expect(bad.status).toBe(401);
    expect(bad.sessionToken).toBeUndefined();
    expect(JSON.stringify(bad.body)).not.toContain("pw-123");
  });

  it("is unavailable in demo mode and validates input", async () => {
    expect((await loginHandler({ env: { SESSION_SECRET: SECRET }, rawBody: { password: "x" } })).status).toBe(403);
    expect((await loginHandler({ env, rawBody: {} })).status).toBe(400);
  });
});

describe("CSV export", () => {
  it("contains only approved and overridden items and neutralises spreadsheet formulas", async () => {
    await reviewHandler({ store, env, token, recId, rawBody: { type: "approve", reviewer: "=HYPERLINK(\"x\")" } });
    const csv = await exportCsvHandler(store);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("SKU_ID");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("SKU001");
    expect(lines[1]).toContain("750");
    expect(lines[1]).not.toMatch(/(^|,)"?=HYPERLINK/);
  });
});

function aiDeps(generate: AiDeps["generate"] = vi.fn(async () => ({ text: "{}" }))): AiDeps {
  return { generate, model: "gemini-test", limits: { perMinute: 5, perDay: 50 }, timeoutMs: 500 };
}
