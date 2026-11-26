/**
 * The predecessor chair's BOARD ROW, on both ends of `slopweaver cmux takeover` — the gate that reads its run
 * before anything is touched, and the event that ends it once the pin has moved.
 *
 * Closing the WORKSPACE was never the whole ending. `handover settle` refuses a DOC row outright, and the
 * five-step takeover wrote nothing to the predecessor's row, so every retired chair kept `status: ready` and
 * stayed in `RUN NOW` — and a fill read one as available work and spawned a SECOND supervisor chair.
 * `../../../handover/supervisorSupersession.ts` carries that incident and the measurement.
 *
 * Both halves live here rather than in `./takeover.ts` because they are the one part of the verb that talks
 * to the board instead of to cmux, and because keeping them in the verb pushed it past the
 * `file-size-ratchet` cap.
 */

import { realpathSync } from "node:fs";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { predecessorRunNotFinishedRefusal } from "../../../cmux/takeover.js";
import { currentCycle, type RunPhase, runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { pairRowsToWorkspaces } from "../../../sessions/closeDone.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import { appPredecessorLedgerRow } from "../../../supervisor/takeoverSeat.js";

/**
 * The predecessor's run phase for a resolved slug.
 *
 * @param home the state home the run journals live under
 * @param slug the predecessor's handover slug
 * @returns its phase, or `undefined` when the journal could not be read or holds no event at all
 */
function predecessorRunPhase({ home, slug }: { home: string | undefined; slug: string }): RunPhase | undefined {
  const journal = readRunJournal({ runsDir: stateHomePaths(home === undefined ? {} : { home }).runs, slug });
  if (journal.isErr()) {
    logger.error({ msg: `cmux takeover: could not read ${slug}'s run journal — ${journal.error.message}` });
    return undefined;
  }
  // A journal with no `started` is a row never run — empty, or holding only pre-start lines such as a `probed`
  // — `runStateOf` folds that to `NO_RUN`, whose phase is `closed`: it read as
  // "stepped down" and let a chair that never opened its run be closed out from under itself.
  if (currentCycle({ events: journal.value.events }).length === 0) {
    return undefined;
  }
  return runStateOf({ events: journal.value.events }).phase;
}

/**
 * Gate (c)'s one printed line, with both absences SPELLED rather than substituted by an operator.
 *
 * The two say different things and a reader acts on the difference: no slug means the workspace was never
 * registered against a row at all, while no phase means the row exists and has never been run.
 *
 * @param runPhase the predecessor's run phase, absent when its journal holds no run
 * @param slug the predecessor's handover slug, absent when the ledger never registered it
 * @returns what to print after "predecessor run:"
 */
export function runNote({ runPhase, slug }: { runPhase: RunPhase | undefined; slug: string | undefined }): string {
  if (slug === undefined) {
    return "no slug on record";
  }
  if (runPhase === undefined) {
    return `${slug} (no run)`;
  }
  return `${slug} (${runPhase})`;
}

/**
 * The OPEN ledger row that answers to the predecessor's live workspace, paired the way every other reader of a
 * possibly-renumbered fleet pairs one: `pairRowsToWorkspaces`, ref and worktree first, then worktree alone.
 *
 * Never the recorded `workspaceRef` alone. cmux renumbers every ref when the app restarts while workspace ids
 * survive (`../../../cmux/client.ts`; the pinned chair went `workspace:164` → `workspace:1` in
 * `skills/supervisor/reference/reboot.md`), so a ref-only lookup refused every successor after a restart with no
 * hatch — and, worse, a ref cmux re-issued to another session could hand gate (c) THAT session's slug. The
 * whole inventory is paired, not the predecessor alone, so a row another live workspace claims exactly is never
 * claimed by the predecessor's worktree fallback too.
 *
 * **The pairing is then held to the WHOLE path.** `sameWorktree` also accepts a bare basename match, which suits
 * a sweep that only keeps or closes idle seats, but this row decides a destructive close: two worktrees named
 * alike under different roots (`/repo-a/…/shared`, `/repo-b/…/shared`) would let a re-issued ref pair another
 * seat's row to the predecessor. So the paired row's recorded cwd must canonicalise to
 * the predecessor's live directory, or no row answers — a refusal, which costs moving the pin by hand; closing
 * another seat's row costs that seat.
 *
 * @param rows the folded session ledger, any status
 * @param workspaces the live cmux inventory the predecessor was resolved from
 * @param predecessorWorkspaceId the predecessor's cmux id, the one name a restart does not change
 * @param canonicalDir resolves a directory to one spelling (a symlinked root to its target), so the whole-path
 * check survives the symlink the basename fallback exists for
 * @returns the paired row, or undefined when no open row answers to that workspace by its whole path
 */
export function predecessorLedgerRow({
  rows,
  workspaces,
  predecessorWorkspaceId,
  canonicalDir,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  predecessorWorkspaceId: string;
  canonicalDir: (input: { dir: string }) => string;
}): SessionItem | undefined {
  const openRows = rows.filter((row) => row.status === "open");
  const paired = pairRowsToWorkspaces({ rows: openRows, workspaces });
  for (const [row, workspace] of paired) {
    if (workspace.workspaceId !== predecessorWorkspaceId) {
      continue;
    }
    const dir = canonicalDir({ dir: workspace.currentDirectory });
    if (row.cwd === undefined || canonicalDir({ dir: row.cwd }) !== dir) {
      return undefined;
    }
    if (worktreeIsAmbiguous({ canonicalDir, dir, openRows, predecessorWorkspaceId, row, workspaces })) {
      return undefined;
    }
    return row;
  }
  return undefined;
}

/**
 * Whether the predecessor's worktree fails to name ONE seat. A predecessor's row may predate the `workspaceId` a
 * `cmux spawn` row now records, so after a restart the worktree is the one identity every row has, and it is
 * identity only while it is unshared: a second
 * LIVE workspace in the same directory (a duplicate spawn) lets cross-reissued refs pair that seat's row to the
 * predecessor, and a second OPEN row there — another slug, or a stale row of the same one — can win the pairing
 * on a re-issued ref, so gate (c) reads the wrong journal or step 5 closes the wrong row.
 * Refusing costs nothing measured: every chair boots its own `fresh-supervisor-handoff-N` slug into its own
 * worktree, and `slopweaver session list | grep supervisor-handoff` showed one open chair row.
 */
function worktreeIsAmbiguous({
  canonicalDir,
  dir,
  openRows,
  predecessorWorkspaceId,
  row,
  workspaces,
}: {
  canonicalDir: (input: { dir: string }) => string;
  dir: string;
  openRows: readonly SessionItem[];
  predecessorWorkspaceId: string;
  row: SessionItem;
  workspaces: readonly CmuxWorkspaceSummary[];
}): boolean {
  const sharedLive = workspaces.some(
    (workspace) =>
      workspace.workspaceId !== predecessorWorkspaceId && canonicalDir({ dir: workspace.currentDirectory }) === dir,
  );
  const otherOpenRowHere = openRows.some(
    (other) => other !== row && other.cwd !== undefined && canonicalDir({ dir: other.cwd }) === dir,
  );
  return sharedLive || otherOpenRowHere;
}

/**
 * A directory's real path, or the literal path when it cannot be resolved (gone, unreadable): the literal can
 * still match a literal, and an unresolvable path never matches a resolved one by accident.
 */
function realDirOrLiteral({ dir }: { dir: string }): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * The note naming the ref a row was spawned under, when a restart has since renumbered it — the evidence a
 * reader checks the pairing against.
 *
 * @param row the paired ledger row, if any
 * @param liveRef the predecessor's ref as cmux reports it now
 * @returns the suffix to print, empty when nothing differs
 */
function renumberNote({ row, liveRef }: { row: SessionItem | undefined; liveRef: string }): string {
  if (row?.workspaceRef === undefined || row.workspaceRef === liveRef) {
    return "";
  }
  return `, ledger row spawned as ${row.workspaceRef} and paired by worktree`;
}

/**
 * Gate (c)'s passing arm: the slug step 6 closes, and the ledger row step 5 closes — its recorded ref REQUIRED,
 * because a `closed` event naming no ref closes every open row under its key rather than this one.
 */
export interface PredecessorRun {
  readonly slug: string;
  readonly row: SessionItem & { readonly workspaceRef: string };
}

/**
 * Gate (c): confirm the predecessor's own run has reached a terminal phase, per its session-ledger slug.
 *
 * The slug and row come back on the passing arm rather than being thrown away: step 5 closes the ledger row
 * under its OWN recorded ref, and step 6 records the predecessor's board row closed — and
 * `../../../sessions/session.ts` is the only place that knows which row a workspace answered to.
 * `../../../cmux/takeover.ts`'s refusal already guarantees a slug on this arm — it refuses an unregistered
 * predecessor outright — so the caller needs no second check.
 *
 * @param home the state home the ledger and journals live under
 * @param predecessor the pinned workspace being retired, as cmux reports it now
 * @param workspaces the live inventory it was resolved from, paired against the ledger whole
 * @returns the predecessor's slug and ledger row, or the refusal that stops the takeover
 */
export function predecessorRunGate({
  home,
  predecessor,
  workspaces,
}: {
  home: string | undefined;
  predecessor: CmuxWorkspaceSummary;
  workspaces: readonly CmuxWorkspaceSummary[];
}): { readonly refusal: string } | PredecessorRun {
  const { events } = parseSessionLog({ text: readSessionLogText(home === undefined ? {} : { home }) });
  const rows = foldSessions({ events });
  const row = predecessorLedgerRow({
    canonicalDir: realDirOrLiteral,
    predecessorWorkspaceId: predecessor.workspaceId,
    rows,
    workspaces,
  });
  const slug = row?.slug;
  const predecessorRef = predecessor.workspaceRef;
  const runPhase = slug === undefined ? undefined : predecessorRunPhase({ home, slug });
  logger.out({
    line: `cmux takeover: step 3/6 — predecessor run: ${runNote({ runPhase, slug })}${renumberNote({ liveRef: predecessorRef, row })}`,
  });
  const refusal = predecessorRunNotFinishedRefusal({ predecessorRef, runPhase, slug });
  if (refusal !== undefined) {
    return { refusal };
  }
  // Unreachable with `slug === undefined`: the refusal above is exactly that case. An `if` rather than a
  // `??`-style stand-in, because `no-silent-fallback` refuses a substituted value and there is nothing here a
  // substitution could honestly name.
  const recordedRef = row?.workspaceRef;
  if (slug === undefined || row === undefined || recordedRef === undefined) {
    return { refusal: `${predecessorRef} names no handover slug` };
  }
  const siblings = closeSiblings({ row, rows });
  if (siblings > 0) {
    return {
      refusal:
        `${predecessorRef}'s ledger row (${slug}, spawned as ${recordedRef}) shares its key, recorded ref and spawn ` +
        `instant with ${siblings} other open row(s), so step 5's close would close them too — close the right one ` +
        "by hand (`slopweaver cmux close`) and move the pin yourself",
    };
  }
  return { row: { ...row, workspaceRef: recordedRef }, slug };
}

/** Gate (c)'s passing arm for an app predecessor: the slug step 6 closes, and the row step 5's close names by id. */
export interface AppPredecessorRun {
  readonly slug: string;
  readonly row: SessionItem & { readonly sessionId: string };
}

/**
 * Gate (c) for a predecessor the desktop app hosts: its one open ledger row, found by its exact app session id in
 * the directory the app reports it in now (`../../../supervisor/takeoverSeat.ts`'s `appPredecessorLedgerRow`),
 * then the same terminal-phase check a cmux predecessor's run passes.
 *
 * @param home the state home the ledger and journals live under
 * @param appSessionId the predecessor's app session id, from the pin record
 * @param directory the predecessor's working directory, as the app resolved it live
 * @returns the predecessor's slug and ledger row, or the refusal that stops the takeover
 */
export function appPredecessorRunGate({
  home,
  appSessionId,
  directory,
}: {
  home: string | undefined;
  appSessionId: string;
  directory: string;
}): { readonly refusal: string } | AppPredecessorRun {
  const { events } = parseSessionLog({ text: readSessionLogText(home === undefined ? {} : { home }) });
  const found = appPredecessorLedgerRow({
    appSessionId,
    canonicalDir: realDirOrLiteral,
    directory,
    rows: foldSessions({ events }),
  });
  if (found.isErr()) {
    return { refusal: found.error.message };
  }
  const label = appPinLabel({ appSessionId });
  const { slug } = found.value;
  if (slug === undefined) {
    return { refusal: `${label}'s ledger row names no handover slug, so its run cannot be confirmed finished` };
  }
  const runPhase = predecessorRunPhase({ home, slug });
  logger.out({ line: `cmux takeover: step 3/6 — predecessor run: ${runNote({ runPhase, slug })}` });
  const refusal = predecessorRunNotFinishedRefusal({ predecessorRef: label, runPhase, slug });
  if (refusal !== undefined) {
    return { refusal };
  }
  return { row: found.value, slug };
}

/**
 * How many OTHER open rows step 5's `closed` event would also close: the fold targets every row under the key
 * whose recorded ref and `spawnedIso` both equal the event's (`../../../sessions/session.ts`'s `applyClosed`),
 * and neither field is unique — a restart re-issues refs, and two spawns can share a millisecond. Counted here,
 * before anything is unpinned, so the close is refused rather than over-broad.
 *
 * @param row the predecessor's paired row
 * @param rows the whole folded ledger
 * @returns the number of open rows other than `row` that the close would reach
 */
export function closeSiblings({ row, rows }: { row: SessionItem; rows: readonly SessionItem[] }): number {
  return rows.filter(
    (other) =>
      other !== row &&
      other.status === "open" &&
      other.sessionKey === row.sessionKey &&
      other.workspaceRef === row.workspaceRef &&
      other.spawnedIso === row.spawnedIso,
  ).length;
}

/**
 * Step 6: record the predecessor chair's board row CLOSED, witnessing the pin that replaced it.
 *
 * **It can never fail the takeover.** By the time it runs, the unpin, pin, rename and close have all happened
 * against cmux, which has no safety net for any of them, so a non-zero exit would invite an operator to re-run
 * a verb whose gates now read a world that has already moved. It prints what went wrong and the one command
 * that repairs it — the same contract `./recordPin.ts` keeps for the pin record.
 *
 * @param home the state home holding the run journals
 * @param predecessorSlug the retiring chair's handover slug
 * @param successorLabel the seat that now holds the pin, recorded as the witness: a cmux `workspace:<n>` or an
 *   `app:<id>`
 */
export function recordPredecessorRowClosed({
  home,
  predecessorSlug,
  successorLabel,
}: {
  home: string | undefined;
  predecessorSlug: string;
  successorLabel: string;
}): void {
  const written = applyRowEvent({
    event: {
      atIso: new Date().toISOString(),
      kind: "closed",
      residue: [],
      summary: `the supervisor pin moved to ${successorLabel}; this chair retired`,
    },
    runsDir: stateHomePaths(home === undefined ? {} : { home }).runs,
    slug: predecessorSlug,
  });
  if (written.isErr()) {
    logger.error({
      msg:
        `cmux takeover: step 6/6 — the pin moved, but ${predecessorSlug}'s board row was NOT closed: ` +
        `${written.error.message}. Repair it with \`slopweaver handover close ${predecessorSlug} --summary ` +
        `"the supervisor pin moved to ${successorLabel}; this chair retired"\``,
    });
    return;
  }
  logger.out({
    line: `cmux takeover: step 6/6 — closed ${predecessorSlug}'s board row (witness: the pin now on ${successorLabel})`,
  });
}
