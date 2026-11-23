/**
 * Reading their own recorded speech off disk — the effectful half of the voice source.
 *
 * Three families, read in one pass and folded to distinct units by `./unit.ts`. Nothing here interprets a
 * word of what they said; it locates, streams, deduplicates and reports what it could not reach.
 *
 * ## Every failure is REPORTED, never substituted with emptiness
 *
 * A source that was asked for and could not be read lands in the watermark's `unreadable`, and a batch is
 * still produced from what did read. The alternative shapes were both refused: throwing loses the units
 * that read fine, and swallowing produces a scan that reports full coverage of a directory it never opened.
 * That second one is the failure this repository names as a check that cannot fail reporting clean.
 *
 * ## Why the tick ledger is streamed rather than read whole
 *
 * `.claude/rules/typescript-patterns.md`: a `.jsonl` read whole is one of three shapes the `whole-file-json`
 * gate refuses, because its size comes from the DATA. The tick ledger grows by a row per sweep tick forever
 * and each row carries every owner turn in a 24-hour window, so it is exactly that case — measured
 * at 104 rows holding 1,896 turn entries. It goes through `readJsonlLines` and one row is parsed at a
 * time.
 *
 * The turn FILES are read whole, and that is a different judgement rather than an inconsistency: each one is
 * a single turn a person spoke, so its size is bounded by how long they talked rather than by how long the
 * installation has been running.
 */
import { readFileSync } from "node:fs";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { listOwnerTurnFiles, ownerTurnRoots } from "../../store/fleet/ownerTurnFiles.js";
import { supervisorTickLedgerPath } from "../../supervisor/tickStore.js";

import { VOICE_SOURCE_KINDS, type VoiceSourceKind, type VoiceUnit, type VoiceUnreadable } from "./types.js";
import { foldRecordings, type VoiceRecording } from "./unit.js";

/** What one scan reached. */
export interface VoiceScan {
  readonly units: readonly VoiceUnit[];
  /** How many recordings were read before deduplication. */
  readonly recordings: number;
  readonly unreadable: readonly VoiceUnreadable[];
}

/**
 * Where each family of their recorded speech lives under a state home.
 *
 * Exported so a test and the CLI's own report can name the roots a scan read, rather than each restating a
 * path this module owns.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns one root per source kind, in scan order
 */
export function voiceRoots({ home }: { home?: string } = {}): Readonly<Record<VoiceSourceKind, string>> {
  return {
    ...ownerTurnRoots(home === undefined ? {} : { home }),
    "tick-ledger": supervisorTickLedgerPath(home === undefined ? {} : { home }),
  };
}

/**
 * Read every family asked for, and fold what was read into distinct units.
 *
 * @param home the state home (defaults to the resolved home)
 * @param kinds which families to read; defaults to all three
 * @returns the units, how many recordings produced them, and every source that would not read
 */
export function scanVoice({
  home,
  kinds = VOICE_SOURCE_KINDS,
}: {
  home?: string;
  kinds?: readonly VoiceSourceKind[];
} = {}): VoiceScan {
  const roots = voiceRoots(home === undefined ? {} : { home });
  const recordings: VoiceRecording[] = [];
  const unreadable: VoiceUnreadable[] = [];
  // Read in VOICE_SOURCE_KINDS order rather than in the caller's, because `foldRecordings` attributes a unit
  // to its FIRST recording and that attribution must not depend on how the flags were typed.
  for (const kind of VOICE_SOURCE_KINDS) {
    if (!kinds.includes(kind)) {
      continue;
    }
    if (kind === "tick-ledger") {
      readTickLedger({ into: recordings, path: roots["tick-ledger"], unreadable });
      continue;
    }
    readTurnFiles({ into: recordings, kind, root: roots[kind], unreadable });
  }
  return { recordings: recordings.length, unreadable, units: foldRecordings({ recordings }) };
}

/**
 * Every owner-turn file under one root, one recording each.
 *
 * Which files exist is `../../store/fleet/ownerTurnFiles.ts`'s walk — the same one the `owner-turns` import
 * leg reads — so the voice source and the store can never disagree about it. Voice still reads the files on
 * disk rather than the store: its consumer is synchronous, and the store only holds what the last import saw.
 */
