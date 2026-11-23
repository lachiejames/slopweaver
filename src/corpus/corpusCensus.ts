/**
 * The corpus CENSUS — the logical-latest view of a corpus tree, computed by streaming it, holding a byte range
 * per identity instead of a record.
 *
 * ## Why this exists
 *
 * `audit`, `distil`, `slice verify` and the console's WORLD MODEL section each used to call
 * {@link ./corpusDirRead.readCorpusDir} (or `loadCorpus`), which materialises every record of every window
 * file into one array before any of them computes anything. What each then computes is a FOLD — counts, a
 * few sets, a batch plan — or needs whole records only a batch at a time. MEASURED on the
 * owner's corpus (10,614 MiB, 74 files): the `bronze` projection those verbs asked for preflights at
 * 7,429 MiB against a 3,590 MiB budget, so all four refused; `retrieval` measured 3,202 MiB live and still
 * refused at the band's floor. The rule: bronze is meant to be sliced so nothing loads a multi-gigabyte
 * corpus into memory at once, so these verbs move onto the streaming shape rather than bump the band.
 *
 * ## What it retains
 *
 * One {@link CensusEntry} per logical identity — the five fields the collapse and the batch plan read, the
 * record's body length, and the {@link RowPointer} its row sits at. Never the body, never `raw`. So peak heap
 * scales with how many ENTITIES the corpus holds, not how many bytes: a window re-fetched ten times costs one
 * entry, and a 60 KB Slack payload costs the same as a 60-byte one. A caller that needs whole records reads
 * them back by pointer, a batch at a time, through a {@link RowReader}.
 *
 * ## The collapse is {@link ./latestRecords.latestRecords}, exactly
 *
 * The winner rule is not restated here. A pair whose timestamps differ is decided from the two strings the
 * entry keeps ({@link ./latestRecords.laterTimestamp}, the only branch of the rule that reads no content);
 * a pair whose timestamps are the SAME string re-reads the held row by pointer, parses both under the
 * caller's `tieProjection`, and asks {@link ./latestRecords.latestWins}. The projection matters: the rule's
 * last tie-break compares serialised rows, and `raw` is in a `bronze` row and not in a `retrieval` one, so a
 * census matches the collapse its caller USED to run only when it re-reads under the projection that caller
 * used to read under. Survivors keep first-seen order, as the collapse's own Map does.
 */
import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { slopweaverHome } from "../config.js";
import type { OwnerProtectionResolver } from "./bronzeProtection.js";
import { type CensusRowUnreadableError, type CorpusCensusError, CorpusCensusErrors } from "./corpusCensus.errors.js";
import { type CorpusProjection, parseRow, type SkipReason } from "./corpusRowCore.js";
import { protectedSkipWarnings, readJsonlLines, scanCorpusRoot } from "./corpusStore.js";
import { groupOfFile, type SkipTally, tallySkips } from "./corpusTallyCore.js";
import { laterTimestamp, latestWins, recordIdentity } from "./latestRecords.js";
import { type RowPointer, type RowReader, rowUnreadable } from "./rowReader.js";
import { collapseRowWarnings, type RowWarning } from "./rowWarnings.js";
import type { CorpusRecord, CorpusSource } from "./types.js";

/** What the census keeps for one logical identity — its current version's keys, never its body. */
export interface CensusEntry {
  readonly source: CorpusSource;
  readonly container: string;
  readonly sourceId: string;
  readonly kind: string;
  readonly tsIso: string;
  /**
   * The length of the record's title and text joined by a newline — `gold/recordBody.recordBody`'s string,
   * whose length the distil budget spends and the slice exposure measures. Pinned equal by a unit test.
   */
  readonly bodyChars: number;
  /** The first path segment under the corpus root — the leg this version's row was read from. */
  readonly group: string;
  readonly pointer: RowPointer;
}

/** One group's conservation arithmetic, in the terms `corpusTallyCore.CorpusGroupTally` states it. */
export interface CensusGroup {
  readonly group: string;
  /** Non-blank lines seen across this group's readable files. */
  readonly rows: number;
  /** Lines that parsed into a record — admitted or not. */
  readonly parsed: number;
  readonly skipped: readonly SkipTally[];
  readonly unreadable: readonly string[];
}

/** What one physical row handed a fold: the record under the `retrieval` projection, and where it sits. */
export interface CensusRow {
  readonly record: CorpusRecord;
  readonly pointer: RowPointer;
  readonly group: string;
  /** How many versions of this identity have been admitted so far, this one included — `1` on first sight. */
  readonly versions: number;
}

