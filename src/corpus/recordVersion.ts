/**
 * Which of two versions of one entity is the LATER one — the version clock both the bronze writer
 * (`./bronzeFreshness.ts`) and the latest view (`./latestRecords.ts`) order by, so the two can never disagree.
 *
 * For almost every source a record's `tsIso` IS its version time: an edited message, issue or page carries the
 * instant of the edit. A diary is the exception. A calendar record's `tsIso` is the event's START, which a
 * reschedule moves in either direction, so ordering versions by it treats an event moved EARLIER as a stale
 * read: the writer refused the new version and the view kept serving the old time. Both diary projections
 * already keep the provider's own modification time in `attrs.updatedIso` (Google's `updated`, Outlook's
 * `lastModifiedDateTime`), so that is the clock their versions are ordered by.
 *
 * A diary row without one carries a FALLBACK stamp, its start. A start and a modification time are two different
 * clocks, and comparing them directly would refuse a fresh version of a future meeting against a stale row whose
 * start sits months ahead. So the basis travels with the stamp: an authoritative stamp outranks a fallback one
 * whatever the two strings say, and only stamps of one basis compare by time.
 */
import type { CorpusRecord, CorpusSource } from "./types.js";

/** The sources whose `tsIso` is an event's start rather than the time its current version was written. */
const START_TIMED_SOURCES: ReadonlySet<CorpusSource> = new Set<CorpusSource>(["calendar", "outlook-calendar"]);

/** The attr a {@link START_TIMED_SOURCES} projection keeps the provider's modification time under. */
const VERSION_ATTR = "updatedIso";

/**
 * One record's version stamp: the time it orders by, and whether that time is the source's real version clock
 * (`authoritative`) or a diary row's start standing in for a missing one (`fallback`).
 */
export interface RecordVersion {
  readonly basis: "authoritative" | "fallback";
  readonly tsIso: string;
}

/**
 * Whether `source` orders its versions by a modification time rather than by its `tsIso` — one of the diaries.
 * Pure.
 *
 * @param source the record's source
 * @returns true for a source whose `tsIso` is an event's start
 */
export function ordersByModification({ source }: { source: CorpusSource }): boolean {
  return START_TIMED_SOURCES.has(source);
}

/**
 * The version stamp a record orders by: a diary row's `attrs.updatedIso` when it carries a non-empty one, its
 * start as a fallback when it does not, and every other source's own `tsIso`. Pure.
 *
 * @param record the record to stamp
 * @returns its version stamp
 */
export function recordVersion({ record }: { record: CorpusRecord }): RecordVersion {
  if (!ordersByModification({ source: record.source })) {
    return { basis: "authoritative", tsIso: record.tsIso };
  }
  const updated = record.attrs?.[VERSION_ATTR];
  if (typeof updated === "string" && updated.length > 0) {
    return { basis: "authoritative", tsIso: updated };
  }
  return { basis: "fallback", tsIso: record.tsIso };
}

/**
 * Whether two stamps are the same version: one basis and one string. Pure.
 *
 * @param candidate one stamp
 * @param incumbent the other stamp
 * @returns true when neither outranks the other
 */
export function sameRecordVersion({
  candidate,
  incumbent,
}: {
  candidate: RecordVersion;
  incumbent: RecordVersion;
}): boolean {
  return candidate.basis === incumbent.basis && candidate.tsIso === incumbent.tsIso;
}

/**
 * Whether `candidate` is a LATER version than a DIFFERENT `incumbent`: an authoritative stamp outranks a fallback
 * one, and stamps of one basis order by {@link laterTimestamp}. Pure, and a total order over distinct stamps.
 *
 * @param candidate the later-read version's stamp
 * @param incumbent the held version's stamp, which must differ from `candidate`
 * @returns true when `candidate` is the later version
 */
export function laterRecordVersion({
  candidate,
  incumbent,
}: {
  candidate: RecordVersion;
  incumbent: RecordVersion;
}): boolean {
  if (candidate.basis !== incumbent.basis) {
    return candidate.basis === "authoritative";
  }
  return laterTimestamp({ candidate: candidate.tsIso, incumbent: incumbent.tsIso });
}

/**
 * The instant a `tsIso` denotes, ranked so the winner rule stays a TOTAL order: a value no parser accepts
 * ranks `-Infinity`, below every real timestamp, rather than `NaN`.
 *
 * `NaN` would be fatal here, and not only because every comparison against it is false. Letting an
 * unparseable pair "fall through" to the content tie-breaks makes the relation NON-TRANSITIVE: a long
 * unparseable row beats a short dated one on length, that dated row beats a long dated one on nothing at
 * all, and the dated rows order by instant — a cycle, which `latestRecords` folds through a Map, so the
 * survivor becomes whichever row was read first. Ranking unparseable as `-Infinity` keeps the comparison a
 * lexicographic order on (millisecond, sub-millisecond fraction, raw string) — see {@link laterTimestamp} —
 * every part of which is total. Pure.
 */
