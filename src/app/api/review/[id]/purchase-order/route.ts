import { getStore } from "@/db/client";
import { purchaseOrderHandler } from "@/lib/api/handlers";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, respond } from "@/lib/server/http";
import { getZohoClient } from "@/lib/zoho/client";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await ctx.params;
    return respond(await purchaseOrderHandler({ store: getStore(), env: authEnv(), token: await sessionToken(), recId: id, zoho: getZohoClient() }));
  });
}
