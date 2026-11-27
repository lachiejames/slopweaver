/**
 * The cold half of a recovery pass's worker reading: which reopened bare shells `./resumeRun.ts` resumes on their saved
 * session, which it refuses, and which it hands to the standing supervisor to find out — with the one line naming
 * every one of those.
 *
 * A tab that is a bare shell, paired to an OPEN ledger row BY ITS WORKTREE, with a saved session cmux kept for it, is
 * recovered beside the walled ones (`../../../sessions/coldSeat.ts`). One whose transcript is gone is refused
 * `NO_RESUMABLE_SESSION`. One with no saved session at all, one whose saved session is live in another tab, one whose
 * row names no worktree, or whose worktree another tab shares (`pairingGuess`) is handed to the standing supervisor,
 * never typed into and never fresh-spawned. So is a bare shell in any open row's worktree that no open row paired to
 * (`unclaimedWorktreeTabs`).
 */
import { dirname } from "node:path";

import { directoryKey } from "#lib/sameDirectory.js";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { pairRowsToWorkspaces, sameWorktree } from "../../../sessions/closeDone.js";
import type { ColdSeatVerdict, NotColdReason } from "../../../sessions/coldSeat.js";
import type { ReseatWall } from "../../../sessions/reseat.js";
import { ReseatErrors } from "../../../sessions/reseatErrors.js";
import type { SessionItem } from "../../../sessions/session.js";
import { judgeWorkspaceCold } from "../cmux/reseatCold.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";
import { type PassState, refuseSeat } from "./resumePassState.js";

/** A bare-shell seat this pass would not type into, and why — handed to the caught-up supervisor. */
export interface UnresumedSeat {
  readonly workspace: CmuxWorkspaceSummary;
  readonly why: string;
}

/** Why a cold tab paired on its `workspace:N` alone is not typed into. */
const REF_ONLY_PAIRING = "its ledger row names no worktree, so it paired on a ref cmux reissues on reopen";

/** Why a cold tab sharing its worktree with another tab is not typed into. */
const SHARED_WORKTREE = "another tab is open in the same worktree, so which one is this row's seat would be a guess";

/** Why a cold tab in an open row's worktree that no open row paired to is not typed into. */
const UNCLAIMED_TAB =
  "it is in an open ledger row's worktree but no open row paired to it, so which seat it is is unknown";

/** Why an unclaimed bare shell whose saved session already runs in another tab is named rather than passed over. */
const UNCLAIMED_LIVE_ELSEWHERE =
  "no open row paired to it and its saved session is already live in another tab, so it may be a stale duplicate";

/** Why an unclaimed bare shell nothing saved a session for is named: it may be a seat cmux kept no session for. */
const UNCLAIMED_NO_SESSION =
  "a bare shell in an open ledger row's worktree with no saved session and no open row paired to it, so nothing resumes it";

/** Why a tab with nothing running in it is named: its shell had not started, or had exited, when it was read. */
const NO_PROCESS =
  "nothing was running in it when read — its shell had not started or had exited — so nothing was typed";

/** Why a tab whose one childless process is no shell this pass knows, holding a saved session, is named. */
const UNRECOGNISED_PROMPT =
  "one childless process it does not know as a shell holds a saved session, so nothing was typed into it";

/** Why the tab this pass runs in, when it is a worker's seat, is named rather than resumed. */
const OWN_TAB = "this pass runs in it, so it cannot be resumed from here — resume it once the pass has ended";

/**
 * The tab this pass runs in, when it is one of a worker's candidate tabs: typing into it would land in this pass, and
 * passing over it in silence would leave a seat with no outcome. It is named only when cmux saved a
 * session for it, so the fresh tab the desktop opens in the main checkout is not named on every pass.
 *
 * @param ownWorkspaceId the workspace this pass runs in, when it runs in cmux
 * @param tabs every tab paired to an open row or in an open row's worktree
 * @returns that tab, or `undefined`
 */
