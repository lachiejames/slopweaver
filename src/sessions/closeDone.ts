/**
 * The done-chat sweep `slopweaver session close-done` runs — pure: which open ledger rows are DONE, which
 * of those are safe to close, and what the summary says. The CLI verb (`../cli/commands/session/closeDone.ts`)
 * owns the socket, the journal reads and the ledger writes.
 *
 * ## Why this is a verb and not a step the supervisor remembers
 *
 * The owner asked for done chats to be closed SIX times in twenty-four hours. Every supervisor knew the
 * rule and every one of them let finished workspaces sit: a step a session has to remember is a step the next
 * session re-derives, and a done chat left open holds a slot the fill step then declines to reuse
 * (`skills/supervisor/reference/stuck-chats.md`). Measured on the live fleet, the day this landed:
 * 57 ledger rows read `open` against 23 live workspaces, two live workspaces sat on asks already `answered`,
 * and one ref (`workspace:44`) carried two open rows from two different worktrees.
 *
 * ## What "done" means here — three checkable anchors, never a screen's say-so
 *
 * A row is done when its slug's run journal ENDED (`finished`/`abandoned` in the current cycle — the same
 * anchor `cmux takeover` reads for a predecessor). A doc-side anchor — an ask SETTLED (`settlement:` on the
 * doc) or a doc at a TERMINAL status (`done`/`cancelled`/`rejected`, the same docs `cmux spawn` refuses to
 * open) — counts only when that journal is NOT open: never started, or ended. **An open run is never closed,
 * whatever its doc says.** Measured, the first live run of this verb: `workspace:69`'s ask read
 * `settlement: answered` while its journal read `started … claimed` and the session was holding a merge lane
 * for a pull request the answer had produced; the verb closed it, and the supervisor had to respawn it. A
 * settled ask says the QUESTION is over, and only the journal says whether the SESSION is.
 *
 * A journal that was never started is not `run-closed` either: `runStateOf` reports `closed` for an empty
 * journal, so {@link doneEvidenceOf} distinguishes an ended cycle (at least one entry) from no cycle at all,
 * and a freshly spawned session that has not yet run `handover start` is never closed on the journal alone.
 *
 * ## What "safe to close" means — the row, the workspace, and the screen all agree
 *
 * A ledger row is paired with a live workspace by its `workspaceRef` AND its worktree, never by the ref
 * alone: cmux re-issues `workspace:N` refs after a restart, so a stale row can share a ref with a live
 * workspace running different work (measured: `workspace:83` carried a row for
 * `misjudged-severity-overridden` and one for the doc this module was written under) — and, the same
 * restart, a surviving workspace is live under a NEW ref with its directory unchanged, which is why an unpaired
 * row falls back to its worktree alone, against workspaces no exact match claimed. An open row with no live
 * workspace behind it either way is `drifted` — the workspace was closed outside `cmux close` — and only its
 * ledger row is closed.
 *
 * **The worktree fallback is for slug-backed rows only.** An ask worker and an answer reviewer deliberately
 * reuse their parent's checkout (`../cmux/plan.ts`'s `planAskSession`), so several of them share one
 * directory and a directory cannot say which. A dispatch child pairs on its exact ref or not at all.
 *
 * **Which workspace a slug-backed row's fallback reaches therefore CHANGES, in two directions, and both are
 * the point**. Where a dispatch row previously claimed a renumbered workspace
 * on the shared cwd, the real session sharing that checkout read `drifted` and had its ledger row retired
 * while its workspace ran on — it now gets that workspace. And where a CLOSED dispatch row was invisible, the
 * fallback took the workspace that dispatch child demonstrably IS and was kept for the wrong reason — the
 * identified row claims it now, and the fallback reaches the one nothing else claims. The fallback is a cwd
 * guess either way; what changed is that a row which can be identified exactly is no longer competing with it.
 *
 * ## The bot loop's own children — the turn is the anchor, not a doc
 *
 * An ask worker and an answer reviewer answer to no handover doc; they are keyed by their dispatch
 * coordinates (`../cmux/plan.ts`'s `dispatchSessionName`). This module used to keep every one of them on the
 * grounds that "its parent closes it" — which is true right up to the moment the parent does not. MEASURED
 * on the live fleet: 8 of 28 live workspaces were dispatch children of four asks that had all
 * reached `answered` hours earlier, three of them superseded rounds of ONE review. So a child is now judged
 * by its parent TURN: {@link dispatchDoneEvidence} reads the ask's own lifecycle log and answers whether the
 * turn is over — the answer posted (or the ask was withheld or triaged), the worker's lease expired, or the
 * worker's workspace is gone from cmux. Only then, and only on an idle screen, is the child closed.
 *
 * **A lease that has expired is the weakest of those three, and on its own it says nothing about a
 * REVIEWER.** A reviewer mid-verdict holds this verb off exactly as it holds `../live/turn/dispatch.ts`'s
 * sweep clock off, read through the one `../live/turn/reviewPosture.ts` and capped by the one
 * `../live/turn/leaseJudgement.ts` bound. {@link dispatchDoneEvidence} carries the measured turn that was
 * lost before it did.
 *
 * The session key is never parsed back into an ask: `dispatchSessionName` sanitises and truncates, so it is
 * not injective. Both names are derived FORWARD from every ask on the lifecycle log instead, and a key two
 * asks derive alike keeps the workspace rather than guessing which.
 *
 * ## Why a CLOSED row can still name a live workspace
 *
 * One key covers every ROUND of one ask's review, and only the last round's workspace is ever released —
 * so a ref-less `closed` event retired all four rows of the ask above while three of their workspaces ran
 * on. `../live/turn/sessionLedger.ts` now names the ref it closed, which stops that happening again; the
 * rows already folded closed are reached by considering a CLOSED dispatch row whose exact ref pairs to a
 * live workspace. EVERY dispatch pairing, open row or closed, is then confirmed against the workspace's own
 * cmux description, which carries the dispatch's full coordinates (`../cmux/plan.ts`'s
 * `dispatchWorkspaceName`) — a re-issued `workspace:N` ref proves nothing, and a workspace name does.
 *
 * A candidate is then closed only when its screen is IDLE — no running turn (`esc to interrupt`) and no line
 * queued behind one (`./turnBusy.ts`'s measured markers). A screen that could not be read keeps the row: the
 * expensive direction to be wrong in is closing a session mid-thought, and one more sweep tick is cheap.
 *
 * ## What is never closed
 *
 * The pinned workspace (the supervisor — cmux refuses anyway, and this refuses first), the caller's own
 * workspace, a row spawned within the last {@link BOOTING_GRACE_MS} (a respawn of the same slug reads its predecessor's finished journal
 * until its own `handover start` opens a new cycle), and any row whose run is still open or waiting on the
 * owner. Nothing here writes to a run journal: a run is another session's to finish or abandon.
 */
