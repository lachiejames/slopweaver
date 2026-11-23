/**
 * Whether a workspace's screen change reflects a genuinely booted host, not a shell error — or an
 * unbooted shell — masquerading as one.
 *
 * P3's finding: {@link ../cmux/spawn.js}'s old "any non-empty screen, different from before" success test
 * treated a shell error — `command not found`, an auth failure, an immediate crash — as a successful boot,
 * because every one of those ALSO changes the screen. Rejecting those well-known shapes was step one, but
 * it left a second, rarer false positive standing: the screen ALSO changes the instant the shell echoes back
 * the just-typed boot line itself, one tick before the target CLI has even exec'd — that echo matches no
 * negative pattern either, so the old "not an error" test called it booted while `claude`/`codex` was still
 * cold-starting. This is this doc's own root cause, reproduced live by racing several concurrent
 * `cmux spawn`s: under contention, the pickup command sent immediately after that false-positive boot signal
 * either lands in the raw shell (the target process hadn't exec'd yet) or is silently dropped (the process
 * had exec'd but its input handling wasn't attached yet) — both read back as a "successful send" to a caller
 * that only checked "not a known error", which is exactly the false `ok: true` this doc chased.
 *
 * The fix requires a POSITIVE match on the host's own real banner text, captured live in that same
 * reproduction (`claude --plugin-dir …` renders `Claude Code v2.1.231…`; `codex --no-alt-screen` renders
 * `OpenAI Codex (v0.145.0)…`) rather than merely rejecting error shapes — {@link HOST_POSITIVE_PATTERNS} is
 * no longer the placeholder this module used to carry.
 */
import type { VisibleSessionHost } from "../supervisor/session.js";

/** Shell-error shapes common to any launch, regardless of which model CLI was meant to boot. */
const GENERIC_NEGATIVE_PATTERNS: readonly RegExp[] = [
  /command not found/i,
  /no such file or directory/i,
  /permission denied/i,
  /is not recognized as an internal or external command/i,
  /^zsh: /im,
  /^-?bash: /im,
];

/**
 * The line Claude Code prints and exits on when told to resume a session id that has no transcript, anchored at
 * column 0. MEASURED: a never-prompted seat (its transcript is written only on the first submitted prompt)
 * relaunched with `--resume 68f60302-…` printed `No conversation found with session ID: 68f60302-…` and dropped to zsh.
 * The id is not parsed out of the prose.
 */
const MISSING_CONVERSATION_LINE = /^No conversation found with session ID:/u;

/**
 * Chrome only a RUNNING Claude Code draws: its live composer prompt (`❯` and a non-breaking space, `./composer.ts`),
 * a row made wholly of the `─` rule that frames that composer, its `? for shortcuts` hint, or its banner. A zsh prompt
 * draws none of these — a `❯ ` theme uses an ordinary space — so a missing-conversation line with any of them below it
 * was rendered inside a live session rather than printed by one that exited.
 */
function isRunningClaudeChrome({ line }: { line: string }): boolean {
  const trimmed = line.trim();
  return (
    line.includes("❯ ") ||
    (trimmed.length > 0 && /^─+$/u.test(trimmed)) ||
    line.includes("? for shortcuts") ||
    /Claude Code v\d/u.test(line)
  );
}

/**
 * Consecutive reads the SAME new missing-conversation exit line must stand on, with no Claude composer witnessed on
 * the grid at any of them, before a boot or a reseat read-back acts on it. A column-0 quote drawn in the instant
 * before Claude draws its chrome reads as an exit for that one frame, while a real exit stays the lowest
 * line under the prompt. Two reads a tick apart outlast the frame, and a real failure costs one tick more. RESIDUE,
 * stated: two reads whose missing-conversation lines are the same, with no chrome and no composer, read
 * as an exit whether one quote stood the whole tick or an identical one printed as the first scrolled off. The text
 * is all a read sees, and it cannot prove a process exited.
 */
export const EXIT_SIGHTINGS_TO_FAIL = 2;

/** One read's new exit: the lowest line's text, and how many such lines stood on screen with it. */
export interface ExitLine {
  /** The lowest missing-conversation line's own text. */
  readonly line: string;
  /** How many missing-conversation lines the read carried, so a second identical line printed is a different exit. */
  readonly lines: number;
}

/** The run of consecutive reads one new exit has stood on. */
export interface ExitSightings {
  /** How many consecutive reads showed it. */
  readonly count: number;
  /** The exit those reads showed; `undefined` while no read shows one. */
  readonly exit: ExitLine | undefined;
}

/** No read has shown a new exit yet. */
export const NO_EXIT_SIGHTINGS: ExitSightings = { count: 0, exit: undefined };

