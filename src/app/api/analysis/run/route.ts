import { getStore } from "@/db/client";
import { analysisRunHandler } from "@/lib/api/handlers";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, respond } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST() {
  return guarded(async () => respond(await analysisRunHandler({ store: getStore(), env: authEnv(), token: await sessionToken() })));
}