export function ownSeatTab({
  ownWorkspaceId,
  tabs,
}: {
  ownWorkspaceId: string | undefined;
  tabs: readonly CmuxWorkspaceSummary[];
}): CmuxWorkspaceSummary | undefined {
  return tabs.find((tab) => tab.workspaceId === ownWorkspaceId);
}

/** The line a paired tab that is not cold, and not for the supervisor, prints instead of passing silently. */
const NOT_COLD_LINES: Readonly<Record<string, string>> = {
  "not-a-bare-shell":
    "not resumed — something other than one shell at its prompt is running in it; once the tab shows a prompt, run `slopweaver fleet resume` again or `slopweaver cmux reseat <ws>` from a different cmux workspace (another entry in the sidebar)",
  "split-surfaces":
    "not resumed — the workspace holds more than one tab (surface), and a typed line would reach only the selected one; close the extra tabs until one is left, then run `slopweaver fleet resume` again or `slopweaver cmux reseat <ws>` from a different cmux workspace (another entry in the sidebar)",
};

/**
 * Why a paired tab that is not cold goes to the supervisor: a bare shell nothing saved a session for, or one whose
 * saved session already runs in another tab — either way a bare shell where the row's seat should be —
 * or a lone process no shell this pass knows holding a saved session. A tab running a live session or
 * some other program is not handed over.
 *
 * @param why the cold-seat judge's reason
 * @returns the reason to name it to the supervisor, or `undefined` to pass it over
 */
export function pairedNotColdReason({ why }: { why: NotColdReason }): string | undefined {
  if (why === "no-saved-session") {
    return "no saved session";
  }
  if (why === "live-elsewhere") {
    return "its saved session is already live in another tab, so this bare shell may be a stale duplicate";
  }
  if (why === "unrecognised-prompt") {
    return UNRECOGNISED_PROMPT;
  }
  if (why === "no-process") {
    return NO_PROCESS;
  }
  return undefined;
}

/** A cold seat to resume: its tab and the saved session it resumes on. */
interface ColdWorker {
  readonly workspace: CmuxWorkspaceSummary;
  readonly sessionId: string;
}

/** The pass's own tab, named when cmux saved a session for it and it is not the chair's. */
async function ownTabUnresumed({
  deps,
  own,
  chairWorkspaceId,
}: {
  deps: ReseatDeps;
  own: CmuxWorkspaceSummary | undefined;
  chairWorkspaceId: string | undefined;
}): Promise<UnresumedSeat | undefined> {
  if (own === undefined || own.workspaceId === chairWorkspaceId) {
    return undefined;
  }
  const binding = await deps.client.readResumeBinding({ workspaceId: own.workspaceId });
  if (binding.isErr()) {
    return { why: `not read — ${binding.error.message}`, workspace: own };
  }
  if (binding.value === undefined) {
    return undefined;
  }
  return { why: OWN_TAB, workspace: own };
}

/** An unclaimed tab in an open row's worktree, named for the supervisor when it is any kind of bare shell. */
async function unclaimedUnresumed({
  deps,
  workspace,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
}): Promise<UnresumedSeat | undefined> {
  const judged = await judgeWorkspaceCold({ deps, pinnedSessionId: undefined, workspace });
  if (judged.isErr()) {
    return { why: `not read — ${judged.error.message}`, workspace };
  }
  const why = unclaimedTabReason({ verdict: judged.value });
  if (why === undefined) {
    return undefined;
  }
  return { why, workspace };
}

/**
 * One paired tab's outcome: a cold seat to resume, a seat named for the supervisor, or nothing — with a gone
 * transcript refused and a running program's line printed on the pass as it is read.
 */