/**
 * Fold one read into the run of sightings: the same exit again extends it, a different one starts a new run, and a
 * read with none ends it. Two quotes that each read as an exit for one frame never add up to a standing exit, nor
 * does an identical quote printed again below the first: the same exit is the same text with the
 * same number of lines, because a process that exited prints nothing more.
 *
 * @param sightings the run so far
 * @param exit this read's new exit, `undefined` when it shows none
 * @returns the run after this read
 */
export function nextExitSightings({
  sightings,
  exit,
}: {
  sightings: ExitSightings;
  exit: ExitLine | undefined;
}): ExitSightings {
  if (exit === undefined) {
    return NO_EXIT_SIGHTINGS;
  }
  const same = exit.line === sightings.exit?.line && exit.lines === sightings.exit.lines;
  if (same) {
    return { count: sightings.count + 1, exit };
  }
  return { count: 1, exit };
}

/**
 * This read's new exit, for {@link nextExitSightings}: the lowest line and the line count when the read shows one.
 *
 * @param before the reading from before the launch line was typed
 * @param after the reading now
 * @returns the new exit, `undefined` when there is none
 */
export function newExitLine({
  before,
  after,
}: {
  before: MissingConversationReading;
  after: MissingConversationReading;
}): ExitLine | undefined {
  if (!newMissingConversationExit({ after, before }) || after.lowest === undefined) {
    return undefined;
  }
  return { line: after.lowest, lines: after.lines };
}

/** What one screen shows of Claude's missing-conversation line. */
export interface MissingConversationReading {
  /** How many times the line stands at column 0 — exits and column-0 quotes alike, so it only ever grows. */
  readonly lines: number;
  /** Whether the LOWEST such line is an exit: no running-Claude chrome anywhere below it. */
  readonly lastIsExit: boolean;
  /** The lowest such line's own text, session id included; `undefined` when the screen carries none. */
  readonly lowest: string | undefined;
}

/**
 * Read a screen's missing-conversation lines: how many stand at column 0, and whether the lowest one is Claude Code
 * EXITING — nothing a running Claude draws anywhere below it.
 *
 * The phrase alone is not the signal. A hook, a prompt or a transcript quoting it inside a live session is indented
 * under Claude's own gutter or has the composer drawn beneath it, and counting it failed a healthy boot and cost one
 * retry. No shell prompt shape is read: what follows the exit is the owner's prompt, whatever its theme.
 *
 * The count is of LINES, never of exits, because judging an old line by what is below it is unstable: a relaunch
 * that boots Claude's banner under an old exit and then exits again turns the old one into a non-exit, and a count of
 * exits stays level across a real new failure. Lines only ever grow while the tab is on screen.
 *
 * The screen cannot prove the process exited: a column-0 quote in the instant before Claude draws its composer reads
 * as an exit for that frame, so no caller acts on one reading ({@link EXIT_SIGHTINGS_TO_FAIL}). A line scrolled off
 * the visible screen is a line the count no longer holds, which is why the lowest line's own text is kept beside it
 * ({@link newMissingConversationExit}).
 *
 * @param screen the surface's rendered text
 * @returns the line count, whether the lowest line is an exit, and that line's text
 */
export function readMissingConversation({ screen }: { screen: string }): MissingConversationReading {
  const lines = screen.split("\n");
  const found = lines.flatMap((line, index) => (MISSING_CONVERSATION_LINE.test(line) ? [index] : []));
  const lowest = found.at(-1);
  if (lowest === undefined) {
    return { lastIsExit: false, lines: 0, lowest: undefined };
  }
  const below = lines.slice(lowest + 1);
  return {
    lastIsExit: !below.some((line) => isRunningClaudeChrome({ line })),
    lines: found.length,
    lowest: lines[lowest],
  };
}

/**
 * Whether a screen read after a launch shows a NEW missing-conversation exit: the lowest line an exit, and either more
 * lines than the screen read before carried or a lowest line whose text is not the one that was lowest then. An old
 * failure left on screen is never this launch's.
 *
 * Why the text as well as the count: output that scrolls an old line off the top as a new one prints
 * leaves the count level across a real failure. A screen scrolls from the TOP, so the old lowest line is the last of
 * them to go; a different lowest line therefore means a new one printed. The session id in that text is what makes a
 * resume's own failure differ from an old one. RESIDUE, stated: the same session id failing twice, with exactly as
 * many old lines scrolled off as new ones printed, reads level — the read-back then runs out as `UNCONFIRMED`, which
 * names the tab, rather than relaunching anything.
 *
 * @param before the reading from before the launch line was typed
 * @param after the reading now
 * @returns true when this launch exited on the missing-conversation line
 */
