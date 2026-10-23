import { and, count, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import type { ZodType } from "zod";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { getLatestRun } from "@/lib/analysis/run";
import { explainPrompt, runFacts, summaryPrompt, SYSTEM_INSTRUCTION, toSkuFacts, type SkuFacts } from "./prompts";
import { explainOutput, summaryOutput, type AiKind, type ExplainOutput, type SummaryOutput } from "./schema";

export interface GeneratorRequest {
  kind: AiKind;
  system: string;
  prompt: string;
}
export interface GeneratorResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}
export type Generator = (req: GeneratorRequest, signal: AbortSignal) => Promise<GeneratorResponse>;

export interface AiDeps {
  /** null when GEMINI_API_KEY is not configured. */
  generate: Generator | null;
  model: string;
  limits: { perMinute: number; perDay: number };
  timeoutMs: number;
}

export type AiErrorCode = "NOT_CONFIGURED" | "NO_DATA" | "NOT_FOUND" | "THROTTLED" | "QUOTA" | "TIMEOUT" | "INVALID_RESPONSE" | "UNAVAILABLE";

export type AiResult<T> =
  | { ok: true; data: T; cached: boolean; model: string }
  | { ok: false; code: AiErrorCode; message: string };

const MESSAGES: Record<AiErrorCode, string> = {
  NOT_CONFIGURED: "AI commentary is not configured. All calculations and recommendations are unaffected.",
  NO_DATA: "Run an analysis first; there is nothing to explain yet.",
  NOT_FOUND: "That SKU is not part of the latest analysis run.",
  THROTTLED: "AI requests are limited to protect the free tier. Please wait a minute and try again. Calculations are unaffected.",
  QUOTA: "The Gemini free-tier quota has been reached. It resets daily; no paid plan is used or required. Calculations and recommendations are unaffected.",
  TIMEOUT: "Gemini took too long to respond. Calculations are unaffected; try again shortly.",
  INVALID_RESPONSE: "Gemini returned a response that failed validation, so it was discarded. Calculations are unaffected.",
  UNAVAILABLE: "Gemini is unavailable right now. Calculations and recommendations are unaffected.",
};
const fail = (code: AiErrorCode): AiResult<never> => ({ ok: false, code, message: MESSAGES[code] });

class TimeoutError extends Error {}

function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(e?.message ?? "");
}

function parseJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(body);
}

