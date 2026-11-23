/**
 * What the sweep says about an ask a live worker is still holding.
 *
 * Split out of `./dispatchSweep.ts`, which decides WHICH finding an ask earned; this is the reporting that
 * follows a still-working one — the worker line, the stale-card line, the budget warn and the live checklist
 * push. It takes the two effects it uses structurally rather than the sweep's whole deps type, so it never
 * imports back up into the module that calls it.
 */
import { logger } from "../../../lib/logger.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import type { ProcessSnapshot } from "../../../live/standing/inspect.js";
import type { FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import { readReviewRecord, readVerdictFile } from "../../../live/turn/reviewStore.js";
import type { FreshVisibleSessionRef } from "../../../live/turn/tier.js";
import { sweepBudgetLines } from "./dispatchBudget.js";
import type { LiveScreenRead } from "./liveScreenRead.js";
import { pushLiveChecklistDetail, staleCardLine } from "./sweepCard.js";
import { workingSweepLine } from "./sweepLines.js";

/** {@link workingSweepLine} for one ask, reading its review record and verdict off disk to fill both arms. */
function stillWorkingLine({
  entry,
  home,
  worker,
}: {
  entry: AskLifecycle;
  home: string;
  worker: FreshVisibleSessionRef;
}): string {
  const review = readReviewRecord({ askIdentity: entry, home });
  return workingSweepLine({
    entry,
    reviewer: review?.reviewer,
    reviewerDone: review !== undefined && readVerdictFile({ record: review }).kind === "present",
    worker,
  });
}

/**
 * Everything the sweep says and does about an ask a live worker is still holding: name both its sessions,
 * say so if its card has stopped moving, and push the card whatever its workspace's own screen currently
 * shows. The DECISION has ended by here and the reporting begins.
 *
 * @param deps the effects to write the sweep's lines and read the process table through
 * @param entry the ask being swept
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param onChecklistUpdateFailed counts a courtesy card update Slack declined
 * @param read this generation's live screen read
 */
export async function reportStillWorking({
  deps,
  entry,
  home,
  nowIso,
  onChecklistUpdateFailed,
  read,
}: {
  deps: {
    readonly processSnapshot: () => ProcessSnapshot;
    readonly writeLine: (input: { line: string }) => void;
  };
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  onChecklistUpdateFailed: () => void;
  read: LiveScreenRead & { readonly record: FreshDispatchRecord };
}): Promise<void> {
  deps.writeLine({ line: stillWorkingLine({ entry, home, worker: read.record.session }) });
  const stale = staleCardLine({
    briefPath: read.record.briefPath,
    entry,
    home,
    nowIso,
    snapshot: deps.processSnapshot(),
  });
  if (stale !== undefined) {
    deps.writeLine({ line: stale });
  }
  // The budget warn rides the pass the loop already runs — see `./dispatchBudget.ts`.
  for (const line of sweepBudgetLines({ askIdentity: entry, home, nowIso })) {
    deps.writeLine({ line });
  }
  const outcome = await pushLiveChecklistDetail({ entry, home, nowIso, read });
  if (outcome?.kind === "failed") {
    logger.error({
      msg: `turn dispatch --sweep: could not push a live checklist update for ${entry.channel}/${entry.messageTs} — ${outcome.reason}`,
    });
    onChecklistUpdateFailed();
  }
}
