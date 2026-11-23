/**
 * WHICH keys may name a REVIEWER, and which may not. Pure — the whole decision is decidable from here.
 *
 * This is the GitHub half of the rule `../linear/assigneeIndex.ts` states for Linear and `../slack/mentionIndex.ts`
 * states for Slack, and it is the same rule for the same reason:
 *
 * > **Derive may PROPOSE a link fuzzily. Only a CONFIRMED link may address a person.**
 *
 * Requesting a review is an addressing act, not a graph edit: it puts a pull request on a real colleague's
 * queue and pings them. Three sessions hit this exact gap — one gave up naming no reviewer at all,
 * one requested a login by a raw API call it had to justify, one fell back to a comment asking someone by
 * name — because there was no governed check standing between "the caller typed a string" and "GitHub emailed
 * a human". This module is that check. A GUESSED login (an org-suffix pattern the roster does not confirm,
 * say) is exactly the failure mode this exists to close, not merely a nice-to-have.
 *
 * Unlike Linear's index, the TARGET here is not a separate provider id — a GitHub login already IS the
 * addressing key the write itself sends. So resolution answers a narrower question than Linear's: not "which
 * account", only "is this login one the roster actually confirms, spelled exactly as GitHub spells it" — a
 * caller who typed the wrong case is still corrected to the roster's own casing, but a caller who typed a
 * login the roster has never seen is refused outright, never guessed.
 *
 * The three rules below mirror the Linear index exactly, with GitHub-owned fields in place of Linear-owned
 * ones:
 *
 * 1. **Every key is OWNED by a GITHUB identity**, or it is the canonical person id. A person's Slack id,
 *    Linear id or display NAME is never a key — those are the fields most likely to have been joined to the
 *    wrong GitHub account, and a display name is ambiguous even when the join is right.
 * 2. **A key claimed by two different people is DROPPED and reported**, never resolved first-wins.
 * 3. **Held candidates are not addressable.** `derive` holds name-only links rather than applying them; this
 *    index reads only APPLIED people, and the held ids exist here solely so a refusal can name the reason.
 *
 * The human roster (the store's identity roster) is layered ON TOP: it is a human's confirmation, so it
 * wins over anything derived and can resolve a key the derived layer had to drop for ambiguity.
 */
import { absentAsEmpty } from "#lib/absent.js";
import {
  type DeriveFreshness,
  freshnessAction,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
} from "../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../silver/derivedRoster.js";
import type { IdentityRecord, PersonIdentity } from "../../silver/identity.js";

/** Which layer supplied a resolution: the human roster, or `derive`'s own cross-source resolution. */
type ReviewerOrigin = "override" | "derived";

/** One candidate (key → GitHub login) pair a roster entry offers. */
interface KeyPair {
  readonly key: string;
  readonly login: string;
}

/** One resolved reviewer: the exact login GitHub itself owns, and which layer vouched for it. */
export interface ReviewerTarget {
  readonly login: string;
  readonly origin: ReviewerOrigin;
}

/** The addressable state of the roster, for a refusal message and for `--json`. */
interface ReviewerRosterReport {
  readonly freshness: DeriveFreshness;
  /** How many people the derived roster carries at all. */
  readonly derivedPeople: number;
  /** How many distinct keys can name a reviewer (both layers, after collision drops). */
  readonly addressableKeys: number;
  /** How many people are implicated in a low-confidence link `derive` is HOLDING rather than applying. */
  readonly heldPeople: number;
  /** Keys dropped because two different people claimed them, sorted for a stable report. */
  readonly collisions: readonly string[];
}

/** The resolution for one requested login: what resolved, from where, and the roster state behind it. */
export interface ReviewerResolution {
  readonly target: ReviewerTarget | undefined;
  readonly roster: ReviewerRosterReport;
  /** True when the requested key names a HELD candidate — unresolvable BY DESIGN, and worth saying so. */
  readonly held: boolean;
}

/** The keys a GitHub identity itself owns: its native login (case-preserved), its handle (bare and `@`-prefixed). */
function githubIdentityKeys({ identity }: { identity: PersonIdentity }): readonly string[] {
  return [identity.nativeId, ...(identity.handle === undefined ? [] : [identity.handle, `@${identity.handle}`])].filter(
    (key) => key.length > 0,
  );
}

/**
 * Every (key → login) pair one derived person offers.
 *
 * A person with no GitHub identity yields NONE — they have no account to request review from, and inventing
 * a target for them is the failure this whole file exists to prevent. A person with TWO GitHub identities
 * yields the canonical id twice with different targets, which rule 2 then drops as ambiguous.
 */
function derivedKeyPairs({ person }: { person: DerivedPerson }): readonly KeyPair[] {
  const github = person.identities.filter((identity) => identity.source === "github");
  return github.flatMap((identity) =>
    [person.id, ...githubIdentityKeys({ identity })].map((key) => ({ key, login: identity.nativeId })),
  );
}

/**
 * Every (key → login) pair one HUMAN roster entry offers.
 *
 * The record's own `id`/`handle` are keys here (unlike the derived layer, where only GitHub-owned fields
 * count) precisely because a human wrote them: that file IS the confirmation. `name`/`email` are still never
 * keys — a display name is ambiguous no matter who typed it, and an email is not how GitHub addresses anyone.
 */
function overrideKeyPairs({ record }: { record: IdentityRecord }): readonly KeyPair[] {
  const github = absentAsEmpty({ value: record.identities }).filter((identity) => identity.source === "github");
  const recordKeys = [record.id, record.handle, `@${record.handle}`];
  return github.flatMap((identity) =>
    [...recordKeys, ...githubIdentityKeys({ identity })]
      .filter((key) => key.length > 0)
      .map((key) => ({ key, login: identity.nativeId })),
  );
}

