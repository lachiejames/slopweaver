/**
 * The pure projection from a controlled turn's durable {@link TurnCompletion} onto the ONE ask-lifecycle
 * event it earns — never more than one. Moved out of `cli/commands/turn/run.ts` so the integration lane can
 * build the exact same event the production path builds, rather than recreating an approximation of it.
 *
 * `lifecycleEventForCompletion` reads its identity from `completion.askIdentity` — never a separately
 * supplied `Mention` — because a `TurnCompletion` and the `Mention` that produced it are two independently
 * constructed values; reading identity from the completion itself is what makes a mismatch between the two
 * impossible to smuggle through, rather than merely unlikely.
 */

import { askIdentityOf } from "../ask/identity.js";
import type {
  AnsweredEvent,
  AnswerLostEvent,
  FailedEvent,
  FirstAnsweredEvent,
  WithheldEvent,
} from "../ask/lifecycle.js";
import type { TurnCompletion } from "./envelope.js";
import { leaseExpiryFromNow } from "./tier.js";

/**
 * Project one turn's durable completion onto the ask-lifecycle event it earns.
 *
 * A `first-answered` completion earns the NON-terminal {@link FirstAnsweredEvent}, carrying the lease the
 * post re-arms: one fresh `DEFAULT_LEASE_HOURS` from `tsIso`, stored on the event rather than written over
 * the dispatch's own generation token.
 *
 * @param completion the turn's durable outcome, carrying its own exact ask identity
 * @param tsIso the clock, injected so the event's own timestamp is pinnable in a test
 * @returns the one event this completion earns — `answered`, `first-answered`, `withheld`, `failed` or
 *   `answer-lost`
 */
export function lifecycleEventForCompletion({
  completion,
  tsIso,
}: {
  completion: TurnCompletion;
  tsIso: string;
}): AnsweredEvent | FirstAnsweredEvent | WithheldEvent | FailedEvent | AnswerLostEvent {
  const base = { ...askIdentityOf({ source: completion.askIdentity }), tsIso };
  const primary = completion.primary;
  if (primary.kind === "answered") {
    return { ...base, answerTs: primary.answerTs, kind: "answered" };
  }
  if (primary.kind === "first-answered") {
    return {
      ...base,
      answerDigest: primary.answerDigest,
      answerTs: primary.answerTs,
      kind: "first-answered",
      leaseExpiresAt: leaseExpiryFromNow({ nowIso: tsIso }),
      owes: primary.followThrough.owes,
      what: primary.followThrough.what,
    };
  }
  if (primary.kind === "withheld") {
    return {
      ...base,
      code: primary.held.code,
      kind: "withheld",
      queueId: primary.held.id,
      reason: primary.held.reason,
    };
  }
  // `answer-lost` and `failed` are carried straight through rather than collapsed: the completion already
  // decided which claim this turn earns (`./envelope.ts`), and a projection that flattened them here would
  // reintroduce the exact conflation the fourth arm exists to end.
  return { ...base, kind: primary.kind, reason: primary.reason };
}
