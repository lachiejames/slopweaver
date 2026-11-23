/**
 * The decisions `handover park` makes before it writes anything — which live seat it is closing, and whether
 * that seat may be closed now. Pure: the workspace list, the screen and the run's own facts in, a verdict out;
 * `../cli/commands/handover/parkRun.ts` owns the socket, the journal append and the close.
 *
 * ## Which seat — three keys, and never a guess
 *
 * A named `--workspace` (ref or id) wins, provided it stands in the writer's worktree when one was recorded.
 * Otherwise the seat is the one live workspace standing in that worktree, which is how the chair parks a seat
 * it is not sitting in and how a seat parks itself. Only when the writer recorded NO worktree is it the
 * caller's OWN workspace (`CMUX_WORKSPACE_ID`, never cmux's focus — `../cli/commands/cmux/run.ts` has the wrong
 * write that measured the difference). Two workspaces in the writer's worktree is an ambiguity this refuses
 * rather than resolves: closing the wrong one ends a seat that was working.
 *
 * ## Whether now
 *
 * The pinned workspace is the chair, and cmux will not close it either. A FOREIGN seat whose screen shows a
 * running turn or a line queued behind one is mid-thought, and closing it loses the thought — the same
 * reading `../sessions/closeDone.ts` takes before any close. The caller's own seat is exempt from the running-turn
 * read by construction: it is running THIS command, so its screen is busy for the one reason that does not count.
 * A line QUEUED behind that turn is not that reason: it is input addressed to the seat — the chair's relay, a
 * reseat's brief — and closing the seat drops it unread. MEASURED: a seat reseated barely a minute earlier re-ran
 * its pre-reseat `handover park --wake-at` with the chair's relay queued in its composer, and closed itself over it. So an own seat showing a queued line is refused like a foreign one, behind the same hatch.
 * "Own" is read off the caller's `CMUX_WORKSPACE_ID`, which cmux sets and the caller's environment could
 * override. That is trusted on purpose: whoever can set it can set `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT` too, so
 * it opens nothing the hatch does not.
 *
 * Any other foreign seat closes only on POSITIVE proof of rest, and that proof has two halves. The run's holder
 * recorded a real host — `claude-code` or `codex`, both of whose running turns this repo can read. Its screen then classifies `idle` under THAT host's own patterns
 * (`../cmux/turnState.ts`): the host's composer at the bottom, with no running marker, queued line or background
 * work. Screen text alone is never enough, because another host can print the same words as its own output, so the host is the journal's, never guessed off the screen. The residue is
 * stated rather than discovered: a different program standing in a held run's tree and printing that host's
 * exact composer as its last lines would read as at rest.
 */

import { type BackgroundWork, backgroundWorkOf } from "../cmux/backgroundWork.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import {
  hostShowsQueuedMessage,
  hostShowsRunningTurn,
  screenShowsQueuedMessage,
  screenShowsRunningTurn,
} from "../cmux/turnBusy.js";
import { classifyTurnScreen } from "../cmux/turnState.js";
import { err, ok, type Result } from "../lib/result.js";
import type { SupervisorHost } from "../supervisor/session.js";
import { worktreePathKey } from "../worktree/location.js";
import { currentCycle, type ParsedLedger, type RunEvent } from "./ledger.js";
import { activeParkedCheckpoint } from "./parked.js";
import { type RunWriter, runOwnership, writerOf } from "./runOwner.js";
import { ownershipAmbiguousLines } from "./unknownKind.js";

/** No live workspace answers to the seat being parked. */
export interface ParkSeatNotFoundError {
  readonly code: "SEAT_NOT_FOUND";
  readonly message: string;
}

/** More than one live workspace sits in the writer's worktree, so which one is the seat is not knowable. */
export interface ParkSeatAmbiguousError {
  readonly code: "SEAT_AMBIGUOUS";
  readonly message: string;
  readonly workspaceRefs: readonly string[];
}

/** The workspace `--workspace` named does not stand in the run's worktree, so it is not this run's seat. */
export interface ParkSeatOutsideRunError {
  readonly code: "SEAT_OUTSIDE_RUN";
  readonly message: string;
  readonly workspaceRef: string;
}

/** Why `handover park` could not pick the seat it is closing. */
export type ParkSeatError = ParkSeatNotFoundError | ParkSeatAmbiguousError | ParkSeatOutsideRunError;

