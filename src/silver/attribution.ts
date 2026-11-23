/**
 * Attribution coverage: how much of the corpus actually has a resolvable PERSON behind it, and — for the
 * part that does not — WHY, named exactly rather than left as a lump.
 *
 * This exists because the number was being quoted rather than measured. "Attribution" here is one precise
 * thing: a record with an `author` whose `<source>:<nativeId>` carries an APPLIED cross-source link, so
 * {@link ./personResolver.canonicalPersonIdForAuthor} returns a canonical person id rather than the raw
 * string back. A raw string is not attribution — it is the same human appearing once per source.
 *
 * The residual is classified from the hydrated member rows, and every rule is an EXACT string match. One is
 * worth calling out: `handle-not-native-id` fires when the record's author equals a member's declared
 * `handle` for that source while the member row is keyed by a different `nativeId`. That is a diagnosis, not
 * a join — nothing here merges anything, and no identity is ever inferred from it. It is here because a
 * source whose activity is keyed by handle and whose member store is keyed by UUID cannot ever link, and
 * that fact should be a number on a report rather than something the next reader rediscovers.
 *
 * Pure — no I/O, no clock.
 */
import { trustedJoinEmail } from "../corpus/members/email.js";
import type { MemberBronzeRow } from "../corpus/members/types.js";
import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { compareStrings } from "../lib/compare.js";
import type { AccountClassification } from "./accountKind.js";
import { classifyMemberRow } from "./accountKind.js";
import { classifyActor } from "./actorKind.js";
import type { IdentityResolution, IdentitySource } from "./identity.js";
import { personIdentityKey } from "./personLookup.js";
import { canonicalPersonIdForAuthor, chatNativeAuthorId } from "./personResolver.js";

/**
 * Why an authored record still has no canonical person behind it. Every one of these is a REASON, not a
 * bucket: five are deliberate (a machine author, a non-human account, a deactivated one, a held email, an
 * unknown account) and two are defects — `handle-not-native-id` names a whole source that cannot link, and
 * `linkable-member` should be 0, so it is representable precisely so a real regression cannot hide inside
 * another reason.
 *
 * `machine-author` is the one that had to be ADDED rather than measured, and it is the largest single class
 * on this corpus. It is not a coverage gap at all: a record GitHub itself calls `Bot` has no person behind
 * it to reach, so counting it as a miss reported a correct refusal as a failure — the same mistake
 * `external` fixed for the roster (`accountKind.ts`'s `AccountKind`). Measured over the
 * 220,888 GitHub bronze records on the owner's install: 143,034 of 204,741 authored records have an author
 * outside the 94-row GitHub roster, and the six largest — coderabbitai 84,598, github-actions 18,550,
 * linear 11,118, acme-agent-system 5,180, nx-cloud 2,453, ellipsis-dev 2,045 — are every one a machine.
 * GitHub's own account type names 97,874 of them `Bot` with no name list involved.
 */
type AttributionMiss =
  | "machine-author"
  | "non-human-account"
  | "deactivated-member"
  | "email-held"
  | "handle-not-native-id"
  | "no-member-row"
  | "linkable-member";

/** One source's slice of the coverage. */
interface AttributionSourceCoverage {
  readonly source: CorpusSource;
  readonly records: number;
  readonly authored: number;
  readonly attributed: number;
  /**
   * Of the ones that MISSED, how many a machine wrote — reported beside the ratio rather than subtracted
   * from it, so the headline stays comparable to every figure measured before this class existed.
   *
   * The miss side, not all of `authored`, and the difference is load-bearing: a `machine-as-person` post
   * that DID resolve to the person it went out under is attribution working, not a machine hiding in the
   * numerator. Only the records with nobody to reach are counted here.
   */
  readonly machineAuthored: number;
}

/** One residual class and how many authored records fell into it. */
interface AttributionResidual {
  readonly reason: AttributionMiss;
  readonly count: number;
}

/** The whole attribution picture: the coverage, its per-source split, and the named residual. */
export interface AttributionCoverage {
  readonly records: number;
  readonly authored: number;
  readonly attributed: number;
  /**
   * Of the authored records that MISSED, how many a machine wrote. Equal to the `machine-author` entry of
   * {@link residual} by construction — carried here as well so a caller reporting the headline never has to
   * go digging through the residual to state the one fact that makes the headline honest.
   */
  readonly machineAuthored: number;
  /** Distinct canonical people credited with at least one record. */
  readonly people: number;
  readonly sources: readonly AttributionSourceCoverage[];
  readonly residual: readonly AttributionResidual[];
}

/** The `<source>:<nativeId>` → member row index, and the `<source>:<handle>` one used only to DIAGNOSE. */
interface MemberIndex {
  readonly byNativeId: ReadonlyMap<string, MemberBronzeRow>;
  readonly byHandle: ReadonlyMap<string, MemberBronzeRow>;
}

