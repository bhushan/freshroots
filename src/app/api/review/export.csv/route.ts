import { getStore } from "@/db/client";
import { exportCsvHandler } from "@/lib/api/handlers";
import { guarded } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async () => {
    const csv = await exportCsvHandler(getStore());
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="freshroots-approved-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
