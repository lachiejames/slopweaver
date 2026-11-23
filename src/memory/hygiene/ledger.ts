/**
 * THE HYGIENE LEDGER: what this pass has already put in front of the owner, and what the owner said about it.
 * `$SLOPWEAVER_HOME/ledgers/memory/hygiene.jsonl`, append-only.
 *
 * Same pure-line / effectful-append split as `reflect/seen.ts`, `admit/painPoint.ts` and `admit/ledger.ts`:
 * {@link hygieneLedgerLine} is pure and takes its timestamp as an argument, {@link recordHygieneRows} is the
 * thin effectful append, and {@link foldHygieneLedger} derives every piece of state from the whole file rather
 * than storing it. Nothing here reads a clock.
 *
 * ## Why a local ledger rather than a row in `ledgers/reflect/seen.jsonl`
 *
 * The VOCABULARY is shared and the FILE is not, and both halves of that are deliberate.
 *
 * Shared: {@link HygieneRecommendation} is `reflect/seen.ts`'s `SeenGrade`, imported rather than respelled, so
 * `keep | adjust | drop` cannot drift into a second set of three words meaning nearly the same thing.
 *
 * Not shared: a `SeenRow` is typed to a `ReflectSource` and to `findingId`'s three friction fields — source,
 * class key, locus. A proposal about a memory FILE has none of those, and forcing one through that shape would
 * make both readers lie about what they hold. `reflect/board.ts` already set this precedent for the same
 * reason and said so in its own header: board hygiene is its own report shape and its own verb, never a
 * `mineSubstrates` collector, because folding it in would quietly make the board a source of findings.
 *
 * ## Two things this exists to make impossible
 *
 * **Re-proposing what the owner refused.** A `refused` row is TERMINAL: once one carries it, that proposal is dead
 * however many times a later run rediscovers it, and no later row revives it. {@link foldHygieneLedger}'s one
 * asymmetry is that single line, and the pass's honesty rests on it.
 *
 * **Losing the recurrence.** {@link HygieneState.daysSeen} counts DISTINCT CALENDAR DAYS a proposal was made,
 * so two runs in one day do not inflate it, and a proposal the owner has left alone for a week reads as chronic
 * through one counter rather than through a second cadence.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  HYGIENE_CHECK_IDS,
  type HygieneCheckId,
  type HygieneDisposition,
  type HygieneRecommendation,
} from "./types.js";

/** Every disposition, so a parser and a test read one list rather than two. */
export const HYGIENE_DISPOSITIONS = ["proposed", "accepted", "refused"] as const;

/** The dispositions the OWNER writes, as opposed to the one the pass writes. */
export const HYGIENE_ANSWERS = ["accepted", "refused"] as const;

/** One of the owner's two answer words. */
export type HygieneAnswer = (typeof HYGIENE_ANSWERS)[number];

/** One appended row. Flat on purpose: a ledger a `jq` one-liner can read outlives one that needs a parser. */
export interface HygieneRow {
  /** When the row was written. Injected by the caller, never read from a clock in here. */
  readonly tsIso: string;
  /** The proposal's stable id, from `proposalId`. The join key for every fold below. */
  readonly id: string;
  readonly check: HygieneCheckId;
  /** What the proposal is about, carried so a reader can name it from the fold alone. */
  readonly subject: string;
  /** What the card recommended be done with the memory. */
  readonly recommendation: HygieneRecommendation;
  readonly disposition: HygieneDisposition;
  /** The owner's reason, when they gave one. Absent on a pass-written row. */
  readonly why?: string;
}

/**
 * Render one row as its JSONL line. Pure and deterministic — keys are emitted in a fixed order, so two runs
 * writing the same row produce byte-identical lines.
 *
 * @param row the row to render
 * @returns the JSON line, with no trailing newline
 */
export function hygieneLedgerLine({ row }: { row: HygieneRow }): string {
  return JSON.stringify({
    check: row.check,
    disposition: row.disposition,
    id: row.id,
    recommendation: row.recommendation,
    schemaVersion: 1,
    subject: row.subject,
    tsIso: row.tsIso,
    ...(row.why === undefined ? {} : { why: row.why }),
  });
}

/** Whether a parsed value is a disposition this version knows. */
function isDisposition(value: unknown): value is HygieneDisposition {
  return HYGIENE_DISPOSITIONS.some((known) => known === value);
}

/** Whether a parsed value is a check this version knows. */
function isCheck(value: unknown): value is HygieneCheckId {
  return HYGIENE_CHECK_IDS.some((known) => known === value);
}

