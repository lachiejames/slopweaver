/**
 * RELEASING A REVIEWER — the one place a reviewer workspace is torn down, and the two very different reasons
 * it is allowed to happen.
 *
 * ## Two callers, two gates, one release
 *
 * `turn review --close` releases a reviewer whose ask is still running, so it is gated hard on proof the
 * reviewer STOPPED (`review.ts`'s `reviewPollClosure`): its own written verdict, or cmux reporting the host
 * exited. That gate exists because closing a working reviewer is exactly what cost twelve workspaces —
 * `reviewStore.ts`'s header has it.
 *
 * The ask's own TERMINAL outcome is the other reason, and it needs no such gate. Once the answer has posted,
 * or the sweep has finalised the ask as failed, abandoned or phantom, there is no verdict left that anything
 * could consume: the door for this ask is shut. A reviewer still sitting there is not mid-anything useful, it
 * is a session nobody will ever read. {@link reviewerReaping} is that decision, and it is deliberately not the
 * same function as the `--close` gate, because collapsing the two is how the mid-verdict close came back.
 *
 * ## Why this is code and not an instruction
 *
 * The worker was already told to run `--close` when it was finished. Measured on one ask: SIX
 * reviewer workspaces were left standing, a real share of a 46-session pile-up. The instruction cannot work as
 * written, and the reason is structural rather than forgetfulness — the worker posts with `turn answer`, and
 * `turn answer` CLOSES THE WORKER'S OWN WORKSPACE as its last act. A worker that has not released its reviewer
 * by then never gets another chance to; it is gone. So the release moved to the terminal path itself, where
 * there is always something still running to do it.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { ReviewRecord } from "./review.js";

/**
 * What a terminal outcome should do about the ask's reviewer.
 *
 * @internal — the shape {@link reviewerReaping} returns and {@link reviewerReapLine} reads; exported because
 * both signatures name it, not because anything outside this pair constructs one.
 */
export type ReviewerReaping =
  | { readonly kind: "nothing"; readonly why: string }
  | { readonly kind: "reap"; readonly record: ReviewRecord; readonly why: string };

/**
 * Whether an ask that has just reached a terminal outcome leaves a reviewer to release.
 *
 * Ungated on liveness on purpose — see this module's header. The ask is over either way, so a reviewer that
 * is still working is the strongest case for closing it, not a reason to leave it.
 *
 * @param record the ask's review record, absent when no review was ever opened; one already stamped
 *   `releasedAt` is nothing to do again, which is what keeps a worker's own well-behaved `--close` from
 *   turning into a reported close failure here
 * @param terminal how the ask ended, in the words the release line will carry
 * @returns what to do
 */
export function reviewerReaping({
  record,
  terminal,
}: {
  record: ReviewRecord | undefined;
  terminal: string;
}): ReviewerReaping {
  if (record === undefined) {
    return { kind: "nothing", why: "no review was opened for this ask" };
  }
  if (record.releasedAt !== undefined) {
    return { kind: "nothing", why: `its reviewer was already released at ${record.releasedAt}` };
  }
  return {
    kind: "reap",
    record,
    why: `the ask is ${terminal}, so no verdict from this reviewer can be consumed`,
  };
}

/**
 * The line a reap reports, whichever caller ran it — one shape, so a reader grepping for a released reviewer
 * finds every one of them.
 *
 * @param askIdentity the ask whose reviewer was released
 * @param outcome what the close attempt did: the cmux failure text, or `undefined` when it succeeded
 * @param reaping the decision this line reports on
 * @returns the line
 */
export function reviewerReapLine({
  askIdentity,
  outcome,
  reaping,
}: {
  askIdentity: AskIdentity;
  outcome: string | undefined;
  reaping: ReviewerReaping;
}): string {
  const ask = `${askIdentity.channel}/${askIdentity.messageTs}`;
  if (reaping.kind === "nothing") {
    return `reviewer reap ${ask}: nothing to release — ${reaping.why}`;
  }
  const where = reaping.record.reviewer.workspaceRef;
  return outcome === undefined
    ? `reviewer reap ${ask}: released ${where} — ${reaping.why}`
    : `reviewer reap ${ask}: ${where} could not be closed (${outcome}) — its ledger row was retired anyway`;
}
