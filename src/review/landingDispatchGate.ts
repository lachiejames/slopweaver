/**
 * The terminal evidence gate — what a TERMINAL dispatch verdict would be claiming and this read did not have.
 *
 * Split out of `./landingDispatch.ts` along the one seam that module's header names: the verdicts divide into
 * non-terminal session acts, which claim nothing about what happens after them, and terminal ones, which
 * promise an end state and so are issued only when nothing material is unread. The ladder there decides the
 * verdict; this module decides whether a terminal one may stand.
 *
 * Pure. No network, no clock, no filesystem.
 */

import type { DispatchDecision, DispatchInputs, DispatchVerdict } from "./landingDispatch.js";
import { type ConflictState, conflicting } from "./reviewState.js";

/**
 * One fact a TERMINAL verdict needs and this read did not have.
 *
 * A closed set rather than a sentence, so a consumer can say WHICH hole held a row back and a test can
 * assert it by name. The order is the order {@link unreadDispatchFacts} reports them in, which is roughly
 * "closest to the merge button first".
 *
 * @internal read through {@link DispatchUnread}; a consumer branches on the value, never imports the type.
 */
export type DispatchUnreadFact =
  | "mergeable"
  | "conflict-measurement"
  | "checks"
  | "check-contexts"
  | "reviews"
  | "threads"
  | "review-requests"
  | "labels"
  | "landing-test"
  | "slack-ask"
  | "bump";

/** One unread fact, with the sentence a reader sees. */
export interface DispatchUnread {
  readonly fact: DispatchUnreadFact;
  readonly why: string;
}

/**
 * Every fact a TERMINAL verdict would be claiming and this read could not establish, worst first.
 *
 * `baseDistance` is deliberately NOT here. It is context rather than a gate — a merge queue rebases, so
 * MEASURED: a pull request read `press` at 400 behind — and treating an unread distance as a hole would
 * hold back exactly the rows this verb exists to press. What the verdict may not do is CLAIM it was
 * measured, which is `rebaseWhy`'s job instead, in `./landingDispatch.ts`. Reproduce with `slopweaver github landing --repo
 * acme/acme-admin --author <login> --json` and compare each row's `baseDistance.value.behindBy` against
 * its `action`.
 *
 * @param inputs the row's state, its six tests and its conversation
 * @returns one entry per unestablished fact; empty when a terminal claim is safe
 */
export function unreadDispatchFacts({ inputs }: { inputs: DispatchInputs }): readonly DispatchUnread[] {
  const { state } = inputs;
  const unread: DispatchUnread[] = [];
  if (state.conflict.mergeable === "UNKNOWN") {
    unread.push({
      fact: "mergeable",
      why: "GitHub has not computed whether this merges into its base",
    });
  }
  if (conflicting({ conflict: state.conflict }) && state.conflict.local.kind !== "measured") {
    unread.push({ fact: "conflict-measurement", why: whyUnmeasured({ conflict: state.conflict }) });
  }
  if (state.checksRead.kind === "unread") {
    unread.push({ fact: "checks", why: state.checksRead.why });
  }
  if (state.checksTruncated) {
    unread.push({
      fact: "check-contexts",
      why: "the head has more check contexts than this read carried, so a failing one may be missing",
    });
  }
  if (state.reviewsTruncated) {
    unread.push({
      fact: "reviews",
      why: "GitHub has more reviews than this read carried, so a standing changes-requested may be missing",
    });
  }
  if (state.threadsTruncated) {
    unread.push({
      fact: "threads",
      why: "GitHub has more review threads than this read carried, and a capped read can only LOSE an open one",
    });
  }
  if (state.labelsTruncated) {
    unread.push({
      fact: "labels",
      why: "GitHub has more labels than this read carried, so an opt-out label may be invisible",
    });
  }
  if (state.githubCodeowners.requestsTruncated) {
    unread.push({
      fact: "review-requests",
      why: "GitHub reported more review requests than this read carried, so a pending code owner may be missing",
    });
  }
  const unknownTest = inputs.tests.find((test) => test.verdict === "unknown");
  if (unknownTest !== undefined) {
    unread.push({ fact: "landing-test", why: `${unknownTest.id} could not be answered: ${unknownTest.why}` });
  }
  return unread;
}

/**
 * Why a conflicting pull request's local merge established nothing.
 *
 * @returns the local merge's own reason, or the sentence saying none was attempted
 */
export function whyUnmeasured({ conflict }: { conflict: ConflictState }): string {
  return conflict.local.kind === "unmeasured"
    ? conflict.local.why
    : "GitHub reports it conflicting and no local merge was attempted, so the paths are unknown";
}

/**
 * The first fact standing between this row and a terminal verdict, or `undefined` when none does.
 *
 * @param unread every unestablished fact, as {@link unreadDispatchFacts} ordered them
 * @returns the one to report, worst first
 *
 * @internal exported for its own unit test; `dispatchDecision` in `./landingDispatch.ts` is the seam every caller uses.
 */
export function terminalEvidenceGate({ unread }: { unread: readonly DispatchUnread[] }): DispatchUnread | undefined {
  return unread[0];
}

/**
 * The NON-TERMINAL session acts, which name visible work and claim nothing about what happens after it.
 *
 * A set rather than a property of the branch that produced one: `coderabbit-loop` is reached from TWO places
 * — a `spawn-coderabbit` row and an `answer-threads` row only a bot is waiting on — and only one of them
 * used to skip the gate, so unread reviews elsewhere could suppress the second. A Codex review found the
 * inconsistency between this module's own header and that path. Naming the verdicts makes the rule
 * structural, so a future branch cannot reintroduce it. `draft-first-review-ask` is reached from two places
 * too (a `blocked-on` row and an `answer-threads` row), and neither it nor `finish-or-card-close` promises an
 * end state: each stops at a record for the owner's decision.
 */
const NON_TERMINAL_SESSION_ACTS: ReadonlySet<DispatchVerdict> = new Set<DispatchVerdict>([
  "rebase-and-fix",
  "coderabbit-loop",
  "draft-first-review-ask",
  "finish-or-card-close",
]);

/**
 * Every TERMINAL verdict passes through here; a non-terminal one and the owner-judgment verdict are exempt.
 *
 * @param decision the verdict the ladder reached, before the gate has had its say
 * @returns the decision unchanged, or `unread` naming the first fact a terminal claim would rest on
 */
export function gated({ decision, inputs }: { decision: DispatchDecision; inputs: DispatchInputs }): DispatchDecision {
  if (
    decision.kind !== "act" ||
    NON_TERMINAL_SESSION_ACTS.has(decision.verdict) ||
    decision.verdict === "needs-owner-judgment"
  ) {
    return decision;
  }
  const blocker = terminalEvidenceGate({ unread: unreadDispatchFacts({ inputs }) });
  if (blocker === undefined) {
    return decision;
  }
  return {
    kind: "unread",
    why: `${decision.verdict} would claim an end state, and ${blocker.fact} is unread: ${blocker.why}`,
  };
}
