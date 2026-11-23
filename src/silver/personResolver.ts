/**
 * The pure cross-source person resolver: turn a stream of per-source {@link PersonIdentity} candidates
 * (extracted from the corpus) plus the human roster into a set of canonical {@link Person}s, each owning
 * its per-source ids with a resolution confidence + provenance. Deterministic grouping, no I/O, no deps —
 * a hand-roll is justified under D21 (there is no infra-free library for "group these identities").
 *
 * The link order is data-first (D8) and STRICTLY prioritised, strongest first:
 *   1. `override`  — a roster entry pins these source/native ids to one Person. Always wins.
 *   2. `email`     — free candidates sharing a trusted normalised email merge (high confidence).
 *   3. `handle`    — free candidates sharing an unambiguous normalised handle merge.
 *   4. `name`      — a same-name match is HELD as a candidate, NEVER auto-merged (names collide).
 *   5. `single-source` — the fallback: one Person per source/native id.
 * Low-confidence (name) links are surfaced, not applied; only override/email/handle links are indexed for
 * the directory to merge on, so an unlinked id keeps its raw form (behaviour-preserving).
 *
 * The ladder rests on `nativeId` being a real native id, so that is enforced at the way in rather than
 * assumed: {@link identityCandidatesForRecord} refuses to mint an identity from an author it cannot join,
 * and {@link ./personLookup.resolvePersonForRaw} reports an ambiguous lookup instead of picking one. A name is a label
 * here, never a key.
 */
import type { CorpusRecord } from "../corpus/types.js";
import { isRecord } from "../lib/parsers.js";
import type {
  IdentityConfidence,
  IdentityLinkCandidate,
  IdentityRecord,
  IdentityResolution,
  IdentitySource,
  Person,
  PersonIdentity,
} from "./identity.js";
import { isNativeIdShaped } from "./nativeIdShape.js";
import { normaliseEmail, normaliseHandle, normaliseName, personIdentityKey } from "./personLookup.js";

/**
 * The per-source identity a record contributes: its author's NATIVE ID, tagged with the record's source.
 * The synthetic `gold` source and author-less records contribute nothing. Pure.
 *
 * The author field is not trusted to be an id. Two projections put a display NAME there — Slack's
 * `file`/`pin` records resolve the uploader through the id→name map, and every Linear record carries the
 * `displayName` its connector asked for — so this function establishes a joinable id before minting an
 * identity, and mints NOTHING when it cannot:
 *
 *   1. the author itself, when it has {@link isNativeIdShaped the shape} its source issues;
 *   2. else the id recovered from the raw payload ({@link chatNativeAuthorId}), which survives because
 *      bronze is lossless — this is what makes the repair a silver concern rather than a re-fetch;
 *   3. else nothing. A display name is never an identity, so an unjoinable author is REFUSED here rather
 *      than turned into a person keyed on a name.
 *
 * Refusing is what keeps two humans who share a display name apart, and it costs no attribution that was
 * ever real: a name-keyed identity always landed at `single-source` confidence, which {@link appliedIndex}
 * excludes, so no such identity was ever an applied link.
 *
 * @param record the corpus record
 * @returns the record's person identities — one when its author is joinable, none when it is a bare name
 */
export function identityCandidatesForRecord({ record }: { record: CorpusRecord }): readonly PersonIdentity[] {
  if (record.source === "gold" || record.author === undefined || record.author.length === 0) {
    return [];
  }
  const author = record.author;
  const nativeId = isNativeIdShaped({ source: record.source, value: author }) ? author : chatNativeAuthorId({ record });
  if (nativeId === undefined || !isNativeIdShaped({ source: record.source, value: nativeId })) {
    return [];
  }
  return [{ name: author, nativeId, source: record.source }];
}

