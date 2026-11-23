/**
 * `session close-done`'s second sweep: close a finished `fleet resume` tab nothing on the ledger names. Every
 * judgement is pure (`../../../sessions/closeDoneShells.ts`, `../../../fleet/resumeShell.ts`); this file reads the
 * screens and process trees and closes over the sweep's one client. It runs under the recovery lock, over the journal
 * `./closeDoneFleet.ts` hands it.
 *
 * A workspace whose screen carries no finish line is not reported at all: it is an unrelated workspace, and
 * listing every one of those each tick is the wall rule 7 refuses. One that DOES carry it is always reported —
 * closed, held with the reason, or a failed close.
 */
import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { isBareShellTree } from "../../../cmux/liveness.js";
import type { FleetJournalRead } from "../../../fleet/journal.js";
import {
  type ResumeFinish,
  type ResumeShellCloseReason,
  resumeFinishFromScreen,
  resumeShellCloseReason,
} from "../../../fleet/resumeShell.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { resumeShellCandidates } from "../../../sessions/closeDoneShells.js";
import type { SessionItem } from "../../../sessions/session.js";

/** How one finished resume tab ended. */
export type CloseDoneShellOutcome =
  | {
      readonly kind: "closed";
      readonly workspaceRef: string;
      readonly finish: ResumeFinish;
      readonly reason: ResumeShellCloseReason;
    }
  | { readonly kind: "held"; readonly workspaceRef: string; readonly finish: ResumeFinish; readonly reason: string }
  | {
      readonly kind: "close-failed";
      readonly workspaceRef: string;
      readonly finish: ResumeFinish;
      readonly reason: string;
    };

/**
 * The screen rows read: comfortably more than the finish tail, since a wrapped line and a prompt sit under it.
 * The tail rule itself is `RESUME_FINISH_TAIL_LINES`.
 */
const SCREEN_LINES = 40;

/** Whether the workspace's process tree reads positively as a bare shell, or why it does not. */
async function bareShell({
  client,
  workspaceId,
}: {
  client: CmuxHostSurface;
  workspaceId: string;
}): Promise<string | undefined> {
  const tree = await client.processTree({ workspaceId });
  if (tree.isErr()) {
    return `its process tree did not read: ${tree.error.message}`;
  }
  return bareShellReason({ processes: tree.value });
}

/**
 * Why a tab's attributed tree does not read as a bare shell, or `undefined` when it does. An EMPTY tree is said to
 * be empty: cmux 0.65.2 attributes nothing to a tab at its prompt, and "something is still running" over a tab
 * holding nothing sent the chair to read a screen with nothing on it (the handover
 * `fleet-resume-misreads-eight-live-seats-as-bare-shells-on-defunct-children-and-tty-mismatch`).
 *
 * @param processes the tree cmux attributes to the tab
 * @returns the reason it is held, or `undefined` for a bare shell
 */
export function bareShellReason({ processes }: { processes: readonly CmuxProcess[] }): string | undefined {
  if (processes.length === 0) {
    return "cmux attributes no process to it, so it could not be proven a bare shell";
  }
  return isBareShellTree({ processes }) ? undefined : "something is still running in it";
}

/** The finish line a workspace's screen carries now, or `undefined` when it carries none or did not read. */
async function finishOnScreen({
  client,
  workspaceId,
}: {
  client: CmuxHostSurface;
  workspaceId: string;
}): Promise<ResumeFinish | undefined> {
  const screen = await client.readScreen({ scrollbackLines: SCREEN_LINES, target: { workspaceId } });
  return screen.isOk() ? resumeFinishFromScreen({ screen: screen.value }) : undefined;
}

/**
 * Why the tab is no longer the one judged, read right before the close: a tree no longer bare, or a screen no longer
 * carrying the same finish under an untouched prompt — a draft typed since the first read leaves the tree bare.
 * cmux has no check-and-close, so this is the narrowest window there is.
 */
