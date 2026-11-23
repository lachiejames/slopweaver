/**
 * The directory: who and where the corpus is about. Pure, deterministic — a full re-scan each derive.
 * People = every record `author` plus every `@mention` in `refs`; containers = every record `container`.
 * Each entry carries how many records touch it and which sources it appears in, ranked by activity.
 *
 * PR4.8: bot and integration accounts are FILTERED OUT of the people directory (see
 * {@link ./accountKind}) — they aren't teammates, so counting them as "people" was wrong. They are only
 * dropped from this ONE surface: their records, member rows, dossiers and resolved identities all remain in
 * the corpus and stay queryable. Containers still count every record, bot-authored ones included.
 *
 * A record's AUTHOR is resolved by {@link ./personResolver.canonicalPersonIdForAuthor}, which also tries the
 * source-native id a chat record keeps in its raw payload — a Slack `file`/`pin` record's `author` is a
 * display name, so without that lift the same human was counted twice: once under their `U…` id (from their
 * messages) and once under their name (from their uploads).
 */

import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { compareStrings } from "../lib/compare.js";
import { type AccountClassification, classifyAccount } from "./accountKind.js";
import type { IdentityConfidence, IdentityResolution, Person, PersonIdentity } from "./identity.js";
import { canonicalPersonId, canonicalPersonIdForAuthor } from "./personResolver.js";

export interface DirectoryEntry {
  readonly id: string;
  readonly kind: "person" | "container";
  readonly recordCount: number;
  readonly sources: readonly CorpusSource[];
  /** The canonical display name — present only for a person merged via an identity resolution. */
  readonly displayName?: string;
  /** The per-source ids this person owns — present only for a person merged via an identity resolution. */
  readonly identities?: readonly PersonIdentity[];
  /** How the person's identities were linked — present only for a resolved person. */
  readonly confidence?: IdentityConfidence;
  /** What linked them (provenance) — present only for a resolved person. */
  readonly provenance?: readonly string[];
}

/** The empty resolution — the default, so `buildDirectory({ records })` is behaviour-preserving. */
const EMPTY_RESOLUTION: IdentityResolution = { candidates: [], conflicts: [], index: new Map(), people: [] };

interface Tally {
  count: number;
  readonly sources: Set<CorpusSource>;
}

/** A `@mention` ref → its bare handle, or null if the ref isn't a usable mention. */
function mentionHandle({ ref }: { ref: string }): string | null {
  return ref.startsWith("@") && ref.length >= 2 ? ref.slice(1) : null;
}

/** The `@mention` handles a record contributes, deduped and in ref order. */
function mentionIdsForRecord({ record }: { record: CorpusRecord }): readonly string[] {
  const handles = new Set<string>();
  for (const ref of record.refs) {
    const handle = mentionHandle({ ref });
    if (handle !== null) {
      handles.add(handle);
    }
  }
  return [...handles];
}

/**
 * The distinct RAW person ids a record contributes: its `author` plus every `@mention` handle in `refs`.
 * Deduped — a person named as both author and mention is counted once per record. Pure.
 *
 * @param record the corpus record
 * @returns the distinct person ids
 */
export function personIdsForRecord({ record }: { record: CorpusRecord }): readonly string[] {
  const author = record.author !== undefined && record.author.length > 0 ? [record.author] : [];
  return [...new Set([...author, ...mentionIdsForRecord({ record })])];
}

/** Map a raw person id through the resolution to its canonical id (raw `gold`/unlinked ids pass through). */
function canonicalId({
  record,
  resolution,
  rawId,
}: {
  record: CorpusRecord;
  resolution: IdentityResolution;
  rawId: string;
}): string {
  return record.source === "gold" ? rawId : canonicalPersonId({ rawId, resolution, source: record.source });
}

/**
 * The distinct CANONICAL person ids a record contributes — its author plus every `@mention` handle, each
 * mapped through the identity resolution, so per-source dupes of one human collapse to a single id (deduped
 * per record). Pure.
 *
 * The author goes through {@link ./personResolver.canonicalPersonIdForAuthor} rather than the plain
 * {@link ./personResolver.canonicalPersonId} the mentions use, because a chat `file`/`pin` record's author is
 * a display NAME whose joinable native id lives in its raw payload. A mention has no such second key — it is
 * only ever the handle as written — so treating one like an author would be inventing a join.
 *
 * @param record the corpus record
 * @param resolution the identity resolution (empty ⇒ raw ids, unchanged)
 * @returns the distinct canonical person ids
 */
function canonicalPersonIdsForRecord({
  record,
  resolution,
}: {
  record: CorpusRecord;
  resolution: IdentityResolution;
}): readonly string[] {
  const author = canonicalPersonIdForAuthor({ record, resolution });
  const mentions = mentionIdsForRecord({ record }).map((rawId) => canonicalId({ rawId, record, resolution }));
  return [...new Set(author === undefined ? mentions : [author, ...mentions])];
}

