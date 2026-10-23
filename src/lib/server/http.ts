import "server-only";
import { NextResponse } from "next/server";
import { DatabaseNotConfiguredError } from "@/db/client";
import type { ApiResult } from "@/lib/api/handlers";

const MAX_BODY_BYTES = 20_000;

/** Reads a small JSON body. Returns undefined when it is missing, too large, or not JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function respond(result: ApiResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

/** Turns unexpected failures into a safe 500 without echoing internals or secrets. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return NextResponse.json({ error: "DATABASE_NOT_CONFIGURED", message: "The database is not configured." }, { status: 503 });
    }
    console.error(`[api] unhandled ${err instanceof Error ? err.name : "error"}`);
    return NextResponse.json({ error: "SERVER_ERROR", message: "Something went wrong. Your data was not changed." }, { status: 500 });
  }
}
