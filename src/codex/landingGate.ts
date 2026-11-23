/**
 * The Codex pairing floor as the two LANDING verbs see it — `github enqueue` and `github merge --admin`.
 *
 * ## Why this exists at all, when `codex status --check` already refuses
 *
 * Because `yarn validate:pr` is a package script and nothing makes anyone run it. Measured while designing
 * this: no workflow invokes it, and it is deliberately kept OUT of `yarn validate` (`docs/constraints/coupled-claims.md`)
 * because ordinary build laps run long before any review exists. So the pre-landing check is an honest
 * operator convenience and was never a gate — a rule enforced only there is a rule enforced nowhere, which
 * is exactly the state the Codex pairing ruling exists to end.
 *
 * A landing verb is the one place the question is unavoidable, so the floor is asked there too. This module
 * is the pure half: it takes a local reading and the pull request being landed, decides whether the two are
 * even talking about the same code, and turns the ledger's own failures into one named finding the existing
 * acknowledgement machinery already knows how to refuse and waive.
 *
 * ## The subject is the PULL REQUEST, not the checkout the verb is running in
 *
 * This asked four facts of the CURRENT checkout — same repository, same branch, same commit, clean tree — and
 * answered `not-examined` on any miss. That made the floor unfalsifiable for the case it most needed to
 * judge: a session dispatched to press a pull request under rule 10 authored no diff and stands on no
 * relevant branch, so it failed check 2 every single time. The only way through was `--acknowledge
 * codex-loop-incomplete` on every press, and a floor acknowledged every time is not a floor.
 *
 * So the question moved to where it belongs. `./landingGateRun.ts` reads what THIS MACHINE records about the
 * pull request's own head: every checkout holding that head commit that has evidence on its branch is asked
 * (`./branchEvidenceRoots.ts` says why the rest cannot change the answer), and the ledger's freshness is
 * judged against the head's own fingerprint (`commitTreeFingerprint`, `./gitDiff.ts`) rather than against
 * whatever tree the presser has open.
 *
 * **This is not a loosening, and the arithmetic says so.** A fingerprint is a pure function of git's tree
 * object for a clean tree, so the head's fingerprint is byte-identical to what the old code computed —
 * because the old checks only ever ADMITTED a checkout sitting clean at that same head commit. Every loop
 * that passed before passes now, every loop that failed before still fails, and what is gone is a
 * precondition about who was standing where.
 *
 * It also CLOSES a hole the old keying left open on purpose. `ledgerForBranch` keys on `repoRoot` — an
 * absolute path — precisely to stop a plan run on a same-named branch in an unrelated repository satisfying
 * the plan floor, and `docs/doctrine-rationale/rule-9.md` records the residue: reuse the path, and the predecessor's
 * records still match. Requiring the checkout to HOLD the pull request's head commit is strictly stronger
 * than comparing paths, and a different repository at a reused path holds no such commit.
 *
 * ## NOT-EXAMINED is never clean, and it is still reached
 *
 * When no checkout on this machine can answer — none holds the head commit, none has a matching origin, or
 * the record scan was incomplete — the answer is `not-examined`, which still produces the finding. That
 * asymmetry is the whole design: "we could not tell" must cost the same as "we looked and it was incomplete",
 * or every future gap in association silently becomes a pass. What {@link associateCodexLoop} checks now is
 * that a reading answers for the pull request in front of it, which is the one thing the pure half can still
 * get wrong now that the reader is no longer tied to the current checkout — both landing verbs read the floor
 * TWICE, and the second read must not be allowed to answer for a different pull request than the first.
 */

import { absentAs } from "#lib/absent.js";
import type { DoorAcknowledgement } from "../admit/types.js";
import type { LocalCodexLoopRead } from "./landingGateTypes.js";
import { leftoverFailures, type ReviewLeftover } from "./reviewLeftovers.js";
import { statesAReason } from "./statesAReason.js";

