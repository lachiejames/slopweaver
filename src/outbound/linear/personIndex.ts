/**
 * WHICH keys may address a PERSON on Linear — the one keyset, shared by the two addressing acts this door
 * performs. Pure; the whole decision is decidable from here.
 *
 * This is the Linear half of the rule `../slack/mentionIndex.ts` states for Slack:
 *
 * > **Derive may PROPOSE a link fuzzily. Only a CONFIRMED link may address a person.**
 *
 * Assigning a ticket and mentioning someone in its body are the same act at the same bar: both put a real
 * colleague's name on a real piece of work and notify them, and both are the sort of thing nobody corrects
 * for a week. So they resolve through ONE index rather than two.
 *
 * Three rules follow, each with teeth below:
 *
 * 1. **Every key is OWNED by a LINEAR identity**, or it is the canonical person id. A person's Slack id,
 *    GitHub login or display NAME is never a key: those are the keys most likely to have been joined to the
 *    wrong Linear account, and a display name is ambiguous even when the join is right. So the addressable
 *    set is: canonical person id, Linear native id, Linear handle (`displayName` as the connector captures
 *    it), `@handle`, and the email ON the Linear identity.
 * 2. **A key claimed by two different people is DROPPED and reported**, never resolved first-wins.
 * 3. **Held candidates are not addressable.** `derive` holds name-only links rather than applying them; this
 *    index reads only APPLIED people, and the held ids exist here solely so a refusal can name the reason.
 *
 * The human roster (the store's identity roster) is layered ON TOP: it is a human's confirmation, so it
 * wins over anything derived and can resolve a key the derived layer had to drop for ambiguity.
 *
 * ## Why this is a second file rather than a parameter on the Slack one
 *
 * The two indexes differ in what they are ALLOWED to key on, not merely in which source they filter for. A
 * generalised `buildIndex({ source })` would read as if the only difference were a string, and the next
 * person to widen the Slack keyset — a display name, say, "just for Linear" — would widen both. They are the
 * same shape by coincidence of design, not by a shared contract.
 *
 * ## Why the assignee and the mention DO share one
 *
 * The opposite call, for the opposite reason: they are not the same shape by coincidence, they are the same
 * QUESTION — "which Linear user does this key name, and may we address them?" — asked twice. Two copies of
 * this keyset is the defect class `.claude/rules/error-handling.md` records regenerating through careful
 * work: a widening applied to one copy and not the other would make a mention address someone an assignment
 * refuses, with nothing to catch it. `./assigneeIndex.ts` and `./mentionIndex.ts` are the two callers, and
 * each owns only what differs — arity, and what its refusal has to say.
 *
 * ## Candidates are for the REFUSAL, never for the resolution
 *
 * {@link linearPersonCandidates} matches on display NAME, which everything above forbids as a key. That is
 * safe for exactly one purpose: telling a caller whose key did not resolve WHO it might have meant, with the
 * ids to pick from. It never returns a target and nothing resolves through it — a refusal that names two
 * people and makes the caller choose is the opposite of a guess.
 */
import { absentAsEmpty } from "#lib/absent.js";
import type { DeriveFreshness } from "../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../silver/derivedRoster.js";
import type { IdentityRecord, PersonIdentity } from "../../silver/identity.js";
import { normaliseEmail, normaliseHandle, normaliseName } from "../../silver/personLookup.js";

/** Which layer supplied a resolution: the human roster, or `derive`'s own cross-source resolution. */
export type LinearPersonOrigin = "override" | "derived";

/** One candidate (key → Linear user id) pair a roster entry offers. */
interface KeyPair {
  readonly key: string;
  readonly linearId: string;
}

/** One resolved person: the Linear user id to write, and which layer vouched for it. */
export interface LinearPersonTarget {
  readonly linearId: string;
  readonly origin: LinearPersonOrigin;
}

/** The addressable state of the roster, for a refusal message and for `--json`. */
export interface LinearRosterReport {
  readonly freshness: DeriveFreshness;
  /** How many people the derived roster carries at all. */
  readonly derivedPeople: number;
  /** How many distinct keys can address a person (both layers, after collision drops). */
  readonly addressableKeys: number;
  /** How many people are implicated in a low-confidence link `derive` is HOLDING rather than applying. */
  readonly heldPeople: number;
  /** Keys dropped because two different people claimed them, sorted for a stable report. */
  readonly collisions: readonly string[];
}

/** The keys a Linear identity itself owns: its native id, its handle (bare and `@`-prefixed), its email. */
function linearIdentityKeys({ identity }: { identity: PersonIdentity }): readonly string[] {
  return [
    identity.nativeId,
    ...(identity.handle === undefined ? [] : [identity.handle, `@${identity.handle}`]),
    ...(identity.email === undefined ? [] : [identity.email]),
  ].filter((key) => key.length > 0);
}

