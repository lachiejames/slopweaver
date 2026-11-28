/**
 * What a seat's screen says its turn is doing — idle, running, queued, or unknown — read with the patterns
 * measured for the host the seat booted, never another host's.
 *
 * ## Why one classifier
 *
 * Parking a foreign seat and force-closing one both turn on the same question, "is this seat provably at
 * rest", and at first the only answer was Claude Code's: `../handover/parkPolicy.ts` read Claude's
 * footer and nothing else, so a visibly idle Codex seat was always `unreadable` and a Codex-only install could
 * never park or close one. The patterns now live here per host, and a caller that knows the host asks
 * {@link classifyTurnScreen}; a caller that does not ({@link screenProvesAtRest}, for `cmux close`) asks
 * whether ANY host's at-rest proof holds, which is safe because each proof is positive and host-distinctive.
 *
 * ## Idle is POSITIVE, never the absence of a running marker
 *
 * A blank screen, a shell, or a host nobody measured carries no running marker either, so `idle` requires the
 * host's own composer drawn at the bottom of the screen:
 *
 * - **Claude Code** — its mode footer (`⏵⏵ …` or `? for shortcuts`) as the LAST line, its `❯` input box within
 *   three lines above. Measured on a re-park.
 * - **Codex** — its status footer (`  <model> <effort> · <directory>…`) as the LAST line, and its `›` composer the
 *   nearest non-blank line above it, within three lines. Measured on `codex` v0.157.1
 *   (`../__tests__/fixtures/codexTui.ts`): idle, mid-turn and
 *   queued screens all draw the composer there, so the composer alone is only "Codex is on screen"; what
 *   separates idle is that Codex draws its `• Working (` status line above the composer for the whole of a
 *   turn, and {@link classifyTurnScreen} has already ruled that, the queued header and any background terminal
 *   out before it asks. A selection menu draws its chosen item with the same `›` (`› 1. Trust and continue`),
 *   so a `›` followed by a numbered item is not a composer.
 *
 * Residue, stated: the composer and footer are text, and a session that printed the same lines as its last
 * output would read at rest — the same residue Claude Code's proof carries. A Codex UI change that moves any of
 * these fails CLOSED to `unknown`, never open. So does a Codex composer holding text long enough to WRAP: its `›`
 * then sits further up than {@link PROMPT_TO_FOOTER_LINES}, and a wrapped composer was never measured, so such a
 * seat reads `unknown` rather than having its continuation lines guessed at.
 *
 * Pure: the caller supplies the screen.
 */
import type { VisibleSessionHost } from "../supervisor/session.js";
import { backgroundWorkOf } from "./backgroundWork.js";
import { hostShowsQueuedMessage, hostShowsRunningTurn } from "./turnBusy.js";

/** What one read of a seat's screen says its turn is doing. */
export type TurnScreenState = "idle" | "running" | "queued" | "unknown";

/**
 * How many lines above the last one a host's input box may sit. Claude Code's measured on a
 * re-park, whose journalled `screenTail` ends `❯`, a rule, the footer; repro:
 * `tail -1 $SLOPWEAVER_HOME/runs/<slug>.jsonl | grep -o '"screenTail":"[^"]*'`.
 * Codex's composer sat two lines above (idle after a turn) and three (fresh boot).
 */
const PROMPT_TO_FOOTER_LINES = 3;

/**
 * Claude Code's mode footer as a LINE — `⏵⏵ …` in a permissions mode, `? for shortcuts` in the default one.
 * Anchored at the line's start, because the same words inside a line are just text another session printed.
 */
const CLAUDE_FOOTER_LINE = /^\s*(?:⏵⏵|\? for shortcuts)/u;

/** Claude Code's input box. */
const CLAUDE_PROMPT_LINE = /^❯/u;

/** Codex's composer: a bare `›`, or `›` and text — never `›` and a numbered menu item. */
const CODEX_COMPOSER_LINE = /^›(?:$|\s(?!\d+\.\s))/u;

/**
 * Codex's status footer as measured: two spaces, the model, its reasoning effort, ` · `, then the working
 * directory as a path (`  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view`). Only
 * `default` was measured; the other effort words are Codex's own settings, and one outside the set fails CLOSED.
 * A shell prompt or a command's ` · `-joined output is not this shape, which is what stops a `›` some command
 * PRINTED from passing for the composer.
 */
const CODEX_FOOTER_LINE = /^ {2}\S+ (?:default|minimal|low|medium|high|xhigh) · [~/]/u;

