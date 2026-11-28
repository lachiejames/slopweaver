/**
 * Turning a folded event stream into the supervisor's own per-session view — pure, no socket, no ledger read.
 *
 * The fold in `cmux/sessionActivity.ts` knows a WORKSPACE finished a turn; the supervisor needs to know which
 * SESSION that is, and a workspace id means nothing to a human. This joins the two: the fold's state, the cmux
 * inventory's title and cwd, and (when the ledger knows it) the handover slug the session was dispatched for.
 */
import { absentAsNumber } from "#lib/absent.js";
import { parseStrictIsoInstantMs } from "#lib/date.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { classifySession, type SessionActivity, type SessionSignal } from "../cmux/sessionActivity.js";
import { isPinnedSupervisorWorkspace } from "../cmux/supervisorWorkspace.js";
import type { SeatWall } from "./seatRecovery.js";

/**
 * What a watch row says about a session: the event fold's own {@link SessionSignal}, or the {@link SeatWall}
 * its screen showed — `logged-out` or `limit-retrying`.
 *
 * A wall is the one signal no hook event carries. A setup-token seat cmux's own restore reopened boots `claude`
 * without its token and sits on `Not logged in · Please run /login`, firing nothing;
 * a seat whose plan spent its window sits on `✻ Weekly limit reached · Retrying in 5h …` and reads `working`
 * for as long as it retries. So the only witness is its SCREEN, read by
 * {@link withWalledSeats}'s caller. Both rank just under `needs-input`, and both are stuck chats whose remedy
 * is one verb: `slopweaver session re-seat`.
 */
type SessionWatchSignal = SessionSignal | SeatWall["kind"];

/** One session, as the supervisor sees it. */
export interface SessionWatchRow {
  readonly workspaceId: string;
  readonly workspaceRef: string | undefined;
  readonly title: string | undefined;
  readonly cwd: string | undefined;
  /** Whether the live cmux inventory returned this workspace id. False means the row is unmapped. */
  readonly mapped: boolean;
  readonly signal: SessionWatchSignal;
  /** How long it has been since anything at all happened here, in whole minutes. */
  readonly quietMinutes: number;
  readonly lastEventName: string;
  readonly attentionKind: "notification" | "question" | undefined;
  readonly toolCalls: number;
  /**
   * Which agent CLI the seat's hooks named (`claude`), or `undefined` when no hook event named one — a walled seat
   * the fold never saw, or a frame from before cmux stamped it. The Fleet page counts working sessions per host by it.
   */
  readonly host: string | undefined;
  /** The agent CLI's own session id, when a hook payload named one — what the Fleet page opens a transcript by. */
  readonly sessionId: string | undefined;
  /** When anything last happened here, or `undefined` when no hook event was seen. */
  readonly lastActivityAtIso: string | undefined;
  /** When this session last booted (`SessionStart`), or `undefined` when the fold never saw it boot. */
  readonly openedAtIso: string | undefined;
  /**
   * Whether this is the pinned supervisor ({@link isPinnedSupervisorWorkspace}), or `undefined` for an unmapped row,
   * whose pin and title the inventory did not return.
   */
  readonly manager: boolean | undefined;
  /**
   * The title the agent CLI gave the session itself — Claude Code's newest `ai-title` record, the words cmux shows
   * after its `✳` — read off the seat's own transcript by {@link withSessionTitles}. `undefined` when the session
   * has not titled itself, no transcript was found, or the host writes none: the Fleet page's card title.
   */
  readonly sessionTitle: string | undefined;
}

/**
 * One instant in its canonical `toISOString` form, or `undefined` when it is absent or names no instant — cmux stamps an
 * event with no `occurred_at` as `unknown`, and a reader holding the row to one exact spelling must never see that.
 */
function canonicalInstant({ iso }: { iso: string | undefined }): string | undefined {
  if (iso === undefined) {
    return undefined;
  }
  const ms = parseStrictIsoInstantMs({ text: iso });
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

/** Whole minutes between two ISO instants, floored at zero and 0 when either is unparseable. */
function minutesBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / 60_000));
}

