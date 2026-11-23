/**
 * The FAILING half of `./landing.ts`'s ladder: the first failed test's own act, in the owner's order.
 *
 * Its own module because `./landing.ts` is near its file-size ceiling. The order, and why each rung sits where
 * it does, is documented on `landingAction` there.
 *
 * An advisory-only red never reaches this ladder as a failure: `./landingTests.ts`'s `ci-green` passes a red that
 * `./landingCiFailure.ts` proves advisory, so a failed `ci-green` here is always a red the base requires or one
 * this read could not classify, and it is always `spawn-ci`.
 *
 * Pure. No I/O.
 */

import type { LandingAction, LandingTest, LandingTestId } from "./landing.js";
import type { PrReviewState } from "./reviewState.js";

/** One rung's answer: the act, and the sentence behind it. */
interface LadderStep {
  readonly action: LandingAction;
  readonly detail: string;
}

/** The failing test with the given id, or undefined when it did not fail. */
function failed({ tests, id }: { tests: readonly LandingTest[]; id: LandingTestId }): LandingTest | undefined {
  return tests.find((test) => test.id === id && test.verdict === "fail");
}

/**
 * The first FAILING test's own act, or undefined when none failed.
 *
 * @param tests the six landing tests, each with its verdict
 * @param state the pull request's answers, for the CodeRabbit arm and the stack
 * @returns the act and its sentence, or undefined when no test failed
 */
export function failureLadder({
  tests,
  state,
}: {
  tests: readonly LandingTest[];
  state: PrReviewState;
}): LadderStep | undefined {
  const draft = failed({ id: "undrafted", tests });
  if (draft !== undefined) {
    return { action: "draft", detail: draft.why };
  }
  const mergeable = failed({ id: "mergeable", tests });
  if (mergeable !== undefined) {
    return { action: "conflicting", detail: mergeable.why };
  }
  const ci = failed({ id: "ci-green", tests });
  if (ci !== undefined) {
    return { action: "spawn-ci", detail: ci.why };
  }
  return afterCi({ state, tests });
}

/** Every rung below CI, in order. */
function afterCi({ tests, state }: { tests: readonly LandingTest[]; state: PrReviewState }): LadderStep | undefined {
  // CodeRabbit is tested BEFORE the queue, which is what `./landing.ts`'s header has always said and what the
  // code must do: a stacked or queueless pull request carrying `changes-requested` read
  // `stacked`/`no-queue` and its CodeRabbit list never surfaced. The reasoning is the one already written for
  // `spawn-ci` outranking `stacked` — working through that list is something a session can start THIS MINUTE,
  // and landing the bottom of the stack cannot do it for them. A Codex review found the mismatch. A `stuck`
  // verdict reads the same act: the row is what the read OBSERVED, and `--press` re-requests the review
  // before the dispatch list is built (`../cli/commands/github/landingCodeRabbitNudge.ts`).
  if (state.codeRabbit === "changes-requested" || state.codeRabbit === "stuck") {
    return { action: "spawn-coderabbit", detail: state.codeRabbitDetail };
  }
  const queueable = failed({ id: "queue-available", tests });
  if (queueable !== undefined) {
    return { action: state.stack.stacked ? "stacked" : "no-queue", detail: queueable.why };
  }
  const threads = failed({ id: "threads-clear", tests });
  if (threads !== undefined) {
    return { action: "answer-threads", detail: threads.why };
  }
  const owners = failed({ id: "codeowners-satisfied", tests });
  return owners === undefined ? undefined : { action: "blocked-on", detail: owners.why };
}