async function pairedOutcome({
  state,
  deps,
  row,
  workspace,
  workspaces,
}: {
  state: PassState;
  deps: ReseatDeps;
  row: SessionItem;
  workspace: CmuxWorkspaceSummary;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<{ readonly cold: ColdWorker } | { readonly unresumed: UnresumedSeat } | undefined> {
  const judged = await judgeWorkspaceCold({ deps, pinnedSessionId: undefined, workspace });
  if (judged.isErr()) {
    return { unresumed: { why: `not read — ${judged.error.message}`, workspace } };
  }
  const verdict = judged.value;
  if (verdict.kind === "not-cold") {
    const line = NOT_COLD_LINES[verdict.why];
    if (line !== undefined) {
      state.lines.push(`${workspace.workspaceRef}\t${line}`);
    }
    const why = pairedNotColdReason({ why: verdict.why });
    return why === undefined ? undefined : { unresumed: { why, workspace } };
  }
  const guess = pairingGuess({ rowCwd: row.cwd, workspaces });
  if (guess !== undefined) {
    return { unresumed: { why: guess, workspace } };
  }
  if (verdict.kind === "cold") {
    return { cold: { sessionId: verdict.sessionId, workspace } };
  }
  const workspaceRef = workspace.workspaceRef;
  const error = ReseatErrors.noResumableSession({ cwd: verdict.cwd, sessionId: verdict.sessionId, workspaceRef });
  await refuseSeat({
    refusal: { code: error.code, message: error.message, workspaceRef },
    role: "worker",
    sessionId: verdict.sessionId,
    state,
  });
  return undefined;
}

/**
 * The cold workers: tabs that are bare shells, paired to an OPEN ledger row by its worktree, never walled, the chair
 * or this pass's own. A cold one is returned to recover; one whose transcript is gone is refused here; one with no
 * saved session, one whose saved session is live in another tab, paired on its ref alone, sharing its worktree with another tab, or in an open row's worktree with no
 * open row paired to it is named for the supervisor to find out. Pairing takes the first unclaimed tab in a worktree
 * and a ledger row records no session id, so with two tabs there the resumed session could be a done seat's, typed
 * into the wrong tab: a guess is the supervisor's, never this pass's.
 *
 * @param state the pass to record a refusal on
 * @param deps the guarded reseat deps
 * @param rows the session ledger's rows
 * @param workspaces every workspace cmux lists
 * @param walls each walled workspace's wall
 * @param skip the chair's workspace and this pass's own
 * @param chairWorkspaceId the chair's workspace, when one stands
 * @returns the cold seats with their saved session, and the bare shells left for the supervisor with the reason
 */
export async function readColdWorkers({
  state,
  deps,
  rows,
  workspaces,
  walls,
  skip,
  chairWorkspaceId,
}: {
  state: PassState;
  deps: ReseatDeps;
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  walls: ReadonlyMap<string, ReseatWall>;
  skip: readonly (string | undefined)[];
  chairWorkspaceId: string | undefined;
}): Promise<{ readonly cold: readonly ColdWorker[]; readonly unresumed: readonly UnresumedSeat[] }> {
  const open = rows.filter((row) => row.status === "open");
  const paired = pairRowsToWorkspaces({ rows: open, workspaces });
  const cold: ColdWorker[] = [];
  const unresumed: UnresumedSeat[] = [];
  const passedOver = (workspace: CmuxWorkspaceSummary): boolean =>
    skip.includes(workspace.workspaceId) || walls.has(workspace.workspaceId);
  const unclaimed = unclaimedWorktreeTabs({ keyOf: directoryKey, open, paired, workspaces });
  const own = ownSeatTab({ ownWorkspaceId: deps.ownWorkspaceId, tabs: [...unclaimed, ...paired.values()] });
  const ownSeat = await ownTabUnresumed({ chairWorkspaceId, deps, own });
  if (ownSeat !== undefined) {
    unresumed.push(ownSeat);
  }
  for (const workspace of unclaimed.filter((tab) => !passedOver(tab))) {
    const seat = await unclaimedUnresumed({ deps, workspace });
    if (seat !== undefined) {
      unresumed.push(seat);
    }
  }
  for (const [row, workspace] of paired) {
    if (passedOver(workspace)) {
      continue;
    }
    const outcome = await pairedOutcome({ deps, row, state, workspace, workspaces });
    if (outcome !== undefined && "cold" in outcome) {
      cold.push(outcome.cold);
    } else if (outcome !== undefined) {
      unresumed.push(outcome.unresumed);
    }
  }
  return { cold, unresumed };
}

/**
 * The pass's own record of the bare-shell seats it would not type into, printed whether or not a chair is asked.
 *
 * @param chairStanding whether a supervisor stands to be sent the line
 * @param line the instruction naming every such seat
 * @returns the line for the pass's output
 */
export function unresumedPassLine({ chairStanding, line }: { chairStanding: boolean; line: string }): string {
  if (chairStanding) {
    return `supervisor\tasked to find out about these — ${line}`;
  }
  return `supervisor\tnone stands to find out about these — ${line}`;
}

/**
 * The seats still standing once cmux is listed again, after the walk: the workspace list is read once at the start of
 * the pass, so a tab closed while the walk ran is read as a failed read (`surface.resume.get (not_found)`) and would
 * otherwise be named as a seat nobody could read. MEASURED, one attempt: two workspaces,
 * closed by the chair minutes earlier on rows reading DONE, named exactly that way. A list that will not
 * read keeps every seat: one more name is the fail-safe direction.
 *
 * @param unresumed the seats the walk would name
 * @param relisted every workspace cmux lists now, or `undefined` when the list would not read
 * @returns the seats still listed, and the refs dropped as closed since
 */
export function stillListedSeats({
  unresumed,
  relisted,
}: {
  unresumed: readonly UnresumedSeat[];
  relisted: readonly CmuxWorkspaceSummary[] | undefined;
}): { readonly standing: readonly UnresumedSeat[]; readonly closed: readonly string[] } {
  if (relisted === undefined) {
    return { closed: [], standing: unresumed };
  }
  const listed = new Set(relisted.map((workspace) => workspace.workspaceId));
  return {
    closed: unresumed
      .filter((seat) => !listed.has(seat.workspace.workspaceId))
      .map((seat) => seat.workspace.workspaceRef),
    standing: unresumed.filter((seat) => listed.has(seat.workspace.workspaceId)),
  };
}

/**
 * The one line the caught-up supervisor gets for every bare-shell seat this pass would not type into.
 *
 * @param unresumed those seats, each with its reason
 * @returns the instruction
 */
export function unresumedSeatsLine({ unresumed }: { unresumed: readonly UnresumedSeat[] }): string {
  const named = unresumed.map((seat) => `${seat.workspace.workspaceRef} (${seat.why})`).join(", ");
  return (
    `fleet resume: ${named} — a bare shell paired to an open ledger row, not resumed. ` +
    "Find out what each was doing; never fresh-spawn one in its place without saying so."
  );
}

/**
 * The tabs no open row claimed that sit in ANY open row's worktree. cmux renumbers every tab on reopen, and a dispatch
 * row (no slug) pairs on its recorded ref alone, so its reopened tab pairs to nothing; and a second tab
 * in a worktree whose row paired to the first is never judged by pairing at all. Either would pass
 * silently. A tab counts as in a worktree when ANY ancestor of its directory, itself included, is the row's directory
 * as spelled or keys to the row's key, or when its own key sits under the row's: so a subdirectory, one
 * reached through a symlinked root, one under an interior link that resolves elsewhere, both at once
 *, and one reached through a link from outside all count. Which seat such a tab is cannot be said, so it is
 * never typed into.
 *
 * @param open the open ledger rows
 * @param paired each open row's paired tab
 * @param workspaces every workspace cmux lists
 * @param keyOf a directory's comparable key — its real path with the worktrees alias folded (`directoryKey`)
 * @returns each such tab once, in cmux's order
 */
export function unclaimedWorktreeTabs({
  open,
  paired,
  workspaces,
  keyOf,
}: {
  open: readonly SessionItem[];
  paired: ReadonlyMap<SessionItem, CmuxWorkspaceSummary>;
  workspaces: readonly CmuxWorkspaceSummary[];
  keyOf: (options: { readonly path: string }) => string;
}): readonly CmuxWorkspaceSummary[] {
  const claimed = new Set([...paired.values()].map((workspace) => workspace.workspaceId));
  const openDirs = open.flatMap((row) => (row.cwd === undefined ? [] : [row.cwd]));
  const dirs = new Set(openDirs.map((dir) => trimSlash({ path: dir })));
  const keys = new Set(openDirs.map((dir) => trimSlash({ path: keyOf({ path: dir }) })));
  return workspaces.filter((workspace) => {
    if (claimed.has(workspace.workspaceId)) {
      return false;
    }
    const tabDir = workspace.currentDirectory;
    const tabKey = trimSlash({ path: keyOf({ path: tabDir }) });
    return (
      openDirs.some((dir) => sameWorktree({ a: dir, b: tabDir })) ||
      ancestorsOf({ path: tabDir }).some(
        (ancestor) => dirs.has(ancestor) || keys.has(trimSlash({ path: keyOf({ path: ancestor }) })),
      ) ||
      [...keys].some((key) => tabKey.startsWith(`${key}/`))
    );
  });
}

/** `path` without a trailing slash, the root kept as `/`. */
function trimSlash({ path }: { path: string }): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

/** `path` and every directory above it, nearest first, as spelled. */
function ancestorsOf({ path }: { path: string }): readonly string[] {
  const ancestors = [trimSlash({ path })];
  for (let parent = dirname(ancestors[0]!); parent !== ancestors.at(-1); parent = dirname(parent)) {
    ancestors.push(parent);
  }
  return ancestors;
}

/**
 * Why an unclaimed tab in an open row's worktree goes to the supervisor: any bare shell — resumable, transcript gone,
 * already live in another tab, or holding no saved session at all — is named, never typed into, and so
 * is a lone process no shell this pass knows holding a saved session. A tab running something is not a
 * seat this pass can say anything about.
 *
 * @param verdict the tab's cold-seat verdict
 * @returns the reason to name it to the supervisor, or `undefined` to pass it over
 */
export function unclaimedTabReason({ verdict }: { verdict: ColdSeatVerdict }): string | undefined {
  if (verdict.kind !== "not-cold") {
    return UNCLAIMED_TAB;
  }
  if (verdict.why === "live-elsewhere") {
    return UNCLAIMED_LIVE_ELSEWHERE;
  }
  if (verdict.why === "unrecognised-prompt") {
    return UNRECOGNISED_PROMPT;
  }
  if (verdict.why === "no-saved-session") {
    return UNCLAIMED_NO_SESSION;
  }
  if (verdict.why === "no-process") {
    return NO_PROCESS;
  }
  return undefined;
}

/**
 * Why a cold tab's pairing to its ledger row is a guess rather than a fact: a row naming no worktree paired on a ref
 * cmux reissues on reopen, and a worktree two tabs share cannot say which one is the row's seat.
 *
 * @param rowCwd the worktree the open ledger row names, absent when it names only a ref
 * @param workspaces every workspace cmux lists
 * @returns the reason to hand the seat to the supervisor, or `undefined` when the pairing is the row's own tab
 */
export function pairingGuess({
  rowCwd,
  workspaces,
}: {
  rowCwd: string | undefined;
  workspaces: readonly CmuxWorkspaceSummary[];
}): string | undefined {
  if (rowCwd === undefined) {
    return REF_ONLY_PAIRING;
  }
  if (workspaces.filter((other) => sameWorktree({ a: rowCwd, b: other.currentDirectory })).length > 1) {
    return SHARED_WORKTREE;
  }
  return undefined;
}
