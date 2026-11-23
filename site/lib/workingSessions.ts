/**
 * The Fleet page's session list — only the seats `session watch` judged `working`, one Queue-style card each, the
 * pinned supervisor first — and the properties a card's panel shows beside its transcript. Pure: the page passes the
 * readings and its clock in.
 *
 * The page shows working sessions only, with no groupings and no counts row (the state sentence keeps the working
 * count); a card's title is the outcome it is on; the supervisor is pinned; opening one shows its transcript with the
 * properties in a sticky side column; workspace, id, title-as-property, attention, mapped-to-cmux and the
 * read-provenance line are not shown; "where" is the worktree.
 *
 * The cards look nearly identical to the queue cards, except for the contents — one short plain title (no first-prompt
 * subtitle, no dashed slug, no `/slopweaver:supervisor`), the chips a Queue card carries, and the supervisor marked
 * apart from the others. So a title is the session's OWN short title before a board row's paragraph, and a card
 * carries its host, its row's priority and whether it has moved recently — the owner's "is it stuck on a shell for
 * days" question, answered at a glance.
 *
 * The phase and the review rounds are `not read`, and that is a finding, not a gap to fill: no record this page reads
 * says whether a live seat is planning, implementing or reviewing, nor how many review passes it has run. A completed
 * Codex pass proves only that the pass completed, so inferring either from the newest one — or from a title or a
 * prompt — would be a guess drawn as a reading.
 */
import type { Reading } from "../components/live/reading";
import type { Seat, Seats } from "../components/live/readNow";
import type { Placed } from "../components/live/readWorkstreams";
import { type NowJoinGap, nowSeatsOf, type ReconcilePlacements } from "./nowSeats";
import { clockWords } from "./planMetersWords";

/** The title a card carries when the supervisor is the seat — never its workspace title or a row. */
const SUPERVISOR_TITLE = "Supervisor";

/**
 * The longest board-row clause a card takes as its title. A board row's label is its doc's whole summary, a paragraph;
 * its first clause is a title only when it is short, and a longer one is a wall of text.
 */
const CLAUSE_TITLE_MAX = 90;

/**
 * How long a working seat may go without an event before its card says it has gone quiet rather than that it is
 * active — `session watch`'s own idle threshold (`DEFAULT_IDLE_MINUTES`, `src/cli/commands/session/watch.ts`).
 */
export const QUIET_AFTER_MINUTES = 10;

/** Where a card's title came from, so a test and a reader can tell an outcome from a fallback. */
export type TitleSource = "supervisor" | "session-title" | "cmux-title" | "board-summary" | "not-read";

/** The board row a session is on, as the card's chips need it. */
export interface SessionRow {
  readonly slug: string;
  readonly kind: string;
  /** `p0`–`p3`, or `undefined` when the row declares none. */
  readonly priority: string | undefined;
}

/** Whether a working seat has moved recently, as its card's badge words it. */
export interface SessionLiveness {
  readonly kind: "active" | "quiet";
  readonly words: string;
}

/**
 * What phase a seat is in. Only `not-read` is minted: no record says, and the other arms are the shape a recorded
 * phase would take, with a review round as the repository's own pass id rather than an invented ordinal.
 */
export type SessionPhase =
  | { readonly kind: "read"; readonly phase: "planning" | "implementation" }
  | { readonly kind: "read"; readonly phase: "review"; readonly round: "r1" | "r2" | "r3" }
  | { readonly kind: "not-read" };

/** One working seat as a card. */
export interface WorkingSessionCard {
  /** The seat's workspace id — the one field every row carries, and what `?seat=` opens. */
  readonly key: string;
  readonly seat: Seat;
  /** The board row the same tick's reconcile placed it on, when the join could be trusted. */
  readonly placement: Placed | undefined;
  /**
   * The board row the session is on: its placement's row, else the row named for its worktree — `cmux spawn` names
   * a seat's worktree for the slug it was seated on — else `undefined`.
   */
  readonly row: SessionRow | undefined;
  readonly title: string;
  readonly titleSource: TitleSource;
  readonly manager: boolean;
  readonly phase: SessionPhase;
  /**
   * The uuid the session's transcript opens by — the seat's session id without cmux's `claude-` prefix, which the
   * transcript reader refuses — or `undefined` when the seat carried none or another host's.
   */
  readonly transcriptId: string | undefined;
}