/**
 * The container ids a record contributes (its non-empty `container`, else none). Pure.
 *
 * @param record the record to place
 * @returns its container ids, or none when `container` is empty — an empty string is treated as absent
 *   rather than becoming a container named ""
 */
export function containerIdsForRecord({ record }: { record: CorpusRecord }): readonly string[] {
  return record.container.length > 0 ? [record.container] : [];
}

/** Bump `id`'s tally, counting the record once and noting its source. */
function bump({ tallies, id, source }: { tallies: Map<string, Tally>; id: string; source: CorpusSource }): void {
  const tally = tallies.get(id);
  if (tally === undefined) {
    tallies.set(id, { count: 1, sources: new Set([source]) });
    return;
  }
  tally.count += 1;
  tally.sources.add(source);
}

/** Rank by record count desc, then id asc. */
function byRankThenId({ a, b }: { a: DirectoryEntry; b: DirectoryEntry }): number {
  return b.recordCount - a.recordCount || compareStrings({ a: a.id, b: b.id });
}

/** Turn a container tally map into sorted directory entries. */
function toContainerEntries({ tallies }: { tallies: Map<string, Tally> }): readonly DirectoryEntry[] {
  return [...tallies.entries()]
    .map(([id, tally]): DirectoryEntry => ({
      id,
      kind: "container",
      recordCount: tally.count,
      sources: [...tally.sources].toSorted(),
    }))
    .toSorted((a, b) => byRankThenId({ a, b }));
}

/** A person tally → a directory entry, enriched with its resolved Person metadata when one merged it. */
function toPersonEntry({
  id,
  tally,
  person,
}: {
  id: string;
  tally: Tally;
  person: Person | undefined;
}): DirectoryEntry {
  return {
    id,
    kind: "person",
    recordCount: tally.count,
    sources: [...tally.sources].toSorted(),
    ...(person !== undefined
      ? {
          confidence: person.confidence,
          displayName: person.displayName,
          identities: person.identities,
          provenance: person.provenance,
        }
      : {}),
  };
}

/**
 * Turn a person tally map into sorted, resolution-enriched directory entries, DROPPING every account the
 * kind index classifies as a bot or an integration (PR4.8) and counting how many were dropped.
 */
function toPersonEntries({
  tallies,
  resolution,
  accountKinds,
}: {
  tallies: Map<string, Tally>;
  resolution: IdentityResolution;
  accountKinds: ReadonlyMap<string, AccountClassification>;
}): { entries: readonly DirectoryEntry[]; excluded: number } {
  const byId = new Map(resolution.people.map((person) => [person.id, person]));
  const entries: DirectoryEntry[] = [];
  let excluded = 0;
  for (const [id, tally] of tallies) {
    const person = byId.get(id);
    const { kind } = classifyAccount({
      id,
      index: accountKinds,
      ...(person !== undefined ? { identities: person.identities } : {}),
    });
    if (kind === "person") {
      entries.push(toPersonEntry({ id, person, tally }));
    } else {
      excluded += 1;
    }
  }
  return { entries: entries.toSorted((a, b) => byRankThenId({ a, b })), excluded };
}

/**
 * Build the people + container directory from the corpus. With an identity `resolution`, per-source
 * duplicate handles of one human collapse into a single canonical person entry (carrying its per-source
 * ids + confidence + provenance); without one, ids stay raw — behaviour-preserving. Bot/integration accounts
 * are dropped from `people` and counted in `excludedPeople`; with the default empty `accountKinds` index only
 * the structural `[bot]` login rule can fire (an un-hydrated home keeps everything else).
 *
 * @param records the corpus records
 * @param resolution the cross-source identity resolution (defaults to empty ⇒ raw per-source ids)
 * @param accountKinds the bot/integration classification index (defaults to empty ⇒ structural rules only)
 * @returns ranked `people` and `containers` entries, plus how many people were excluded as non-human
 */
export function buildDirectory({
  records,
  resolution = EMPTY_RESOLUTION,
  accountKinds = new Map(),
}: {
  records: readonly CorpusRecord[];
  resolution?: IdentityResolution;
  accountKinds?: ReadonlyMap<string, AccountClassification>;
}): {
  people: readonly DirectoryEntry[];
  containers: readonly DirectoryEntry[];
  excludedPeople: number;
} {
  const people = new Map<string, Tally>();
  const containers = new Map<string, Tally>();
  for (const record of records) {
    for (const container of containerIdsForRecord({ record })) {
      bump({ id: container, source: record.source, tallies: containers });
    }
    for (const person of canonicalPersonIdsForRecord({ record, resolution })) {
      bump({ id: person, source: record.source, tallies: people });
    }
  }
  const persons = toPersonEntries({ accountKinds, resolution, tallies: people });
  return {
    containers: toContainerEntries({ tallies: containers }),
    excludedPeople: persons.excluded,
    people: persons.entries,
  };
}