/** Lower-case + trim a handle for the diagnosis lookup — the same normalisation the resolver's handle tier uses. */
function handleKey({ source, handle }: { source: IdentitySource; handle: string }): string {
  return `${source}:${handle.trim().toLowerCase()}`;
}

/** Index the member rows by native id (the join key) and by handle (the diagnosis key). First row wins both. */
function indexMembers({ rows }: { rows: readonly MemberBronzeRow[] }): MemberIndex {
  const byNativeId = new Map<string, MemberBronzeRow>();
  const byHandle = new Map<string, MemberBronzeRow>();
  for (const row of rows) {
    const { source, nativeId, handle } = row.identity;
    const key = personIdentityKey({ nativeId, source });
    if (!byNativeId.has(key)) {
      byNativeId.set(key, row);
    }
    if (handle !== undefined && handle.length > 0) {
      const hk = handleKey({ handle, source });
      if (!byHandle.has(hk)) {
        byHandle.set(hk, row);
      }
    }
  }
  return { byHandle, byNativeId };
}

/** Classify the member row a miss landed on into its exact reason. */
function classifyMiss({ row, keyedByNativeId }: { row: MemberBronzeRow; keyedByNativeId: boolean }): AttributionMiss {
  if (classifyMemberRow({ row }).kind !== "person") {
    return "non-human-account";
  }
  if (row.profile.active === false) {
    return "deactivated-member";
  }
  if (trustedJoinEmail({ row }) === undefined) {
    return "email-held";
  }
  return keyedByNativeId ? "linkable-member" : "handle-not-native-id";
}

/**
 * Why one authored record missed.
 *
 * The record's OWN payload is asked first, through {@link ./actorKind.classifyActor}. That order is the
 * rule, and it is the same one `classifyActor` already states internally: the payload is evidence about THIS
 * record while a member row is evidence about an ACCOUNT, so on this record the payload wins. A record a
 * machine wrote has no person to reach, and calling that a miss reported a correct refusal as a coverage
 * failure — which is exactly how GitHub came to read 5.5%.
 *
 * Failing that, it tries the author, then the chat native id — the SAME two keys, in the same order, that
 * {@link ./personResolver.canonicalPersonIdForAuthor} tries, so the reason always describes the lookup that
 * actually happened.
 */
function missFor({
  record,
  members,
  accounts,
}: {
  record: CorpusRecord;
  members: MemberIndex;
  accounts: ReadonlyMap<string, AccountClassification>;
}): AttributionMiss {
  const actor = classifyActor({ index: accounts, record });
  if (actor.kind === "machine" || actor.kind === "machine-as-person") {
    return "machine-author";
  }
  const source = record.source;
  if (source === "gold") {
    return "no-member-row";
  }
  const ids = [record.author, chatNativeAuthorId({ record })].filter(
    (id): id is string => id !== undefined && id.length > 0,
  );
  for (const id of ids) {
    const row = members.byNativeId.get(personIdentityKey({ nativeId: id, source }));
    if (row !== undefined) {
      return classifyMiss({ keyedByNativeId: true, row });
    }
  }
  for (const id of ids) {
    const row = members.byHandle.get(handleKey({ handle: id, source }));
    if (row !== undefined) {
      return classifyMiss({ keyedByNativeId: false, row });
    }
  }
  return "no-member-row";
}

/** A mutable per-source tally, frozen into {@link AttributionSourceCoverage} at the end. */
interface SourceTally {
  records: number;
  authored: number;
  attributed: number;
  machineAuthored: number;
}

/** The tally already open for a source, or a zeroed one stored under it the first time the source is seen. */
function tallyFor({
  bySource,
  source,
}: {
  bySource: Map<CorpusSource, SourceTally>;
  source: CorpusSource;
}): SourceTally {
  const open = bySource.get(source);
  if (open !== undefined) {
    return open;
  }
  const fresh: SourceTally = { attributed: 0, authored: 0, machineAuthored: 0, records: 0 };
  bySource.set(source, fresh);
  return fresh;
}

/**
 * Measure attribution coverage over the corpus: how many records carry an author, how many of those reach a
 * canonical person, how many distinct people that is, and the named residual for the rest. Pure.
 *
 * @param records the corpus records (pass the latest-collapsed view — a superseded version would be counted
 *   as its own record and quietly inflate both halves of the ratio)
 * @param resolution the cross-source identity resolution the directory merges on
 * @param memberRows the hydrated member rows, used ONLY to name why a miss missed (empty ⇒ every miss reads
 *   as `no-member-row`, which is exactly true of an un-hydrated home)
 * @param accounts the member-row index INCLUDING its people ({@link ./accountKind.accountKindIndexAll}),
 *   which is what {@link ./actorKind.classifyActor} needs — the filtered index would read every real
 *   teammate as unplaced
 * @returns the coverage, its per-source split (sorted by source), and the residual (commonest reason first)
 */