export const ParkSeatErrors = {
  ambiguous: ({
    worktree,
    workspaceRefs,
  }: {
    worktree: string;
    workspaceRefs: readonly string[];
  }): ParkSeatAmbiguousError => ({
    code: "SEAT_AMBIGUOUS",
    message:
      `${String(workspaceRefs.length)} live workspaces sit in ${worktree} (${workspaceRefs.join(", ")}) — ` +
      "name the seat with --workspace <ref>",
    workspaceRefs,
  }),
  notFound: ({ detail }: { detail: string }): ParkSeatNotFoundError => ({
    code: "SEAT_NOT_FOUND",
    message: `no live seat to park: ${detail}`,
  }),
  outsideRun: ({ workspaceRef, worktree }: { workspaceRef: string; worktree: string }): ParkSeatOutsideRunError => ({
    code: "SEAT_OUTSIDE_RUN",
    message: `${workspaceRef} does not stand in this run's worktree ${worktree}, so it is not this run's seat`,
    workspaceRef,
  }),
} as const;

/**
 * The live workspace `handover park` is closing.
 *
 * @param requested the `--workspace` ref or id, when one was named
 * @param callerWorkspaceId the caller's own `CMUX_WORKSPACE_ID`, when it runs inside cmux
 * @param writerWorktree the worktree the run's writer recorded, when it recorded one
 * @param workspaces every live workspace, already read
 * @returns the workspace, or why none could be chosen
 */