/** The cards, and why the board was not joined when it was not — so a title falling back says why. */
export interface WorkingSessionsView {
  readonly cards: readonly WorkingSessionCard[];
  readonly joinGap: NowJoinGap | undefined;
}

/**
 * Each seat's trusted placement, keyed by workspace id, off every band of the joined view.
 *
 * @returns the placements, and the join gap when the board could not be joined
 */
function placementsOf({
  seatReading,
  reconcileReading,
}: {
  seatReading: Reading<Seats>;
  reconcileReading: Reading<ReconcilePlacements> | undefined;
}): { readonly byWorkspace: ReadonlyMap<string, Placed>; readonly joinGap: NowJoinGap | undefined } {
  const view = nowSeatsOf({ reconcileReading, seatReading });
  if (view.kind === "signal-only") {
    return { byWorkspace: new Map(), joinGap: view.reason };
  }
  const byWorkspace = new Map<string, Placed>();
  for (const joined of [...view.working, ...view.betweenTurns, ...view.notOnBoard]) {
    if (joined.placement !== undefined) {
      byWorkspace.set(joined.seat.workspaceId, joined.placement);
    }
  }
  return { byWorkspace, joinGap: undefined };
}

/**
 * A slug as a title, a shape the owner cannot read: one token with no space. A slug may
 * carry dots, underscores and capitals (`SAFE_SLUG`, `src/handover/runStore.ts`), so the test is the missing
 * space rather than the slug grammar, and a one-word title falls through to the next source with it.
 */
const SLUG_SHAPE = /^\S+$/;

/**
 * Any line break, as the whole class rather than a list of them: every control character (which holds `\n`, a bare
 * `\r`, the vertical tab, the form feed and NEXT LINE) and the Unicode line and paragraph separators. A control
 * character that breaks no line, a tab, is no part of a title either.
 */
const LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/**
 * A second sentence or clause inside one line: any Unicode sentence terminal (`.`, `!`, `?`, `。` and the rest) or
 * `;`, then whitespace, then more words. A stop
 * with NO space after it is left alone on purpose — it is how a name or a version reads (`Node.js`, `v2.1`), and
 * a title Claude Code writes is a short phrase that never runs two sentences together. Whether a string is a
 * paragraph is a heuristic, so what it closes is a punctuated one: sentences run together with NO punctuation
 * ("Investigate the cards Fix the row") read as one phrase to any lexical test, and only a grammar would split
 * them. The length cap is what bounds that residue.
 */
const SENTENCE_BREAK = /[\p{Sentence_Terminal};]\s+\S/u;

/** What leads a terminal title before its words: Claude Code's `✳`, a spinner frame, spaces. */
const TITLE_LEAD = /^[^\p{L}\p{N}/]+/u;

/**
 * A terminal title with its leading glyph and spaces dropped — `✳ /slopweaver:supervisor` reads
 * `/slopweaver:supervisor` — and nothing else changed.
 *
 * @returns the title without its lead
 */
export function terminalTitleOf({ title }: { title: string }): string {
  return title.replace(TITLE_LEAD, "").trim();
}

/**
 * A session's own title or its cmux workspace title as a card title: the terminal's leading glyph dropped, and
 * nothing at all when it is a slash command (`/slopweaver:supervisor`), or what is left is a slug, runs over a line,
 * holds a second sentence or is longer than a board clause may be — none of those is a title the owner can read.
 *
 * @param title the title as the transcript or cmux holds it
 * @returns the plain title, or `undefined`
 */