/**
 * Join folded activity to the cmux inventory and classify each session.
 *
 * A workspace the fold knows about but the inventory does not is still reported, `mapped: false`: that
 * combination is itself the interesting case — events arrived for a workspace the live inventory no longer
 * (or does not yet) return, and silently dropping the row would hide it. The row still carries whatever the
 * fold itself saw — its own last `cwd`, from the event stream rather than the inventory — because that is
 * the one clue that survives a workspace's closing and is enough for a supervisor to chase or dismiss the
 * row without a bare id to go on.
 *
 * @param activities the folded per-workspace state, keyed by workspace id
 * @param workspaces the live cmux inventory
 * @param nowIso the instant to judge against
 * @param idleAfterMs how long a quiet session must have been quiet to count as idle
 * @returns one row per session, most-urgent first
 */
export function sessionWatchRows({
  activities,
  workspaces,
  nowIso,
  idleAfterMs,
}: {
  activities: Readonly<Record<string, SessionActivity>>;
  workspaces: readonly CmuxWorkspaceSummary[];
  nowIso: string;
  idleAfterMs: number;
}): readonly SessionWatchRow[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const rows = Object.values(activities).map((activity): SessionWatchRow => {
    const workspace = byId.get(activity.workspaceId);
    return {
      attentionKind: activity.attentionKind,
      cwd: workspace === undefined ? activity.cwd : workspace.currentDirectory,
      host: activity.agentSource,
      lastActivityAtIso: canonicalInstant({ iso: activity.lastEventAtIso }),
      lastEventName: activity.lastEventName,
      manager:
        workspace === undefined
          ? undefined
          : isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title }),
      mapped: workspace !== undefined,
      openedAtIso: canonicalInstant({ iso: activity.sessionStartedAtIso }),
      quietMinutes: minutesBetween({ fromIso: activity.lastEventAtIso, toIso: nowIso }),
      sessionId: activity.agentSessionId,
      sessionTitle: undefined,
      signal: classifySession({ activity, idleAfterMs, nowIso }),
      title: workspace?.title,
      toolCalls: activity.toolCalls,
      workspaceId: activity.workspaceId,
      workspaceRef: workspace?.workspaceRef,
    };
  });
  return rows.toSorted(
    (left, right) => urgency({ row: left }) - urgency({ row: right }) || right.quietMinutes - left.quietMinutes,
  );
}

/** The row a walled workspace the fold never saw gets: no hook event, just its inventory entry and its wall. */
function unseenWalledRow({ workspace, wall }: { workspace: CmuxWorkspaceSummary; wall: SeatWall }): SessionWatchRow {
  return {
    attentionKind: undefined,
    cwd: workspace.currentDirectory,
    host: undefined,
    lastActivityAtIso: undefined,
    lastEventName: "no hook event",
    manager: isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title }),
    mapped: true,
    openedAtIso: undefined,
    quietMinutes: 0,
    sessionId: undefined,
    sessionTitle: undefined,
    signal: wall.kind,
    title: workspace.title,
    toolCalls: 0,
    workspaceId: workspace.workspaceId,
    workspaceRef: workspace.workspaceRef,
  };
}

/**
 * Mark every workspace whose screen showed a wall with that wall's signal — a `working` row included, since a
 * limit-walled seat reads `working` for as long as it retries — adding a row for one the fold never saw, and
 * re-sort.
 *
 * @param rows the rows {@link sessionWatchRows} built
 * @param workspaces the live cmux inventory, for a row the fold has no activity for
 * @param wallsByWorkspaceId the wall each walled workspace's screen showed, keyed by workspace id
 * @returns the rows, walled ones re-signalled, most-urgent first
 */
export function withWalledSeats({
  rows,
  workspaces,
  wallsByWorkspaceId,
}: {
  rows: readonly SessionWatchRow[];
  workspaces: readonly CmuxWorkspaceSummary[];
  wallsByWorkspaceId: ReadonlyMap<string, SeatWall>;
}): readonly SessionWatchRow[] {
  if (wallsByWorkspaceId.size === 0) {
    return rows;
  }
  const known = new Set(rows.map((row) => row.workspaceId));
  const marked = rows.map((row): SessionWatchRow => {
    const wall = wallsByWorkspaceId.get(row.workspaceId);
    return wall === undefined ? row : { ...row, signal: wall.kind };
  });
  const unseen = workspaces.flatMap((workspace) => {
    const wall = wallsByWorkspaceId.get(workspace.workspaceId);
    return wall === undefined || known.has(workspace.workspaceId) ? [] : [unseenWalledRow({ wall, workspace })];
  });
  return [...marked, ...unseen].toSorted(
    (left, right) => urgency({ row: left }) - urgency({ row: right }) || right.quietMinutes - left.quietMinutes,
  );
}