export function selectParkWorkspace({
  requested,
  callerWorkspaceId,
  writerWorktree,
  workspaces,
}: {
  requested: string | undefined;
  callerWorkspaceId: string | undefined;
  writerWorktree: string | undefined;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Result<CmuxWorkspaceSummary, ParkSeatError> {
  if (requested !== undefined) {
    return namedParkWorkspace({ callerWorkspaceId, requested, workspaces, writerWorktree });
  }
  if (writerWorktree !== undefined) {
    return onTreeParkWorkspace({ workspaces, writerWorktree });
  }
  const own = workspaces.find((ws) => callerWorkspaceId !== undefined && ws.workspaceId === callerWorkspaceId);
  if (own !== undefined) {
    return ok(own);
  }
  return err(
    ParkSeatErrors.notFound({
      detail:
        "the run's writer recorded no worktree and this command is not running in a cmux workspace — pass --workspace",
    }),
  );
}

/**
 * The seat `--workspace` names, provided it is one of the run's. A name picks AMONG the run's seats, never
 * outside them: an idle seat in another tree passed every other check and was closed under this run's park.
 */
function namedParkWorkspace({
  requested,
  callerWorkspaceId,
  writerWorktree,
  workspaces,
}: {
  requested: string;
  callerWorkspaceId: string | undefined;
  writerWorktree: string | undefined;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Result<CmuxWorkspaceSummary, ParkSeatError> {
  const named = workspaces.find((ws) => ws.workspaceRef === requested || ws.workspaceId === requested);
  if (named === undefined) {
    return err(ParkSeatErrors.notFound({ detail: `--workspace ${requested} names no live workspace` }));
  }
  if (writerWorktree === undefined) {
    // Nothing to check the name against, so only the caller's own seat is provably this run's.
    return named.workspaceId === callerWorkspaceId
      ? ok(named)
      : err(ParkSeatErrors.notFound({ detail: `this run recorded no worktree to check ${requested} against` }));
  }
  if (!standsIn({ directory: named.currentDirectory, tree: writerWorktree })) {
    return err(ParkSeatErrors.outsideRun({ workspaceRef: named.workspaceRef, worktree: writerWorktree }));
  }
  return ok(named);
}

/** The one seat standing in the run's recorded tree, when no `--workspace` named one. */
function onTreeParkWorkspace({
  writerWorktree,
  workspaces,
}: {
  writerWorktree: string;
  workspaces: readonly CmuxWorkspaceSummary[];
}): Result<CmuxWorkspaceSummary, ParkSeatError> {
  const onTree = workspaces.filter((ws) => standsIn({ directory: ws.currentDirectory, tree: writerWorktree }));
  if (onTree.length > 1) {
    return err(
      ParkSeatErrors.ambiguous({ workspaceRefs: onTree.map((ws) => ws.workspaceRef), worktree: writerWorktree }),
    );
  }
  const only = onTree[0];
  if (only !== undefined) {
    return ok(only);
  }
  // No seat stands in the run's tree, so none is this run's — the caller's own included: falling back to it
  // closed an unrelated seat under this run's park.
  return err(
    ParkSeatErrors.notFound({ detail: `no live workspace sits in ${writerWorktree} — the run's seat is gone` }),
  );
}

/**
 * Whether a workspace's directory stands in a worktree: at its root or anywhere beneath it, in any of the
 * spellings {@link worktreePathKey} folds. An exact match let a seat opened in `<tree>/apps/web` escape the
 * ambiguity check, so the chair closed the OTHER seat in that tree.
 *
 * @param directory the workspace's current directory
 * @param tree the worktree the run's writer recorded
 * @returns whether the directory is the tree or inside it
 */
export function standsIn({ directory, tree }: { directory: string; tree: string }): boolean {
  const dir = worktreePathKey({ path: directory });
  const root = worktreePathKey({ path: tree });
  return dir === root || dir.startsWith(`${root}/`);
}

/**
 * The worktree a parked event names: the writer's recorded tree when the seat stands in it, so a seat opened
 * in a subdirectory still records the tree the reseat reopens; otherwise the seat's own directory.
 *
 * @param seat the workspace being parked
 * @param writerWorktree the worktree the run's writer recorded, when it recorded one
 * @returns the worktree to journal
 */
export function parkedWorktree({
  seat,
  writerWorktree,
}: {
  seat: CmuxWorkspaceSummary;
  writerWorktree: string | undefined;
}): string {
  if (writerWorktree !== undefined && standsIn({ directory: seat.currentDirectory, tree: writerWorktree })) {
    return writerWorktree;
  }
  return seat.currentDirectory;
}

/**
 * The session a park names: the run's writer, else — on a released run that is not parked now — the session
 * that released it. The second case is a reseat that never claimed: `cmux spawn` opened a seat in the tree and
 * that seat's older build could not decode the journal to claim it.
 * Naming the releasing session keeps the run released, since a park only releases the writer it names.
 *
 * @param events the run journal's events, in order
 * @returns the session and its worktree, or `undefined` when nothing holds the run or it is parked now
 */
export function parkHolder({ events }: { events: readonly RunEvent[] }): RunWriter | undefined {
  const ownership = runOwnership({ events, sessionId: undefined });
  if (ownership.kind === "unowned") {
    return undefined;
  }
  if (ownership.kind === "released") {
    return activeParkedCheckpoint({ events }) === undefined ? ownership.writer : undefined;
  }
  return ownership.writer;
}

/**
 * The host the idle proof may trust: the CURRENT writer's, never the releasing session's {@link parkHolder}
 * falls back to. A reseat that never claimed recorded no host of its own, so the seat on screen may be any
 * program, and a released writer's historical `claude-code` proves nothing about it.
 *
 * @param events the run journal's events, in order
 * @returns the host the current writer recorded, or `undefined` when no session holds the run now
 */
export function parkSeatHost({ events }: { events: readonly RunEvent[] }): SupervisorHost | undefined {
  return writerOf({ events })?.host;
}

/**
 * Why the journal, re-read right before the append, no longer supports the park its first read decided — or
 * `undefined` when it still does. A line that arrived undecodable since may be a claim by another host, which
 * hides the current writer from this build entirely; lines the first read already
 * proceeded over, under the stale-journal hatch, are not new. The holder, its host AND the run's tree must all
 * still be what the seat was chosen against: the same session reclaiming from another tree leaves the chosen
 * seat outside the run.
 *
 * @param journal the journal as re-read right before the append
 * @param planned the holder's session, host and run tree the seat was chosen and judged against
 * @param ambiguousLines the ownership-ambiguous line numbers the first read already proceeded over
 * @returns the reason the park must stop, or `undefined` when it may append
 */
export function journalMovedReason({
  ambiguousLines,
  journal,
  planned,
}: {
  ambiguousLines: readonly number[];
  journal: ParsedLedger;
  planned: {
    readonly runTree: string | undefined;
    readonly seatHost: SupervisorHost | undefined;
    readonly sessionId: string;
  };
}): string | undefined {
  const known = new Set(ambiguousLines);
  const arrived = ownershipAmbiguousLines({ journal }).filter((line) => !known.has(line));
  if (arrived.length > 0) {
    return `journal line(s) ${arrived.join(", ")} arrived undecodable after the seat was read, so its writer cannot be proven — pull and run park again`;
  }
  const { events } = journal;
  const holder = parkHolder({ events });
  const moved = "the run's holder, its host or its tree changed after its seat was read — run park again";
  if (holder === undefined || holder.sessionId !== planned.sessionId) {
    return moved;
  }
  if (parkSeatHost({ events }) !== planned.seatHost || parkRunTree({ events, holder }) !== planned.runTree) {
    return moved;
  }
  return undefined;
}

/**
 * The worktree a park checks seats against: the holder's own, else the last one this cycle's journal recorded
 * for a seat — a `launched` or `parked` event. A writer that RESUMED under a new session records no worktree,
 * so without the journal's own record every resumed run would leave nothing to check a seat against.
 *
 * @param events the run journal's events, in order
 * @param holder the session {@link parkHolder} named
 * @returns the worktree, or `undefined` when the journal recorded none
 */
export function parkRunTree({
  events,
  holder,
}: {
  events: readonly RunEvent[];
  holder: RunWriter;
}): string | undefined {
  if (holder.worktree !== undefined) {
    return holder.worktree;
  }
  const recorded = currentCycle({ events })
    .map((event) => (event.kind === "launched" || event.kind === "parked" ? event.worktree : undefined))
    .filter((worktree): worktree is string => worktree !== undefined);
  return recorded.at(-1);
}

/**
 * Why the chosen seat may not be closed now — the pinned chair, a foreign seat mid-turn, or a foreign seat
 * whose screen does not prove it is at rest.
 */
export type ParkSeatRefusal =
  | { readonly kind: "pinned" }
  | { readonly kind: "mid-turn"; readonly queued: boolean }
  /** A background shell or Monitor still runs and will wake the seat — not parked. */
  | { readonly kind: "background-work"; readonly work: BackgroundWork }
  | { readonly kind: "unreadable" };

/**
 * Whether the chosen seat may be closed now.
 *
 * @param target the workspace chosen by {@link selectParkWorkspace}
 * @param callerWorkspaceId the caller's own `CMUX_WORKSPACE_ID`; a seat parking itself is read only for a queued line
 * @param screen the seat's screen as just read
 * @param holderHost the host the run's holder recorded at `start` or `claim`; a `claude-code` or `codex` seat's
 *   screen is read for a running turn, a queued line and rest under that host's own patterns only, so text in
 *   one host's shape printed inside the other's transcript changes nothing, and an `explicit` holder or a
 *   journal too old to record one is read busy by either host's marker and never at rest
 * @returns the refusal, or `undefined` when the seat may be closed
 */
export function parkSeatRefusal({
  target,
  callerWorkspaceId,
  holderHost,
  screen,
}: {
  target: CmuxWorkspaceSummary;
  callerWorkspaceId: string | undefined;
  holderHost: SupervisorHost | undefined;
  screen: string;
}): ParkSeatRefusal | undefined {
  if (target.pinned) {
    return { kind: "pinned" };
  }
  const known = holderHost === "claude-code" || holderHost === "codex" ? holderHost : undefined;
  const queued =
    known === undefined ? screenShowsQueuedMessage({ screen }) : hostShowsQueuedMessage({ host: known, screen });
  if (target.workspaceId === callerWorkspaceId) {
    // Its own running turn is this park; a line queued behind it is input addressed to the seat, lost on close.
    return queued ? { kind: "mid-turn", queued: true } : undefined;
  }
  const running =
    known === undefined ? screenShowsRunningTurn({ screen }) : hostShowsRunningTurn({ host: known, screen });
  if (running || queued) {
    return { kind: "mid-turn", queued };
  }
  const work = backgroundWorkOf({ host: known, screen });
  if (work !== undefined && work.shells + work.monitors > 0) {
    return { kind: "background-work", work };
  }
  if (holderHost === undefined || holderHost === "explicit") {
    return { kind: "unreadable" };
  }
  return classifyTurnScreen({ host: holderHost, screen }) === "idle" ? undefined : { kind: "unreadable" };
}

/**
 * How park closes the seat it chose, now cmux 0.65.2 refuses any workspace with a live process unforced
 * (`confirmation_required`). `force`: the seat is the caller's own — the parking session IS that process, its
 * checkpoint already journalled, and closing itself is the act park exists for — or the park hatch already
 * overrode a running turn. `bounded`: a foreign seat, closed unforced and forced once only on a fresh screen
 * proving Claude Code or Codex idle (`../sessions/closeForce.ts`). MEASURED: parking a seat from
 * inside it journalled `parked` and left the seat open, because the close carried no force.
 */
export type ParkCloseMode = "force" | "bounded";

/**
 * Which close park takes for the seat it chose.
 *
 * @param own whether the seat is the caller's own workspace
 * @param hatchForced whether `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT` let a running seat through
 * @returns `force` for its own seat or a hatch-forced one, otherwise `bounded`
 */
export function parkCloseMode({ own, hatchForced }: { own: boolean; hatchForced: boolean }): ParkCloseMode {
  return own || hatchForced ? "force" : "bounded";
}

/**
 * What a busy-or-unknown refusal says the seat's screen shows, for the hatch refusal's detail line.
 *
 * @param refusal a refusal the escape hatch can override
 * @returns the phrase completing "<ref> shows …"
 */
export function refusalShows({ refusal }: { refusal: Exclude<ParkSeatRefusal, { kind: "pinned" }> }): string {
  if (refusal.kind === "unreadable") {
    return "nothing this repo can read as at rest (a run held by no recorded Claude Code or Codex host, or that host's own composer not last on its screen), so it may be working";
  }
  if (refusal.kind === "background-work") {
    return `${String(refusal.work.shells)} background shell(s) and ${String(refusal.work.monitors)} Monitor(s) still running, which will wake it`;
  }
  return refusal.queued ? "a line queued behind a running turn" : "a running turn";
}