/** A line holding nothing but whitespace — the only kind Codex draws between its composer and its footer. */
const BLANK_LINE = /^\s*$/u;

/**
 * Whether the screen POSITIVELY shows this host's input box at rest at the bottom — the half of `idle` the
 * markers cannot give.
 *
 * @param host which model CLI the seat booted
 * @param screen the seat's rendered screen text
 * @returns `true` only when the host's own composer layout is the bottom of the screen
 */
function hostComposerAtBottom({ host, screen }: { host: VisibleSessionHost; screen: string }): boolean {
  // Only the TRAILING blank lines go: the prompt's distance from the footer is counted in screen lines.
  const lines = screen.trimEnd().split("\n");
  const last = lines.at(-1);
  if (last === undefined) {
    return false;
  }
  const above = lines.slice(-1 - PROMPT_TO_FOOTER_LINES, -1);
  if (host === "claude-code") {
    return CLAUDE_FOOTER_LINE.test(last) && above.some((line) => CLAUDE_PROMPT_LINE.test(line));
  }
  if (!CODEX_FOOTER_LINE.test(last)) {
    return false;
  }
  // The composer is the nearest non-blank line above the footer — nothing but blank lines may sit between them.
  const nearest = above.findLast((line) => !BLANK_LINE.test(line));
  return nearest !== undefined && CODEX_COMPOSER_LINE.test(nearest);
}

/**
 * Classify a seat's screen for the host it booted.
 *
 * @param host which model CLI the seat booted — only its own measured patterns answer
 * @param screen the seat's rendered screen text, or `undefined` when it could not be read
 * @returns `queued` or `running` off the host's measured markers; `idle` only when no marker, no background
 *   work and the host's own composer is at the bottom; `unknown` for everything else, an unreadable screen
 *   included
 */
export function classifyTurnScreen({
  host,
  screen,
}: {
  host: VisibleSessionHost;
  screen: string | undefined;
}): TurnScreenState {
  if (screen === undefined) {
    return "unknown";
  }
  if (hostShowsQueuedMessage({ host, screen })) {
    return "queued";
  }
  if (hostShowsRunningTurn({ host, screen })) {
    return "running";
  }
  const work = backgroundWorkOf({ host, screen });
  if (work !== undefined && work.shells + work.monitors > 0) {
    return "unknown";
  }
  return hostComposerAtBottom({ host, screen }) ? "idle" : "unknown";
}

/**
 * Whether Claude Code's own composer sits at the bottom of the screen, background work or not — the prompt half of
 * `idle` alone, for the one caller that judges a counted background shell itself
 * (`../sessions/keepAliveSeatClose.ts`). Never an at-rest proof on its own: a running turn or a queued line is the
 * caller's to refuse first.
 *
 * @param screen the seat's rendered screen text
 * @returns `true` only when Claude Code's footer is the last line with its `❯` prompt just above it
 */
export function claudeComposerAtBottom({ screen }: { screen: string }): boolean {
  return hostComposerAtBottom({ host: "claude-code", screen });
}

/** Every host whose at-rest proof {@link screenProvesAtRest} may accept. */
const PROVABLE_HOSTS: readonly VisibleSessionHost[] = ["claude-code", "codex"];

/**
 * The host whose own composer layout is the bottom of the screen, for a caller never told which host the seat
 * booted. The two layouts end on different last lines (Claude Code's mode footer, Codex's status footer), so at
 * most one matches. A host named here drew the screen, so that host's markers are the only ones that mean anything
 * on it: text higher up shaped like the other host's markers is transcript, such as a diff line that is just a line
 * number, which Codex's terminal count would otherwise read as a background terminal.
 *
 * @param screen the seat's rendered screen text
 * @returns the host whose composer and footer sit at the bottom, or `undefined` when neither does
 */
export function screenHostAtBottom({ screen }: { screen: string }): VisibleSessionHost | undefined {
  return PROVABLE_HOSTS.find((host) => hostComposerAtBottom({ host, screen }));
}

/**
 * Whether a screen POSITIVELY shows some host at rest, for a caller that was never told which host the seat
 * booted — `cmux close`'s bounded force. Each host's proof is its own composer layout, so no host's screen can
 * borrow another's.
 *
 * @param screen the seat's rendered screen text
 * @returns `true` when any host classifies the screen `idle`
 */
export function screenProvesAtRest({ screen }: { screen: string }): boolean {
  return PROVABLE_HOSTS.some((host) => classifyTurnScreen({ host, screen }) === "idle");
}