/**
 * The key two identity candidates are the SAME candidate under. Pure.
 *
 * The whole `(source, nativeId, name)` triple, never just the `<source>:<nativeId>` pair
 * ({@link personIdentityKey}) — {@link resolvePeople} takes a builder's display name from the first
 * candidate that created it, so two records naming one id under different names are two candidates and
 * collapsing them would silently pick a name by read order.
 *
 * NUL-joined, and written as the ESCAPE rather than the raw byte — a literal NUL makes git treat the whole
 * source file as binary. `join` renders an absent name as an empty segment, which is the honest key: a
 * candidate with no name and one with an empty name are the same candidate.
 *
 * Exported and shared rather than restated: three readers deduped candidates once — a persisted sidecar, the
 * streaming lexical index build's count pass, and {@link ./identityCandidateStream.streamIdentityCandidates}
 * — and two readers of one corpus that disagree about what "distinct" means produce two different
 * populations from it. The first two share the retrieval index; the key
 * stays exported because that is the finding, and a second reader will return.
 *
 * @param candidate the identity candidate to key
 * @returns the dedupe key
 */
export function identityCandidateKey({ candidate }: { candidate: PersonIdentity }): string {
  return [candidate.source, candidate.nativeId, candidate.name].join("\u0000");
}

/** A mutable person under construction — deduped identities + a provenance set, frozen to a {@link Person} later. */
interface Builder {
  readonly id: string;
  readonly displayName: string;
  readonly confidence: IdentityConfidence;
  readonly provenance: Set<string>;
  readonly identities: Map<string, PersonIdentity>;
}

/** The best display name for a candidate: name → handle → native id. */
function displayNameFor({ candidate }: { candidate: PersonIdentity }): string {
  return candidate.name ?? candidate.handle ?? candidate.nativeId;
}

