/**
 * A review pass that earns ONE fresh thread after the provider's content-policy refusal.
 *
 * Why one and not more, both MEASURED (`./policyRefusal.ts`): the refusal is not deterministic per request —
 * identical reviews were both refused and answered — so a second thread is a real chance; and OpenAI's own
 * safety-checks page says repeated flags can limit an account for days, so a loop would spend the fleet's
 * standing on a coin that already came up tails twice. After two refusals the review falls to a visible
 * Claude session (`codex review-fallback prepare --after-refusal <artifactId>`), which is rule 9's fallback.
 *
 * Only the INITIAL turn refused earns it. A refusal on the conclusion turn, after the initial turn was
 * aborted at the warn, has already spent the bound on one thread, and no fallback could stand on it
 * (`./policyFallback.ts` wants exactly an initial and a retry, both refused).
 *
 * The retry is a FRESH thread, never a resume of the refused one, and it runs inside what remains of the
 * ORIGINAL deadline: the original warn instant stays the warn instant when it is still ahead, and when it has
 * passed the retry gets the remainder with no warn of its own. Restarting the clock is how a 10-minute bound
 * becomes 18.5 minutes, the rule `./runPass.ts` opens with. A plan never comes through here, so a plan never
 * retries.
 */

import { transportFaultRefusal } from "./policyRefusal.js";
import { buildPolicyRetryPrompt } from "./prompt.js";
import { type BoundedPassResult, runBoundedPass } from "./runPass.js";
import type { PlanAnswer, ReviewAnswer } from "./types.js";

/** What one bounded review pass is given, exactly as `runBoundedPass` takes it for a plan or review answer. */
type BoundedPassArgs = Parameters<typeof runBoundedPass<PlanAnswer | ReviewAnswer>>[0];

/**
 * Run a review pass, and on a refused initial turn run ONE fresh thread inside the original deadline, on the
 * same prompt behind a preamble naming the review as authorised (`buildPolicyRetryPrompt`).
 *
 * @param args the review pass, exactly as `runBoundedPass` would run it
 * @returns every attempt from both threads, the last thread's outcome, and the wall-clock consumed
 */
export async function runReviewPassWithPolicyRetry(
  args: Omit<BoundedPassArgs, "kind" | "anchorMs">,
): Promise<BoundedPassResult> {
  const { bound, runtime } = args;
  const startedAtMs = runtime.nowMs();
  // Both threads anchor on this one reading, so their warn and deadline are the same absolute instants.
  const first = await runBoundedPass({ ...args, anchorMs: startedAtMs });
  const outcome = first.outcome;
  if (outcome.kind !== "fatal" || transportFaultRefusal({ cause: outcome.cause }) === null) {
    return first;
  }
  const [initial, ...afterInitial] = first.attempts;
  const initialRefused = initial?.kind === "initial" && initial.status === "failed" && afterInitial.length === 0;
  if (!initialRefused || runtime.nowMs() >= startedAtMs + bound.totalMs) {
    return first;
  }
  // The SAME bound, anchored at the first thread's start: the retry's warn and deadline are the original
  // absolute instants, however long passes before it arms (`armBound`).
  const secondThread = await runBoundedPass({
    ...args,
    anchorMs: startedAtMs,
    kind: "policy-retry",
    prompt: buildPolicyRetryPrompt({ prompt: args.prompt }),
  });
  return {
    attempts: [...first.attempts, ...secondThread.attempts],
    observedElapsedMs: runtime.nowMs() - startedAtMs,
    outcome: secondThread.outcome,
  };
}