function readTurnFiles({
  root,
  kind,
  into,
  unreadable,
}: {
  root: string;
  kind: VoiceSourceKind;
  into: VoiceRecording[];
  unreadable: VoiceUnreadable[];
}): void {
  const listing = listOwnerTurnFiles({ root });
  for (const entry of listing.unreadable) {
    unreadable.push(entry);
  }
  for (const path of listing.files) {
    try {
      into.push({ locator: path, source: kind, text: readFileSync(path, "utf8") });
    } catch (cause) {
      unreadable.push({ locator: path, why: errorMessage({ error: cause }) });
    }
  }
}

/**
 * Every owner turn the supervisor tick ledger carries, one recording each.
 *
 * A row that will not decode contributes one `unreadable` entry and the walk continues, because the ledger
 * is append-only and one bad line must not cost every turn behind it. `./types.ts` records that the ledger
 * held only 51 distinct texts across 1,789 entries when this was written, so losing the whole file to one
 * line would be losing most of the structured half of their speech.
 */
function readTickLedger({
  path,
  into,
  unreadable,
}: {
  path: string;
  into: VoiceRecording[];
  unreadable: VoiceUnreadable[];
}): void {
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        // `safeJsonParse` rather than a bare `JSON.parse`, because a tick row carries every owner turn in a
        // 24-hour window and its size is therefore a property of how much they said, not of this code.
        let decoded: unknown;
        try {
          decoded = safeJsonParse({ label: "a supervisor tick ledger line", text: line });
        } catch (cause) {
          unreadable.push({ locator: `${path}:${String(index + 1)}`, why: errorMessage({ error: cause }) });
          return;
        }
        pushTickTurns({ into, path, row: decoded, rowIndex: index });
      },
      path,
    });
  } catch (cause) {
    if (isMissing({ error: cause })) {
      return;
    }
    unreadable.push({ locator: path, why: errorMessage({ error: cause }) });
  }
}

/**
 * The turns array on one decoded tick row, or empty when the row is not the shape this reader expects.
 *
 * Split out of {@link pushTickTurns} so each half has one job: this one walks three levels of a record
 * nothing here wrote, and the caller below maps what it finds. Together they scored over the
 * cognitive-complexity ceiling as one function, which is the shape that stops being reviewable.
 */
function tickTurnsOf({ row }: { row: unknown }): readonly unknown[] {
  if (!isRecord(row)) {
    return [];
  }
  const snapshot = row["ownerTurns"];
  if (!isRecord(snapshot)) {
    return [];
  }
  const turns = snapshot["turns"];
  return Array.isArray(turns) ? turns : [];
}

/**
 * One turn as a recording, or undefined when it carries no text for this scan to fold.
 *
 * A turn with no `text` is skipped rather than recorded empty: `./unit.ts`'s fold drops an empty unit
 * anyway, and a recording with nothing in it would inflate the watermark's recording count against units
 * that do not exist.
 */
function tickRecording({ turn, tick }: { turn: unknown; tick: string }): VoiceRecording | undefined {
  if (!isRecord(turn) || typeof turn["text"] !== "string") {
    return undefined;
  }
  const uuid = typeof turn["turnUuid"] === "string" ? turn["turnUuid"] : "unknown-turn";
  const instant = typeof turn["instantIso"] === "string" ? turn["instantIso"] : undefined;
  return {
    locator: `${tick}#${uuid}`,
    source: "tick-ledger",
    text: turn["text"],
    ...(instant === undefined ? {} : { instantIso: instant }),
  };
}

/** The owner turns on one decoded tick row, read defensively because this code did not write the row. */
function pushTickTurns({
  row,
  path,
  rowIndex,
  into,
}: {
  row: unknown;
  path: string;
  rowIndex: number;
  into: VoiceRecording[];
}): void {
  const tick = isRecord(row) && typeof row["tickId"] === "string" ? row["tickId"] : `${path}:${String(rowIndex + 1)}`;
  for (const turn of tickTurnsOf({ row })) {
    const recording = tickRecording({ tick, turn });
    if (recording !== undefined) {
      into.push(recording);
    }
  }
}

/** Whether a caught filesystem error is "it is not there", which is not a failure to report. */
function isMissing({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}