/**
 * Every (key → Linear id) pair one derived person offers.
 *
 * A person with no Linear identity yields NONE — they have no account to be addressed, and inventing a
 * target for them is the failure this whole file exists to prevent. A person with TWO Linear identities
 * yields the canonical id twice with different targets, which rule 2 then drops as ambiguous: "which of
 * their two accounts?" is not a question this layer may answer.
 */
function derivedKeyPairs({ person }: { person: DerivedPerson }): readonly KeyPair[] {
  const linear = person.identities.filter((identity) => identity.source === "linear");
  return linear.flatMap((identity) =>
    [person.id, ...linearIdentityKeys({ identity })].map((key) => ({ key, linearId: identity.nativeId })),
  );
}

/**
 * Every (key → Linear id) pair one HUMAN roster entry offers.
 *
 * The record's own `id`/`handle`/`email` are keys here (unlike the derived layer, where only Linear-owned
 * fields count) precisely because a human wrote them: that file IS the confirmation. `name` is still never a
 * key — a display name is ambiguous no matter who typed it.
 */
function overrideKeyPairs({ record }: { record: IdentityRecord }): readonly KeyPair[] {
  const linear = absentAsEmpty({ value: record.identities }).filter((identity) => identity.source === "linear");
  const recordKeys = [
    record.id,
    record.handle,
    `@${record.handle}`,
    ...(record.email === undefined ? [] : [record.email]),
  ];
  return linear.flatMap((identity) =>
    [...recordKeys, ...linearIdentityKeys({ identity })]
      .filter((key) => key.length > 0)
      .map((key) => ({ key, linearId: identity.nativeId })),
  );
}

/** Index one layer's pairs, DROPPING every key two different targets claimed (rule 2). */
function indexLayer({ pairs }: { pairs: readonly KeyPair[] }): {
  readonly index: ReadonlyMap<string, string>;
  readonly collisions: readonly string[];
} {
  const index = new Map<string, string>();
  const collisions = new Set<string>();
  for (const { key, linearId } of pairs) {
    const seen = index.get(key);
    if (seen !== undefined && seen !== linearId) {
      collisions.add(key);
    }
    index.set(key, linearId);
  }
  for (const key of collisions) {
    index.delete(key);
  }
  return { collisions: [...collisions].toSorted(), index };
}

/**
 * Build the Linear person index from both roster layers.
 *
 * @param derived the derived roster from `corpus/silver/index/identities.json`
 * @param overrides the human roster from the store's identity roster
 * @returns the merged index (override wins) plus the keys dropped as ambiguous
 */
export function buildLinearPersonIndex({
  derived,
  overrides,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
}): {
  readonly index: ReadonlyMap<string, LinearPersonTarget>;
  readonly collisions: readonly string[];
} {
  const derivedLayer = indexLayer({ pairs: derived.people.flatMap((person) => derivedKeyPairs({ person })) });
  const overrideLayer = indexLayer({ pairs: overrides.flatMap((record) => overrideKeyPairs({ record })) });
  const index = new Map<string, LinearPersonTarget>();
  for (const [key, linearId] of derivedLayer.index) {
    index.set(key, { linearId, origin: "derived" });
  }
  // The human layer LAST: a confirmation overrides an inference, and can rescue a key the derived layer
  // dropped as ambiguous. A collision WITHIN the human layer is still dropped — one human, two answers.
  for (const [key, linearId] of overrideLayer.index) {
    index.set(key, { linearId, origin: "override" });
  }
  const collisions = [...new Set([...derivedLayer.collisions, ...overrideLayer.collisions])]
    .filter((key) => !overrideLayer.index.has(key))
    .toSorted();
  return { collisions, index };
}

/**
 * The roster report both addressing acts print, built from one index pass.
 *
 * @param collisions the keys the index dropped as ambiguous
 * @param derived the derived roster the index was built from
 * @param freshness whether that roster still reflects what has been ingested
 * @param index the built index, for its addressable-key count
 * @returns the report
 */
export function linearRosterReport({
  collisions,
  derived,
  freshness,
  index,
}: {
  collisions: readonly string[];
  derived: DerivedRoster;
  freshness: DeriveFreshness;
  index: ReadonlyMap<string, LinearPersonTarget>;
}): LinearRosterReport {
  return {
    addressableKeys: index.size,
    collisions,
    derivedPeople: derived.people.length,
    freshness,
    heldPeople: derived.heldPersonIds.size,
  };
}

/** One person a failed key MIGHT have meant, with what a caller needs to pick them. */
export interface LinearPersonCandidate {
  /** The canonical person id — the key that would have resolved, had the link been confirmed. */
  readonly personId: string;
  /** The display name that matched, as the roster spells it. */
  readonly name: string;
  /** Their Linear user id, or undefined when this person has no Linear identity at all. */
  readonly linearId: string | undefined;
  /** Their Linear handle, when they have one. */
  readonly handle: string | undefined;
  /** The email on the identity that matched, when there is one. */
  readonly email: string | undefined;
}