/** Whether a parsed value is one of the three recommendation words. */
function isRecommendation(value: unknown): value is HygieneRecommendation {
  return value === "keep" || value === "adjust" || value === "drop";
}

/** Decode one ledger line, or `undefined` when this version cannot read it. */
function decodeHygieneRow({ line }: { line: string }): HygieneRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isDisposition(parsed["disposition"]) || !isCheck(parsed["check"])) {
    return undefined;
  }
  if (!isRecommendation(parsed["recommendation"])) {
    return undefined;
  }
  const { tsIso, id, subject, why } = parsed;
  if (typeof tsIso !== "string" || typeof id !== "string" || typeof subject !== "string") {
    return undefined;
  }
  return {
    check: parsed["check"],
    disposition: parsed["disposition"],
    id,
    recommendation: parsed["recommendation"],
    subject,
    tsIso,
    ...(typeof why === "string" && why.trim().length > 0 ? { why } : {}),
  };
}

/**
 * Parse the ledger text into rows, skipping what it cannot read.
 *
 * Tolerant for the same reason `parseSeenRows` is: a truncated final line is the normal consequence of a
 * process dying mid-append, and it must not make the whole ledger unreadable. The one thing skipping can do is
 * LOSE a row, which loses recurrence or an answer; it can never invent one, and a lost `refused` re-proposes
 * something rather than hiding it.
 *
 * @param text the raw `hygiene.jsonl` contents
 * @returns the rows that decoded, in file order
 */
export function parseHygieneRows({ text }: { text: string }): readonly HygieneRow[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim().length === 0) {
      return [];
    }
    const row = decodeHygieneRow({ line });
    return row === undefined ? [] : [row];
  });
}

/** Everything the ledger remembers about one proposal. Derived, never stored. */
export interface HygieneState {
  readonly id: string;
  readonly check: HygieneCheckId;
  readonly subject: string;
  /**
   * What the most recent row recommended for the memory.
   *
   * Carried so `memory grade` can record an answer without re-running the whole pass: the owner answers an id off a
   * card, and the ledger is the only thing that still knows what that id recommended. It is the LATEST rather
   * than the first, because the adversarial arm legitimately demotes a drop to an adjust between runs.
   */
  readonly recommendation: HygieneRecommendation;
  /** The first instant any row mentions it. */
  readonly firstSeenIso: string;
  /** The most recent instant any row mentions it. */
  readonly lastSeenIso: string;
  /** Distinct calendar days the pass proposed it on. The one persisted recurrence counter. */
  readonly daysSeen: number;
  /** TERMINAL. Once true, no later row makes it false, and the pass never proposes it again. */
  readonly refused: boolean;
  /** Whether the owner has said yes to it. Recorded rather than acted on: this pass still never edits a memory. */
  readonly accepted: boolean;
  /** The owner's reason, from the most recent row that carried one. */
  readonly why: string | undefined;
}

/**
 * The owner's reason after one more row: the row's own when it carried one, otherwise the one already on record.
 *
 * A row with no `why` does not ERASE the reason before it, which is the whole point of spelling this out. The
 * pass writes a `proposed` row on every run and none of them carries a why, so folding an absent one as
 * authoritative would wipe the reason the owner typed the moment the recurrence was counted again.
 */
function carriedWhy({ prior, row }: { prior: HygieneState | undefined; row: HygieneRow }): string | undefined {
  if (row.why === undefined) {
    return prior?.why;
  }
  return row.why;
}

/** The calendar day a timestamp falls on, as the ledger writes it. */
function dayOf({ tsIso }: { tsIso: string }): string {
  return tsIso.slice(0, "YYYY-MM-DD".length);
}

/** Record the calendar day one PROPOSED row was written on. Mutates the accumulator it is handed. */
function countDay({ days, row }: { days: Map<string, Set<string>>; row: HygieneRow }): void {
  const seenDays = days.get(row.id);
  if (seenDays === undefined) {
    days.set(row.id, new Set([dayOf({ tsIso: row.tsIso })]));
    return;
  }
  seenDays.add(dayOf({ tsIso: row.tsIso }));
}

/**
 * One row folded onto whatever the ledger already said about its proposal.
 *
 * Split out of {@link foldHygieneLedger} so the accumulation loop and the per-row merge are each readable on
 * their own — the merge is where the one asymmetry lives, and it earns being looked at without a loop around it.
 */
