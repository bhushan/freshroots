import { getStore } from "@/db/client";
import { reviewHandler } from "@/lib/api/handlers";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, readJson, respond } from "@/lib/server/http";
import { getZohoClient } from "@/lib/zoho/client";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await ctx.params;
    return respond(
      await reviewHandler({ store: getStore(), env: authEnv(), token: await sessionToken(), recId: id, rawBody: await readJson(req), zoho: getZohoClient() }),
    );
  });
}