/** The census of one corpus tree. */
export interface CorpusCensus {
  /** One entry per admitted logical identity, keyed by `recordIdentity`, in first-seen order. */
  readonly winners: ReadonlyMap<string, CensusEntry>;
  /** Every group that held a file or an unlistable directory, in read order. */
  readonly groups: readonly CensusGroup[];
  /** Admitted physical rows — what an uncollapsed read would have returned after the `admit` filter. */
  readonly admittedRows: number;
  /** Every path that could not be read at all: whole files, and directories that could not be listed. */
  readonly unreadable: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * The length of `gold/recordBody.recordBody`'s string for a record, computed without building it.
 *
 * @param record the record
 * @returns the joined title-and-text length
 */
function bodyCharsOf({ record }: { record: CorpusRecord }): number {
  return record.title === undefined ? record.text.length : record.title.length + 1 + record.text.length;
}

/** The mutable accumulator one group fills while its files stream past. */
interface GroupRun {
  rows: number;
  parsed: number;
  readonly reasons: SkipReason[];
  readonly unreadable: string[];
}

/** Fetch (or create) a group's accumulator, keeping first-seen order. */
function groupRunFor({ runs, group }: { runs: Map<string, GroupRun>; group: string }): GroupRun {
  const existing = runs.get(group);
  if (existing !== undefined) {
    return existing;
  }
  const created: GroupRun = { parsed: 0, reasons: [], rows: 0, unreadable: [] };
  runs.set(group, created);
  return created;
}

/**
 * Decide whether a later-read row replaces the held version of its identity.
 *
 * @returns true when the candidate wins, or the reason the held row could not be read back
 */
function candidateWins({
  line,
  pointer,
  candidate,
  incumbent,
  reader,
  tieProjection,
}: {
  line: string;
  pointer: RowPointer;
  candidate: CorpusRecord;
  incumbent: CensusEntry;
  reader: RowReader;
  tieProjection: CorpusProjection;
}): Result<boolean, CensusRowUnreadableError> {
  if (candidate.tsIso !== incumbent.tsIso) {
    return ok(laterTimestamp({ candidate: candidate.tsIso, incumbent: incumbent.tsIso }));
  }
  const heldLine = reader.line({ pointer: incumbent.pointer });
  if (heldLine.isErr()) {
    return err(heldLine.error);
  }
  const reparsed = parseRow({ line, projection: tieProjection });
  if (!("record" in reparsed)) {
    return err(rowUnreadable({ pointer, reason: reparsed.error }));
  }
  if (heldLine.value === line) {
    // Byte-identical rows are the commonest tie by far — an overlapping window re-fetching an unchanged
    // entity — and the rule decides them on the record alone, so one parse serves both sides.
    return ok(latestWins({ candidate: reparsed.record, incumbent: reparsed.record }));
  }
  const held = parseRow({ line: heldLine.value, projection: tieProjection });
  if (!("record" in held)) {
    return err(rowUnreadable({ pointer: incumbent.pointer, reason: held.error }));
  }
  return ok(latestWins({ candidate: reparsed.record, incumbent: held.record }));
}

/** What the census is told once and applies to every row. */
interface FoldRules {
  readonly reader: RowReader;
  readonly tieProjection: CorpusProjection;
  readonly admit: ((args: { record: CorpusRecord }) => boolean) | undefined;
  readonly onRow: ((row: CensusRow) => void) | undefined;
}

/** The collapse's running state, carried across every file of one census. */
interface FoldState {
  readonly winners: Map<string, CensusEntry>;
  readonly versions: Map<string, number>;
  admittedRows: number;
  /** The first row a tie could not read back — once set, the walk stops. */
  failure: CensusRowUnreadableError | undefined;
}

/**
 * Fold one parsed, admitted row into the collapse: count its version, hand it to the caller's fold, and keep
 * it when it beats the version held for its identity.
 */
function foldRow({
  record,
  line,
  pointer,
  group,
  rules,
  state,
}: {
  record: CorpusRecord;
  line: string;
  pointer: RowPointer;
  group: string;
  rules: FoldRules;
  state: FoldState;
}): void {
  state.admittedRows += 1;
  const key = recordIdentity({ record });
  const prior = state.versions.get(key);
  const seen = prior === undefined ? 1 : prior + 1;
  state.versions.set(key, seen);
  rules.onRow?.({ group, pointer, record, versions: seen });
  const incumbent = state.winners.get(key);
  if (incumbent !== undefined) {
    const wins = candidateWins({
      candidate: record,
      incumbent,
      line,
      pointer,
      reader: rules.reader,
      tieProjection: rules.tieProjection,
    });
    if (wins.isErr()) {
      state.failure = wins.error;
      return;
    }
    if (!wins.value) {
      return;
    }
  }
  state.winners.set(key, {
    bodyChars: bodyCharsOf({ record }),
    container: record.container,
    group,
    kind: record.kind,
    pointer,
    source: record.source,
    sourceId: record.sourceId,
    tsIso: record.tsIso,
  });
}

/**
 * Stream one file's rows into the collapse, accounting every row in its group as
 * {@link ./corpusDirRead.readCorpusTally} does. Stops early once a tie has failed.
 *
 * @returns the read's own outcome — an error when the file could not be read at all
 */
function streamFile({
  path,
  group,
  run,
  fileWarnings,
  rules,
  state,
}: {
  path: string;
  group: string;
  run: GroupRun;
  fileWarnings: RowWarning[];
  rules: FoldRules;
  state: FoldState;
}): Result<void, IngestError> {
  return safeFs({
    execute: () => {
      readJsonlLines({
        onChunk: () => state.failure === undefined,
        onLine: ({ line, index, byteOffset, byteLength }) => {
          if (state.failure !== undefined || line.trim().length === 0) {
            return;
          }
          run.rows += 1;
          const parsed = parseRow({ line, projection: "retrieval" });
          if (!("record" in parsed)) {
            run.reasons.push(parsed.reason);
            fileWarnings.push({ error: parsed.error, line: index + 1 });
            return;
          }
          run.parsed += 1;
          if (rules.admit !== undefined && !rules.admit({ record: parsed.record })) {
            return;
          }
          foldRow({ group, line, pointer: { byteLength, byteOffset, path }, record: parsed.record, rules, state });
        },
        path,
      });
    },
    operation: "corpusCensus.read",
    path,
  });
}

/** Charge every directory the walk could not list to its group's `unreadable`, and to the census's own. */
function noteUnlistableDirs({
  dir,
  dirs,
  runs,
  unreadable,
  warnings,
}: {
  dir: string;
  dirs: readonly string[];
  runs: Map<string, GroupRun>;
  unreadable: string[];
  warnings: string[];
}): void {
  for (const unlistable of dirs) {
    groupRunFor({ group: groupOfFile({ file: unlistable, root: dir }), runs }).unreadable.push(unlistable);
    unreadable.push(unlistable);
    warnings.push(`${unlistable}: directory could not be listed`);
  }
}

/**
 * Stream a corpus tree into its census.
 *
 * Every row is accounted for exactly as {@link ./corpusDirRead.readCorpusTally} accounts for it — a blank
 * line is uncounted, a rejected row is a counted skip with a line-numbered warning, a file that cannot be
 * opened is named in `unreadable` and the walk continues — so a caller switching from that reader keeps its
 * conservation arithmetic. A missing root is an empty census with a warning, as there.
 *
 * @param dir the corpus root to stream (bronze, or one source dir)
 * @param reader the reader a timestamp tie re-reads the held row through; the caller owns its lifetime
 * @param tieProjection the projection a tie is decided under — the one the caller's old read used
 * @param admit which parsed records join the collapse at all (the sync exclusion); omit to admit every one
 * @param onRow a fold over every ADMITTED physical row, called in read order
 * @param home the Slopweaver home whose protect list applies, beside the account's own; `dir` may sit outside it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the census, or a typed error when the root itself could not be read, the owner's protect list refuses
 *   part of it, or a tie could not be decided
 */
export function censusCorpus({
  dir,
  reader,
  tieProjection,
  admit,
  onRow,
  home = slopweaverHome(),
  protection,
}: {
  dir: string;
  reader: RowReader;
  tieProjection: CorpusProjection;
  admit?: (args: { record: CorpusRecord }) => boolean;
  onRow?: (row: CensusRow) => void;
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<CorpusCensus, CorpusCensusError> {
  const scanned = scanCorpusRoot({ dir, home, protection, statOperation: "corpusCensus.stat" });
  if (scanned.isErr()) {
    return err(scanned.error);
  }
  if ("empty" in scanned.value) {
    return ok(emptyCensus({ warning: scanned.value.empty }));
  }
  const { scan } = scanned.value;
  const state: FoldState = { admittedRows: 0, failure: undefined, versions: new Map(), winners: new Map() };
  const rules: FoldRules = { admit, onRow, reader, tieProjection };
  const runs = new Map<string, GroupRun>();
  const unreadable: string[] = [];
  const warnings: string[] = [...protectedSkipWarnings({ scan })];
  for (const file of scan.files) {
    const group = groupOfFile({ file: file.path, root: dir });
    const run = groupRunFor({ group, runs });
    const fileWarnings: RowWarning[] = [];
    const read = streamFile({ fileWarnings, group, path: file.path, rules, run, state });
    if (state.failure !== undefined) {
      return err(CorpusCensusErrors.tieUnreadable({ cause: state.failure, path: file.path }));
    }
    if (read.isErr()) {
      run.unreadable.push(file.path);
      unreadable.push(file.path);
      warnings.push(`${file.path}: unreadable (${read.error.message})`);
      continue;
    }
    for (const warning of collapseRowWarnings({ warnings: fileWarnings })) {
      warnings.push(`${file.path}: ${warning}`);
    }
  }
  noteUnlistableDirs({ dir, dirs: scan.unreadableDirs, runs, unreadable, warnings });
  return ok({
    admittedRows: state.admittedRows,
    groups: groupsOf({ runs }),
    unreadable,
    warnings,
    winners: state.winners,
  });
}

/** Every group's finished accumulator as its conservation arithmetic, in first-seen order. */
function groupsOf({ runs }: { runs: ReadonlyMap<string, GroupRun> }): readonly CensusGroup[] {
  return [...runs].map(([group, run]) => ({
    group,
    parsed: run.parsed,
    rows: run.rows,
    skipped: tallySkips({ reasons: run.reasons }),
    unreadable: run.unreadable,
  }));
}

/** A census of nothing, carrying the one warning that says why. */
function emptyCensus({ warning }: { warning: string }): CorpusCensus {
  return { admittedRows: 0, groups: [], unreadable: [], warnings: [warning], winners: new Map() };
}
