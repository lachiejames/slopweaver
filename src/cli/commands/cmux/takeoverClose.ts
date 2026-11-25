/**
 * `cmux takeover` step 5: close the retired chair's workspace, which an unforced close can no longer do.
 *
 * MEASURED: chairs 368 and 369 each printed steps 1–4 and then `cmux workspace.close failed
 * (confirmation_required): Workspace has a running process; retry with --force` — cmux 0.65.2 refuses any workspace
 * with a live process unforced, and a retired chair always holds one (its own idle `claude`, and usually the
 * `claude watch` keep-alive it started at boot). So every takeover since stopped at step 5: the predecessor stayed
 * open, its ledger row stayed open, and its board row was never closed. Four chairs were open at once.
 *
 * Two tries, both bounded. First the close every other caller uses (`closeWorkspaceWithBoundedForce`): unforced,
 * then forced once only on cmux's own refusal and a screen proving the seat idle with nothing in the background.
 * Then, when that screen read `busy`, the keep-alive arm (`../../../sessions/keepAliveSeatClose.ts`): forced only
 * when every background shell is a `claude watch` and another watch outside the chair covers for it. Anything else
 * holds, and `session close-done` retries it each tick.
 */
import { logger } from "../../../lib/logger.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { HarnessTarget, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { closeWorkspaceWithBoundedForce } from "../../../sessions/closeForce.js";
import {
  keepAliveForceNote,
  keepAliveOnlyCloseDecision,
  type WatchTable,
} from "../../../sessions/keepAliveSeatClose.js";
import type { SessionItem } from "../../../sessions/session.js";
import { appendSessionEvent } from "../../../sessions/sessionStore.js";