export function newMissingConversationExit({
  before,
  after,
}: {
  before: MissingConversationReading;
  after: MissingConversationReading;
}): boolean {
  if (!after.lastIsExit) {
    return false;
  }
  return after.lines > before.lines || after.lowest !== before.lowest;
}

/**
 * Per-host banner text that only appears once the real CLI has actually started rendering — captured live
 * against `claude --plugin-dir …` and `codex --no-alt-screen`. A screen lacking this is either the unbooted
 * shell (possibly still echoing the boot line itself) or a not-yet-rendered launch, never a booted host.
 */
const HOST_POSITIVE_PATTERNS: Readonly<Record<VisibleSessionHost, RegExp>> = {
  "claude-code": /Claude Code v\d/,
  codex: /OpenAI Codex/,
};

/**
 * Per-host text that only appears once the host is rendering an input prompt it will actually accept a paste
 * into — a STRICTLY later moment than {@link HOST_POSITIVE_PATTERNS}, and the distinction this constant
 * exists for.
 *
 * Measured across ten real spawns: `agent.hook.SessionStart` fires, and the session's first
 * `UserPromptSubmit` follows **4.4-7.7 s later**. Boot is witnessed by that event, so a pickup line sent the
 * instant boot is confirmed is sent into a session that is seconds away from having a prompt at all. Mostly
 * the pty buffers it and it lands anyway; when the TUI clears its input on first render it does not, which is
 * the silent drop `spawn.ts`'s header records and the reason a pickup ever needs hand-delivering.
 *
 * A host with no measured pattern is `undefined` rather than a guess. `codex` is that case: nothing here has
 * captured its composer's ready state live, and a pattern invented at a desk would either never match (making
 * every codex spawn pay the full wait) or match too early (proving nothing). An absent pattern simply means
 * readiness cannot be asserted for that host, and {@link readyPromptIsAssertable} says so out loud.
 */
const READY_PROMPT_PATTERNS: Readonly<Record<VisibleSessionHost, RegExp | undefined>> = {
  "claude-code": /(?:❯|\? for shortcuts)/u,
  codex: undefined,
};

/**
 * Whether readiness is a question that can be ANSWERED for this host at all.
 *
 * Exported so a caller distinguishes "not ready yet" from "this host cannot tell you" — the two demand
 * opposite behaviour, and collapsing them would make a `codex` spawn wait out a bound for a signal that is
 * never coming.
 *
 * @param host which model CLI this workspace booted
 * @returns whether {@link hasReadyPromptSignal} can ever return true for it
 */
export function readyPromptIsAssertable({ host }: { host: VisibleSessionHost }): boolean {
  return READY_PROMPT_PATTERNS[host] !== undefined;
}

/**
 * Whether `screen` shows a host rendering a prompt it will accept a paste into.
 *
 * A positive answer is worth acting on; a negative one is NOT proof the host will drop a paste, only that
 * nothing here can see a prompt yet. Callers must therefore treat this as a reason to wait a little, never as
 * a reason to refuse — which is why `pickupDelivery.ts` sends after its readiness bound either way and relies on a
 * bounded RETRY for the actual guarantee.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @param host which model CLI this workspace booted
 * @returns whether a ready prompt is visible
 */
export function hasReadyPromptSignal({
  host,
  screen,
}: {
  host: VisibleSessionHost;
  screen: string | undefined;
}): boolean {
  const pattern = READY_PROMPT_PATTERNS[host];
  if (pattern === undefined || screen === undefined) {
    return false;
  }
  return pattern.test(screen);
}

/**
 * Whether `screen` shows a positive boot signal for `host`, relative to the screen captured before anything
 * was sent.
 *
 * @param before the screen immediately after workspace creation, before the boot line was sent, or
 *   `undefined` when that baseline could not be read at all — in which case there is nothing for the current
 *   screen to be unchanged FROM, so the unchanged-screen check simply cannot fire
 * @param screen the current screen, after the boot line was sent
 * @param host which model CLI this workspace was meant to boot
 * @returns whether this is a genuine boot rather than an unchanged screen, a shell error, or the shell still
 *   cold-starting the target CLI
 */
export function hasPositiveBootSignal({
  before,
  screen,
  host,
}: {
  before: string | undefined;
  screen: string;
  host: VisibleSessionHost;
}): boolean {
  if (screen.trim().length === 0 || screen === before) {
    return false;
  }
  if (GENERIC_NEGATIVE_PATTERNS.some((pattern) => pattern.test(screen))) {
    return false;
  }
  // Claude's missing-conversation exit can sit under a banner it already printed, so it outranks the banner.
  if (host === "claude-code" && readMissingConversation({ screen }).lastIsExit) {
    return false;
  }
  return HOST_POSITIVE_PATTERNS[host].test(screen);
}