import { basename } from "node:path";

import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { dispatchSessionName, dispatchWorkspaceName } from "../cmux/planNames.js";
import { derivedRowState } from "../handover/derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus } from "../handover/doc.js";
import type { RunEvent, RunState } from "../handover/ledger.js";
import { type StandingSessionRuling, standingSessionHolds } from "../handover/standingSession.js";
import type { AskLifecycleEvent } from "../live/ask/lifecycle.js";
import type { ReviewPosture } from "../live/turn/leaseJudgement.js";
import { type DispatchChild, dispatchChildrenBySessionKey } from "./dispatchChildren.js";
import { type DoneEvidence, dispatchDoneEvidence, type WorkerWorkspaceState } from "./dispatchDoneEvidence.js";
import type { SessionItem } from "./session.js";

/**
 * How long after its spawn a row is treated as still booting, never as done.
 *
 * Two minutes: `cmux spawn`'s own pickup delivery already allows most of a minute for a cold boot, and the
 * spawned session's `handover start` — the write that reopens a finished journal — follows in its first
 * turn. Reproduce the boot bound with `grep -n "MAX_READY_PROMPT_POLLS" src/cmux/pickupDelivery.ts`.
 */
export const BOOTING_GRACE_MS = 2 * 60 * 1000;

/**
 * Whether a slug's run and doc say its work is over, and which of the three anchors says so.
 *
 * The run journal gates everything: an open or waiting run is never done, and a journal that could not be
 * read answers `undefined` rather than letting the doc decide alone.
 *
 * @param run the slug's derived run state, or `undefined` when its journal could not be read
 * @param doc the slug's board doc, or `undefined` when the board does not carry it
 * @returns the evidence, or `undefined` when nothing on disk says the work is done
 */