/** How step 5 ended for the predecessor's workspace. */
export type TakeoverCloseOutcome =
  | { readonly kind: "closed"; readonly how: string }
  | { readonly kind: "held"; readonly why: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Close the predecessor's workspace, or say why it stays open.
 *
 * @param client the takeover's cmux connection
 * @param processTable one fresh whole read of the process table, each row with its state, taken only on the
 *   keep-alive arm
 * @param workspaceId the predecessor's workspace, already unpinned
 * @returns closed with how, held with why, or cmux's own failure
 */
export async function closeCmuxTakeoverPredecessor({
  client,
  processTable,
  workspaceId,
}: {
  client: CmuxHostSurface;
  processTable: () => WatchTable;
  workspaceId: string;
}): Promise<TakeoverCloseOutcome> {
  const bounded = await closeWorkspaceWithBoundedForce({ client, workspaceId });
  if (bounded.isErr()) {
    return { kind: "failed", reason: bounded.error.message };
  }
  if (bounded.value.kind === "closed") {
    return { how: bounded.value.forced ? "forced, screen idle" : "unforced", kind: "closed" };
  }
  if (bounded.value.verdict !== "busy") {
    return { kind: "held", why: `its screen is ${bounded.value.verdict}` };
  }
  const screen = await client.readScreen({ target: { workspaceId } });
  const tree = await client.processTree({ workspaceId });
  // One seat closes here, so nothing else is retiring in this pass.
  const decision = keepAliveOnlyCloseDecision({
    retiring: new Set(),
    screen: screen.isOk() ? screen.value : undefined,
    table: processTable(),
    tree: tree.isOk() ? tree.value : undefined,
  });
  if (decision.kind === "held") {
    return { kind: "held", why: `its screen is busy and ${decision.detail}` };
  }
  const forced = await client.closeWorkspace({ force: true, workspaceId });
  if (forced.isErr()) {
    return { kind: "failed", reason: forced.error.message };
  }
  return { how: `forced, ${keepAliveForceNote({ decision })}`, kind: "closed" };
}

/**
 * Step 5's line when the tab stayed open: why, and what closes it later. A hold is not a fault — its ledger row
 * stays open, so `session close-done` judges it again on its next tick.
 */
function step5Failure({ closed }: { closed: Exclude<TakeoverCloseOutcome, { readonly kind: "closed" }> }): string {
  if (closed.kind === "failed") {
    return `${closed.reason}; close it with \`slopweaver cmux close\` once nothing runs there`;
  }
  return `${closed.why}; its ledger row stays open, so \`slopweaver session close-done\` retries it`;
}

/**
 * Step 5 whole: close the predecessor, close its ledger row when its tab closed, and print the step's line.
 *
 * @param home the state home the ledger lives under, or the default one
 * @param predecessorId the predecessor's workspace, already unpinned
 * @param predecessorRef the predecessor's live ref, for the printed line
 * @param predecessorRow the predecessor's open ledger row, whose own ref and spawn instant the close event names
 * @param processTable one fresh whole read of the process table, taken only on the keep-alive arm
 * @returns whether the predecessor's tab closed
 */
export async function runTakeoverStep5({
  client,
  home,
  predecessorId,
  predecessorRef,
  predecessorRow,
  processTable,
}: {
  client: CmuxHostSurface;
  home: string | undefined;
  predecessorId: string;
  predecessorRef: string;
  predecessorRow: SessionItem & { readonly workspaceRef: string };
  processTable: () => WatchTable;
}): Promise<boolean> {
  const closed = await closeCmuxTakeoverPredecessor({ client, processTable, workspaceId: predecessorId });
  if (closed.kind !== "closed") {
    logger.error({ msg: `cmux takeover: step 5/6 — ${predecessorRef} NOT closed: ${step5Failure({ closed })}` });
    return false;
  }
  // The ROW's own ref, not the live one: the fold closes the row whose `workspaceRef` the event names, and a
  // restart may have renumbered the live ref past it (`../session/reSeat.ts`'s `recordLedgerClose`). The row's
  // `spawnedIso` narrows it further: a re-issued ref can sit on a second open row under the same key.
  appendSessionEvent({
    event: {
      kind: "closed",
      sessionKey: predecessorRow.sessionKey,
      tsIso: new Date().toISOString(),
      workspaceRef: predecessorRow.workspaceRef,
      ...(predecessorRow.spawnedIso === undefined ? {} : { spawnedIso: predecessorRow.spawnedIso }),
    },
    ...(home === undefined ? {} : { home }),
  });
  logger.out({ line: `cmux takeover: step 5/6 — closed ${predecessorRef} (${closed.how})` });
  return true;
}

/**
 * Close a predecessor the desktop app hosts, through the session harness's own close and nothing else: no pid is
 * read and nothing is killed. The app holds a session it cannot prove finished, and that hold is step 5's answer.
 *
 * @param harness the app session harness, of which only `close` is used
 * @param target the predecessor as the app resolved it live
 * @returns closed with how, held with why, or the harness's own failure
 */
export async function closeAppTakeoverPredecessor({
  harness,
  target,
}: {
  harness: Pick<SessionHarness, "close">;
  target: HarnessTarget;
}): Promise<TakeoverCloseOutcome> {
  const closed = await harness.close({ target });
  if (closed.isErr()) {
    return { kind: "failed", reason: closed.error.message };
  }
  if (closed.value.kind === "held") {
    return { kind: "held", why: `the desktop app held it (${closed.value.reason})` };
  }
  return { how: closed.value.forced ? "the app forced it" : "unforced", kind: "closed" };
}

/**
 * Step 5 whole for an app predecessor: close it through the harness, close its ledger row by its app session id and
 * spawn instant when it closed, and print the step's line.
 *
 * @param harness the app session harness, of which only `close` is used
 * @param home the state home the ledger lives under, or the default one
 * @param label the predecessor's `app:<id>`, for the printed line
 * @param row the predecessor's one open ledger row
 * @param target the predecessor as the app resolved it live
 * @returns whether the predecessor closed
 */
export async function runAppTakeoverStep5({
  harness,
  home,
  label,
  row,
  target,
}: {
  harness: Pick<SessionHarness, "close">;
  home: string | undefined;
  label: string;
  row: SessionItem & { readonly sessionId: string };
  target: HarnessTarget;
}): Promise<boolean> {
  const closed = await closeAppTakeoverPredecessor({ harness, target });
  if (closed.kind !== "closed") {
    logger.error({ msg: `cmux takeover: step 5/6 — ${label} NOT closed: ${step5Failure({ closed })}` });
    return false;
  }
  appendSessionEvent({
    event: {
      kind: "closed",
      sessionId: row.sessionId,
      sessionKey: row.sessionKey,
      tsIso: new Date().toISOString(),
      ...(row.spawnedIso === undefined ? {} : { spawnedIso: row.spawnedIso }),
    },
    ...(home === undefined ? {} : { home }),
  });
  logger.out({ line: `cmux takeover: step 5/6 — closed ${label} (${closed.how})` });
  return true;
}
