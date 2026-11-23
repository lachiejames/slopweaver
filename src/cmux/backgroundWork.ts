/**
 * What background work a Claude Code or Codex seat's screen shows still running — a shell or a Monitor that will
 * complete and wake the seat, or a Codex background terminal, so the seat is NOT parked however idle its prompt
 * looks.
 *
 * A parked seat is one that, left for a year, would look no different — frozen, running no shell that will
 * complete. Claude Code prints the count on its mode footer while either runs, MEASURED with `slopweaver cmux read-screen` on a live seat:
 *
 * - `⏵⏵ bypass permissions on · 1 shell · esc to interrupt · ← 3 agents` — one background shell;
 * - `⏵⏵ bypass permissions on · 1 shell, 1 monitor · esc to interrupt · ← 3 agents` — a shell and a Monitor;
 * - `⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents` — neither.
 *
 * Read only off a FOOTER line, anchored at its start the way `../handover/parkPolicy.ts` reads it, because the
 * same words anywhere else are text some session printed. A running background subagent draws a panel BELOW
 * the footer instead, which the at-rest proof already refuses (the footer is then not the last line).
 */
import type { VisibleSessionHost } from "../supervisor/session.js";

/** Claude Code's mode footer as a line — the same anchor `../handover/parkPolicy.ts` proves rest with. */
const FOOTER_LINE = /^\s*(?:⏵⏵|\? for shortcuts)/u;

/** `N shell` / `N shells` on the footer. */
const SHELLS = /(?:^|\s|·)(\d+) shells?\b/u;

/** `N monitor` / `N monitors` on the footer. */
const MONITORS = /(?:^|\s|·|,)\s*(\d+) monitors?\b/u;

/** How many background shells and Monitors the footer counts — zero each when it names none. */
export interface BackgroundWork {
  readonly shells: number;
  readonly monitors: number;
}

/**
 * Codex's own count, a status line of its own above the composer once the turn is over:
 * `  1 background terminal running · /ps to view · /stop to close`. MEASURED on `codex` v0.157.1
 * (`../__tests__/fixtures/codexTui.ts`'s `CODEX_AFTER_INTERRUPT`); gone once the terminal ends. Anchored at the
 * line's start for the same reason the Claude footer is. Mid-turn the same words ride the `• Working (` line,
 * which is a running turn and refused as one before this count is asked.
 *
 * Codex cuts a line too long for its pane with `…` (the fixtures hold one), so a narrow pane can render
 * `1 background terminal ru…`. A count followed by any cut-off prefix of the phrase is the same line, or the
 * terminal would vanish exactly when the pane is narrow — down to the bare count, `1 …` or
 * `1…`, whose empty stem is a prefix of every phrase, and a count left alone on its line with
 * no `…` at all. A bare number elsewhere in a transcript then reads as a terminal, which
 * only ever holds a seat, never parks one.
 */
const CODEX_TERMINALS_COUNT = /^\s*(\d+)/u;

/** The phrase the count line carries, singular and plural, that a cut-off line must be a prefix of. */
const CODEX_TERMINALS_PHRASES = ["background terminal running", "background terminals running"] as const;

/**
 * Codex's terminal count on one line, or `undefined` when the line is not its count line, whole or cut off.
 *
 * The count is read by one anchored pattern and the rest by string checks rather than a second quantifier, which
 * the `redos-check` gate refuses as polynomial backtracking.
 */
function codexTerminalCount({ line }: { line: string }): number | undefined {
  const count = CODEX_TERMINALS_COUNT.exec(line);
  if (count === null) {
    return undefined;
  }
  const rest = line.slice(count[0].length).trimEnd();
  const whole = CODEX_TERMINALS_PHRASES.some((phrase) => rest.startsWith(` ${phrase}`));
  const cut = rest.endsWith("…") && !rest.includes("·") && (rest === "…" || rest.startsWith(" "));
  if (rest === "") {
    return Number(count[1]);
  }
  if (!whole && !cut) {
    return undefined;
  }
  const stem = rest.slice(0, -1).trim();
  if (!whole && !CODEX_TERMINALS_PHRASES.some((phrase) => phrase.startsWith(stem))) {
    return undefined;
  }
  return Number(count[1]);
}

/** The work Claude Code's LAST footer line counts, or `undefined` when the screen has no footer line. */
function claudeWorkOf({ lines }: { lines: readonly string[] }): BackgroundWork | undefined {
  const footer = lines.findLast((line) => FOOTER_LINE.test(line));
  if (footer === undefined) {
    return undefined;
  }
  return { monitors: countOf({ line: footer, pattern: MONITORS }), shells: countOf({ line: footer, pattern: SHELLS }) };
}

/** Codex's background terminals off its LAST count line, as shells, or `undefined` when there is none. */
function codexWorkOf({ lines }: { lines: readonly string[] }): BackgroundWork | undefined {
  const count = lines.map((line) => codexTerminalCount({ line })).findLast((found) => found !== undefined);
  if (count === undefined) {
    return undefined;
  }
  return { monitors: 0, shells: count };
}

/**
 * The background work a screen counts, read by the seat's OWN host's line when the caller knows it.
 *
 * A known host is read by its own line only, so the other host's shape printed inside its transcript changes
 * nothing. With the host unknown both are read and SUMMED, never one short-circuiting the other: a Claude-shaped
 * footer printed in a Codex transcript would hide the Codex terminal count below it, and an
 * unknown host may only err toward holding a seat.
 *
 * @param screen the seat's rendered screen text
 * @param host the CLI the seat runs, or `undefined` when the caller cannot tell
 * @returns the counts, or `undefined` when no line the host draws counted anything
 */
export function backgroundWorkOf({
  screen,
  host,
}: {
  screen: string;
  host: VisibleSessionHost | undefined;
}): BackgroundWork | undefined {
  const lines = screen.split("\n");
  if (host === "claude-code") {
    return claudeWorkOf({ lines });
  }
  if (host === "codex") {
    return codexWorkOf({ lines });
  }
  const claudeWork = claudeWorkOf({ lines });
  const codexWork = codexWorkOf({ lines });
  if (claudeWork === undefined) {
    return codexWork;
  }
  if (codexWork === undefined) {
    return claudeWork;
  }
  return { monitors: claudeWork.monitors, shells: claudeWork.shells + codexWork.shells };
}

/**
 * Whether the screen shows any background shell, Monitor or Codex terminal still running, for a host the
 * caller cannot name.
 *
 * @param screen the seat's rendered screen text
 * @returns `true` when either host's line counts at least one
 */
export function screenShowsBackgroundWork({ screen }: { screen: string }): boolean {
  const work = backgroundWorkOf({ host: undefined, screen });
  return work !== undefined && work.shells + work.monitors > 0;
}

/** The count one pattern captures on the footer, `0` when it is not there. */
function countOf({ line, pattern }: { line: string; pattern: RegExp }): number {
  const captured = pattern.exec(line)?.[1];
  return captured === undefined ? 0 : Number(captured);
}
