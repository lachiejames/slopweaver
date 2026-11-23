/**
 * The SEEN LEDGER: what the reflection loop has already put in front of the owner, and what the owner said about
 * it. `$SLOPWEAVER_HOME/ledgers/reflect/seen.jsonl`, append-only.
 *
 * Same pure-line / effectful-append split as `src/admit/painPoint.ts` and `src/admit/ledger.ts`:
 * {@link seenLine} is pure and takes its timestamp as an argument, {@link recordSeen} is the thin effectful
 * append, and {@link foldSeenLedger} derives every piece of state from the whole file rather than storing
 * it. Nothing here reads a clock.
 *
 * ## Two things it exists to make impossible
 *
 * **Re-proposing what the owner already refused.** A `drop` is TERMINAL: once one row carries it, the finding is
 * dead however many times the miner rediscovers it, and no later row revives it. Worth stating as a ship
 * condition because the last attempt at this loop declared the status in its types and never wrote a single
 * one — a reject path nothing exercises is the mirror image of a gate that always refuses.
 *
 * **Losing the recurrence.** There is ONE persisted per-finding counter, no
 * second cadence, and the daily pass carries state across days rather than re-deriving it — "started when"
 * and "resolved yet" need history. {@link SeenState.daysSeen} is that counter. It counts DISTINCT CALENDAR
 * DAYS on which the miner found the finding at all, surfaced or backlogged, so two runs on one day do not
 * inflate it and a finding that quietly sat in the backlog for a week is still visibly chronic.
 *
 * ## Why a grade lives in the same file as a sighting
 *
 * A grade that arrives into a ledger nothing folds terminally is a grade with no teeth, so a grade is a row
 * HERE rather than in a second file: {@link foldSeenLedger} reads sightings and grades in one pass, and the
 * miner's own `prepareCandidates` refuses a dropped finding from that same fold. The writer is
 * `slopweaver reflect grade` (`src/reflect/grades.ts`), which appends one row carrying the word, an optional
 * why, and an optional `closedBy` — what closed the underlying problem — so the next run reads its own
 * history instead of re-measuring it.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { addInto } from "#lib/collections.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import { REFLECT_SOURCES, type ReflectSource } from "./finding.js";

/**
 * What one row records.
 *
 * The first two are written by the miner: `surfaced` means it reached the owner's five, `backlogged` means
 * it was found and ranked below the cap. The last three are the owner's grade, one word each — the alignment
 * measurement the design asks for, and the only thing that can end a finding's life.
 */
export type SeenDisposition = "adjust" | "backlogged" | "drop" | "keep" | "surfaced";

/**
 * Every disposition, so a parser and a test read one list rather than two.
 *
 * @internal
 */
export const SEEN_DISPOSITIONS = ["surfaced", "backlogged", "keep", "adjust", "drop"] as const;

/** The grades, which are the subset of dispositions the owner writes. */
export const SEEN_GRADES = ["keep", "adjust", "drop"] as const;

/** One of the owner's three grade words. */
export type SeenGrade = (typeof SEEN_GRADES)[number];

/** One appended row. Flat on purpose: a ledger a `jq` one-liner can read outlives one that needs a parser. */
export interface SeenRow {
  /** When the row was written. Injected by the caller, never read from a clock in here. */
  readonly tsIso: string;
  /** The finding's stable id, from `findingId`. The join key for every fold below. */
  readonly id: string;
  /** Which collector produced it, so the grade distribution can be taken per source. */
  readonly source: ReflectSource;
  /** The class key at the time, carried so a reader can tell WHAT the id refers to without a second file. */
  readonly classKey: string;
  /** Where it was seen, same reason. */
  readonly locus: string;
  /** What happened to it. */
  readonly disposition: SeenDisposition;
  /** How many times that window saw it. Recorded, and deliberately not part of the id. */
  readonly occurrences: number;
  /** The owner's reason, when the owner gave one. Absent on a miner-written row. */
  readonly why?: string;
  /**
   * What closed the underlying problem — a pull request, a commit, a board slug — when a grade row names one.
   * Metadata on the grade, never an edit to the finding: a later sighting of a closed finding is a regression
   * the brief says out loud, not something this field hides.
   */
  readonly closedBy?: string;
}

/**
 * Render one row as its JSONL line. Pure and deterministic — keys are emitted in a fixed order so two runs
 * writing the same row produce byte-identical lines.
 *
 * @param row the row to render
 * @returns the JSON line, with no trailing newline
 */
export function seenLine({ row }: { row: SeenRow }): string {
  return JSON.stringify({
    classKey: row.classKey,
    disposition: row.disposition,
    id: row.id,
    locus: row.locus,
    occurrences: row.occurrences,
    schemaVersion: 1,
    source: row.source,
    tsIso: row.tsIso,
    ...(row.why !== undefined ? { why: row.why } : {}),
    ...(row.closedBy !== undefined ? { closedBy: row.closedBy } : {}),
  });
}