/** Union two identities of the same key — the first-seen (roster) fields win, gaps filled by the incoming. */
function mergeIdentity({ existing, incoming }: { existing: PersonIdentity; incoming: PersonIdentity }): PersonIdentity {
  const handle = existing.handle ?? incoming.handle;
  const name = existing.name ?? incoming.name;
  const email = existing.email ?? incoming.email;
  return {
    nativeId: existing.nativeId,
    source: existing.source,
    ...(handle !== undefined ? { handle } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

/** Add an identity to a builder, deduped by its index key — a same-key identity MERGES fields (never
 * overwrites), so a roster-provided handle/email isn't lost when a corpus candidate for the same id arrives. */
function addIdentity({ builder, identity }: { builder: Builder; identity: PersonIdentity }): void {
  const key = personIdentityKey(identity);
  const existing = builder.identities.get(key);
  builder.identities.set(key, existing === undefined ? identity : mergeIdentity({ existing, incoming: identity }));
}

/** A fresh builder for a canonical person. */
function newBuilder({
  id,
  displayName,
  confidence,
}: {
  id: string;
  displayName: string;
  confidence: IdentityConfidence;
}): Builder {
  return { confidence, displayName, id, identities: new Map(), provenance: new Set() };
}

/**
 * Register a roster person's emails (top-level + per-identity) as owned, so a free email-match absorbs into
 * it. Email ownership is authoritative (it wins over inferred links), so an email claimed by two DIFFERENT
 * roster people is a conflict — recorded (first-wins the map, not silently later-wins), like a dup id.
 */
function claimEmails({
  emailToId,
  emails,
  id,
  conflicts,
}: {
  emailToId: Map<string, string>;
  emails: readonly (string | undefined)[];
  id: string;
  conflicts: string[];
}): void {
  for (const email of emails) {
    if (email !== undefined && email.length > 0) {
      const norm = normaliseEmail({ email });
      const owner = emailToId.get(norm);
      if (owner === undefined) {
        emailToId.set(norm, id);
      } else if (owner !== id) {
        conflicts.push(`email ${norm} claimed by both ${owner} and ${id}`);
      }
    }
  }
}

/**
 * Seed builders from the roster: every entry carrying `identities[]` becomes (or extends) a Person whose
 * source/native ids (and declared emails) are pinned to its `id` at `override` confidence. A source/native
 * id claimed by two different roster people is a conflict (recorded, not silently later-wins).
 */
function rosterBuilders({ overrides }: { overrides: readonly IdentityRecord[] }): {
  builders: Map<string, Builder>;
  keyToId: Map<string, string>;
  emailToId: Map<string, string>;
  conflicts: string[];
} {
  const builders = new Map<string, Builder>();
  const keyToId = new Map<string, string>();
  const emailToId = new Map<string, string>();
  const conflicts: string[] = [];
  for (const override of overrides) {
    // A roster entry written only for its `id`/`handle`/`name` display contract pins no source id, so it seeds nobody.
    const { identities } = override;
    if (identities == null || identities.length === 0) {
      continue;
    }
    // The first roster entry to declare an id names its person; a later entry under the same id extends it.
    if (!builders.has(override.id)) {
      builders.set(override.id, newBuilder({ confidence: "override", displayName: override.name, id: override.id }));
    }
    const builder = builders.get(override.id)!;
    builder.provenance.add(`override:${override.id}`);
    claimEmails({ conflicts, emails: [override.email, ...identities.map((i) => i.email)], emailToId, id: override.id });
    for (const identity of identities) {
      const key = personIdentityKey(identity);
      const claimed = keyToId.get(key);
      if (claimed !== undefined && claimed !== override.id) {
        conflicts.push(`identity ${key} claimed by both ${claimed} and ${override.id}`);
        continue;
      }
      keyToId.set(key, override.id);
      addIdentity({ builder, identity });
    }
  }
  return { builders, conflicts, emailToId, keyToId };
}

/** Classify a non-roster candidate into its merge group + the confidence tier that groups it. */
function classifyFree({ candidate }: { candidate: PersonIdentity }): {
  groupId: string;
  confidence: IdentityConfidence;
  reason: string;
} {
  if (candidate.email !== undefined) {
    const email = normaliseEmail({ email: candidate.email });
    return { confidence: "email", groupId: `person:email:${email}`, reason: `email:${email}` };
  }
  if (candidate.handle !== undefined) {
    const handle = normaliseHandle({ handle: candidate.handle });
    return { confidence: "handle", groupId: `person:handle:${handle}`, reason: `handle:${handle}` };
  }
  const native = normaliseHandle({ handle: candidate.nativeId });
  return { confidence: "single-source", groupId: `person:${candidate.source}:${native}`, reason: "single-source" };
}

/** The roster person that OWNS a candidate's email, if any — so the override wins over an inferred email group. */
function rosterEmailOwner({
  emailToId,
  candidate,
}: {
  emailToId: Map<string, string>;
  candidate: PersonIdentity;
}): string | undefined {
  return candidate.email !== undefined ? emailToId.get(normaliseEmail({ email: candidate.email })) : undefined;
}

/** Fold one free candidate into the builders: join its roster person (by id OR by owned email) if any, else its inferred group. */
function addFree({
  builders,
  keyToId,
  emailToId,
  candidate,
}: {
  builders: Map<string, Builder>;
  keyToId: Map<string, string>;
  emailToId: Map<string, string>;
  candidate: PersonIdentity;
}): void {
  const key = personIdentityKey(candidate);
  const byKey = keyToId.get(key);
  const byEmail = byKey === undefined ? rosterEmailOwner({ candidate, emailToId }) : undefined;
  const owner = byKey ?? byEmail;
  if (owner !== undefined) {
    const builder = builders.get(owner)!;
    if (byEmail !== undefined && candidate.email !== undefined) {
      builder.provenance.add(`email:${normaliseEmail({ email: candidate.email })}`);
    }
    keyToId.set(key, owner);
    addIdentity({ builder, identity: candidate });
    return;
  }
  const { groupId, confidence, reason } = classifyFree({ candidate });
  // The first candidate to reach a group names its person; every later one joins it.
  if (!builders.has(groupId)) {
    builders.set(groupId, newBuilder({ confidence, displayName: displayNameFor({ candidate }), id: groupId }));
  }
  const builder = builders.get(groupId)!;
  builder.provenance.add(reason);
  keyToId.set(key, groupId);
  addIdentity({ builder, identity: candidate });
}

/** Freeze a builder into a Person with deterministically ordered identities + provenance. */
function toPerson({ builder }: { builder: Builder }): Person {
  return {
    confidence: builder.confidence,
    displayName: builder.displayName,
    id: builder.id,
    identities: [...builder.identities.values()].toSorted((a, b) =>
      personIdentityKey(a).localeCompare(personIdentityKey(b)),
    ),
    provenance: [...builder.provenance].toSorted(),
  };
}

/** The distinct normalised names a person carries across its identities. */
function personNames({ person }: { person: Person }): readonly string[] {
  return [
    ...new Set(person.identities.flatMap((i) => (i.name !== undefined ? [normaliseName({ name: i.name })] : []))),
  ];
}

/**
 * Same-name links across DIFFERENT people, HELD not applied: for each normalised name owned by more than
 * one canonical person, one candidate listing them. Deterministically ordered.
 */
function nameCandidates({ people }: { people: readonly Person[] }): readonly IdentityLinkCandidate[] {
  // One claim per (name, person): `personNames` dedupes a person's names and person ids are unique, so a name's
  // claims name distinct people.
  const byName = Map.groupBy(
    people.flatMap((person) => personNames({ person }).map((name) => ({ id: person.id, name }))),
    (claim) => claim.name,
  );
  const candidates: IdentityLinkCandidate[] = [];
  for (const [name, claims] of byName) {
    if (claims.length > 1) {
      candidates.push({ confidence: "name", personIds: claims.map((c) => c.id).toSorted(), reason: `name:${name}` });
    }
  }
  return candidates.toSorted((a, b) => a.reason.localeCompare(b.reason));
}

/** The index of only APPLIED cross-source links (override/email/handle) — a single-source id is left raw. */
function appliedIndex({
  keyToId,
  people,
}: {
  keyToId: Map<string, string>;
  people: readonly Person[];
}): ReadonlyMap<string, string> {
  const linked = new Set(people.filter((p) => p.confidence !== "single-source").map((p) => p.id));
  return new Map([...keyToId].filter(([, id]) => linked.has(id)));
}

/**
 * Resolve per-source identity candidates + the roster into canonical people. Deterministic + pure.
 *
 * @param candidates the per-source identities discovered in the corpus (see {@link identityCandidatesForRecord})
 * @param overrides the parsed roster (the human seed/override that always wins)
 * @returns the canonical people, held name candidates, roster conflicts, and the applied-link index
 */
export function resolvePeople({
  candidates,
  overrides,
}: {
  candidates: readonly PersonIdentity[];
  overrides: readonly IdentityRecord[];
}): IdentityResolution {
  const { builders, keyToId, emailToId, conflicts } = rosterBuilders({ overrides });
  for (const candidate of candidates) {
    addFree({ builders, candidate, emailToId, keyToId });
  }
  // A roster entry whose every identity lost a conflict contributes no identities — drop the empty shell.
  const people = [...builders.values()]
    .filter((builder) => builder.identities.size > 0)
    .map((builder) => toPerson({ builder }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return { candidates: nameCandidates({ people }), conflicts, index: appliedIndex({ keyToId, people }), people };
}

/**
 * Resolve straight from a corpus + roster — the common wiring both `derive` and the `identity` verb use.
 * Pure orchestration over {@link identityCandidatesForRecord} + {@link resolvePeople}. `extraCandidates`
 * (PR4.1) are hydrated MEMBER identities carrying real emails — appended to the record-derived candidates
 * so the resolver's existing `email` tier auto-links the whole team cross-source. Additive: an empty
 * `extraCandidates` (the default) reproduces the pre-PR4.1 behaviour exactly.
 *
 * @param records the corpus records to discover per-source identities from
 * @param roster the parsed roster (the human seed/override)
 * @param extraCandidates additional per-source identities (e.g. hydrated members) — default empty
 * @returns the cross-source identity resolution
 */
export function resolveFromRecords({
  records,
  roster,
  extraCandidates = [],
}: {
  records: readonly CorpusRecord[];
  roster: readonly IdentityRecord[];
  extraCandidates?: readonly PersonIdentity[];
}): IdentityResolution {
  return resolvePeople({
    // Members lead: an email-bearing member candidate forms its email group FIRST, so the email-less
    // activity candidate for the same `<source>:<nativeId>` then joins that group by key (rather than
    // claiming a single-source group the member's email could no longer merge).
    candidates: [...extraCandidates, ...records.flatMap((record) => identityCandidatesForRecord({ record }))],
    overrides: roster,
  });
}

/**
 * The canonical person id for a raw source-native id — used by the directory to MERGE per-source dupes.
 * Only APPLIED cross-source links map; an unlinked id returns unchanged (behaviour-preserving).
 *
 * @param source the record's source
 * @param rawId the raw author/handle
 * @returns the canonical person id, or `rawId` when it carries no applied link
 */
export function canonicalPersonId({
  resolution,
  source,
  rawId,
}: {
  resolution: IdentityResolution;
  source: IdentitySource;
  rawId: string;
}): string {
  return resolution.index.get(personIdentityKey({ nativeId: rawId, source })) ?? rawId;
}

/**
 * The one chat source, and the raw-payload field it carries the author's source-native id under. Slack's
 * message/comment projections already store that id as the record's `author`, but the `file` and `pin`
 * projections store a resolved DISPLAY NAME instead — and a name is precisely what the resolver must never
 * join on. The joinable id survives in the record's `raw` because bronze is lossless, which is what makes
 * this a repair in silver rather than a re-fetch.
 */
const CHAT_SOURCE = "slack";
const CHAT_NATIVE_AUTHOR_FIELD = "user";

/**
 * The source-native author id a **chat** record carries in its raw payload, when that is not already the
 * record's `author`. Pure — an exact field read, never a guess at who a display name meant.
 *
 * @param record the corpus record
 * @returns the native author id (Slack's `raw.user`) for a chat record whose `author` is something else, or
 *   `undefined` for any other source, a missing/blank field, or a record whose author IS that id already
 */
export function chatNativeAuthorId({ record }: { record: CorpusRecord }): string | undefined {
  if (record.source !== CHAT_SOURCE || !isRecord(record.raw)) {
    return undefined;
  }
  const native = record.raw[CHAT_NATIVE_AUTHOR_FIELD];
  return typeof native === "string" && native.length > 0 && native !== record.author ? native : undefined;
}

/**
 * The canonical person id for a RECORD's author — {@link canonicalPersonId} plus the chat repair. Looks up
 * the record's own `author` FIRST and only then the chat native id, deliberately: the projection may have
 * rewritten `author` to a different native id on purpose (PR4.5 me-to-me maps the owner's own bot post back
 * to the owner), and that rewrite must stay authoritative rather than be undone by the raw payload it was
 * derived from. Falls back to the raw author, so an id with no applied link is left exactly as it was. Pure.
 *
 * @param record the corpus record
 * @param resolution the identity resolution
 * @returns the canonical person id, `record.author` when it carries no applied link, or `undefined` when the
 *   record has no author at all
 */
export function canonicalPersonIdForAuthor({
  record,
  resolution,
}: {
  record: CorpusRecord;
  resolution: IdentityResolution;
}): string | undefined {
  const author = record.author;
  if (author === undefined || author.length === 0) {
    return undefined;
  }
  if (record.source === "gold") {
    return author;
  }
  const direct = resolution.index.get(personIdentityKey({ nativeId: author, source: record.source }));
  if (direct !== undefined) {
    return direct;
  }
  const native = chatNativeAuthorId({ record });
  const lifted =
    native === undefined
      ? undefined
      : resolution.index.get(personIdentityKey({ nativeId: native, source: record.source }));
  return lifted ?? author;
}