/**
 * The finding subject both landing verbs report under, and the one an operator names to waive it.
 *
 * ONE subject covers every way the loop can be incomplete — a missing plan, a post-hoc plan, a missing or
 * stale review, a `BROKEN` one, or an association that could not be made. That is a deliberate trade rather
 * than an oversight: a per-failure subject set would let someone waive "no plan ran" while believing they had
 * waived something smaller, and the detail lines say exactly which failures are being waived. Naming it
 * requires a reason, and the reason is written to the door ledger.
 */
export const CODEX_LOOP_SUBJECT = "codex-loop-incomplete";

/** The pull request a landing verb is about, as the remote describes it. */
export interface PullRequestHead {
  /** `owner/name`, exactly as the verb was asked for. */
  readonly repository: string;
  /** The pull request's head branch — GitHub's `headRefName`. */
  readonly branch: string;
  /** The pull request's head commit — GitHub's `headOid`. */
  readonly headSha: string;
  /**
   * The base branch's commit as GitHub reads it — `baseRefOid` — which a ratchet bump is judged against
   * (`./baselineBumpWitness.ts`). `undefined` only where no pull request exists: `codex status --check` asks
   * about a local branch tip, and a bump read handed one refuses rather than guessing a base.
   */
  readonly baseSha: string | undefined;
}

/** Whether a local reading may speak for the pull request, and what it says if so. */
export type CodexLoopInspection =
  | {
      readonly kind: "examined";
      readonly failures: readonly string[];
      /** Current `BROKEN` reviews past the second review pass, each landed only on an acknowledgement with a reason. */
      readonly leftovers: readonly ReviewLeftover[];
    }
  | { readonly kind: "not-examined"; readonly reason: string };

/** The one finding, when the loop does not clear the floor. */
export interface CodexLoopFinding {
  readonly subject: typeof CODEX_LOOP_SUBJECT;
  /** One line per obligation, or the single reason the local checkout could not answer. */
  readonly details: readonly string[];
}

/**
 * Decide whether a reading answers for THIS pull request, and if so what the records say.
 *
 * The reader (`./landingGateRun.ts`) is told which pull request to answer for, so the association it cannot
 * make for itself is the only one left here: that the reading in hand is about the pull request the caller is
 * holding. Both landing verbs read the floor twice — once to judge, once immediately before the mutation —
 * and a second reading that answered for a different pull request would otherwise be accepted as this one's.
 *
 * Each field is compared rather than trusting the reader, because the cost of being wrong is asymmetric: a
 * mismatch means some caller paired a reading with the wrong head, and reporting `not-examined` there is a
 * refusal, while silently accepting it would land unreviewed code.
 *
 * @param local what this machine could be read to say about the pull request, or why it could not be read
 * @param head the pull request being landed
 * @returns the recorded failures when the reading answers for this pull request, otherwise `not-examined`
 */
export function associateCodexLoop({
  local,
  head,
}: {
  local: LocalCodexLoopRead;
  head: PullRequestHead;
}): CodexLoopInspection {
  if (local.kind === "unreadable") {
    return { kind: "not-examined", reason: local.reason };
  }
  const { evidence } = local;
  if (evidence.repository !== head.repository) {
    return {
      kind: "not-examined",
      reason: `the reading answers for ${evidence.repository}, but the pull request is in ${head.repository}`,
    };
  }
  if (evidence.branch !== head.branch) {
    return {
      kind: "not-examined",
      reason: `the reading answers for branch ${evidence.branch}, but the pull request's head branch is ${head.branch}`,
    };
  }
  if (evidence.headSha !== head.headSha) {
    return {
      kind: "not-examined",
      reason: `the reading answers for ${evidence.headSha}, but the pull request's head is ${head.headSha}`,
    };
  }
  if (evidence.baseSha !== head.baseSha) {
    return {
      kind: "not-examined",
      reason: `the reading answers for base ${String(evidence.baseSha)}, but the pull request's base is ${String(head.baseSha)}`,
    };
  }
  return { failures: evidence.failures, kind: "examined", leftovers: evidence.leftovers };
}

