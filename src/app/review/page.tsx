import { AccessNotice, EmptyState, SetupNeeded } from "@/components/notice";
import { ReviewBoard } from "@/components/review-board";
import { getStore, isDatabaseConfigured } from "@/db/client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { getReviewBoard } from "@/lib/queries";
import { getAccessMode } from "@/lib/server/context";
import { zohoConfigFromEnv } from "@/lib/zoho/client";

export const metadata = { title: "Review queue" };

export default async function ReviewPage() {
  if (!isDatabaseConfigured()) return <SetupNeeded reason="no-database" />;
  const mode = await getAccessMode();
  let board;
  try {
    board = await getReviewBoard(getStore().db);
  } catch {
    return <SetupNeeded reason="error" />;
  }
  return (
    <div className="space-y-8">
      <div>
        {board && <p className="type-label text-ash">Snapshot {fmtDate(board.run.snapshotDate)}</p>}
        <h1 className="type-title mt-3">Planner review queue</h1>
        <p className="mt-3 max-w-prose text-base text-ash">Approve, override or reject each proposal. Approving or overriding a recommendation places a purchase order in Zoho Books when Zoho is connected.</p>
      </div>
      {!board ? (
        <EmptyState title="Nothing to review yet">Run the analysis from the Overview page. Every recommendation then waits here for a planner decision.</EmptyState>
      ) : (
        <>
          <AccessNotice mode={mode} what="approve, reject or override recommendations" />
          <ReviewBoard
            rows={board.rows}
            history={board.history}
            orders={board.purchaseOrders}
            zohoConnected={zohoConfigFromEnv(process.env) !== null}
            canAct={mode === "admin"}
            runLabel={`Analysis of ${fmtDateTime(board.run.createdAt)} on the inventory snapshot of ${fmtDate(board.run.snapshotDate)}.`}
          />
        </>
      )}
    </div>
  );
}
