/**
 * `slopweaver turn ledger` — every ask the bot has been tagged with, with the five spans of its turn.
 *
 * The EFFECTFUL SHELL of `../../../live/turn/ledger.ts`, which holds every join and every sum. This file
 * reads four things and renders: the ask-lifecycle log, the completion ledger, and — only for the asks the
 * window actually kept — each one's validated drafts and review rounds. That order is the point: `--since`
 * narrows before any checkpoint directory is walked, so a one-day read does not pay for a whole home.
 *
 * Diagnostic and read-only, exactly like `./blockedList.ts` next door: no door, no write, no model, and no
 * clock beyond comparing `--since`.
 */

import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { humanDuration } from "../../../lib/progressRender.js";
import type { Result } from "../../../lib/result.js";
import { parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { readCheckpointSet } from "../../../live/turn/checkpointStore.js";
import { parseTurnCompletionLog } from "../../../live/turn/completionLog.js";
import { readTurnCompletionText } from "../../../live/turn/completionStore.js";
import type { TurnCompletion } from "../../../live/turn/envelope.js";
import {
  GENERATION_SCOPED_PHASES,
  TURN_LEDGER_PHASE_BOUNDS,
  TURN_LEDGER_PHASE_KEYS,
  TURN_LEDGER_PHASE_LABELS,
  type TurnLedgerPhaseStats,
  type TurnLedgerRow,
  turnLedgerRow,
  turnLedgerStats,
} from "../../../live/turn/ledger.js";
import { turnLedgerCompletions, turnLedgerGroups, turnLedgerWindow } from "../../../live/turn/ledgerWindow.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { cardEditHome, refuseWith } from "./cardGates.js";
import { TURN_LEDGER_FLAG_SPEC, TURN_LEDGER_USAGE } from "./ledgerUsage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, ledger, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** How much of an ask's text one line shows before it is cut. */
const ASK_TEXT_WIDTH = 96;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network.
 *
 * @param rest the argv tail after `turn ledger`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnLedgerArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_LEDGER_FLAG_SPEC.boolean], string: [...TURN_LEDGER_FLAG_SPEC.string] },
  });
}

