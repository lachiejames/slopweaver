/**
 * The rulings source of `talk recall`'s search: every `ruling` event journalled on a run (`runs/*.jsonl`) and every
 * anchored row of the archived state docs (`handovers/archive/*.md`). The listing, window and read-shaping helpers it
 * shares with the calls and steers sources are `./recallRead.ts`'s; opening one ruling is `./recallOpenRead.ts`.
 *
 * A journal line is decoded only when it carries `ruling` and every word (`lineMayMatch`), a necessary condition of a
 * match that a raw `\u` escape also passes, so the filter cannot hide one. A line that passes it and still does not
 * decode is COUNTED against the source, never dropped.
 */
import { readJsonlLines } from "../corpus/corpusStore.js";
import { archivedRulings, rulingArchiveDir } from "../handover/archivedRulings.js";
import type { RulingEvent } from "../handover/ledger.js";
import { decodeLedgerLine } from "../handover/ledgerLineDecode.js";
import { stateHomePaths } from "../stateHome.js";
import { lineMayMatch, type RecallCandidate, type RecallSourceRead, textMatchesRecall } from "./recall.js";
import { recallPointerOf } from "./recallPointer.js";
import {
  type DiskSearch,
  inWindow,
  JOURNAL_SUFFIX,
  type ListedFile,
  regularFiles,
  searchedRead,
} from "./recallRead.js";

/**
 * A word every ruling line holds, in its `kind`: a pre-filter through {@link lineMayMatch} rather than the exact
 * `"kind":"ruling"` bytes `ledgerLine` writes, because a journal line spaced or escaped differently is still one.
 */
const RULING_WORD = "ruling";

/**
 * When a ruling was DECIDED, else when it was journalled.
 *
 * @returns the ruling's instant
 */
export function rulingIso({ event }: { event: RulingEvent }): string {
  // A ruling journalled without its own decision instant was decided when it was journalled.
  if (event.decidedIso === undefined) {
    return event.atIso;
  }
  return event.decidedIso;
}

/**
 * Every ruling line of one journal that could match, decoded, with its 1-based line — and how many lines that could
 * have matched did not decode at all, so a torn line is counted against the source rather than dropped silently.
 */
function journalRulings({ path, words }: { path: string; words: readonly string[] }): {
  found: readonly { line: number; event: RulingEvent }[];
  undecoded: number;
} {
  const found: { line: number; event: RulingEvent }[] = [];
  let undecoded = 0;
  readJsonlLines({
    onLine: ({ line, index }) => {
      if (!lineMayMatch({ line, words: [RULING_WORD, ...words] })) {
        return;
      }
      const event = decodeLedgerLine({ line });
      if (event === undefined) {
        undecoded += 1;
      } else if (event.kind === "ruling") {
        found.push({ event, line: index + 1 });
      }
    },
    path,
  });
  return { found, undecoded };
}

/**
 * Search the owner's rulings: every `ruling` event journalled on a run, and every anchored row of the archived state docs.
 *
 * @returns the rulings source's read
 */
export function searchRulings({
  home,
  words,
  sinceMs,
}: {
  home: string;
  words: readonly string[];
  /** The window's floor, epoch milliseconds, or `undefined` for all time. */
  sinceMs: number | undefined;
}): RecallSourceRead {
  const listed = regularFiles({ dir: stateHomePaths({ home }).runs, keep: (name) => name.endsWith(JOURNAL_SUFFIX) });
  if (listed.isErr()) {
    return { searched: false, why: listed.error.message };
  }
  const problems = [...listed.value.skipped];
  const matches: RecallCandidate[] = [];
  let undecoded = 0;
  for (const file of listed.value.files) {
    try {
      const run = runRulingMatches({ file, sinceMs, words });
      for (const match of run.matches) {
        matches.push(match);
      }
      undecoded += run.undecoded;
    } catch (cause) {
      problems.push(`${file.name}: ${String(cause)}`);
    }
  }
  if (undecoded > 0) {
    problems.push(`${String(undecoded)} journal line(s) carrying the words did not decode`);
  }
  const archived = archivedRulingMatches({ home, sinceMs, words });
  for (const match of archived.matches) {
    matches.push(match);
  }
  for (const problem of archived.problems) {
    problems.push(problem);
  }
  return searchedRead({ matches, problems });
}

/** One run journal's matching rulings and its undecodable candidate lines; throws when it cannot be read. */
function runRulingMatches({ file, sinceMs, words }: Omit<DiskSearch, "home"> & { file: ListedFile }): {
  matches: readonly RecallCandidate[];
  undecoded: number;
} {
  const slug = file.name.slice(0, -JOURNAL_SUFFIX.length);
  const journal = journalRulings({ path: file.path, words });
  const matches = journal.found
    .filter(({ event }) => inWindow({ atIso: rulingIso({ event }), sinceMs }))
    .filter(({ event }) => textMatchesRecall({ text: event.ruling, words }))
    .map(({ event, line }): RecallCandidate => ({
      about: slug,
      atIso: rulingIso({ event }),
      pointer: recallPointerOf({ pointer: { kind: "run-ruling", line, slug } }),
      source: "rulings",
      text: event.ruling,
      who: "owner",
    }));
  return { matches, undecoded: journal.undecoded };
}

/** The archived state docs' matching ruling rows, and what of the archive could not be read. */
function archivedRulingMatches({ home, sinceMs, words }: DiskSearch): {
  matches: readonly RecallCandidate[];
  problems: readonly string[];
} {
  // All time reads every row: no floor is the lowest one.
  let archiveFloor = Number.NEGATIVE_INFINITY;
  if (sinceMs !== undefined) {
    archiveFloor = sinceMs;
  }
  const archive = archivedRulings({ archiveDir: rulingArchiveDir({ home }), sinceMs: archiveFloor });
  const matches = archive.rows
    .filter((row) => textMatchesRecall({ text: row.text, words }))
    .map((row): RecallCandidate => ({
      about: row.file,
      atIso: row.instantIso,
      pointer: recallPointerOf({ pointer: { file: row.file, kind: "archived-ruling", line: row.line } }),
      source: "rulings",
      text: row.text,
      who: "owner",
    }));
  return { matches, problems: archive.problems };
}
