/**
 * Whether a Claude fallback pass may be prepared at all: the FLEET's cap, taken from the one verdict every
 * other Codex cap reader takes.
 *
 * Split from `./fallbackReview.ts`, which owns the request/receipt documents, because this is the one
 * decision both fallback verbs take before either document exists. The rule is that a visible
 * Claude session takes the pass when Codex is capped; with a second registered account, "Codex is capped" is
 * a statement about the whole register, and a fallback prepared while one destination is still open would
 * mint a receipt asserting a cap that was not there.
 *
 * **One verdict, never a second judgement.** This module used to rebuild the fleet's cap from each
 * destination's gauge alone, while `codex review` routed on `./fleetCap.ts`'s ranking. The two disagreed
 * wherever a gauge says less than the ranking knows — a signed-out store has no gauge, a cached exhaustion
 * record has none, a 99% row is past the routing pause — and each disagreement was a deadlock: `codex
 * review` refused "no registered destination can take this pass" and `prepare` refused "Codex is OPEN" over
 * the same fleet (including one fleet of three 99% rows beside two capped ones). So the
 * decision here is a function of {@link CodexFleetCap} and nothing else.
 *
 * **Two grounds, one arm.** A fallback is prepared when `codex review` has nowhere to go AND either a real
 * provider cap was read (`capEvidence`) or the fleet is held at the routing pause (`routingPause`). The
 * second closes the last deadlock: with every account at 99% weekly, `codex review` refused and
 * `prepare` refused too, so a seat had no review route (rule 9 says a Codex cap stops nothing). The receipt
 * stays honest about which ground it stood on, because `blockedBy` is that ground's own sentence and a pause
 * names itself "not a provider cap".
 *
 * **A third ground that is not capacity at all.** An adopted register with no Codex row (`fleet.providerUnregistered`)
 * licenses the fallback too — Claude is then the configured provider — but its decision carries a
 * `CodexProviderUnregisteredEvidence` rather than cap evidence, so no receipt can say Codex was capped
 * (`./providerUnregistered.ts`).
 *
 * Pure. `cli/commands/codex/fallbackCapRead.ts` reads the fleet and hands the verdict here.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import type { FallbackCapEvidence } from "./fallbackReview.js";
import type { CodexFleetCap } from "./fleetCap.js";
import type { CodexProviderUnregisteredEvidence } from "./providerUnregistered.js";

/** What `prepare` decided about the cap: evidence to record, or the refusal detail. */
export type FallbackCapDecision =
  /** Licensed without the hatch — a provider cap or the fleet's routing pause, `blockedBy` saying which. */
  | { readonly kind: "capped"; readonly evidence: FallbackCapEvidence }
  /** Not capped, but the hatch is open — the evidence says so, and the caller prints the override loudly. */
  | { readonly kind: "overridden"; readonly evidence: FallbackCapEvidence }
  /** No Codex plan is registered at all — its own ground, never cap evidence (`./providerUnregistered.ts`). */
  | { readonly kind: "unregistered"; readonly evidence: CodexProviderUnregisteredEvidence }
  | { readonly kind: "refused"; readonly detail: string };

/**
 * Decide whether a fallback may be prepared, from the fleet's own verdict and the hatch.
 *
 * **The FLEET, never one account.** A fallback spends a visible Claude session in place of Codex, so it is
 * legitimate only when nothing registered can take the pass AND a row is out for capacity: a destination the
 * ranking would spend is a routing decision, and a fleet that is merely unavailable — every row paused, signed
 * out, at its usage limit or not measured, none refusing and none near-cap — has no capacity ground to cite. A
 * provider cap's `blockedBy` is the fleet's own `why`, the sentence `codex status` prints after `CAPPED:`; a
 * routing pause's is the pause's own sentence with every excluded row, its `limitId` null since no provider
 * limit refused. `reachedType` is null on both: the fleet's evidence
 * is merged from a cache, a log and a live answer, and naming one rollout event's reached type beside it
 * would attribute the cap to a source that may not have been the one read. The hatch is a value here — the
 * caller reads the variable into a local and passes it, never as a parameter default (`hatch-release` in
 * `yarn lint`).
 *
 * @param fleet the one verdict `./fleetCap.ts` reached over every registered destination
 * @param hatchOpen whether the verb's own uncapped hatch was set
 * @param hatchEnv that hatch's full variable name, so an overridden request records which one opened it
 * @param nowIso the instant, for the evidence an overridden request records
 * @returns the decision
 */
export function decideFallbackCap({
  fleet,
  hatchOpen,
  hatchEnv,
  nowIso,
}: {
  fleet: CodexFleetCap;
  hatchOpen: boolean;
  hatchEnv: string;
  nowIso: string;
}): FallbackCapDecision {
  if (fleet.capEvidence !== undefined) {
    return {
      evidence: {
        blockedBy: fleet.why,
        limitId: unsetFieldAsNull({ record: fleet.capEvidence, key: "limitId" }),
        observedAtIso: fleet.capEvidence.observedAtIso,
        reachedType: null,
      },
      kind: "capped",
    };
  }
  if (fleet.routingPause !== undefined) {
    return {
      evidence: {
        blockedBy: fleet.routingPause.why,
        limitId: null,
        observedAtIso: fleet.routingPause.observedAtIso,
        reachedType: null,
      },
      kind: "capped",
    };
  }
  // Ahead of the hatch: on a Claude-only install the fallback is the configured route, not an override.
  if (fleet.providerUnregistered !== undefined) {
    return { evidence: fleet.providerUnregistered, kind: "unregistered" };
  }
  if (hatchOpen) {
    return {
      evidence: {
        blockedBy: `no fleet-wide cap was read; prepared under ${hatchEnv}=1`,
        limitId: null,
        observedAtIso: nowIso,
        reachedType: null,
      },
      kind: "overridden",
    };
  }
  if (fleet.destination !== undefined) {
    return { detail: `${fleet.why} — route the pass there instead of spending a Claude fallback`, kind: "refused" };
  }
  return { detail: fleet.why, kind: "refused" };
}
