import { getStore } from "@/db/client";
import { zohoSyncHandler } from "@/lib/api/handlers";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, respond } from "@/lib/server/http";
import { getZohoClient } from "@/lib/zoho/client";

export const runtime = "nodejs";

export async function POST() {
  return guarded(async () => respond(await zohoSyncHandler({ store: getStore(), env: authEnv(), token: await sessionToken(), zoho: getZohoClient() })));
}