export function doneEvidenceOf({
  run,
  doc,
  events,
}: {
  run: RunState | undefined;
  doc: HandoverDoc | undefined;
  events: readonly RunEvent[];
}): DoneEvidence | undefined {
  if (run?.phase !== "closed") {
    return undefined;
  }
  if (run.entries > 0) {
    return { kind: "run-closed" };
  }
  // Both remaining anchors read the row's DERIVED state rather than its front-matter lines: a settlement now
  // arrives as a `settled` event, and a `status:` line is the row's declared intent rather than what happened
  // to it. `../handover/derivedRowState.ts` falls back to those lines for every row settled before that was
  // true, so this branch answers exactly as it did for the whole existing board.
  const derived = doc === undefined ? undefined : derivedRowState({ doc, events });
  if (derived?.settlement !== undefined) {
    return { kind: "ask-settled", settlement: derived.settlement };
  }
  if (derived !== undefined && isTerminalDocStatus(derived.status)) {
    return { kind: "doc-terminal", status: derived.status };
  }
  return undefined;
}

/** Why a row was left alone by the planning pass, before any screen was read. */
export type KeepReason =
  /** The row was registered by hand and names no workspace — not this sweep's to judge. */
  | "no-workspace"
  /** The row answers to no handover doc and to no ask on the lifecycle log — nothing here can judge it. */
  | "no-slug"
  /** A dispatch child whose parent bot turn is still running. */
  | "dispatch-open"
  /** Two asks derive this one session key, so which turn the row belongs to is ambiguous. */
  | "dispatch-key-ambiguous"
  /** The workspace this dispatch row's ref pairs to does not name this child — cmux re-issued the ref. */
  | "dispatch-ref-reused"
  /** The workspace is cmux's pinned one — the supervisor. */
  | "pinned"
  /** The workspace is the caller's own. */
  | "own-workspace"
  /** Spawned within {@link BOOTING_GRACE_MS} — booting, not done. */
  | "booting"
  /**
   * A run seat nothing calls done whose row carries the owner's STANDING-SESSION ruling, in force: its idle wait for the owner
   * is the intended state, never a park (`../handover/standingSession.ts`). A seat whose run IS
   * done still closes — a finished run is not between the owner's turns.
   */
  | "standing-session";

/** One open ledger row, placed by the planning pass. */
export type CloseDonePlanItem =
  /** Done on disk and live in cmux — close it, once its screen reads idle. */
  | {
      readonly kind: "candidate";
      readonly row: SessionItem;
      readonly workspace: CmuxWorkspaceSummary;
      readonly evidence: DoneEvidence;
    }
  /** Open on the ledger, but its workspace is gone from cmux — close the row only. */
  | { readonly kind: "drifted"; readonly row: SessionItem; readonly workspaceRef: string }
  /**
   * A run seat nothing on disk calls done — parked when it proves at rest, or else left working
   * (`./parkSeat.ts`).
   */
  | {
      readonly kind: "park-candidate";
      readonly row: SessionItem & { readonly slug: string };
      readonly workspace: CmuxWorkspaceSummary;
    }
  /** Left alone, and why. */
  | { readonly kind: "kept"; readonly row: SessionItem; readonly reason: KeepReason };

/**
 * Whether two directories name the same worktree — equal, or equal by basename across a symlinked root.
 *
 * @returns true when they do
 */
export function sameWorktree({ a, b }: { a: string; b: string }): boolean {
  return a === b || basename(a) === basename(b);
}

/**
 * Pair each considered row with the live workspace it was spawned into, each workspace claimed at most once.
 *
 * Two passes, in a deliberate order. The first pairs on the ref AND the worktree, the exact match. The second
 * pairs the rows still unpaired on the worktree alone, against workspaces nobody claimed: cmux re-numbers
 * every `workspace:N` when it restarts, so a row recorded as `workspace:1010` is live as `workspace:19` with
 * its directory unchanged (measured, eight rows). Rows are most-recent-first, so a re-spawn of the
 * same slug claims the live workspace ahead of the stale row it replaced, which then reads as drifted.
 *
 * The second pass takes SLUG-BACKED rows only. A dispatch child reuses its parent's checkout by design, so
 * several children of several asks share one directory and the directory says nothing about which is which —
 * pairing one that way would be the fuzzy identity-matching `./session.ts` refuses.
 *
 * Exported because `session re-seat` (`./seatRecovery.ts`) asks the same question of the same fleet — which
 * ledger row a renumbered workspace is — and a second pairing would drift from this one.
 *
 * @param rows the ledger rows to place, most recently opened first
 * @param workspaces the live cmux inventory
 * @returns each paired row's live workspace; an unpaired row is absent
 */