/** A Claude Code session id as cmux's hook payload names it: `claude-<uuid>`, or the bare uuid an older frame carried. */
const CLAUDE_SESSION_ID = /^(?:claude-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The uuid a Claude Code transcript is named by, off a row's session id — `undefined` for another host's id, whose
 * transcript is not a Claude Code one.
 *
 * @param sessionId the row's session id, as cmux's hook payload named it
 * @returns the transcript uuid, or `undefined`
 */
export function claudeTranscriptId({ sessionId }: { sessionId: string | undefined }): string | undefined {
  if (sessionId === undefined) {
    return undefined;
  }
  return CLAUDE_SESSION_ID.exec(sessionId)?.[1];
}

/**
 * Each row with the title its session gave itself, read through `titleOf` — called once per Claude Code row (its host
 * `claude`, or no host named and a `claude-` id) with a uuid session id, and never for another host's.
 *
 * @param rows the rows the report keeps
 * @param titleOf the newest `ai-title` of one transcript uuid, `undefined` when it has none or none was found
 * @returns the rows, each carrying its session title when one was read
 */
export function withSessionTitles({
  rows,
  titleOf,
}: {
  rows: readonly SessionWatchRow[];
  titleOf: (transcriptId: string) => string | undefined;
}): readonly SessionWatchRow[] {
  return rows.map((row): SessionWatchRow => {
    // A uuid alone does not make a session Claude Code's — a Codex thread id is one too — so the row's host must say
    // claude, or, when no hook named a host, the id must carry cmux's own `claude-` prefix.
    const claudeRow =
      row.host === "claude" || (row.host === undefined && row.sessionId?.startsWith("claude-") === true);
    const transcriptId = claudeTranscriptId({ sessionId: row.sessionId });
    if (!claudeRow || transcriptId === undefined) {
      return row;
    }
    const title = titleOf(transcriptId)?.trim();
    if (title === undefined || title === "") {
      return row;
    }
    return { ...row, sessionTitle: title };
  });
}

/** Lower sorts first: a session waiting on the owner outranks one that is merely quiet. */
function urgency({ row }: { row: SessionWatchRow }): number {
  switch (row.signal) {
    case "needs-input":
      return 0;
    case "logged-out":
    case "limit-retrying":
      return 1;
    case "silent":
      return 2;
    case "idle":
      return 3;
    case "working":
      return 4;
  }
}

/** What a row is called: its workspace title, else its workspace ref, else its last cwd, else its bare id. */
function rowName({ row }: { row: SessionWatchRow }): string {
  if (row.title !== undefined) {
    return row.title;
  }
  if (row.workspaceRef !== undefined) {
    return row.workspaceRef;
  }
  if (row.cwd !== undefined) {
    return row.cwd;
  }
  return row.workspaceId;
}

/**
 * One row's two presented phrases — who it is, and what it is doing — before they are joined into a line.
 *
 * An unmapped row (no live cmux inventory entry) never names a bare workspace id as if it were a name a
 * supervisor could act on: it is flagged explicitly, carries its last-known cwd when the fold saw one, and
 * always states the id so the row can be chased (`cmux list --json` / `session list --json` against it) or
 * positively dismissed, rather than skipped for looking unreachable.
 *
 * Separate from {@link renderSessionWatchRow} so a consumer that records a row as structured fields — the
 * supervisor's tick draft — takes the same two phrases the line shows rather than splitting the line on tabs.
 *
 * @param row the row to present
 * @returns the row's name (with its unmapped flag when it has one) and its one-clause detail
 */
export function sessionWatchRowParts({ row }: { row: SessionWatchRow }): { name: string; detail: string } {
  const named = rowName({ row });
  const unmapped = row.mapped
    ? ""
    : ` [unmapped: id ${row.workspaceId} not in cmux inventory — check \`cmux list --json\` / \`session list --json\`]`;
  return { detail: sessionWatchRowDetail({ row }), name: `${named}${unmapped}` };
}

/**
 * What a waiting row is waiting on. `needs-input` keys on the attention INSTANT, and a snapshot whose stored kind
 * was neither known kind restores that instant without a kind, so the row says it cannot tell rather than guessing.
 */
function attentionLabel({ attentionKind }: { attentionKind: SessionWatchRow["attentionKind"] }): string {
  if (attentionKind === undefined) {
    return "unknown";
  }
  return attentionKind;
}

/** The one clause saying what a row's session is doing. */
function sessionWatchRowDetail({ row }: { row: SessionWatchRow }): string {
  if (row.signal === "needs-input") {
    return `waiting on you (${attentionLabel({ attentionKind: row.attentionKind })})`;
  }
  if (row.signal === "logged-out") {
    return "Not logged in on screen — neither a working setup token nor a signed-in store; run slopweaver session re-seat";
  }
  if (row.signal === "limit-retrying") {
    return "usage-limit retry banner on screen — it answers nothing until its plan resets; run slopweaver session re-seat";
  }
  return `quiet ${String(row.quietMinutes)}m after ${row.lastEventName}`;
}

/**
 * One row as the line a supervisor reads — {@link sessionWatchRowParts}, joined with the signal and the
 * tool-call count.
 *
 * @param row the row to render
 * @returns the human-readable line
 */
export function renderSessionWatchRow({ row }: { row: SessionWatchRow }): string {
  const { name, detail } = sessionWatchRowParts({ row });
  return `${row.signal}\t${name}\t${detail}\t${String(row.toolCalls)} tool call(s)`;
}

/**
 * How long an unmapped row stays reportable before it collapses into the suppressed count.
 *
 * One hour, and the number is the owner's ruling (option B on the buried-watch card,
 * `session-watch-reports-173-dead-worktrees-and-one-live-workspace`) rather than a tuned constant. It is the
 * window in which `mapped: false` still means what `skills/supervisor/reference/stuck-chats.md` says it
 * means — a workspace that has just closed, or one missing from a single inventory read — as opposed to a
 * worktree that died days ago. MEASURED on the fleet that forced the ruling (repro: `slopweaver session
 * watch --idle-minutes 10 --json` joined to `slopweaver cmux list --json` on `workspaceId`): of 411 rows,
 * 385 were unmapped and NONE of those 385 was a live workspace, so an hour kept 31 rows and 10 `needs-input`
 * where the unfiltered report had 411 and 212.
 */
export const STALE_UNMAPPED_AFTER_MS = 60 * 60_000;

/**
 * The document `session watch --json-report` prints: the rows, what was collapsed out of them, and when.
 *
 * A second machine shape beside `--json`'s bare row array rather than a change to it, because callers join
 * that array to `cmux list --json` as it stands. This one exists for a consumer that must RECORD the reading
 * — `supervisor tick-draft` — and so needs the suppressed count, which `--json` sends to stderr, and the
 * instant, which a redirected file does not otherwise carry. `suppressedOldestQuietMinutes` is `null` rather
 * than omitted when nothing was collapsed, so the key is present in every document.
 *
 * `diagnostics` carries what the drain KNOWS it could not see — a cmux inventory that would not read, an
 * event cursor that had aged out of the retained buffer — because both are printed to stderr and a redirected
 * document without them is indistinguishable from a complete read: `{rows: [], suppressed: 0}` reads as a
 * quiet fleet either way. A recorder takes a non-empty list as a partial reading rather than a clean one.
 *
 * @param report the rows to print and what was collapsed out of them
 * @param observedAtIso the instant the rows were judged at
 * @param diagnostics what this drain could not see, each in the words it reported
 * @returns the document to serialise
 */
export function sessionWatchReportDocument({
  report,
  observedAtIso,
  diagnostics,
}: {
  report: SessionWatchReport;
  observedAtIso: string;
  diagnostics: readonly string[];
}): {
  readonly observedAtIso: string;
  readonly rows: readonly SessionWatchRow[];
  readonly suppressed: number;
  readonly suppressedOldestQuietMinutes: number | null;
  readonly diagnostics: readonly string[];
} {
  return {
    diagnostics,
    observedAtIso,
    rows: report.rows,
    suppressed: report.suppressed,
    suppressedOldestQuietMinutes: oldestSuppressedOrNull({ minutes: report.suppressedOldestQuietMinutes }),
  };
}

/** The oldest suppressed row's quiet minutes for the document, whose key is present even when nothing collapsed. */
function oldestSuppressedOrNull({ minutes }: { minutes: number | undefined }): number | null {
  if (minutes === undefined) {
    return null;
  }
  return minutes;
}

/** The rows a watch reports, and what it collapsed to get there. */
export interface SessionWatchReport {
  /** The rows to render, in the order `sessionWatchRows` produced them. */
  readonly rows: readonly SessionWatchRow[];
  /** How many stale unmapped rows were collapsed out of `rows`. */
  readonly suppressed: number;
  /** The longest any suppressed row had been quiet, or `undefined` when none was suppressed. */
  readonly suppressedOldestQuietMinutes: number | undefined;
}

/**
 * Collapse the stale unmapped rows out of a report, keeping every row a supervisor can still act on.
 *
 * Three properties, and each is the rule rather than a detail:
 *
 * - **A `mapped` row is NEVER suppressed**, however quiet. Liveness is what the supervisor is reading for,
 *   and on the fleet that forced this every live workspace was mapped, so nothing live is reachable by the
 *   age test at all.
 * - **A fresh unmapped row is never suppressed either**, which is what keeps
 *   `skills/supervisor/reference/stuck-chats.md`'s ruling intact: a workspace that closed moments ago is the
 *   interesting case, and only age separates it from a corpse.
 * - **Nothing is suppressed when the inventory could not be READ.** `inventoryRead: false` reports
 *   everything, because a failed cmux read marks every row unmapped and an age test over that would blank
 *   the whole gauge on one socket hiccup — a check that cannot fail reporting clean.
 *
 * @param rows the joined rows to filter
 * @param staleAfterMs how long an unmapped row may be quiet before it collapses
 * @param inventoryRead whether the cmux inventory was read at all, as opposed to having failed
 * @param includeStale whether the caller asked to see the collapsed rows anyway
 * @returns the rows to render and the count collapsed out of them
 */
export function reportedSessionWatchRows({
  rows,
  staleAfterMs,
  inventoryRead,
  includeStale = false,
}: {
  rows: readonly SessionWatchRow[];
  staleAfterMs: number;
  inventoryRead: boolean;
  includeStale?: boolean;
}): SessionWatchReport {
  if (!inventoryRead || includeStale) {
    return { rows, suppressed: 0, suppressedOldestQuietMinutes: undefined };
  }
  const staleAfterMinutes = staleAfterMs / 60_000;
  const stale = rows.filter((row) => !row.mapped && row.quietMinutes >= staleAfterMinutes);
  const quietest = stale.reduce((longest, row) => Math.max(longest, row.quietMinutes), 0);
  return {
    rows: rows.filter((row) => row.mapped || row.quietMinutes < staleAfterMinutes),
    suppressed: stale.length,
    suppressedOldestQuietMinutes: stale.length === 0 ? undefined : quietest,
  };
}

/**
 * The one line that stands for every row a report collapsed, or `undefined` when it collapsed none.
 *
 * The count is printed rather than dropped on purpose: a supervisor has to be able to see that the gauge
 * chose not to show it something, and to get it back in one flag.
 *
 * @param report the report to describe
 * @returns the summary line, or `undefined` when nothing was suppressed
 */
export function renderSuppressedSessionWatchRows({ report }: { report: SessionWatchReport }): string | undefined {
  if (report.suppressed === 0) {
    return undefined;
  }
  const oldest = absentAsNumber({ value: report.suppressedOldestQuietMinutes, whenAbsent: 0 });
  return `suppressed\t${String(report.suppressed)} unmapped row(s) quiet over an hour, oldest ${String(oldest)}m — closed workspaces the fold still remembers; \`--include-stale\` to see them`;
}