/** Index one layer's pairs, DROPPING every key two different targets claimed (rule 2). Case-insensitive keys. */
function indexLayer({ pairs }: { pairs: readonly KeyPair[] }): {
  readonly index: ReadonlyMap<string, string>;
  readonly collisions: readonly string[];
} {
  const index = new Map<string, string>();
  const collisions = new Set<string>();
  for (const { key, login } of pairs) {
    // GitHub logins and handles are case-insensitive, so the same person typed in a different case must not
    // look like two different reviewers — the index key is folded, while the stored TARGET keeps the exact
    // case GitHub itself reports.
    const folded = key.toLowerCase();
    const seen = index.get(folded);
    if (seen !== undefined && seen !== login) {
      collisions.add(folded);
    }
    index.set(folded, login);
  }
  for (const key of collisions) {
    index.delete(key);
  }
  return { collisions: [...collisions].toSorted(), index };
}

/**
 * Build the reviewer index from both layers.
 *
 * @param derived the derived roster from `corpus/silver/index/identities.json`
 * @param overrides the human roster from the store's identity roster
 * @returns the merged index (override wins) plus the keys dropped as ambiguous
 */
export function buildReviewerIndex({
  derived,
  overrides,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
}): {
  readonly index: ReadonlyMap<string, ReviewerTarget>;
  readonly collisions: readonly string[];
} {
  const derivedLayer = indexLayer({ pairs: derived.people.flatMap((person) => derivedKeyPairs({ person })) });
  const overrideLayer = indexLayer({ pairs: overrides.flatMap((record) => overrideKeyPairs({ record })) });
  const index = new Map<string, ReviewerTarget>();
  for (const [key, login] of derivedLayer.index) {
    index.set(key, { login, origin: "derived" });
  }
  // The human layer LAST: a confirmation overrides an inference, and can rescue a key the derived layer
  // dropped as ambiguous. A collision WITHIN the human layer is still dropped — one human, two answers.
  for (const [key, login] of overrideLayer.index) {
    index.set(key, { login, origin: "override" });
  }
  const collisions = [...new Set([...derivedLayer.collisions, ...overrideLayer.collisions])]
    .filter((key) => !overrideLayer.index.has(key))
    .toSorted();
  return { collisions, index };
}

/**
 * Resolve one requested reviewer key against both roster layers.
 *
 * @param derived the derived roster
 * @param overrides the human override roster
 * @param freshness whether the derived roster still reflects what has been ingested
 * @param login the login (or roster key) the caller named
 * @returns the resolution, its origin, the roster report, and whether the key names a HELD candidate
 */
export function resolveReviewerKey({
  derived,
  overrides,
  freshness,
  login,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  freshness: DeriveFreshness;
  login: string;
}): ReviewerResolution {
  const { index, collisions } = buildReviewerIndex({ derived, overrides });
  const target = index.get(login.toLowerCase());
  return {
    held: target === undefined && derived.heldPersonIds.has(login),
    roster: {
      addressableKeys: index.size,
      collisions,
      derivedPeople: derived.people.length,
      freshness,
      heldPeople: derived.heldPersonIds.size,
    },
    target,
  };
}

/**
 * Why a requested reviewer could not be resolved, in terms of the roster's actual state.
 *
 * @param login the login the caller named
 * @param resolution the resolution that key produced
 * @returns one or more refusal lines, or empty when there is nothing to refuse
 */
export function reviewerRefusals({
  login,
  resolution,
}: {
  login: string;
  resolution: ReviewerResolution;
}): readonly string[] {
  if (resolution.target !== undefined) {
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
      `cannot request review from ${JSON.stringify(login)}: that identity link is HELD — derive PROPOSED it but ` +
        "nothing has confirmed it, and a held link may never address a person. Confirm it in " +
        "the identity roster (slopweaver identity roster replace) to make it addressable.",
      ...stale,
    ];
  }
  if (roster.collisions.includes(login.toLowerCase())) {
    return [
      `cannot request review from ${JSON.stringify(login)}: two different people claim that key, so it was ` +
        "DROPPED rather than resolved to whichever came first. Disambiguate it in the identity roster (slopweaver identity roster replace).",
      ...stale,
    ];
  }
  return [
    `cannot request review from ${JSON.stringify(login)}: no exact match among the ${String(roster.addressableKeys)} ` +
      "addressable keys (canonical person id, GitHub login, or GitHub handle). A reviewer is exact-match only — " +
      "never guessed. Run `slopweaver derive` if this is a real colleague who has not been ingested yet.",
    ...stale,
  ];
}

/**
 * The refusal for a write whose reviewers rest on a roster that is STILL not fresh after the consumer's
 * just-in-time refresh had its chance.
 *
 * The GitHub counterpart of `../linear/assigneeIndex.ts`'s `staleAssigneeRefusals`, and the same third rule
 * of the freshness contract: a stale roster refuses only when it can change the outcome.
 *
 * @param resolutions every reviewer resolution this write is about to send
 * @returns the refusal lines, or empty when the write may proceed
 */
export function staleReviewerRefusals({
  resolutions,
}: {
  resolutions: readonly ReviewerResolution[];
}): readonly string[] {
  const freshness = resolutions[0]?.roster.freshness;
  if (freshness === undefined) {
    return [];
  }
  const action = freshnessAction({
    affectsOutput: resolutions.length > 0,
    artefact: SILVER_ROSTER_ARTEFACT,
    freshness,
    refreshAttempted: true,
  });
  return action.kind === "refuse" ? [action.line] : [];
}