function instantOf({ tsIso }: { tsIso: string }): number {
  const parsed = Date.parse(tsIso);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Whether one `tsIso` is LATER than a DIFFERENT one — the whole of the winner rule whenever two versions'
 * stamps share a basis but not a string. Pure, and a total order over distinct strings.
 *
 * @param candidate the later-read version's timestamp
 * @param incumbent the held version's timestamp, which must differ from `candidate`
 * @returns true when `candidate` is the later timestamp
 */
function laterTimestamp({ candidate, incumbent }: { candidate: string; incumbent: string }): boolean {
  const candidateAt = instantOf({ tsIso: candidate });
  const incumbentAt = instantOf({ tsIso: incumbent });
  // Compare INSTANTS, not the strings. `corpusStore` accepts any non-empty `tsIso`, and 12.2% of the
  // records measured here carry a `+10:00` offset rather than `Z` — and `"…T00:30:00+10:00"` sorts ABOVE
  // a `Z` instant at midnight of the same date while being the EARLIER moment. Comparing strings would then keep the older row and
  // hand the stale prose to the only verb that spends tokens. No entity currently mixes the two formats
  // (0 of 7,663 multi-version entities, so this changes no winner today), but nothing prevents one: a
  // connector that changes its timestamp rendering is all it takes.
  if (candidateAt !== incumbentAt) {
    return candidateAt > incumbentAt;
  }
  // Equal RANK, but the strings still differ — two timestamps `Date.parse` truncated to one millisecond, the
  // same instant written two ways (`+10:00` vs `Z`), or both unparseable. The first is why the digits past the
  // millisecond are compared next, as a FRACTION: `…00.0009Z` and `…00.0001Z` are one millisecond to
  // `Date.parse`, and so are `…T10:00:00.0001+10:00` and `…T00:00:00.0009Z`, where the raw strings order the
  // `+10:00` one later while it is the EARLIER moment, and `…00Z` against `…00.0005Z`, where `"Z" > "."`.
  // An unparseable pair skips this: it denotes no instant, so a fraction read off its text would be fiction.
  // The whole key is therefore (millisecond rank, sub-millisecond fraction, raw string), each part total.
  if (candidateAt !== Number.NEGATIVE_INFINITY) {
    const fraction = compareSubMillisecond({
      candidate: subMillisecondDigits({ tsIso: candidate }),
      incumbent: subMillisecondDigits({ tsIso: incumbent }),
    });
    if (fraction !== 0) {
      return fraction > 0;
    }
  }
  // One instant written two ways, or two unparseable strings: nothing in either says which is later, so the
  // raw strings decide, which keeps the order total.
  return candidate > incumbent;
}

/**
 * The fractional-second digits of a WHOLE-STRING ISO-8601 date-time: a four-digit or signed six-digit year, a
 * `T`, `t` or space separator, and a `Z`, `z`, `±HHMM` or `±HH:MM` offset or none. Every UTC offset is a
 * whole number of minutes, so these digits mean the same in any rendering of one instant.
 *
 * **Anchored on the whole string, and the residue is stated rather than chased.** `Date.parse` also accepts an
 * implementation-defined legacy grammar on this runtime (Node 24): `<Month> <D>, <YYYY> H:M:S.ffff UTC`, one-digit
 * parts, and parenthesised comments it skips, so `(<H:M:S.ffff>) <D> <Mon> <YYYY> <H:M:S.ffff> GMT` parses to
 * the second time. A pattern hunting the first time-shaped run reads the comment's fraction and reverses two
 * instants; one mimicking that grammar is never finished. So a legacy rendering carries no fraction here, and two
 * of them inside one millisecond order by their text, as every equal-millisecond pair did before this read.
 * Pinned in `recordVersion.test.ts`.
 */
const FRACTION_PATTERN = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}\.(\d+)(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/**
 * The digits of a parsed `tsIso`'s fractional second PAST the millisecond — the part `Date.parse` truncates
 * away. Empty for a timestamp with three or fewer fractional digits, none, or one outside the ISO-8601 grammar
 * {@link FRACTION_PATTERN} reads. Pure.
 */
function subMillisecondDigits({ tsIso }: { tsIso: string }): string {
  const match = FRACTION_PATTERN.exec(tsIso);
  if (match === null) {
    return "";
  }
  return match[1]!.slice(3);
}

/**
 * Two sub-millisecond digit runs compared as the fractions they denote: the shorter is right-padded with zeros,
 * so `"9"` (900µs) outranks `"01"` (10µs), and `""` equals `"000"`. Pure.
 *
 * @returns positive when `candidate` is the larger fraction, negative when smaller, zero when equal
 */
function compareSubMillisecond({ candidate, incumbent }: { candidate: string; incumbent: string }): number {
  const width = Math.max(candidate.length, incumbent.length);
  const candidatePadded = candidate.padEnd(width, "0");
  const incumbentPadded = incumbent.padEnd(width, "0");
  if (candidatePadded === incumbentPadded) {
    return 0;
  }
  return candidatePadded > incumbentPadded ? 1 : -1;
}
