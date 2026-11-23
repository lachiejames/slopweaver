/**
 * Admission, then routing, then exactly one pass — the order every `codex plan` and `codex review` pass runs
 * in, and the one place it is written down.
 *
 * ```text
 * slot opens → admission → duplicate: refused, no fleet read, no reservation
 *                        → admitted:  reserve + route THIS pass → unroutable: refused, no client, nothing held
 *                                                               → routed:     admission again → duplicate: refused
 *                                                                                              → admitted:  run one pass
 *                                                                             → release, in `finally`, either way
 * ```
 *
 * The reservation is taken in the same locked step that routes (`codex/passReservationStore.ts`): on an account
 * the owner gave a usage limit, a pass that routes holds one weekly point until it finishes, so concurrent passes
 * cannot each read the same headroom and together cross the limit. It is released however `run` ends — completed
 * or thrown — and a release that fails is printed and left to expire, never allowed to replace the pass's result.
 *
 * Routing used to happen ONCE per invocation, before the fan-out, so every property of a review shared the
 * client one fleet reading had chosen — however long the later properties waited for a slot, and however the
 * fleet had moved by then. And because admission was asked inside the pass, a duplicate still paid for a
 * fleet read and a client it would never use. Now `runPlanPass` and `runReviewProperty` take only a routed
 * client, and the only way to get one here is through admission first, so the type rules out routing a pass
 * the duplicate gate would refuse.
 */
import type { LockedCodexClient } from "../../../codex/client.js";
import { type CompletedPass, fanOutReview } from "../../../codex/orchestrate.js";
import { type AdmittedPass, admittedPass, type PassAdmission } from "../../../codex/passAdmission.js";
import type { PassBound, ReviewProperty } from "../../../codex/types.js";
import type { PassAdmit } from "./admitFor.js";
import { type CodexDeps, routedCodexPass } from "./passDeps.js";

/**
 * What an invocation produced: a real pass, or one of two refusals that spent nothing.
 *
 * A discriminated union rather than a `CompletedPass` with an empty record, because a refused pass has no
 * usage, no attempts and no artifact — and manufacturing a zero-token record for one would put a fake
 * measurement into the very ledger `codex usage` reads. `codex/types.UsageMeasurement` exists to keep "not
 * measured" and "zero" apart; a synthesised record would defeat it at the source.
 *
 * Assembled here and nowhere else: admission and routing both happen BEFORE a pass function is called, so
 * `runPlanPass` and `runReviewProperty` only ever receive admitted, routed work and return the pass it
 * completed.
 */
export type PassInvocation =
  | { readonly kind: "completed"; readonly pass: CompletedPass }
  /** Admission found an exact conclusive duplicate, so the pass was never routed. */
  | { readonly kind: "refused"; readonly admission: PassAdmission }
  /** Admitted, but no registered destination could take it; the routing refusal was printed when it was made. */
  | { readonly kind: "unrouted"; readonly exitCode: number };

/** What an admitted, routed pass runs with: admission's proof it may run, and the client it was routed to. */
interface AdmittedRoute {
  readonly admitted: AdmittedPass;
  readonly client: LockedCodexClient;
}

/** Where a pass is routed from: the seams, the state home, the model and the bound — read afresh for every pass. */
export interface PassRouteRequest {
  /** The pass's own bound, which dates a reservation's expiry. */
  readonly bound: PassBound;
  readonly deps: CodexDeps;
  readonly home: string;
  readonly model: string;
}

/**
 * Admit one pass, reserve and route it, run it on the client it was routed to, and release what it reserved.
 *
 * A duplicate returns before the fleet is read at all; an admitted pass the fleet cannot take returns the
 * routing refusal's exit code, already printed by `routedCodexPass`, and never reaches `run`. A routed pass is
 * admitted once more before it runs, since the fleet read awaited and the tree or the ledger may have moved.
 *
 * @param admit the duplicate gate, asked first
 * @param route what the routing read needs, asked only once admission let the pass through
 * @param run the pass itself, handed admission's proof and the routed client
 * @returns what the invocation produced: a completed pass, a duplicate refusal, or an unroutable one
 */
export async function admittedRoutedPass({
  admit,
  route,
  run,
}: {
  admit: PassAdmit;
  route: PassRouteRequest;
  run: (args: AdmittedRoute) => Promise<CompletedPass>;
}): Promise<PassInvocation> {
  const admission = admit();
  if (admittedPass({ admission }) === undefined) {
    return { admission, kind: "refused" };
  }
  const routed = await routedCodexPass({ bound: route.bound, deps: route.deps, home: route.home, model: route.model });
  if (typeof routed === "number") {
    return { exitCode: routed, kind: "unrouted" };
  }
  try {
    // Asked AGAIN, in the same synchronous step that starts the pass, because the fleet read above awaited: the
    // checkout can move while it does, and a plan pass freezes the tree as it stands when it STARTS, so a proof
    // minted for HEAD A must not run HEAD B (found by a Codex review). No await separates this admission from the
    // pass's own freeze, which is main's admit-then-freeze order; a pass that became a duplicate spends nothing,
    // and the `finally` releases what it reserved.
    const recheck = admit();
    const admitted = admittedPass({ admission: recheck });
    if (admitted === undefined) {
      return { admission: recheck, kind: "refused" };
    }
    return { kind: "completed", pass: await run({ admitted, client: routed.client }) };
  } finally {
    await routed.release();
  }
}

/**
 * Fan a review out across its properties, each admitted and then routed when ITS OWN slot opens.
 *
 * Every property re-runs the same admission and the same routing read, so a property queued behind others
 * is routed on the fleet as it stands when it starts, and a duplicate property costs no routing while its
 * siblings route normally. The concurrency cap is `fanOutReview`'s, unchanged.
 *
 * @param admitOf builds one property's duplicate gate
 * @param concurrency the explicit parallelism cap
 * @param properties the falsifiable claims, one pass each, in the order the invocations are returned
 * @param route what each property's routing read needs
 * @param run one property's pass, handed the client that property was routed to
 * @returns one invocation per property, in property order
 */
export async function fanOutAdmittedReview({
  admitOf,
  concurrency,
  properties,
  route,
  run,
}: {
  admitOf: (args: { property: ReviewProperty }) => PassAdmit;
  concurrency: number;
  properties: readonly ReviewProperty[];
  route: PassRouteRequest;
  run: (args: AdmittedRoute & { property: ReviewProperty }) => Promise<CompletedPass>;
}): Promise<readonly PassInvocation[]> {
  return fanOutReview({
    concurrency,
    properties,
    runOne: ({ property }) =>
      admittedRoutedPass({
        admit: admitOf({ property }),
        route,
        run: ({ admitted, client }) => run({ admitted, client, property }),
      }),
  });
}
