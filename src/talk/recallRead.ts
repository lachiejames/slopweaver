/**
 * The disk half of `talk recall`'s search over the call transcripts (`talk/calls/*.jsonl`) and the relay receipts
 * (`talk/relays.jsonl`), and the listing, window and read-shaping helpers the rulings source (`./recallRulings.ts`)
 * shares. Opening one is `./recallOpenRead.ts`, the knowledge half `./recallKnowledge.ts`; what matches and how an
 * answer is packed is `./recall.ts`.
 *
 * ## Why it is a scan and not an index
 *
 * MEASURED on the operator's home (`time slopweaver talk recall --words xero --json`, five runs): see
 * `../cli/commands/talk/recallRun.ts`, which carries the numbers. The whole population is about 94 MiB, and two
 * cheap filters keep an all-time scan inside the voice's 20 s: a call file is folded only when every word occurs
 * somewhere in its raw bytes, and a journal line is decoded only when it carries `ruling` and every word. Both are
 * necessary conditions of a match (`lineMayMatch`), and a raw `\u` escape passes both, so neither can hide one. A
 * call file is folded WHOLE before its segments are matched, because a segment's text is its kept snapshot
 * (`./callRecord.ts`), not any line's.
 *
 * A window filters by each record's OWN instant, never a file's mtime: a call file can carry a segment newer than
 * its mtime (`./callFileAppend.ts` keeps a file's times on purpose), so an mtime skip turned an in-window match into
 * an exact zero. A bounded search therefore costs what an all-time one does, which is the
 * figure measured above.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { unsetFieldAsNull } from "../lib/absent.js";
import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { callTouchedByTestInstance } from "./callOrigin.js";
import { type CallSegment, foldCall, OWNER_SPEAKER } from "./callRecord.js";
import { callsDir, isCallId, readCallEntriesCounted } from "./callStore.js";
import { JSON_UNICODE_ESCAPE, type RecallCandidate, type RecallSourceRead, textMatchesRecall } from "./recall.js";
import { type RecallError, RecallErrors } from "./recallErrors.js";
import { recallPointerOf } from "./recallPointer.js";
import { readRelayLedger, type TurnRecord } from "./relayStore.js";

/** A call file's name: the id, then `.jsonl`. */
const CALL_FILE = /^([0-9a-f-]{36})\.jsonl$/u;

/** A run journal's suffix, and a call file's. */
export const JOURNAL_SUFFIX = ".jsonl";

/**
 * What one disk search was asked for.
 *
 * @internal
 */
export interface DiskSearch {
  readonly home: string;
  readonly words: readonly string[];
  /** The window's floor, epoch milliseconds, or `undefined` for all time. */
  readonly sinceMs: number | undefined;
}

/**
 * One regular file a directory listing kept.
 *
 * @internal
 */
export interface ListedFile {
  readonly name: string;
  readonly path: string;
}

/**
 * Whether an instant is inside the window.
 *
 * @internal
 * @returns true when the instant is at or after the floor, or there is no floor
 */
export function inWindow({ atIso, sinceMs }: { atIso: string; sinceMs: number | undefined }): boolean {
  return sinceMs === undefined || Date.parse(atIso) >= sinceMs;
}

/**
 * Whether a thrown filesystem error says the path is not there.
 *
 * @param cause what a `node:fs` call threw
 * @returns true for `ENOENT`
 */
export function isMissingFile({ cause }: { cause: unknown }): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/**
 * The regular files in a directory whose names match. A missing directory is none; anything
 * named like one that is not a regular file — a link, a FIFO — is never opened and is named instead.
 *
 * @internal
 * @returns the kept files and what was skipped, or why the directory could not be listed
 */
export function regularFiles({
  dir,
  keep,
}: {
  dir: string;
  keep: (name: string) => boolean;
}): Result<{ readonly files: readonly ListedFile[]; readonly skipped: readonly string[] }, RecallError> {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    // A directory behind a dangling link is a source that could not be read, never an empty one.
    if (isAbsentError({ error: cause, path: dir })) {
      return ok({ files: [], skipped: [] });
    }
    return err(RecallErrors.sourceUnreadable({ cause, path: dir }));
  }
  const files: ListedFile[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    if (!keep(name)) {
      continue;
    }
    const path = join(dir, name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile()) {
        files.push({ name, path });
      } else {
        skipped.push(`${name} is not a regular file`);
      }
    } catch (cause) {
      skipped.push(`${name}: ${String(cause)}`);
    }
  }
  return ok({ files, skipped });
}

/**
 * Whether every word occurs somewhere in a file's raw lines — a necessary condition of any segment in it matching. A
 * line carrying a `\u` escape could be spelling any word, so it settles the file as a candidate.
 */
function fileMayMatch({ path, words }: { path: string; words: readonly string[] }): boolean {
  const missing = new Set(words);
  readJsonlLines({
    onChunk: () => missing.size > 0,
    onLine: ({ line }) => {
      const lower = line.toLowerCase();
      if (lower.includes(JSON_UNICODE_ESCAPE)) {
        missing.clear();
        return;
      }
      for (const word of missing) {
        if (lower.includes(word)) {
          missing.delete(word);
        }
      }
    },
    path,
  });
  return missing.size === 0;
}

