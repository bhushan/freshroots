import { z } from "zod";

export const summaryOutput = z.object({
  headline: z.string().min(1).max(200),
  bullets: z.array(z.string().min(1).max(300)).min(1).max(6),
  skusToWatch: z.array(z.string().max(20)).max(8),
});
export type SummaryOutput = z.infer<typeof summaryOutput>;

export const explainOutput = z.object({
  summary: z.string().min(1).max(500),
  drivers: z.array(z.string().min(1).max(300)).min(1).max(5),
  caveats: z.array(z.string().max(300)).max(4),
});
export type ExplainOutput = z.infer<typeof explainOutput>;

export type AiKind = "summary" | "explain";

/** JSON Schema handed to Gemini so it returns structured output. */
export function jsonSchemaFor(kind: AiKind): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(kind === "summary" ? summaryOutput : explainOutput) as Record<string, unknown>;
  void _ignored;
  return schema;
}
