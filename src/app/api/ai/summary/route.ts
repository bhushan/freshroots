import { getStore } from "@/db/client";
import { aiSummaryHandler } from "@/lib/api/handlers";
import { aiDepsFromEnv } from "@/lib/ai/gemini";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, respond } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  return guarded(async () =>
    respond(await aiSummaryHandler({ store: getStore(), env: authEnv(), token: await sessionToken(), deps: aiDepsFromEnv() })),
  );
}