/** Output may only reference SKU IDs that were in the input. */
function mentionsUnknownSku(output: unknown, allowed: Set<string>): boolean {
  const found = JSON.stringify(output).match(/\bSKU\d+\b/g) ?? [];
  return found.some((id) => !allowed.has(id));
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Job<T> {
  kind: AiKind;
  runId: string;
  skuId: string | null;
  prompt: string;
  allowedSkus: Set<string>;
  schema: ZodType<T>;
}

async function execute<T>(store: Store, deps: AiDeps, job: Job<T>): Promise<AiResult<T>> {
  const { db } = store;
  const { kind, runId, skuId } = job;
  const skuMatch = skuId === null ? isNull(t.aiUsage.skuId) : eq(t.aiUsage.skuId, skuId);

  // Cached answers cost no quota, so they are served even when throttled.
  const [cached] = await db
    .select({ response: t.aiUsage.response, model: t.aiUsage.model })
    .from(t.aiUsage)
    .where(and(eq(t.aiUsage.kind, kind), eq(t.aiUsage.runId, runId), skuMatch, eq(t.aiUsage.status, "ok"), isNotNull(t.aiUsage.response)))
    .orderBy(desc(t.aiUsage.createdAt))
    .limit(1);
  if (cached) {
    const parsed = job.schema.safeParse(cached.response);
    if (parsed.success) return { ok: true, data: parsed.data, cached: true, model: cached.model };
  }

  if (!deps.generate) return fail("NOT_CONFIGURED");

  const billable = inArray(t.aiUsage.status, ["ok", "error", "quota"]);
  const since = (ms: number) => new Date(Date.now() - ms);
  const [[minute], [day]] = await Promise.all([
    db.select({ n: count() }).from(t.aiUsage).where(and(billable, gte(t.aiUsage.createdAt, since(60_000)))),
    db.select({ n: count() }).from(t.aiUsage).where(and(billable, gte(t.aiUsage.createdAt, since(24 * 3600_000)))),
  ]);
  if (minute.n >= deps.limits.perMinute || day.n >= deps.limits.perDay) return fail("THROTTLED");

  const started = Date.now();
  const record = (values: Partial<typeof t.aiUsage.$inferInsert> & { status: string }) =>
    db.insert(t.aiUsage).values({ kind, runId, skuId, model: deps.model, latencyMs: Date.now() - started, ...values });

  let code: AiErrorCode;
  try {
    const res = await withTimeout(deps.timeoutMs, (signal) =>
      (deps.generate as Generator)({ kind, system: SYSTEM_INSTRUCTION, prompt: job.prompt }, signal),
    );
    const tokens = { inputTokens: res.inputTokens ?? null, outputTokens: res.outputTokens ?? null };
    let data: T | null = null;
    try {
      const parsed = job.schema.safeParse(parseJson(res.text));
      if (parsed.success && !mentionsUnknownSku(parsed.data, job.allowedSkus)) data = parsed.data;
    } catch {
      data = null;
    }
    if (data === null) {
      await record({ status: "error", errorCode: "INVALID_RESPONSE", ...tokens });
      return fail("INVALID_RESPONSE");
    }
    await record({ status: "ok", response: data, ...tokens });
    return { ok: true, data, cached: false, model: deps.model };
  } catch (err) {
    if (err instanceof TimeoutError) code = "TIMEOUT";
    else if (isQuotaError(err)) code = "QUOTA";
    else code = "UNAVAILABLE";
    // Log the class of failure only; provider error text is never stored or returned.
    console.error(`[ai] ${kind} failed: ${code} status=${(err as { status?: number })?.status ?? "n/a"}`);
    await record({ status: code === "QUOTA" ? "quota" : "error", errorCode: code });
    return fail(code);
  }
}

async function loadFacts(store: Store): Promise<{ run: NonNullable<Awaited<ReturnType<typeof getLatestRun>>>; skus: SkuFacts[] } | null> {
  const run = await getLatestRun(store.db);
  if (!run) return null;
  const rows = await store.db
    .select({
      skuId: t.recommendations.skuId,
      name: t.skus.name,
      category: t.skus.category,
      perishability: t.skus.perishability,
      standardReorderQty: t.skus.standardReorderQty,
      distinctWeeks: t.recommendations.distinctWeeks,
      avg4Raw: t.recommendations.avg4Raw,
      avg12Raw: t.recommendations.avg12Raw,
      avg4Adjusted: t.recommendations.avg4Adjusted,
      avg12Adjusted: t.recommendations.avg12Adjusted,
      festivalUpliftApplied: t.recommendations.festivalUpliftApplied,
      unitsOnHand: t.recommendations.unitsOnHand,
      coverageWeeks: t.recommendations.coverageWeeks,
      flags: t.recommendations.flags,
      action: t.recommendations.action,
      suggestedQty: t.recommendations.suggestedQty,
      warnings: t.recommendations.warnings,
    })
    .from(t.recommendations)
    .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
    .where(eq(t.recommendations.runId, run.id))
    .orderBy(t.recommendations.skuId);
  return { run, skus: rows.map(toSkuFacts) };
}

function countsOf(run: { summary: unknown }): Record<string, number> {
  const s = run.summary as Record<string, unknown>;
  const pick = ["totalSkus", "highDemand", "stockoutRisk", "overstockRisk", "manualReview", "insufficientData"];
  return Object.fromEntries(pick.map((k) => [k, Number(s[k] ?? 0)]));
}

export async function generateSummary(store: Store, deps: AiDeps): Promise<AiResult<SummaryOutput>> {
  const facts = await loadFacts(store);
  if (!facts) return fail("NO_DATA");
  return execute(store, deps, {
    kind: "summary",
    runId: facts.run.id,
    skuId: null,
    prompt: summaryPrompt(runFacts(facts.run, countsOf(facts.run)), facts.skus),
    allowedSkus: new Set(facts.skus.map((s) => s.skuId)),
    schema: summaryOutput,
  });
}

export async function generateExplanation(store: Store, skuId: string, deps: AiDeps): Promise<AiResult<ExplainOutput>> {
  const facts = await loadFacts(store);
  if (!facts) return fail("NO_DATA");
  const sku = facts.skus.find((s) => s.skuId === skuId);
  if (!sku) return fail("NOT_FOUND");
  return execute(store, deps, {
    kind: "explain",
    runId: facts.run.id,
    skuId,
    prompt: explainPrompt(runFacts(facts.run, countsOf(facts.run)), sku),
    allowedSkus: new Set([skuId]),
    schema: explainOutput,
  });
}
