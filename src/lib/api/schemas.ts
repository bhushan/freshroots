import { z } from "zod";

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const cleanText = (max: number) => z.string().transform((s) => s.replace(CONTROL_EXCEPT_NEWLINE, "").trim()).pipe(z.string().max(max));

export const reviewBody = z
  .object({
    type: z.enum(["approve", "reject", "override", "investigate"]),
    overrideQty: z.number().int().min(0).max(10_000_000).optional(),
    note: cleanText(500).optional(),
    reviewer: cleanText(60).pipe(z.string().min(1)).optional(),
  })
  .strict();
export type ReviewBody = z.infer<typeof reviewBody>;

export const loginBody = z.object({ password: z.string().min(1).max(200) }).strict();

export const skuIdParam = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const uuidParam = z.uuid();

export const DEFAULT_REVIEWER = "Planner";