/** Whether a parsed value is a disposition this version knows. */
function isDisposition(value: unknown): value is SeenDisposition {
  return SEEN_DISPOSITIONS.some((known) => known === value);
}

/** Whether a parsed value is a source this version knows. */
function isSource(value: unknown): value is ReflectSource {
  return REFLECT_SOURCES.some((known) => known === value);
}

/** Decode one ledger line, or `undefined` when this version cannot read it. */
function decodeSeenRow({ line }: { line: string }): SeenRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isDisposition(parsed["disposition"]) || !isSource(parsed["source"])) {
    return undefined;
  }
  const { tsIso, id, classKey, locus, occurrences, why, closedBy } = parsed;
  const named = typeof tsIso === "string" && typeof id === "string" && typeof classKey === "string";
  if (!named || typeof locus !== "string") {
    return undefined;
  }
  return {
    classKey,
    disposition: parsed["disposition"],
    id,
    locus,
    occurrences: typeof occurrences === "number" && Number.isFinite(occurrences) ? occurrences : 0,
    source: parsed["source"],
    tsIso,
    ...(typeof why === "string" && why.trim().length > 0 ? { why } : {}),
    ...(typeof closedBy === "string" && closedBy.trim().length > 0 ? { closedBy } : {}),
  };
}

/**
 * Parse the ledger text into rows, skipping what it cannot read.
 *
 * Tolerant in the same way and for the same reason as `parsePainPoints`: a truncated final line is the
 * normal consequence of a process dying mid-append, and it must not make the whole ledger unreadable. The
 * one thing skipping can do is LOSE a row, which loses recurrence or a grade; it can never invent one, and
 * a lost `drop` re-surfaces a finding rather than hiding one.
 *
 * @param text the raw `seen.jsonl` contents
 * @returns the rows that decoded, in file order
 */
export function parseSeenRows({ text }: { text: string }): readonly SeenRow[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim().length === 0) {
      return [];
    }
    const row = decodeSeenRow({ line });
    return row === undefined ? [] : [row];
  });
}

/** Everything the ledger remembers about one finding. Derived, never stored. */
export interface SeenState {
  readonly id: string;
  readonly source: ReflectSource;
  /** The class key as of the most recent row, so a reader can name the finding from the fold alone. */
  readonly classKey: string;
  readonly locus: string;
  /** The first instant any row mentions it. The answer to "started when". */
  readonly firstSeenIso: string;
  /** The most recent instant any row mentions it. */
  readonly lastSeenIso: string;
  /** Distinct UTC calendar days the miner found it on. The one persisted recurrence counter. */
  readonly daysSeen: number;
  /**
   * The latest UTC day it was SIGHTED on, by date rather than by file order, so a run can tell whether today
   * is already in {@link daysSeen}. Two runs straddling UTC midnight can append out of date order.
   */
  readonly latestSightingDay: string | undefined;
  /** How many times it reached the owner's five, as opposed to sitting in the backlog. */
  readonly surfacedCount: number;
  /** TERMINAL. Once true, no later row makes it false, and the miner never proposes it again. */
  readonly dropped: boolean;
  /** The most recent grade, when one has been given. */
  readonly grade: SeenGrade | undefined;
  /** What the most recent grade naming one said closed it. A later grade without one does not erase it. */
  readonly closedBy: string | undefined;
  /** When that closing grade was written, so a sighting after it reads as the regression it is. */
  readonly closedAtIso: string | undefined;
}

/**
 * The UTC calendar day a timestamp falls on, as the ledger writes it.
 *
 * @param tsIso an ISO-8601 instant
 * @returns its `YYYY-MM-DD` prefix
 */
export function dayOf({ tsIso }: { tsIso: string }): string {
  return tsIso.slice(0, "YYYY-MM-DD".length);
}

/** The latest day a finding was sighted on, after this row: the later of the two `YYYY-MM-DD` strings. */
function latestSightingAfter({
  sighting,
  tsIso,
  prior,
}: {
  sighting: boolean;
  tsIso: string;
  prior: string | undefined;
}): string | undefined {
  if (!sighting) {
    return prior;
  }
  const day = dayOf({ tsIso });
  if (prior === undefined || day > prior) {
    return day;
  }
  return prior;
}

/** Whether this disposition is the miner reporting a SIGHTING, as opposed to the owner reporting a grade. */
function isSighting({ disposition }: { disposition: SeenDisposition }): boolean {
  return disposition === "surfaced" || disposition === "backlogged";
}

/**
 * Whether a disposition is one of the owner's grades.
 *
 * Positional because TypeScript forbids a type predicate over a destructured binding (TS1230), which is the
 * compiler's decision rather than this repo's — see the named-object-params rule's exception for predicates.
 */