async function changedSince({
  client,
  finish,
  workspaceId,
}: {
  client: CmuxHostSurface;
  finish: ResumeFinish;
  workspaceId: string;
}): Promise<string | undefined> {
  const busy = await bareShell({ client, workspaceId });
  if (busy !== undefined) {
    return busy;
  }
  const now = await finishOnScreen({ client, workspaceId });
  return now?.attemptId === finish.attemptId && now.outcome === finish.outcome
    ? undefined
    : "its screen changed since it was read";
}

/** Read, judge and — unless a dry run — close one candidate. `undefined` when its screen is no resume tab. */
async function sweepOne({
  client,
  dryRun,
  journal,
  workspace,
}: {
  client: CmuxHostSurface;
  dryRun: boolean;
  journal: FleetJournalRead;
  workspace: CmuxWorkspaceSummary;
}): Promise<CloseDoneShellOutcome | undefined> {
  const { workspaceRef, workspaceId } = workspace;
  const finish = await finishOnScreen({ client, workspaceId });
  if (finish === undefined) {
    return undefined;
  }
  const reason = resumeShellCloseReason({ finish, journal });
  if (reason === undefined) {
    return { finish, kind: "held", reason: `${finish.outcome}, and no later attempt has finished`, workspaceRef };
  }
  const busy = await bareShell({ client, workspaceId });
  if (busy !== undefined) {
    return { finish, kind: "held", reason: busy, workspaceRef };
  }
  if (dryRun) {
    return { finish, kind: "closed", reason, workspaceRef };
  }
  const changed = await changedSince({ client, finish, workspaceId });
  if (changed !== undefined) {
    return { finish, kind: "held", reason: changed, workspaceRef };
  }
  // Forced: `changedSince` just re-proved the tree bare and the finish unchanged, and cmux 0.65.2 refuses a
  // workspace with any live process unforced (`../../../sessions/closeForce.ts`).
  const closed = await client.closeWorkspace({ force: true, workspaceId });
  if (closed.isErr()) {
    return { finish, kind: "close-failed", reason: closed.error.message, workspaceRef };
  }
  return { finish, kind: "closed", reason, workspaceRef };
}

/**
 * Close every finished `fleet resume` tab no open ledger row names. No ledger write: the ledger never had a row
 * for one.
 *
 * @param client the sweep's one cmux client
 * @param dryRun report what would close, closing nothing
 * @param journal the fleet journal, for whether a later attempt superseded a tab's or every seat it refused is gone
 * @param ownWorkspaceId the caller's own workspace, never closed
 * @param rows the folded session ledger
 * @param workspaces the inventory the sweep listed
 * @returns one outcome per tab whose screen carried a finish line
 */
export async function sweepFinishedResumeShells({
  client,
  dryRun,
  journal,
  ownWorkspaceId,
  rows,
  workspaces,
}: {
  client: CmuxHostSurface;
  dryRun: boolean;
  journal: FleetJournalRead;
  ownWorkspaceId: string | undefined;
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<readonly CloseDoneShellOutcome[]> {
  const outcomes: CloseDoneShellOutcome[] = [];
  for (const workspace of resumeShellCandidates({ ownWorkspaceId, rows, workspaces })) {
    const outcome = await sweepOne({ client, dryRun, journal, workspace });
    if (outcome !== undefined) {
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

/** What a closed tab's line adds after its attempt: why a tab that did not end healthy could close. */
function closedSuffix({ reason }: { reason: ResumeShellCloseReason }): string {
  switch (reason) {
    case "healthy":
      return "";
    case "superseded":
      return ", superseded";
    case "seats-gone":
      return ", every seat it refused is gone";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * One line for one finished resume tab.
 *
 * @param outcome what happened to it
 * @param dryRun whether the sweep only reported
 * @returns the line
 */
export function renderShellOutcome({ outcome, dryRun }: { outcome: CloseDoneShellOutcome; dryRun: boolean }): string {
  const what = `${outcome.workspaceRef} finished fleet resume tab — attempt ${outcome.finish.attemptId} ${outcome.finish.outcome}`;
  switch (outcome.kind) {
    case "closed":
      return `${dryRun ? "would close" : "closed"} ${what}${closedSuffix({ reason: outcome.reason })}`;
    case "held":
      return `held ${what}: ${outcome.reason}`;
    case "close-failed":
      return `FAILED to close ${what}: ${outcome.reason}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
