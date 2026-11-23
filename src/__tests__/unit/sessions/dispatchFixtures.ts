/**
 * The bot loop's own dispatch children — an ask worker and the reviewer of its answer — as close-done's pure
 * tests build them, shared by the tests under `./closeDone/` and `./closeDoneStanding.test.ts`.
 */
import { dispatchSessionName, dispatchWorkspaceName } from "../../../cmux/planNames.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import type { ReviewPosture } from "../../../live/turn/leaseJudgement.js";

/** The instant every close-done test judges against. */
export const NOW = "2026-09-03T10:00:00.000Z";

/** An ask with no reviewer open at all — the posture that grants no exemption, so the clock decides. */
export const NO_REVIEW: ReviewPosture = {
  hasUsableVerdict: false,
  inFlight: false,
  recordOpen: false,
  spawnedAt: undefined,
};

/**
 * A reviewer that is open and has written nothing — what `reviewPosture.ts` reports for a live round.
 *
 * @returns the in-flight posture spawned at `spawnedAt`
 */
export function reviewing({ spawnedAt }: { spawnedAt: string }): ReviewPosture {
  return { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt };
}

/** The ask every dispatch fixture belongs to. */
export const ASK: AskIdentity = { channel: "C0AAA", messageTs: "1789046247.801199", threadTs: "1789046247.801199" };

/** The dispatch keys and workspace names the real spawners mint, never a second spelling of either. */
export const REVIEW_KEY = dispatchSessionName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "review" });
/** The worker's dispatch session key. */
export const WORKER_KEY = dispatchSessionName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "ask" });
/** The reviewer's workspace name. */
export const REVIEW_NAME = dispatchWorkspaceName({
  askChannel: ASK.channel,
  askMessageTs: ASK.messageTs,
  role: "review",
});
/** The worker's workspace name. */
export const WORKER_NAME = dispatchWorkspaceName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "ask" });

/**
 * The `captured` event every other event for an ask must follow, or the fold ignores the lot.
 *
 * @param over identity fields replacing the default ask's
 * @returns the captured event
 */
export function captured(over: Partial<AskIdentity> = {}): AskLifecycleEvent {
  return {
    ...ASK,
    ...over,
    kind: "captured",
    surface: "channel",
    tsIso: "2026-09-03T07:00:00.000Z",
    userId: "U0AAA",
  };
}

/**
 * A `dispatched` event whose lease runs out at the given instant.
 *
 * @returns the dispatched event
 */
export function dispatched({ leaseExpiresAt }: { leaseExpiresAt: string }): AskLifecycleEvent {
  return {
    ...ASK,
    decision: {
      confidence: "high",
      needs: [],
      rationale: "worth answering",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    },
    kind: "dispatched",
    leaseExpiresAt,
    tier: "fresh-visible-session",
    tsIso: "2026-09-03T07:01:00.000Z",
  };
}
