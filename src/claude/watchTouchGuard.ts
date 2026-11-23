/**
 * The one guard every refresh the watch runs must pass: which stores a tick may touch or repair, and why the rest
 * are held back.
 *
 * Split out of `watchTick.ts` along the seam between DECIDING which plan is active and deciding what a refresh may
 * then reach. Both a keep-alive touch and a probe repair are refreshes, and a refresh of the store holding the
 * active slot's credential revokes the token every running session authenticates with, so both read this module.
 */
import type { ActiveFrom } from "./watchTickActiveSlot.js";

/**
 * Why a store that is due a refresh is nonetheless being left alone.
 *
 * @param active the plan the fleet is on, when either source answered
 * @param activeFrom which source answered, since `unknown` holds every store back rather than one
 * @param alias the store being considered
 * @param sharesActiveCredential every store observed holding the active slot's own credential
 * @returns the reason, or undefined when this store may be touched
 */
function refreshHeldBack({
  active,
  activeFrom,
  alias,
  sharesActiveCredential,
}: {
  active?: string;
  activeFrom: ActiveFrom;
  alias: string;
  sharesActiveCredential: readonly string[];
}): string | undefined {
  // `none` is deliberately NOT in the branch above, and deliberately still subject to the two below. The
  // blanket hold rests on "any store could be the one whose account the active slot holds", which a dead
  // slot has already answered: it holds nobody's. The byte comparison is a different claim and survives —
  // review pass r1 (`dead-slot-release-cannot-revoke-a-live-token`) falsified releasing it. An `expired`
  // reading is of the ACCESS token, and `credentialDocument.ts` measures the REFRESH grant beside it at 27
  // to 29 days, so a store byte-matching a dead slot can still hold a grant that slot could have used;
  // refreshing that store mints a new one and revokes it, leaving a browser sign-in as the only repair.
  // Excluding `none` from this branch alone is what the starvation actually needed: on the machine that was
  // measured `sharesActiveCredential` is empty, so all four stores are released either way.
  if (activeFrom === "unknown") {
    return (
      `${alias} is not being touched because no plan could be identified as active, so any store could be ` +
      `the one whose account the active slot holds and refreshing it could revoke the live credential`
    );
  }
  if (sharesActiveCredential.includes(alias)) {
    return (
      `${alias} holds the same credential as the active slot, so refreshing it would revoke the token ` +
      `every running session is authenticating with`
    );
  }
  if (alias === active) {
    if (activeFrom === "pinned") {
      return `${alias} is the store this watch process is itself booted against, so it refreshes itself under ordinary use`;
    }
    return `${alias} is the active plan (${activeFrom}), so it refreshes itself under ordinary use`;
  }
  return undefined;
}

/**
 * Split the stores that are due a refresh into the ones this tick may touch and the reasons the rest are
 * being left alone.
 *
 * @param active the plan the fleet is on, when either source answered
 * @param activeFrom which source answered, since `unknown` holds every store back rather than one
 * @param due the stores the keep-alive schedule says are due, in configured order
 * @param sharesActiveCredential every store observed holding the active slot's own credential
 * @returns the stores to touch, and one sentence per store held back
 */
export function splitTouches({
  active,
  activeFrom,
  due,
  sharesActiveCredential,
}: {
  active?: string;
  activeFrom: ActiveFrom;
  due: readonly string[];
  sharesActiveCredential: readonly string[];
}): { touch: readonly string[]; touchSkipped: readonly string[] } {
  const considered = due.map((alias) => ({
    alias,
    heldBack: refreshHeldBack({
      activeFrom,
      alias,
      sharesActiveCredential,
      ...(active === undefined ? {} : { active }),
    }),
  }));
  return {
    touch: considered.filter((entry) => entry.heldBack === undefined).map((entry) => entry.alias),
    touchSkipped: considered.flatMap((entry) => (entry.heldBack === undefined ? [] : [entry.heldBack])),
  };
}