export function plainTitle({ title }: { title: string | undefined }): string | undefined {
  if (title === undefined) {
    return undefined;
  }
  // The slash test runs AFTER the glyph strip: cmux titles a seat "✳ /slopweaver:supervisor".
  const plain = terminalTitleOf({ title });
  const notATitle = plain === "" || plain.startsWith("/") || SLUG_SHAPE.test(plain);
  const paragraph = LINE_BREAK.test(plain) || SENTENCE_BREAK.test(plain) || plain.length > CLAUSE_TITLE_MAX;
  if (notATitle || paragraph) {
    return undefined;
  }
  return plain;
}

/**
 * A board row's label cut to its first clause — up to the first `: `, `; `, ` (`, spaced dash, line break or
 * sentence end — when that clause is short enough to be a title. A longer one is never truncated into one.
 *
 * @param label the row's label, its doc's whole summary
 * @returns the clause, or `undefined` when even the first clause is a paragraph
 */
export function firstClause({ label }: { label: string }): string | undefined {
  const clause = label
    // `\s` throughout rather than a literal space, so a no-break space after a `;` cuts exactly as a space does.
    .split(/:\s|;\s|\s\(|\p{Sentence_Terminal}\s|\s[—–]\s|[\p{Cc}\p{Zl}\p{Zp}]/u)[0]
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A row with no summary carries its slug as its label (`rowOfDoc`, `src/handover/rank.ts`), which is no title;
  // nor is a slash command, glyph-led or not, which `plainTitle` refuses for the same reason.
  const slashCommand = clause.replace(TITLE_LEAD, "").startsWith("/");
  if (clause === "" || clause.length > CLAUSE_TITLE_MAX || SLUG_SHAPE.test(clause) || slashCommand) {
    return undefined;
  }
  return clause;
}

/**
 * A card's title, by precedence: the supervisor is `Supervisor`; else the title the session gave itself; else its cmux
 * title made plain; else its board row's first clause; else `outcome not read` — never an id, slug, slash command or
 * a paragraph drawn as though it were a title.
 *
 * @returns the title and where it came from
 */
function titleOf({ seat, placement }: { seat: Seat; placement: Placed | undefined }): {
  readonly title: string;
  readonly titleSource: TitleSource;
} {
  if (seat.manager === true) {
    return { title: SUPERVISOR_TITLE, titleSource: "supervisor" };
  }
  const own = plainTitle({ title: seat.sessionTitle });
  if (own !== undefined) {
    return { title: own, titleSource: "session-title" };
  }
  const cmux = plainTitle({ title: seat.title });
  if (cmux !== undefined) {
    return { title: cmux, titleSource: "cmux-title" };
  }
  if (placement !== undefined) {
    const clause = firstClause({ label: placement.row.label });
    if (clause !== undefined) {
      return { title: clause, titleSource: "board-summary" };
    }
  }
  return { title: "outcome not read", titleSource: "not-read" };
}

/**
 * The last segment of a worktree path — the directory `cmux spawn` names for the slug a seat was seated on.
 *
 * @returns the segment, or `undefined` for a path with none
 */
function worktreeName({ cwd }: { cwd: string }): string | undefined {
  return cwd.split("/").findLast((part) => part !== "");
}

/** The conventional spawn layout, `<checkout>/.claude/worktrees[.noindex]/<slug>[/...]` (`src/cmux/title.ts`). */
const SPAWNED_WORKTREE = /\/\.claude\/worktrees(?:\.noindex)?\/([^/]+)/;

/**
 * The slug a seat's worktree is named for, read only off the conventional spawn layout: a reused branch worktree, a
 * main checkout or any other path names no slug, since its last segment matching a row's would be a coincidence.
 *
 * @returns the slug, or `undefined`
 */
function spawnedSlugOf({ cwd }: { cwd: string }): string | undefined {
  return SPAWNED_WORKTREE.exec(cwd)?.[1];
}

/**
 * The board row a seat is on: its trusted placement's row, else the ONE board row whose slug its conventional spawn
 * worktree is named for — two rows under one slug join neither.
 *
 * @param boardRows every row on the board, `undefined` while the board is unread or the seats are a frozen capture
 * @returns the row, or `undefined`
 */
function rowOf({
  seat,
  placement,
  boardRows,
}: {
  seat: Seat;
  placement: Placed | undefined;
  boardRows: readonly SessionRow[] | undefined;
}): SessionRow | undefined {
  if (placement !== undefined) {
    return { kind: placement.row.kind, priority: placement.row.priority, slug: placement.row.id };
  }
  const slug = spawnedSlugOf({ cwd: seat.cwd });
  if (boardRows === undefined || slug === undefined) {
    return undefined;
  }
  const named = boardRows.filter((row) => row.slug === slug);
  if (named.length !== 1) {
    return undefined;
  }
  return named[0];
}

/** A Claude Code session id as cmux's hook payload names it: `claude-<uuid>`, or the bare uuid an older frame carried. */
const CLAUDE_SESSION_ID = /^(?:claude-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The uuid a seat's transcript opens by. cmux names a Claude Code session `claude-<uuid>`, and the transcript reader
 * takes the bare uuid only, so a card handing it the prefixed id opened nothing.
 *
 * A uuid alone is not a Claude Code id — a Codex thread id is one too — so the seat's host must say `claude`, or, when
 * no hook named one, the id must carry cmux's own `claude-` prefix.
 *
 * @param sessionId the seat's session id, as the reading carried it
 * @param host the agent CLI the seat's hooks named, `undefined` when none did
 * @returns the uuid, or `undefined` for no id or another host's
 */
export function transcriptIdOf({
  sessionId,
  host,
}: {
  sessionId: string | undefined;
  host: string | undefined;
}): string | undefined {
  if (sessionId === undefined) {
    return undefined;
  }
  const claudeSeat = host === "claude" || (host === undefined && sessionId.startsWith("claude-"));
  if (!claudeSeat) {
    return undefined;
  }
  return CLAUDE_SESSION_ID.exec(sessionId)?.[1];
}

/**
 * Every seat `session watch` judged `working`, as a card, in the reading's own order with the supervisor first.
 *
 * @param seatReading the tick's `session watch` reading
 * @param reconcileReading the tick's `handover reconcile` reading, `undefined` while it is loading or unread
 * @param boardRows every board row, for a seat no placement names; `undefined` while unread or for a frozen capture
 * @returns the cards, and the join gap when the board's summaries could not be used
 */
export function workingSessionsOf({
  seatReading,
  reconcileReading,
  boardRows,
}: {
  seatReading: Reading<Seats>;
  reconcileReading: Reading<ReconcilePlacements> | undefined;
  boardRows: readonly SessionRow[] | undefined;
}): WorkingSessionsView {
  const { byWorkspace, joinGap } = placementsOf({ reconcileReading, seatReading });
  const cards = seatReading.value.rows
    .filter((seat) => seat.signal === "working")
    .map((seat): WorkingSessionCard => {
      const placement = byWorkspace.get(seat.workspaceId);
      return {
        key: seat.workspaceId,
        manager: seat.manager === true,
        phase: { kind: "not-read" },
        placement,
        row: rowOf({ boardRows, placement, seat }),
        seat,
        transcriptId: transcriptIdOf({ host: seat.host, sessionId: seat.sessionId }),
        ...titleOf({ placement, seat }),
      };
    });
  return { cards: [...cards.filter((card) => card.manager), ...cards.filter((card) => !card.manager)], joinGap };
}

/**
 * Minutes since the seat last moved: off its last-activity instant against the page's clock when the reading carried
 * one, so a page left open keeps ageing it, else the reading's own quiet minutes.
 *
 * @param nowMs the page's clock
 * @returns whole minutes, never negative
 */
function quietMinutesOf({ seat, nowMs }: { seat: Seat; nowMs: number }): number {
  if (seat.lastActivityAtIso === undefined) {
    return seat.quietMinutes;
  }
  return Math.max(0, Math.floor((nowMs - Date.parse(seat.lastActivityAtIso)) / 60_000));
}

/**
 * Whether a working seat has moved recently, worded for its card's badge: `active just now`, `active 4m ago`, or
 * `quiet 2.5h` once it has gone {@link QUIET_AFTER_MINUTES} without an event.
 *
 * @param nowMs the page's clock
 * @returns the badge's kind and words
 */
export function livenessOf({ seat, nowMs }: { seat: Seat; nowMs: number }): SessionLiveness {
  const minutes = quietMinutesOf({ nowMs, seat });
  if (minutes >= QUIET_AFTER_MINUTES) {
    return { kind: "quiet", words: `quiet ${spanWords({ ms: minutes * 60_000 })}` };
  }
  if (minutes === 0) {
    return { kind: "active", words: "active just now" };
  }
  return { kind: "active", words: `active ${String(minutes)}m ago` };
}

/**
 * How long a span is, as the panel prints it: `12m`, `3.5h`, `2.0d`.
 *
 * @returns the words
 */
function spanWords({ ms }: { ms: number }): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 90) {
    return `${String(minutes)}m`;
  }
  const hours = ms / 3_600_000;
  if (hours < 36) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * An instant as the panel prints it — the clock, and how long before the page's clock it was.
 *
 * @returns `hh:mmZ, 3m ago`, or `not read` when the reading carried none
 */
function whenWords({ iso, nowMs }: { iso: string | undefined; nowMs: number }): string {
  if (iso === undefined) {
    return "not read";
  }
  const clock = clockWords({ iso, nowMs });
  if (clock === undefined) {
    return "not read";
  }
  return `${clock}, ${spanWords({ ms: nowMs - Date.parse(iso) })} ago`;
}

/**
 * The phase in words.
 *
 * @returns `planning`, `implementation`, `review r2`, or `phase not read`
 */
export function phaseWords({ phase }: { phase: SessionPhase }): string {
  if (phase.kind === "not-read") {
    return "phase not read";
  }
  if (phase.phase === "review") {
    return `review ${phase.round}`;
  }
  return phase.phase;
}

/** One property in a session panel's side column. */
export interface SessionProperty {
  readonly label: string;
  readonly value: string;
}

/**
 * The properties a session panel shows beside its transcript, in order — worktree, open for, phase, review rounds,
 * tool calls and quiet for, after the two a Queue card's column leads with, status and priority. Workspace, id,
 * title-as-property, attention, mapped-to-cmux and how it was read are not shown.
 *
 * @param nowMs the page's clock, which ages the last activity, the quiet time and the open duration
 * @returns the label and value of each property
 */
export function sessionPropertiesOf({
  card,
  nowMs,
}: {
  card: WorkingSessionCard;
  nowMs: number;
}): readonly SessionProperty[] {
  const { seat } = card;
  let openFor = "not read";
  if (seat.openedAtIso !== undefined) {
    openFor = spanWords({ ms: nowMs - Date.parse(seat.openedAtIso) });
  }
  let priority = "no board row";
  if (card.row !== undefined) {
    priority = "none declared";
    if (card.row.priority !== undefined) {
      priority = card.row.priority;
    }
  }
  const named = worktreeName({ cwd: seat.cwd });
  let worktree = seat.cwd;
  if (named !== undefined) {
    worktree = named;
  }
  return [
    { label: "Status", value: seat.signal },
    { label: "Priority", value: priority },
    { label: "Worktree", value: worktree },
    { label: "Open for", value: openFor },
    { label: "Phase", value: phaseWords({ phase: card.phase }) },
    { label: "Review rounds", value: "not read" },
    { label: "Tool calls", value: String(seat.toolCalls) },
    { label: "Quiet for", value: spanWords({ ms: quietMinutesOf({ nowMs, seat }) * 60_000 }) },
    { label: "Last activity", value: whenWords({ iso: seat.lastActivityAtIso, nowMs }) },
  ];
}

/**
 * What the session was asked to do: the prompt that opened its latest turn, when the transcript read reached it.
 *
 * @param prompt the latest turn's opening prompt, `undefined` when the read began mid-turn
 * @returns the prompt's text, or `goal not read` — never the board summary, which is already the card's title
 */
export function goalWords({ prompt }: { prompt: { readonly text: string } | undefined }): string {
  if (prompt === undefined || prompt.text.trim() === "") {
    return "goal not read";
  }
  return prompt.text;
}