export function pairRowsToWorkspaces({
  rows,
  workspaces,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): ReadonlyMap<SessionItem, CmuxWorkspaceSummary> {
  const paired = new Map<SessionItem, CmuxWorkspaceSummary>();
  const claimed = new Set<string>();
  const claim = ({ row, workspace }: { row: SessionItem; workspace: CmuxWorkspaceSummary }): void => {
    paired.set(row, workspace);
    claimed.add(workspace.workspaceId);
  };
  const unclaimed = (workspace: CmuxWorkspaceSummary): boolean => !claimed.has(workspace.workspaceId);
  for (const row of rows) {
    const cwd = row.cwd;
    // A row with no cwd at all pairs on its ref alone — the long-standing behaviour for a doc-backed row,
    // whose slug the placement then judges by its own run journal. A dispatch row gets no such latitude:
    // the ref is the ONLY thing it would then be matched on, and a re-issued
    // `workspace:N` is exactly what this pairing is built not to trust.
    const worktreeUnknownIsAllowed = cwd === undefined && row.slug !== undefined;
    const exact = workspaces.find(
      (workspace) =>
        unclaimed(workspace) &&
        workspace.workspaceRef === row.workspaceRef &&
        (worktreeUnknownIsAllowed || (cwd !== undefined && sameWorktree({ a: cwd, b: workspace.currentDirectory }))),
    );
    if (exact !== undefined) {
      claim({ row, workspace: exact });
    }
  }
  for (const row of rows) {
    const cwd = row.cwd;
    if (paired.has(row) || cwd === undefined || row.slug === undefined) {
      continue;
    }
    const byWorktree = workspaces.find(
      (workspace) => unclaimed(workspace) && sameWorktree({ a: cwd, b: workspace.currentDirectory }),
    );
    if (byWorktree !== undefined) {
      claim({ row, workspace: byWorktree });
    }
  }
  return paired;
}

/** Whether a row was spawned too recently to have re-opened its own journal yet. */
function isBooting({ row, nowIso }: { row: SessionItem; nowIso: string }): boolean {
  if (row.spawnedIso === undefined) {
    return false;
  }
  const ageMs = Date.parse(nowIso) - Date.parse(row.spawnedIso);
  return !Number.isNaN(ageMs) && ageMs < BOOTING_GRACE_MS;
}

/**
 * Whether a live workspace is positively THIS dispatch child, by the name cmux itself was given at spawn.
 *
 * `spawn.ts` writes the plan's `workspaceName` into the workspace description, and drops it only when the
 * title already carries it — so both fields are read.
 *
 * Required of EVERY dispatch row, open or closed, and the asymmetry that once stood here was the defect.
 * A ref plus a worktree is not identification for one of these: cmux re-issues
 * `workspace:N` on restart, and every child of every ask shares the loop's one checkout — so an old open row
 * for a workspace that vanished without a ledger close can pair to a DIFFERENT ask's live child on the
 * re-issued number and hand it the first ask's terminal evidence. A child whose workspace cannot be
 * confirmed is kept, which costs one more sweep tick; closing the wrong live session costs a turn.
 */
function workspaceNamesDispatch({
  workspace,
  workspaceName,
}: {
  workspace: CmuxWorkspaceSummary;
  workspaceName: string;
}): boolean {
  const fields = [workspace.description, workspace.title];
  return fields.some((field) => field?.includes(workspaceName) === true);
}

/** Place one dispatch child that has a live workspace behind it — judged by its parent turn, never a doc. */
function placeDispatchRow({
  children,
  nowIso,
  reviewPostureFor,
  row,
  workerWorkspace,
  workspace,
}: {
  children: readonly DispatchChild[];
  nowIso: string;
  reviewPostureFor: (args: { readonly child: DispatchChild }) => ReviewPosture;
  row: SessionItem;
  workerWorkspace: (args: { readonly child: DispatchChild; readonly cwd: string | undefined }) => WorkerWorkspaceState;
  workspace: CmuxWorkspaceSummary;
}): CloseDonePlanItem {
  if (children.length !== 1) {
    return { kind: "kept", reason: "dispatch-key-ambiguous", row };
  }
  const child = children[0]!;
  if (!workspaceNamesDispatch({ workspace, workspaceName: child.workspaceName })) {
    return { kind: "kept", reason: "dispatch-ref-reused", row };
  }
  const evidence = dispatchDoneEvidence({
    child,
    nowIso,
    review: reviewPostureFor({ child }),
    workerWorkspace: workerWorkspace({ child, cwd: row.cwd }),
  });
  if (evidence === undefined) {
    return { kind: "kept", reason: "dispatch-open", row };
  }
  return { evidence, kind: "candidate", row, workspace };
}

/** Place one row that has a live workspace behind it. */
function placeLiveRow({
  childrenFor,
  evidenceFor,
  nowIso,
  ownWorkspaceId,
  reviewPostureFor,
  row,
  standingFor,
  workerWorkspace,
  workspace,
}: {
  childrenFor: (args: { readonly sessionKey: string }) => readonly DispatchChild[] | undefined;
  evidenceFor: (args: { readonly slug: string }) => DoneEvidence | undefined;
  nowIso: string;
  ownWorkspaceId: string | undefined;
  reviewPostureFor: (args: { readonly child: DispatchChild }) => ReviewPosture;
  row: SessionItem;
  /** The row's latest live standing-session ruling, in force or not. */
  standingFor: (args: { readonly slug: string }) => StandingSessionRuling | undefined;
  workerWorkspace: (args: { readonly child: DispatchChild; readonly cwd: string | undefined }) => WorkerWorkspaceState;
  workspace: CmuxWorkspaceSummary;
}): CloseDonePlanItem {
  if (workspace.pinned) {
    return { kind: "kept", reason: "pinned", row };
  }
  if (ownWorkspaceId !== undefined && workspace.workspaceId === ownWorkspaceId) {
    return { kind: "kept", reason: "own-workspace", row };
  }
  if (isBooting({ nowIso, row })) {
    return { kind: "kept", reason: "booting", row };
  }
  if (row.slug === undefined) {
    const children = childrenFor({ sessionKey: row.sessionKey });
    if (children === undefined) {
      return { kind: "kept", reason: "no-slug", row };
    }
    return placeDispatchRow({ children, nowIso, reviewPostureFor, row, workerWorkspace, workspace });
  }
  const evidence = evidenceFor({ slug: row.slug });
  if (evidence !== undefined) {
    return { evidence, kind: "candidate", row, workspace };
  }
  const standing = standingFor({ slug: row.slug });
  if (standing !== undefined && standingSessionHolds({ nowIso, ruling: standing })) {
    return { kind: "kept", reason: "standing-session", row };
  }
  return { kind: "park-candidate", row: { ...row, slug: row.slug }, workspace };
}

/**
 * Whether the WORKER of each ask is still live — asked of the live INVENTORY by the worker's own workspace
 * name, never inferred from whether its ledger row happened to pair.
 *
 * Reading it off the pairing was the defect: a dispatch row pairs on its exact ref
 * or not at all, so a worker cmux has renumbered past goes unpaired while running perfectly well — and
 * "unpaired" read as `gone` reaped that live worker's reviewer mid-turn, with no terminal event and an hour
 * of lease left. The workspace name survives a renumber; the ref is the thing that does not.
 *
 * `gone` still needs a worker row to have existed: a review child of an ask whose worker was never registered
 * at all (a ledger append that failed, a build predating registration) reads `unknown` and is kept, because
 * "no row" and "row whose workspace is gone" are different facts and only the second says the worker stopped.
 */
function workerWorkspaceLookup({
  rows,
  workspaces,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): (args: { readonly child: DispatchChild; readonly cwd: string | undefined }) => WorkerWorkspaceState {
  return ({ child, cwd }) => {
    const { channel, messageTs } = child.lifecycle;
    const workerKey = dispatchSessionName({ askChannel: channel, askMessageTs: messageTs, role: "ask" });
    // Two things must hold before a row counts as this ask's worker, and each closes a measured way of being
    // wrong. It must answer to no DOC: `dispatchSessionName`'s output is a
    // legal handover slug, so a doc named `ask-<channel>-<ts>` would otherwise fabricate a worker row for an
    // ask that has none. And it must sit in the SAME checkout as the reviewer asking — `planAskSession` and
    // `planReviewSession` both boot into `repoRoot`, so a worker and its reviewer always share a directory,
    // while two asks whose channels differ only past `SESSION_NAME_MAX_LENGTH` share a truncated key and do
    // not. Without the second, one loop's worker row proved another loop's worker gone.
    const isWorkerRow = (row: SessionItem): boolean =>
      row.slug === undefined &&
      row.sessionKey === workerKey &&
      cwd !== undefined &&
      row.cwd !== undefined &&
      sameWorktree({ a: cwd, b: row.cwd });
    if (!rows.some(isWorkerRow)) {
      return "unknown";
    }
    const workerName = dispatchWorkspaceName({ askChannel: channel, askMessageTs: messageTs, role: "ask" });
    const live = workspaces.some((workspace) => workspaceNamesDispatch({ workspace, workspaceName: workerName }));
    return live ? "live" : "gone";
  };
}

/**
 * Place every ledger row this sweep may act on: a close candidate, a drifted row, or kept with a reason.
 *
 * Pure and total — the screen reads that decide a candidate's fate come after, in `./screenVerdict.ts`'s `judgeScreen`, so a
 * dry run can print this plan without reading a single surface.
 *
 * Every OPEN row is placed, as it always was. A CLOSED row is placed only when it is a dispatch child that
 * still pairs to a live workspace — the ledger and cmux contradicting each other, which is the residue of
 * the ref-less closes `../live/turn/sessionLedger.ts` no longer writes. Every other closed row is left out
 * entirely rather than reported, since the ledger and cmux agree about it.
 *
 * @param askEvents every parsed ask-lifecycle event, from which both dispatch names per ask are derived
 * @param rows the folded session ledger, every status
 * @param workspaces every live workspace, as `cmux list` reads them
 * @param ownWorkspaceId the caller's own workspace id (`CMUX_WORKSPACE_ID`), or `undefined` outside cmux
 * @param nowIso the instant to judge boot age, a parent's lease and a review hold against
 * @param evidenceFor reads one slug's done evidence — a plain function, so the planner never touches disk
 * @param reviewPostureFor reads one child's parent ask's review off disk, for the same reason
 * @param standingFor reads one slug's latest live standing-session ruling off its journal, for the same reason;
 * the planner judges it in force against `nowIso`
 * @returns one item per placed row, in ledger order
 */
export function planCloseDone({
  askEvents,
  rows,
  workspaces,
  ownWorkspaceId,
  nowIso,
  evidenceFor,
  reviewPostureFor,
  standingFor,
}: {
  askEvents: readonly AskLifecycleEvent[];
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  ownWorkspaceId: string | undefined;
  nowIso: string;
  evidenceFor: (args: { readonly slug: string }) => DoneEvidence | undefined;
  reviewPostureFor: (args: { readonly child: DispatchChild }) => ReviewPosture;
  standingFor: (args: { readonly slug: string }) => StandingSessionRuling | undefined;
}): readonly CloseDonePlanItem[] {
  const childrenByKey = dispatchChildrenBySessionKey({ askEvents });
  const childrenFor = ({ sessionKey }: { readonly sessionKey: string }): readonly DispatchChild[] | undefined =>
    childrenByKey.get(sessionKey);
  const isDispatchRow = (row: SessionItem): boolean => row.slug === undefined && childrenByKey.has(row.sessionKey);
  const considered = rows.filter(
    (row) => row.workspaceRef !== undefined && (row.status === "open" || isDispatchRow(row)),
  );
  const paired = pairRowsToWorkspaces({ rows: considered, workspaces });
  const workerWorkspace = workerWorkspaceLookup({ rows: considered, workspaces });
  return rows
    .filter((row) => row.status === "open" || (isDispatchRow(row) && paired.has(row)))
    .map((row): CloseDonePlanItem => {
      if (row.workspaceRef === undefined) {
        return { kind: "kept", reason: "no-workspace", row };
      }
      const workspace = paired.get(row);
      if (workspace === undefined) {
        return { kind: "drifted", row, workspaceRef: row.workspaceRef };
      }
      return placeLiveRow({
        childrenFor,
        evidenceFor,
        nowIso,
        ownWorkspaceId,
        reviewPostureFor,
        row,
        standingFor,
        workerWorkspace,
        workspace,
      });
    });
}
