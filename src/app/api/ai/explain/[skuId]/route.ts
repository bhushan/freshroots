import { getStore } from "@/db/client";
import { aiExplainHandler } from "@/lib/api/handlers";
import { aiDepsFromEnv } from "@/lib/ai/gemini";
import { authEnv, sessionToken } from "@/lib/server/context";
import { guarded, respond } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_req: Request, ctx: { params: Promise<{ skuId: string }> }) {
  return guarded(async () => {
    const { skuId } = await ctx.params;
    return respond(
      await aiExplainHandler({ store: getStore(), env: authEnv(), token: await sessionToken(), skuId, deps: aiDepsFromEnv() }),
    );
  });
}