/**
 * The finding to report, or `undefined` when the loop genuinely cleared the floor.
 *
 * Only an EXAMINED reading with no failures and no leftovers is clean. Every other shape produces the finding,
 * including one that could not be examined at all — see this module's header for why that asymmetry is the
 * point. A leftover (a CURRENT `BROKEN` review past the second pass) stays part of the finding: no description
 * names it, so it lands only on an acknowledgement with a reason (`./reviewLeftovers.ts`).
 *
 * @param inspection what {@link associateCodexLoop} concluded
 * @returns the finding, or `undefined`
 */
export function codexLoopFinding({ inspection }: { inspection: CodexLoopInspection }): CodexLoopFinding | undefined {
  if (inspection.kind === "not-examined") {
    return { details: [`the Codex loop could not be examined: ${inspection.reason}`], subject: CODEX_LOOP_SUBJECT };
  }
  const details = [...inspection.failures, ...leftoverFailures({ leftovers: inspection.leftovers })];
  if (details.length === 0) {
    return undefined;
  }
  return { details, subject: CODEX_LOOP_SUBJECT };
}

/** Whether a printed finding is being waived or is still standing. */
export type CodexLoopFindingState = "ACKNOWLEDGED" | "refused";

/**
 * The finding as printed lines, one per obligation, for both landing verbs.
 *
 * ONE renderer, because a waiver that prints only its reason lands over failures nobody was shown. Measured:
 * `github merge --admin` printed `ACKNOWLEDGED: codex-loop-incomplete — reason: …` and nothing else, so two
 * pull requests landed through `github lap --land` on a relayed reason while every review stood STALE, and
 * the BROKEN properties behind them were never on the page. `github enqueue` already printed each detail.
 *
 * @param finding the finding to print
 * @param state whether the invocation's acknowledgement waives it
 * @returns `<state>: codex-loop-incomplete: <detail>` per detail, in order
 */
export function codexLoopFindingLines({
  finding,
  state,
}: {
  finding: CodexLoopFinding;
  state: CodexLoopFindingState;
}): readonly string[] {
  return finding.details.map((detail) => `${state}: ${CODEX_LOOP_SUBJECT}: ${detail}`);
}

/**
 * The acknowledgement to record when the pairing floor is waived, or `undefined` when it is not waived.
 *
 * ONE function for both landing verbs, deliberately: an acknowledgement rule stated twice is a rule that
 * drifts, and this one has an obligation attached — a reason — that a second copy would eventually forget.
 * It answers only "did this caller cover the subject, with a reason"; whether a finding was RAISED is the
 * caller's own question, because writing an acknowledgement for a floor nobody failed would make the
 * ledger's waiver count useless in the opposite direction.
 *
 * @param acknowledge the exact subjects the caller named
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @param reason the caller's stated reason; one with nothing visible in it waives nothing
 * @returns the acknowledgement to write at the door, or `undefined`
 */
export function codexLoopWaiver({
  acknowledge,
  acknowledgeAll,
  reason,
}: {
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
  reason: string | undefined;
}): DoorAcknowledgement | undefined {
  const covered = acknowledgeAll || acknowledge.includes(CODEX_LOOP_SUBJECT);
  if (!covered || reason === undefined || !statesAReason({ reason })) {
    return undefined;
  }
  return { reason, subject: CODEX_LOOP_SUBJECT };
}

/**
 * The one-line summary a landing report prints for the finding.
 *
 * @param finding the finding to describe
 * @returns a single line naming the count and the first obligation, with the rest left to the detail lines
 */
export function codexLoopSummary({ finding }: { finding: CodexLoopFinding }): string {
  const [first] = finding.details;
  const rest = finding.details.length - 1;
  const more = rest > 0 ? ` (+${String(rest)} more)` : "";
  return `the Codex pairing floor is unmet: ${absentAs({ value: first, whenAbsent: "no detail recorded" })}${more}`;
}