function isGrade(value: SeenDisposition): value is SeenGrade {
  return SEEN_GRADES.some((grade) => grade === value);
}

/** Distinct days a finding was sighted on. A finding the owner graded before any sighting has none yet. */
function sightingDays({ days, id }: { days: ReadonlyMap<string, ReadonlySet<string>>; id: string }): number {
  const sighted = days.get(id);
  if (sighted === undefined) {
    return 0;
  }
  return sighted.size;
}

/** The first instant any row mentions a finding. With no state before it, this row is that first mention. */
function firstMentionIso({ prior, row }: { prior: SeenState | undefined; row: SeenRow }): string {
  if (prior === undefined) {
    return row.tsIso;
  }
  return prior.firstSeenIso;
}

/** How many times a finding was surfaced before this row. With no state before it, it never was. */
function surfacedBeforeRow({ prior }: { prior: SeenState | undefined }): number {
  if (prior === undefined) {
    return 0;
  }
  return prior.surfacedCount;
}

/**
 * Fold the whole ledger into one state per finding.
 *
 * Row order is file order, which is append order, so "most recent" is simply "last seen while folding".
 * The one asymmetry is `dropped`, which only ever goes from false to true: that is what makes a drop
 * terminal, and it is the single line of this function that the loop's alignment rests on.
 *
 * @param rows the parsed ledger, in file order
 * @returns one state per finding id, keyed by id
 */
export function foldSeenLedger({ rows }: { rows: readonly SeenRow[] }): ReadonlyMap<string, SeenState> {
  const days = new Map<string, Set<string>>();
  const states = new Map<string, SeenState>();
  for (const row of rows) {
    const prior = states.get(row.id);
    const sighting = isSighting({ disposition: row.disposition });
    if (sighting) {
      addInto({ key: row.id, sets: days, value: dayOf({ tsIso: row.tsIso }) });
    }
    const closes = isGrade(row.disposition) && row.closedBy !== undefined;
    states.set(row.id, {
      classKey: row.classKey,
      closedAtIso: closes ? row.tsIso : prior?.closedAtIso,
      closedBy: closes ? row.closedBy : prior?.closedBy,
      daysSeen: sightingDays({ days, id: row.id }),
      dropped: prior?.dropped === true || row.disposition === "drop",
      firstSeenIso: firstMentionIso({ prior, row }),
      grade: isGrade(row.disposition) ? row.disposition : prior?.grade,
      id: row.id,
      lastSeenIso: row.tsIso,
      latestSightingDay: latestSightingAfter({ prior: prior?.latestSightingDay, sighting, tsIso: row.tsIso }),
      locus: row.locus,
      source: row.source,
      surfacedCount: surfacedBeforeRow({ prior }) + (row.disposition === "surfaced" ? 1 : 0),
    });
  }
  return states;
}

/**
 * The reflection loop's own ledger directory, a sibling of the flat ledgers under the state home because
 * the loop writes several files rather than one.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute directory holding `seen.jsonl` and `heartbeat.jsonl`
 */
export function reflectLedgerDir({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home !== undefined ? { home } : {}).ledgers, "reflect");
}

/**
 * Read the seen ledger's raw text. An absent ledger — a home whose loop has never run — is the empty
 * string, not an error, so a first run reads as "nothing seen yet" rather than as a broken home.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the ledger contents, or the empty string when there is no ledger yet
 */
export function readSeenText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(join(reflectLedgerDir(home !== undefined ? { home } : {}), "seen.jsonl"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Append rows to the seen ledger, creating its directory if needed. The effectful edge over
 * {@link seenLine}.
 *
 * Unlike `recordPainPoint`, this one FAILS LOUDLY rather than swallowing. The trade there was that an
 * observation ledger must never block a send; here the ledger IS the product — a run whose sightings were
 * not recorded has lost the recurrence counter and will re-propose a dropped finding tomorrow, so reporting
 * success over a failed write would be the exact defect this file exists to prevent.
 *
 * @param rows the rows to append, in order
 * @param home the state home (defaults to the resolved home)
 * @returns how many rows were written, or every reason nothing was
 */
export function recordSeen({ rows, home }: { rows: readonly SeenRow[]; home?: string }): Result<number> {
  if (rows.length === 0) {
    return ok(0);
  }
  const dir = reflectLedgerDir(home !== undefined ? { home } : {});
  const written = safeFs({
    execute: (): number => {
      mkdirSync(dir, { recursive: true });
      appendLines({ path: join(dir, "seen.jsonl"), text: `${rows.map((row) => seenLine({ row })).join("\n")}\n` });
      return rows.length;
    },
    operation: "append reflect seen ledger",
    path: dir,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}