/** Every comparable label one identity offers a candidate search: its handle, its name, its email + local part. */
function candidateLabels({ identity }: { identity: PersonIdentity }): readonly string[] {
  const email = identity.email;
  const local = email === undefined ? undefined : normaliseEmail({ email }).split("@")[0];
  return [
    normaliseHandle({ handle: identity.nativeId }),
    ...(identity.handle === undefined ? [] : [normaliseHandle({ handle: identity.handle })]),
    ...(identity.name === undefined ? [] : [normaliseName({ name: identity.name })]),
    ...(email === undefined ? [] : [normaliseEmail({ email })]),
    ...(local === undefined || local.length === 0 ? [] : [local]),
  ];
}

/**
 * The one candidate a person offers, or undefined when nothing about them matches the key.
 *
 * `extraLabels` is what a HUMAN roster entry contributes that a derived person cannot: the identity roster
 * carries `handle`, `name` and `email` on the record itself rather than on any one identity, so a person
 * confirmed there would otherwise be invisible to a search that only walked identities.
 */
function candidateFor({
  person,
  needle,
  extraLabels = [],
}: {
  person: DerivedPerson;
  needle: string;
  extraLabels?: readonly string[];
}): LinearPersonCandidate | undefined {
  const matched = person.identities.find((identity) => candidateLabels({ identity }).includes(needle));
  if (matched === undefined && !extraLabels.includes(needle)) {
    return undefined;
  }
  const linear = person.identities.find((identity) => identity.source === "linear");
  return {
    email: linear?.email ?? matched?.email,
    handle: linear?.handle,
    linearId: linear?.nativeId,
    name: matched?.name ?? matched?.handle ?? person.id,
    personId: person.id,
  };
}

/** The labels a HUMAN roster entry carries on the record itself, normalised for comparison. */
function overrideLabels({ record }: { record: IdentityRecord }): readonly string[] {
  const email = record.email;
  const local = email === undefined ? undefined : normaliseEmail({ email }).split("@")[0];
  return [
    normaliseHandle({ handle: record.handle }),
    normaliseName({ name: record.name }),
    ...(email === undefined ? [] : [normaliseEmail({ email })]),
    ...(local === undefined || local.length === 0 ? [] : [local]),
  ].filter((label) => label.length > 0);
}

/**
 * WHO a key that failed to resolve might have meant — for a refusal message, never for a resolution.
 *
 * The match is EXACT after normalising, across a person's handles, display names and emails (address and
 * local part alike) in every source, not only Linear. That is deliberately wider than the addressable
 * keyset: the whole point is to find the person a human had in mind when they typed `cj`, including when
 * the reason it did not resolve is that two people answer to that name or that the one who does has no
 * Linear account. Wider still — a prefix or substring match — was rejected: `to` should not offer everyone
 * whose name contains those letters, and a refusal that lists eleven people is one nobody acts on.
 *
 * @param derived the derived roster
 * @param overrides the human roster, whose entries are searched the same way
 * @param key the key that failed to resolve, as the caller wrote it
 * @returns every person the key might have named, ordered by canonical person id so a refusal is stable
 */
export function linearPersonCandidates({
  derived,
  overrides,
  key,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  key: string;
}): readonly LinearPersonCandidate[] {
  const needle = normaliseHandle({ handle: key });
  const fromOverrides = overrides.map((record) =>
    candidateFor({
      extraLabels: overrideLabels({ record }),
      needle,
      person: { confidence: "override", id: record.id, identities: absentAsEmpty({ value: record.identities }) },
    }),
  );
  const fromDerived = derived.people.map((person) => candidateFor({ needle, person }));
  const byPerson = new Map<string, LinearPersonCandidate>();
  for (const candidate of [...fromDerived, ...fromOverrides]) {
    if (candidate !== undefined) {
      byPerson.set(candidate.personId, candidate);
    }
  }
  return [...byPerson.values()].toSorted((a, b) => a.personId.localeCompare(b.personId));
}

/**
 * Every Linear user id in the roster, mapped to the best LABEL for it — the handle Linear itself shows,
 * failing that the display name.
 *
 * This exists because a mention's markup carries a label as well as an id (`@[handle](uuid)`), and the label
 * a caller would otherwise have to supply is exactly the thing they must not be trusted with: a typo there
 * writes one person's name over another person's id. The label is read from the same roster the id came
 * from, so the two can never disagree.
 *
 * @param derived the derived roster
 * @param overrides the human roster, which wins where both know a Linear id
 * @returns Linear user id → label, for every Linear identity in either layer
 */
export function linearLabelIndex({
  derived,
  overrides,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
}): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const record = ({ identity }: { identity: PersonIdentity }): void => {
    const label = identity.handle ?? identity.name;
    if (identity.source === "linear" && label !== undefined && label.length > 0) {
      labels.set(identity.nativeId, label);
    }
  };
  for (const person of derived.people) {
    for (const identity of person.identities) {
      record({ identity });
    }
  }
  for (const entry of overrides) {
    for (const identity of absentAsEmpty({ value: entry.identities })) {
      record({ identity });
    }
  }
  return labels;
}