/** One string flag's value, or `undefined` when it was not given. */
function stringFlag({ name, values }: { name: string; values: ParsedFlags["values"] }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Every reason a window is not usable, named rather than silently ignored — both bounds are checked, so a
 * caller who got two of them wrong is told both at once.
 *
 * @returns one line per rejection, empty when the flags describe a real window
 */
export function turnLedgerWindowRejections({ values }: { values: ParsedFlags["values"] }): readonly string[] {
  const rejections: string[] = [];
  const since = stringFlag({ name: "since", values });
  if (since !== undefined && parseIsoMs({ tsIso: since }) === undefined) {
    rejections.push(`--since ${since} is not an ISO-8601 instant`);
  }
  const limit = stringFlag({ name: "limit", values });
  if (limit !== undefined && !/^\d+$/u.test(limit)) {
    rejections.push(`--limit ${limit} is not a whole number`);
  }
  return rejections;
}

/**
 * A phase as a line reads it — a rounded single unit, `reversed` when its own two instants disagree about
 * which came first, and a dash when the record set was simply silent. The two absences are spelled
 * differently on purpose: one is a disagreement to chase, the other is nothing to chase at all.
 */
function phaseCell({ row, key }: { row: TurnLedgerRow; key: (typeof TURN_LEDGER_PHASE_KEYS)[number] }): string {
  const seconds = row.phases[key];
  if (seconds !== undefined) {
    return `${TURN_LEDGER_PHASE_LABELS[key]} ${humanDuration({ seconds })}`;
  }
  if (row.reversedPhases.includes(key)) {
    return `${TURN_LEDGER_PHASE_LABELS[key]} reversed`;
  }
  return `${TURN_LEDGER_PHASE_LABELS[key]} —`;
}

/** What a row is filed under: the tag's own instant, or the capture that stood in for it, SAYING so. */
function anchorCell({ row }: { row: TurnLedgerRow }): string {
  if (row.taggedIso === undefined) {
    return `${row.capturedIso} (captured)`;
  }
  return row.taggedIso;
}

/** The rounds clause — `rounds 2 (clean,broken)` — or `rounds 0` when the ask was never reviewed. */
function roundsCell({ row }: { row: TurnLedgerRow }): string {
  if (row.rounds.length === 0) {
    return "rounds 0";
  }
  return `rounds ${String(row.rounds.length)} (${row.rounds.map((round) => round.outcome).join(",")})`;
}

/**
 * One row as the lines a person reads — the measurements on one line, the ask's own words indented under it
 * when the capture row carried them.
 *
 * @param row the joined row
 * @returns one or two lines, with no trailing newline
 */
export function turnLedgerRowLines({ row }: { row: TurnLedgerRow }): readonly string[] {
  const redispatch = row.dispatches > 1 ? `  re-dispatched x${String(row.dispatches)}` : "";
  const head = [
    anchorCell({ row }),
    row.surface,
    row.ending,
    TURN_LEDGER_PHASE_KEYS.map((key) => phaseCell({ key, row })).join("  "),
    roundsCell({ row }),
    `${row.channel}/${row.messageTs}${redispatch}`,
  ].join("  ");
  if (row.askText === undefined) {
    return [head];
  }
  const flattened = row.askText.replace(/\s+/gu, " ").trim();
  const text = flattened.length > ASK_TEXT_WIDTH ? `${flattened.slice(0, ASK_TEXT_WIDTH)}…` : flattened;
  return [head, `    "${text}"`];
}

/** One phase's footer line — its figures, its denominator, and what it was measured between. */
function statsLine({ stats }: { stats: TurnLedgerPhaseStats }): string {
  const label = TURN_LEDGER_PHASE_LABELS[stats.key].padEnd(8);
  const bounds = TURN_LEDGER_PHASE_BOUNDS[stats.key];
  const excluded =
    stats.excludedRedispatched > 0 ? `, ${String(stats.excludedRedispatched)} re-dispatched excluded` : "";
  const reversed = stats.reversed > 0 ? `, ${String(stats.reversed)} reversed` : "";
  if (stats.meanSeconds === undefined || stats.medianSeconds === undefined) {
    return `  ${label} no row in this window carries it (${String(stats.count)} measured${excluded}${reversed}) — ${bounds}`;
  }
  return (
    `  ${label} mean ${humanDuration({ seconds: stats.meanSeconds })}` +
    `  median ${humanDuration({ seconds: stats.medianSeconds })}` +
    `  over ${String(stats.count)} row(s)${excluded}${reversed} — ${bounds}`
  );
}

/**
 * The footer: one line per declared phase, then what the ledger could not read and what it does not hold.
 *
 * @param rows every row in the window, whether or not `--limit` printed it
 * @param stats the per-phase figures
 * @param unreadable how many lines of each log would not parse
 * @returns the footer lines, with no trailing newline
 */
export function turnLedgerFooterLines({
  rows,
  stats,
  unreadable,
}: {
  rows: readonly TurnLedgerRow[];
  stats: readonly TurnLedgerPhaseStats[];
  unreadable: { readonly asks: number; readonly completions: number };
}): readonly string[] {
  const terminal = rows.filter((row) => row.terminal).length;
  const lines = [
    "",
    `${String(rows.length)} ask(s) in this window, ${String(terminal)} with a terminal event.`,
    ...stats.map((entry) => statsLine({ stats: entry })),
  ];
  const scoped = [...GENERATION_SCOPED_PHASES].toSorted().join(" and ");
  lines.push(`  A re-dispatched ask is left out of the ${scoped} averages only — its row is still on the page above.`);
  const reversed = stats.reduce((sum, entry) => sum + entry.reversed, 0);
  if (reversed > 0) {
    lines.push(
      `  ${String(reversed)} span(s) closed BEFORE they opened and read \`reversed\` above: the two clocks` +
        " behind them disagree, so there is no duration to print or average.",
    );
  }
  if (unreadable.asks > 0 || unreadable.completions > 0) {
    lines.push(
      `  ${String(unreadable.asks)} unreadable ask-log line(s) and ${String(unreadable.completions)} unreadable completion line(s) were stepped over.`,
    );
  }
  lines.push("  No reactions on the answer: nothing on this machine records a human reaction to a bot answer yet.");
  return lines;
}

/**
 * One row as the `--json` object — every phase in EXACT seconds, not the rounded unit a line shows.
 *
 * @returns the row's own fields, unabridged, so a caller quoting a number never has to undo a rounding
 */
export function turnLedgerRowJson({ row }: { row: TurnLedgerRow }): Record<string, unknown> {
  return { ...row };
}

/** This ask's completions in file order — an empty list when the completion log never mentioned it. */
function completionsFor({
  byKey,
  key,
}: {
  byKey: ReadonlyMap<string, readonly TurnCompletion[]>;
  key: string;
}): readonly TurnCompletion[] {
  const forAsk = byKey.get(key);
  if (forAsk === undefined) {
    return [];
  }
  return forAsk;
}

/**
 * The IO edge: both logs, the window, and one checkpoint directory per SURVIVING ask. The narrowing runs
 * before any directory is walked, which is the whole reason a one-day `--since` costs a one-day read.
 */
function readLedger({ values }: { values: ParsedFlags["values"] }): {
  readonly rows: readonly TurnLedgerRow[];
  readonly unreadable: { readonly asks: number; readonly completions: number };
} {
  const home = cardEditHome({ values });
  const asks = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const completionLog = parseTurnCompletionLog({ text: readTurnCompletionText({ home }) });
  const completions = turnLedgerCompletions({ events: completionLog.events });
  const window = turnLedgerWindow({
    channel: stringFlag({ name: "channel", values }),
    groups: turnLedgerGroups({ events: asks.events }),
    sinceIso: stringFlag({ name: "since", values }),
  });
  const rows: TurnLedgerRow[] = [];
  for (const group of window) {
    const row = turnLedgerRow({
      checkpoint: readCheckpointSet({ askIdentity: group.askIdentity, home }),
      completions: completionsFor({ byKey: completions, key: group.key }),
      events: group.events,
    });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return {
    rows,
    unreadable: { asks: asks.unreadable.length, completions: completionLog.unreadable.length },
  };
}

/** The rows `--limit` lets onto the page. The footer is computed over every row, never over this. */
function pageOf({
  rows,
  values,
}: {
  rows: readonly TurnLedgerRow[];
  values: ParsedFlags["values"];
}): readonly TurnLedgerRow[] {
  const limit = stringFlag({ name: "limit", values });
  if (limit === undefined) {
    return rows;
  }
  return rows.slice(0, Number(limit));
}

/**
 * Run the ledger verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runTurnLedger(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_LEDGER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnLedgerArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_LEDGER_USAGE });
  }
  const { values } = parsed.value;
  const rejections = turnLedgerWindowRejections({ values });
  if (rejections.length > 0) {
    return refuseWith({ code: EXIT_USAGE, errors: rejections, usage: TURN_LEDGER_USAGE });
  }
  const { rows, unreadable } = readLedger({ values });
  const stats = turnLedgerStats({ rows });
  const page = pageOf({ rows, values });
  if (values["json"] === true) {
    const document = {
      footer: stats,
      rows: page.map((row) => turnLedgerRowJson({ row })),
      unreadable,
      window: rows.length,
    };
    logger.out({ line: JSON.stringify(document, null, 2) });
    return rows.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({ line: "no asks in this window." });
    return EXIT_EXPECTED_EMPTY;
  }
  const lines = [
    ...page.flatMap((row) => turnLedgerRowLines({ row })),
    ...turnLedgerFooterLines({ rows, stats, unreadable }),
  ];
  for (const line of lines) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const turnLedgerCommand = defineCommand({ run: runTurnLedger });