export function measureAttribution({
  records,
  resolution,
  memberRows = [],
  accounts = new Map(),
}: {
  records: readonly CorpusRecord[];
  resolution: IdentityResolution;
  memberRows?: readonly MemberBronzeRow[];
  accounts?: ReadonlyMap<string, AccountClassification>;
}): AttributionCoverage {
  const members = indexMembers({ rows: memberRows });
  const bySource = new Map<CorpusSource, SourceTally>();
  const misses = new Map<AttributionMiss, number>();
  const people = new Set<string>();
  let authored = 0;
  let attributed = 0;
  let machineAuthored = 0;
  for (const record of records) {
    const tally = tallyFor({ bySource, source: record.source });
    tally.records += 1;
    const canonical = canonicalPersonIdForAuthor({ record, resolution });
    if (canonical === undefined) {
      continue;
    }
    tally.authored += 1;
    authored += 1;
    // A canonical id EQUAL to the raw author means no applied link was found (the resolver hands the raw id
    // back untouched). The one way that reads wrong is an author string that is itself a canonical person id,
    // which would count as a miss — the conservative direction for a coverage claim, never the flattering one.
    if (canonical === record.author) {
      const miss = missFor({ accounts, members, record });
      // A miss reason's tally opens at one on its first record.
      const missed = misses.get(miss);
      misses.set(miss, missed === undefined ? 1 : missed + 1);
      if (miss === "machine-author") {
        tally.machineAuthored += 1;
        machineAuthored += 1;
      }
      continue;
    }
    tally.attributed += 1;
    attributed += 1;
    people.add(canonical);
  }
  return {
    attributed,
    authored,
    machineAuthored,
    people: people.size,
    records: records.length,
    residual: [...misses]
      .map(([reason, count]): AttributionResidual => ({ count, reason }))
      .toSorted((a, b) => b.count - a.count || compareStrings({ a: a.reason, b: b.reason })),
    sources: [...bySource]
      .map(([source, tally]): AttributionSourceCoverage => ({ ...tally, source }))
      .toSorted((a, b) => compareStrings({ a: a.source, b: b.source })),
  };
}

/** A count as a percentage of a total, to one decimal — `0.0` for an empty total rather than a NaN. */
function percent({ count, total }: { count: number; total: number }): string {
  return total === 0 ? "0.0" : ((100 * count) / total).toFixed(1);
}

/** One source's clause: the raw ratio, then what it looks like once machine authorship is set aside. Pure. */
function sourceClause({ source }: { source: AttributionSourceCoverage }): string {
  const raw = `${source.source} ${String(source.attributed)}/${String(source.authored)} (${percent({ count: source.attributed, total: source.authored })}%)`;
  if (source.machineAuthored === 0) {
    return raw;
  }
  const human = source.authored - source.machineAuthored;
  return `${raw} [${String(source.machineAuthored)} machine-authored; ${percent({ count: source.attributed, total: human })}% of the ${String(human)} left]`;
}

/**
 * The human report lines for an attribution measurement — the coverage, the per-source split, and the named
 * residual. Pure.
 *
 * **Both ratios, never one.** The raw `attributed/authored` figure is what every measurement in this
 * repository's history quotes, so it stays the headline and stays comparable; the bracketed one says what
 * the raw figure cannot, which is that most of what it calls a miss is a machine with no person to reach.
 * Publishing only the second would have announced GitHub attribution leaping from 5.5% to roughly 47% on a
 * reporting change that ingested nothing — a number nobody measured, reading as an improvement nobody made.
 *
 * @param coverage the measurement
 * @returns the lines, one per logical fact, in report order
 */
export function describeAttribution({ coverage }: { coverage: AttributionCoverage }): readonly string[] {
  const { attributed, authored, records, people, machineAuthored } = coverage;
  const lines = [
    `attribution: ${String(attributed)}/${String(authored)} authored records reach a person (${percent({ count: attributed, total: authored })}%; ${percent({ count: attributed, total: records })}% of all ${String(records)}), ${String(people)} distinct people`,
  ];
  if (machineAuthored > 0) {
    const human = authored - machineAuthored;
    lines.push(
      `  ${String(machineAuthored)} of the misses were written by a machine (${percent({ count: machineAuthored, total: authored })}% of authored) — no person to reach, not a coverage gap; over the ${String(human)} left, ${percent({ count: attributed, total: human })}%`,
    );
  }
  const perSource = coverage.sources.map((source) => sourceClause({ source }));
  if (perSource.length > 0) {
    lines.push(`  by source: ${perSource.join(", ")}`);
  }
  const residual = coverage.residual.map((entry) => `${String(entry.count)} ${entry.reason}`);
  lines.push(`  residual: ${residual.length > 0 ? residual.join(", ") : "none"}`);
  return lines;
}
