import { getStore } from "@/db/client";
import { secretSyncHandler } from "@/lib/api/handlers";
import { guarded, respond } from "@/lib/server/http";
import { getZohoClient } from "@/lib/zoho/client";

export const runtime = "nodejs";

/** Zoho webhook target. The body is never read: the shared secret only triggers a fresh pull from Zoho's API. */
export async function POST(req: Request) {
  return guarded(async () =>
    respond(
      await secretSyncHandler({
        store: getStore(),
        zoho: getZohoClient(),
        expected: process.env.ZOHO_WEBHOOK_SECRET,
        provided: req.headers.get("x-webhook-secret") ?? undefined,
      }),
    ),
  );
}