function foldRow({
  days,
  prior,
  row,
}: {
  days: ReadonlyMap<string, ReadonlySet<string>>;
  prior: HygieneState | undefined;
  row: HygieneRow;
}): HygieneState {
  const countedDays = days.get(row.id);
  return {
    accepted: prior?.accepted === true || row.disposition === "accepted",
    check: row.check,
    daysSeen: countedDays === undefined ? 0 : countedDays.size,
    firstSeenIso: prior === undefined ? row.tsIso : prior.firstSeenIso,
    id: row.id,
    lastSeenIso: row.tsIso,
    recommendation: row.recommendation,
    // The ONE asymmetry: `refused` only ever goes false → true, which is what makes a refusal terminal.
    refused: prior?.refused === true || row.disposition === "refused",
    subject: row.subject,
    why: carriedWhy({ prior, row }),
  };
}

/**
 * Fold the whole ledger into one state per proposal.
 *
 * Row order is file order, which is append order, so "most recent" is simply "last seen while folding". The
 * one asymmetry is `refused`, which only ever goes from false to true: that is what makes a refusal terminal,
 * and it is the single line of this function the pass's honesty rests on.
 *
 * @param rows the parsed ledger, in file order
 * @returns one state per proposal id, keyed by id
 */
export function foldHygieneLedger({ rows }: { rows: readonly HygieneRow[] }): ReadonlyMap<string, HygieneState> {
  const days = new Map<string, Set<string>>();
  const states = new Map<string, HygieneState>();
  for (const row of rows) {
    if (row.disposition === "proposed") {
      countDay({ days, row });
    }
    states.set(row.id, foldRow({ days, prior: states.get(row.id), row }));
  }
  return states;
}

/**
 * The hygiene ledger's own directory, a sibling of the flat ledgers under the state home.
 *
 * A directory rather than a bare file because the memory surface will grow a second register before it grows a
 * second home — the same reasoning `reflectLedgerDir` gives for its own.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute directory holding `hygiene.jsonl`
 *
 * @internal
 */
export function hygieneLedgerDir({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).ledgers, "memory");
}

/**
 * The hygiene ledger's path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute path of `hygiene.jsonl`
 */
export function hygieneLedgerPath({ home }: { home?: string } = {}): string {
  return join(hygieneLedgerDir(home === undefined ? {} : { home }), "hygiene.jsonl");
}

/**
 * Read the ledger's rows off disk, one line at a time.
 *
 * Streamed through `readJsonlLines` rather than read into one string: this file is append-only with no ceiling,
 * which is exactly the shape `whole-file-json` refuses — a `.jsonl` grows with the data, so its size is never
 * bounded by the code that shaped it.
 *
 * An absent ledger — a home whose pass has never run — is no rows, not an error, so a first run reads as
 * "nothing proposed yet" rather than as a broken home.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the rows that decoded, in file order
 */
export function readHygieneLedgerRows({ home }: { home?: string } = {}): readonly HygieneRow[] {
  const path = hygieneLedgerPath(home === undefined ? {} : { home });
  const rows: HygieneRow[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const row = decodeHygieneRow({ line });
        if (row !== undefined) {
          rows.push(row);
        }
      },
      path,
    });
  } catch {
    return [];
  }
  return rows;
}

/**
 * Append rows to the ledger, creating its directory if needed. The effectful edge over
 * {@link hygieneLedgerLine}.
 *
 * FAILS LOUDLY rather than swallowing, the same call `recordSeen` makes and for the same reason: a run whose
 * proposals were not recorded has lost the recurrence counter and will re-propose a refused one tomorrow, so
 * reporting success over a failed write would be the exact defect this file exists to prevent.
 *
 * @param rows the rows to append, in order
 * @param home the state home (defaults to the resolved home)
 * @returns how many rows were written, or every reason nothing was
 */
export function recordHygieneRows({ rows, home }: { rows: readonly HygieneRow[]; home?: string }): Result<number> {
  if (rows.length === 0) {
    return ok(0);
  }
  const dir = hygieneLedgerDir(home === undefined ? {} : { home });
  const written = safeFs({
    execute: (): number => {
      mkdirSync(dir, { recursive: true });
      appendLines({
        path: join(dir, "hygiene.jsonl"),
        text: `${rows.map((row) => hygieneLedgerLine({ row })).join("\n")}\n`,
      });
      return rows.length;
    },
    operation: "append memory hygiene ledger",
    path: dir,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}