/**
 * Which of the stores this tick probed it may repair, under exactly the guard the keep-alive touch obeys.
 *
 * The note telling the owner to sign a plan in (`monitor/claudePlanUnusable.ts`) fires off the watch's own
 * probe. Probed bare, an idle store's expired ACCESS token reads `CREDENTIAL_REJECTED` every eight hours while
 * its refresh grant is weeks from expiry — a cache miss the pre-spawn gate repairs on demand, which the note
 * reported as a sign-out. MEASURED: 17 such notes across four plans
 * (`grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl" | grep "auth login"`). So the tick repairs a
 * refused store before it records the probe, and only a store the repair could not heal reaches the note.
 *
 * A repair IS a refresh, so it takes the touch's guard whole rather than a part of it: never a store holding the
 * active slot's own credential, never the resolved active plan, and nothing at all when no plan could be named
 * active. The byte comparison alone is not enough, since it would refresh the active plan's store as soon
 * as its first refresh made the bytes differ — revoking the token every running session authenticates with. A
 * store this holds back can still raise the note; that is the price of never revoking a live token.
 *
 * And it clears nothing when the active plan was only INFERRED. A repair runs before the tick can be decided
 * again, so it must rest on an answer a re-probe cannot overturn. The case: the first
 * probes DEDUCE plan A active because it is the one unidentified store, B is repaired, and B's re-probe names
 * the slot's own organisation — the refresh already ran under the plan the fleet is on. `deduced` and
 * `recorded` are exactly the answers a new identity can overturn, so they clear no repair; the note may fire
 * there, as it did before the watch repaired anything. The residue, stated: under `identified` or `observed`, a
 * repaired store whose re-probe names the SAME organisation is one account in two stores, which the identity
 * alarm already reports as DUPLICATE, and its bytes differ from the slot's, so it does not hold the slot's grant.
 *
 * @param active the plan this tick resolved as active, from the FIRST probes, before any repair
 * @param activeFrom which source named it — `unknown`, `deduced` and `recorded` clear nothing
 * @param probed every store this tick probed, in configured order
 * @param sharesActiveCredential every store observed holding the active slot's own credential
 * @returns the stores a repair may refresh, in configured order
 */
export function storesClearedForRepair({
  active,
  activeFrom,
  probed,
  sharesActiveCredential,
}: {
  active?: string;
  activeFrom: ActiveFrom;
  probed: readonly string[];
  sharesActiveCredential: readonly string[];
}): readonly string[] {
  if (activeFrom === "deduced" || activeFrom === "recorded") {
    return [];
  }
  return splitTouches({ activeFrom, due: probed, sharesActiveCredential, ...(active === undefined ? {} : { active }) })
    .touch;
}

/**
 * The tick decided again after a repair, with its touches held to what BOTH decisions allow.
 *
 * A repair's re-probe can identify a store the first probes could not, and that can move which plan resolves
 * as active. The case: the first probes DEDUCE plan A active, so A is held from repair;
 * a repaired B then identifies as the slot's organisation, the second decision names B, and A — due and inside
 * its refresh window — lands in the second plan's touches. Two readings of one slot that disagree are evidence
 * neither is certain, so a store either one protects stays untouched this tick, and says why.
 *
 * @param first the plan decided from the first probes, before any repair
 * @param second the plan decided again from each store's effective reading
 * @returns the second plan, touching only what the first also cleared
 */
export function touchesHeldByBothDecisions<Plan extends { touch: readonly string[]; touchSkipped: readonly string[] }>({
  first,
  second,
}: {
  first: Plan;
  second: Plan;
}): Plan {
  const held = second.touch.filter((alias) => !first.touch.includes(alias));
  if (held.length === 0) {
    return second;
  }
  return {
    ...second,
    touch: second.touch.filter((alias) => first.touch.includes(alias)),
    touchSkipped: [
      ...second.touchSkipped,
      ...held.map(
        (alias) =>
          `${alias} is not being touched because this tick's first probes held it back, and a repair's re-probe ` +
          `changing that answer is not enough to refresh a store that could hold the live credential`,
      ),
    ],
  };
}
