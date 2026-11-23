/**
 * Which of `github enqueue`'s findings this invocation actually WAIVED, as the rows the door ledger records.
 *
 * Its own module because there are now two of them and the rule they share is the load-bearing part: a
 * waiver is recorded only when the finding was RAISED and is no longer STANDING. Supplying the flags over a
 * guard that found nothing must not manufacture an audit entry for something nobody waived — that makes the
 * ledger's waiver count useless in the opposite direction, which is the failure `../../../admit/types.ts`
 * calls a caller invariant and asks each guard to hold for itself.
 *
 * `./enqueueCodexLoop.ts` still owns the pairing floor's own translation, because that subject carries an
 * obligation (a reason) shared with `github merge --admin` and stated once in `../../../codex/landingGate.ts`.
 */

import type { AcknowledgeableSubject, DoorAcknowledgement } from "../../../admit/types.js";
import { CODEX_LOOP_SUBJECT } from "../../../codex/landingGate.js";
// Type-only, so it is erased at runtime and the pair is not a module cycle.
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
import { codexLoopAcknowledgement } from "./enqueueCodexLoop.js";
import type { EnqueueFinding } from "./enqueueFindings.js";

/**
 * The rollup subject a press may answer for itself, named once so the guard, the press and the door agree.
 *
 * @internal named by this verb, `./landingPress.ts` and their tests.
 */
export const ROLLUP_SUPERSEDED_SUBJECT = "ci-rollup-superseded";

/**
 * Whether a subject was raised by this guard AND is no longer standing against the write.
 *
 * @param subject the finding subject in question
 * @param findings every finding the guard produced
 * @param unacknowledged the findings still standing
 * @returns whether a waiver for this subject describes something that actually happened
 */
function waived({
  subject,
  findings,
  unacknowledged,
}: {
  subject: AcknowledgeableSubject;
  findings: readonly EnqueueFinding[];
  unacknowledged: readonly EnqueueFinding[];
}): boolean {
  const raised = findings.some((finding) => finding.subject === subject);
  const stillStanding = unacknowledged.some((finding) => finding.subject === subject);
  return raised && !stillStanding;
}

/**
 * The superseded-rollup waiver to RECORD, when that finding was raised and then waived with a reason.
 *
 * The reason is not decoration here: it is the run id of the later run that replaced the failure still
 * pinning the rollup (`rollupSupersessionProof`, `../../../live/github/rollupSupersession.ts`), so the ledger row says
 * which run proved the waiver without a reader opening GitHub. A blank reason waives nothing, exactly as
 * the pairing floor's does.
 *
 * @param args the parsed invocation, for its acknowledgements and reason
 * @param findings every finding the guard produced
 * @param unacknowledged the findings still standing
 * @returns the acknowledgement to write at the door, or `undefined`
 */
function rollupSupersededAcknowledgement({
  args,
  findings,
  unacknowledged,
}: {
  args: GithubEnqueueArgs;
  findings: readonly EnqueueFinding[];
  unacknowledged: readonly EnqueueFinding[];
}): DoorAcknowledgement | undefined {
  if (!waived({ findings, subject: ROLLUP_SUPERSEDED_SUBJECT, unacknowledged })) {
    return undefined;
  }
  const reason = args.reason;
  if (reason === undefined || reason.trim().length === 0) {
    return undefined;
  }
  return { reason, subject: ROLLUP_SUPERSEDED_SUBJECT };
}

/**
 * Every waiver this invocation made, in the order the findings are raised.
 *
 * A list rather than one value because `--acknowledge` has always taken a comma-separated SET, and the
 * measured case waives two at once: a fleet pull request whose head no checkout on this machine holds
 * raises `codex-loop-incomplete`, and the same pull request's rollup pinned by a `pr-body-gate` re-run of
 * `dev-gate` raises `ci-rollup-superseded`.
 *
 * @param args the parsed invocation, for its acknowledgements and reason
 * @param findings every finding the guard produced
 * @param unacknowledged the findings still standing
 * @returns the acknowledgements to write at the door; empty when nothing was waived
 */
export function enqueueAcknowledgements({
  args,
  findings,
  unacknowledged,
}: {
  args: GithubEnqueueArgs;
  findings: readonly EnqueueFinding[];
  unacknowledged: readonly EnqueueFinding[];
}): readonly DoorAcknowledgement[] {
  const rows: DoorAcknowledgement[] = [];
  const pairing = codexLoopAcknowledgement({ args, findings, unacknowledged });
  if (pairing !== undefined) {
    rows.push(pairing);
  }
  const rollup = rollupSupersededAcknowledgement({ args, findings, unacknowledged });
  if (rollup !== undefined) {
    rows.push(rollup);
  }
  return rows;
}

/**
 * The subjects whose acknowledgement MUST carry a reason, because that reason is what reaches the ledger.
 *
 * @internal read by `./enqueueCore.ts`'s parser; the closed set lives beside the rows it governs.
 */
export const REASON_REQUIRED_SUBJECTS: readonly AcknowledgeableSubject[] = [
  CODEX_LOOP_SUBJECT,
  ROLLUP_SUPERSEDED_SUBJECT,
];
