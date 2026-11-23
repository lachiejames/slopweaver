/**
 * The effectful half of the reviewer delivery witness: asking cmux what it actually submitted to a reviewer's
 * workspace, reading that workspace's screen, and — when `../../../live/turn/reviewDelivery.ts` says the
 * pickup is typed and unsent — pressing Enter on it.
 *
 * Split out of `./review.ts` and `./dispatchSweep.ts` rather than added to either, because both need it and
 * both are near the file-size cap. The pure decisions live in `reviewDelivery.ts`; nothing here decides
 * anything, which is what keeps the decision testable without a running cmux.
 */
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { type ReviewRecord, reviewerPickupPrompt } from "../../../live/turn/review.js";
import {
  REVIEWER_UNSUBMITTED_AFTER_MS,
  type ReviewerDelivery,
  reviewerDelivery,
  reviewerPickupResubmission,
  unsubmittedReviewerMinutes,
} from "../../../live/turn/reviewDelivery.js";
import { readReviewRecord, readVerdictFile } from "../../../live/turn/reviewStore.js";
import { listCmuxWorkspacesThrough, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";

/** What one look at a reviewer's workspace found — cmux's delivery record, and what the surface is rendering. */
export interface ReviewerSurfaceRead {
  readonly delivery: ReviewerDelivery;
  readonly screen: string | undefined;
}

/**
 * The exact pickup line a reviewer was sent, rebuilt from its own record.
 *
 * Rebuilt rather than stored, for the reason `../../../live/turn/dispatch.ts`'s
 * `unwitnessedPickupCorroboration` gives about the worker's: the line is a pure function of two paths the
 * record already carries, so a record written before this witness existed is reconcilable by it.
 *
 * @param record the review whose reviewer is being asked about
 * @returns the pickup text to compare cmux's delivery record against
 */
export function reviewerPickupOf({ record }: { record: ReviewRecord }): string {
  return reviewerPickupPrompt({ packetPath: record.packetPath, verdictPath: record.verdictPath });
}

/**
 * Read cmux's delivery record and screen for one reviewer's workspace, over a single connection.
 *
 * Every failure collapses to the same shape a healthy-but-silent workspace produces — no delivery record and
 * an unreadable screen — because a broken oracle must never be reported as a fact about the reviewer. The
 * pure decisions built on this both HOLD on that shape rather than acting.
 *
 * @param record the review whose reviewer is being read
 * @returns what cmux says about the workspace right now
 */
export async function readReviewerSurface({ record }: { record: ReviewRecord }): Promise<ReviewerSurfaceRead> {
  const pickup = reviewerPickupOf({ record });
  return withCmuxSessionHost({
    body: async ({ harness, host }) => {
      const listed = await listCmuxWorkspacesThrough({ harness });
      const workspace = listed.isOk()
        ? listed.value.find((candidate) => candidate.workspaceId === record.reviewer.workspaceId)
        : undefined;
      const screen = await host.readScreen({
        target: { surfaceId: record.reviewer.surfaceId, workspaceId: record.reviewer.workspaceId },
      });
      return {
        delivery: reviewerDelivery({ pickup, workspace }),
        screen: screen.isOk() ? screen.value : undefined,
      };
    },
  });
}

/** What a re-submission attempt did, for the caller to report in its own words. */
export type ReviewerResubmitOutcome =
  | { readonly kind: "submitted"; readonly reason: string }
  | { readonly kind: "held"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Press Enter on a reviewer's typed-but-unsent pickup, when and only when
 * `../../../live/turn/reviewDelivery.ts` says it is genuinely sitting there.
 *
 * No text is sent, ever. The line is already in the input box — that is the precondition the decision checks
 * — so this submits the copy that is there rather than adding a second, which is the distinction
 * `../../../cmux/pickupWitnessWindow.ts`'s `sendPickupOnceThenWitness` measured.
 *
 * @param read what the last look at the workspace found
 * @param record the review whose reviewer is stranded
 * @returns what was done, and why
 */
async function resubmitReviewerPickup({
  read,
  record,
}: {
  read: ReviewerSurfaceRead;
  record: ReviewRecord;
}): Promise<ReviewerResubmitOutcome> {
  const decision = reviewerPickupResubmission({
    delivery: read.delivery,
    host: record.reviewer.host,
    pickup: reviewerPickupOf({ record }),
    screen: read.screen,
  });
  if (decision.kind === "hold") {
    return { kind: "held", reason: decision.reason };
  }
  const sent = await withCmuxSessionHost({
    body: ({ host }) =>
      host.submitComposer({
        target: { surfaceId: record.reviewer.surfaceId, workspaceId: record.reviewer.workspaceId },
      }),
  });
  if (sent.isErr()) {
    logger.error({
      msg: `could not press Enter on the reviewer's typed pickup in ${record.reviewer.workspaceRef}: ${sent.error.message}`,
    });
    return { kind: "failed", reason: sent.error.message };
  }
  return { kind: "submitted", reason: decision.reason };
}

/** The two effects the sweep's reviewer arm needs, injected so a test can drive it without a running cmux. */
export interface ReviewerSweepDeps {
  readonly reviewerSurface: (input: { record: ReviewRecord }) => Promise<ReviewerSurfaceRead>;
  readonly resubmitPickup: (input: {
    read: ReviewerSurfaceRead;
    record: ReviewRecord;
  }) => Promise<ReviewerResubmitOutcome>;
}

/**
 * The production wiring of {@link ReviewerSweepDeps} — the real cmux inventory, screen and Enter.
 *
 * @returns deps that read the live cmux socket
 */
export function realReviewerSweepDeps(): ReviewerSweepDeps {
  return { resubmitPickup: resubmitReviewerPickup, reviewerSurface: readReviewerSurface };
}

/**
 * The sweep's reviewer arm: settle a reviewer whose pickup was never submitted, the way the sweep already
 * settles a worker's dispatch against cmux's own delivery record.
 *
 * A no-op for a review that does not exist, has already been released, or has its verdict on disk — and a
 * no-op inside {@link REVIEWER_UNSUBMITTED_AFTER_MS}, so a reviewer that merely booted a moment ago is never
 * touched. What it can do at the end of all that is press Enter on a line already typed into an idle input
 * box; `resubmitReviewerPickup` sends no text, ever.
 *
 * Its line names the DOUBT rather than the finding, and that wording is the fix rather than a
 * flourish: an absent delivery record is not evidence of non-delivery
 * (`../../../live/turn/reviewDelivery.ts`'s header), and the reader of this line is being told to consider
 * acting. `re-submit held (…)` carries the reason, which is where "this reviewer is mid-turn" actually
 * appears.
 *
 * @param askIdentity the ask whose reviewer is being checked
 * @param deps the effects to read and submit through
 * @param home the resolved state home
 * @param nowIso the current instant, which is what turns "no delivery record" into a duration
 * @param writeLine where the sweep's own line goes
 */
export async function reconcileStrandedReviewer({
  askIdentity,
  deps,
  home,
  nowIso,
  writeLine,
}: {
  askIdentity: AskIdentity;
  deps: ReviewerSweepDeps;
  home: string;
  nowIso: string;
  writeLine: (input: { line: string }) => void;
}): Promise<void> {
  const record = readReviewRecord({ askIdentity, home });
  if (record === undefined || record.releasedAt !== undefined || readVerdictFile({ record }).kind === "present") {
    return;
  }
  const read = await deps.reviewerSurface({ record });
  const waitedMinutes = unsubmittedReviewerMinutes({
    delivery: read.delivery,
    nowIso,
    spawnedAt: record.spawnedAt,
  });
  if (waitedMinutes === undefined) {
    return;
  }
  const outcome = await deps.resubmitPickup({ read, record });
  writeLine({
    line:
      `reviewer-delivery-unwitnessed: ${askIdentity.channel}/${askIdentity.messageTs} — cmux holds no record of ` +
      `anything submitted to ${record.reviewer.workspaceRef} in ${String(waitedMinutes)}m, which is a doubt and ` +
      `not proof it never started; re-submit ${outcome.kind} (${outcome.reason})`,
  });
}