/** A folded call segment as a candidate. */
function segmentCandidate({ callId, segment }: { callId: string; segment: CallSegment }): RecallCandidate {
  return {
    about: unsetFieldAsNull({ key: "open", record: segment }),
    atIso: segment.atIso,
    pointer: recallPointerOf({ pointer: { callId, kind: "call", segmentId: segment.id } }),
    source: "calls",
    text: segment.text,
    who: segment.who,
  };
}

/**
 * Search every call transcript: each file that could hold a match is folded whole, then its segments — the owner's and the
 * voice's, a dropped call's last snapshot included — matched.
 *
 * The source is the transcripts ON DISK. A call the index still names whose file was deleted by hand is not a
 * transcript this search failed to read, so it is not counted against the source; nothing in Slopweaver deletes one.
 *
 * @returns the calls source's read
 */
export function searchCalls({ home, words, sinceMs }: DiskSearch): RecallSourceRead {
  const listed = regularFiles({ dir: callsDir({ home }), keep: (name) => CALL_FILE.test(name) });
  if (listed.isErr()) {
    return { searched: false, why: listed.error.message };
  }
  const problems = [...listed.value.skipped];
  const matches: RecallCandidate[] = [];
  let skippedLines = 0;
  for (const file of listed.value.files) {
    const callId = file.name.slice(0, -JOURNAL_SUFFIX.length);
    if (!isCallId({ callId })) {
      continue;
    }
    const found = callMatches({ callId, file, home, sinceMs, words });
    if (found.isErr()) {
      problems.push(found.error.message);
      continue;
    }
    skippedLines += found.value.skipped;
    for (const match of found.value.matches) {
      matches.push(match);
    }
  }
  if (skippedLines > 0) {
    problems.push(`${String(skippedLines)} line(s) of matching calls did not parse`);
  }
  return searchedRead({ matches, problems });
}

/** One call's matching segments, read whole only when its raw lines could hold every word. */
function callMatches({
  callId,
  file,
  home,
  sinceMs,
  words,
}: DiskSearch & { callId: string; file: ListedFile }): Result<
  { matches: readonly RecallCandidate[]; skipped: number },
  RecallError
> {
  try {
    if (!fileMayMatch({ path: file.path, words })) {
      return ok({ matches: [], skipped: 0 });
    }
  } catch (cause) {
    return err(RecallErrors.sourceUnreadable({ cause, path: file.path }));
  }
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return err(RecallErrors.sourceUnreadable({ cause: read.error.message, path: file.path }));
  }
  // A call the desktop test instance opened is a walk's speech, never the owner's words (`./callOrigin.ts`).
  if (callTouchedByTestInstance({ entries: read.value.entries })) {
    return ok({ matches: [], skipped: read.value.skipped });
  }
  const call = foldCall({ callId, entries: read.value.entries, skipped: read.value.skipped });
  const segments = call === undefined ? [] : call.segments;
  const matches = segments
    .filter(
      (segment) => inWindow({ atIso: segment.atIso, sinceMs }) && textMatchesRecall({ text: segment.text, words }),
    )
    .map((segment) => segmentCandidate({ callId, segment }));
  return ok({ matches, skipped: read.value.skipped });
}

/**
 * A searched source's read: its matches, and what it could not read when anything.
 *
 * @internal
 * @returns the source's read, its count exact unless `incomplete` names why
 */
export function searchedRead({
  matches,
  problems,
}: {
  matches: readonly RecallCandidate[];
  problems: readonly string[];
}): RecallSourceRead {
  return {
    count: matches.length,
    incomplete: problems.length > 0 ? problems.join("; ") : undefined,
    matches,
    searched: true,
  };
}

/**
 * What a relay receipt says the owner said: every word, else the row's quote of them.
 *
 * @returns the steer's text
 */
export function steerText({ record }: { record: TurnRecord }): string {
  return record.heard.length > 0 ? record.heard : record.words;
}

/**
 * When a relay reached the board, else when it was staged.
 *
 * @returns the steer's instant
 */
export function steerIso({ record }: { record: TurnRecord }): string {
  // A relay that never reached the board has only its staging instant, by design.
  if (record.registeredAtIso === null) {
    return record.stagedAtIso;
  }
  return record.registeredAtIso;
}

/**
 * Search the relay receipts — every steer the voice handed the supervisor, one per turn.
 *
 * @returns the steers source's read
 */
export function searchSteers({ home, words, sinceMs }: DiskSearch): RecallSourceRead {
  const ledger = readRelayLedger({ home });
  if (ledger.isErr()) {
    return { searched: false, why: ledger.error.message };
  }
  // A turn's receipt is appended once; a second is a retried write, and the newest is kept.
  const byTurn = new Map<string, TurnRecord>();
  for (const record of ledger.value.rows) {
    byTurn.set(record.turnId, record);
  }
  const matches: RecallCandidate[] = [];
  for (const record of byTurn.values()) {
    const atIso = steerIso({ record });
    if (!inWindow({ atIso, sinceMs }) || !textMatchesRecall({ text: steerText({ record }), words })) {
      continue;
    }
    matches.push({
      about: record.slug,
      atIso,
      pointer: recallPointerOf({ pointer: { kind: "steer", turnId: record.turnId } }),
      source: "steers",
      text: steerText({ record }),
      who: OWNER_SPEAKER,
    });
  }
  const { undecoded } = ledger.value;
  return {
    count: matches.length,
    incomplete: undecoded > 0 ? `${String(undecoded)} relay receipt line(s) did not decode` : undefined,
    matches,
    searched: true,
  };
}
