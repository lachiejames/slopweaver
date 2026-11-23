/**
 * WHICH keys may name an ASSIGNEE — one of the two addressing acts this door performs, and the thinner one.
 *
 * The keyset, the collision rule and the held-candidate rule all live in `./personIndex.ts`, which states
 * why they are shared with `./mentionIndex.ts` and why they are NOT shared with `../slack/mentionIndex.ts`.
 * What stays here is what is specific to assignment: it names exactly ONE person, and its refusal has a
 * different fix to offer than a mention's does.
 */
import {
  type DeriveFreshness,
  freshnessAction,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
} from "../../silver/derive/freshness.js";
import type { DerivedRoster } from "../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../silver/identity.js";

import {
  buildLinearPersonIndex,
  type LinearPersonTarget,
  type LinearRosterReport,
  linearRosterReport,
} from "./personIndex.js";

/** One resolved assignee: the Linear user id to write, and which layer vouched for it. */
export type AssigneeTarget = LinearPersonTarget;

/** The addressable state of the roster, for a refusal message and for `--json`. */
type AssigneeRosterReport = LinearRosterReport;

/** The resolution for one write: what resolved, from where, and the roster state behind it. */
export interface AssigneeResolution {
  readonly target: AssigneeTarget | undefined;
  readonly roster: AssigneeRosterReport;
  /** True when the requested key names a HELD candidate — unresolvable BY DESIGN, and worth saying so. */
  readonly held: boolean;
}

/**
 * Build the assignee index from both layers.
 *
 * @param derived the derived roster from `corpus/silver/index/identities.json`
 * @param overrides the human roster from the store's identity roster
 * @returns the merged index (override wins) plus the keys dropped as ambiguous
 */
export function buildAssigneeIndex({
  derived,
  overrides,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
}): {
  readonly index: ReadonlyMap<string, AssigneeTarget>;
  readonly collisions: readonly string[];
} {
  return buildLinearPersonIndex({ derived, overrides });
}

/**
 * Resolve the person a form names as assignee against both roster layers.
 *
 * @param derived the derived roster
 * @param overrides the human override roster
 * @param freshness whether the derived roster still reflects what has been ingested
 * @param person the key the form names, or undefined when it assigns nobody
 * @returns the resolution, its origin, the roster report, and whether the key names a HELD candidate
 */
export function resolveAssigneeKey({
  derived,
  overrides,
  freshness,
  person,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  freshness: DeriveFreshness;
  person: string | undefined;
}): AssigneeResolution {
  const { index, collisions } = buildLinearPersonIndex({ derived, overrides });
  const target = person === undefined ? undefined : index.get(person);
  return {
    held: person !== undefined && target === undefined && derived.heldPersonIds.has(person),
    roster: linearRosterReport({ collisions, derived, freshness, index }),
    target,
  };
}

/**
 * Why an assignee could not be resolved, in terms of the roster's actual state.
 *
 * "no exact match in the identity map" alone is true and useless: the commonest cause is a roster that was
 * never derived or is stale, and the second commonest is a key that WAS found but is held or ambiguous. Each
 * has a different fix, so each says its own.
 *
 * @param person the key the form named, or undefined when it assigned nobody
 * @param resolution the resolution that key produced
 * @returns one or more refusal lines, or empty when there is nothing to refuse
 */
export function assigneeRefusals({
  person,
  resolution,
}: {
  person: string | undefined;
  resolution: AssigneeResolution;
}): readonly string[] {
  if (person === undefined || resolution.target !== undefined) {
    return [];
  }
  const { roster } = resolution;
  const stale =
    roster.freshness.kind === "fresh"
      ? []
      : [
          `${freshnessReason({ artefact: SILVER_ROSTER_ARTEFACT, freshness: roster.freshness })} — run \`${SILVER_ROSTER_ARTEFACT.command}\``,
        ];
  if (resolution.held) {
    return [
      `cannot assign ${JSON.stringify(person)}: that identity link is HELD — derive PROPOSED it but nothing ` +
        "has confirmed it, and a held link may never address a person. Confirm it in " +
        "the identity roster (slopweaver identity roster replace) to make it assignable.",
      ...stale,
    ];
  }
  if (roster.collisions.includes(person)) {
    return [
      `cannot assign ${JSON.stringify(person)}: two different people claim that key, so it was DROPPED ` +
        "rather than resolved to whichever came first. Disambiguate it in the identity roster (slopweaver identity roster replace).",
      ...stale,
    ];
  }
  return [
    `cannot assign ${JSON.stringify(person)}: no exact match among the ${String(roster.addressableKeys)} ` +
      "assignable keys (canonical person id, Linear user id, Linear handle, `@handle`, or the email on the " +
      "Linear identity). An assignee is exact-match only — never guessed. `slopweaver linear states --team " +
      "<key>` prints the Linear user id of everyone on the destination team.",
    ...stale,
  ];
}

/**
 * The refusal for a write whose assignee rests on a roster that is STILL not fresh after the consumer's
 * just-in-time refresh had its chance.
 *
 * The Linear counterpart of `../slack/mentionIndex.staleRosterRefusals`, and the same third rule of the
 * freshness contract: before it existed, a stale roster printed a warning and the send went out anyway. It
 * refuses only when the roster can change the outcome — a ticket that assigns nobody is not made wrong by a
 * roster that has not seen this week's joiners.
 *
 * @param resolution the assignee resolution, carrying the post-refresh verdict
 * @param person the key this write asks to assign, or undefined when it assigns nobody
 * @returns the refusal lines, or empty when the write may proceed
 */
export function staleAssigneeRefusals({
  resolution,
  person,
}: {
  resolution: AssigneeResolution;
  person: string | undefined;
}): readonly string[] {
  const action = freshnessAction({
    affectsOutput: person !== undefined,
    artefact: SILVER_ROSTER_ARTEFACT,
    freshness: resolution.roster.freshness,
    // The consumer that produced this resolution already had its just-in-time chance
    // (`../../cli/commands/linear/wiring.ts`); reaching here still stale means the refusal arm.
    refreshAttempted: true,
  });
  return action.kind === "refuse" ? [action.line] : [];
}
