/**
 * `session close-done`'s act on one planned row: read a candidate's screen and close or hold it, close a drifted
 * row's ledger entry, or park a park candidate. `./closeDone.ts` plans the sweep and walks the plan through
 * {@link sweepItem}; a retired chair's close is recorded on the sweep's keep-alive record (`./closeDoneKeepAlive.ts`)
 * whichever path closes it.
 */
import { type CloseDonePlanItem, judgeScreen } from "../../../sessions/closeDone.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import { closeForceDecision } from "../../../sessions/closeForce.js";
import { appendSessionEvent } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { CloseDoneDeps } from "./closeDone.js";
import { closeRecordingChair, type KeepAliveSweep, keepAliveSeatVerdict } from "./closeDoneKeepAlive.js";
import { parkCandidate } from "./closeDonePark.js";

/** Close one candidate's workspace and its ledger row, or report why the close failed. */
async function closeCandidate({
  deps,
  force,
  item,
  keepAlive,
}: {
  deps: CloseDoneDeps;
  /** Whether the screen just read proves Claude idle at its prompt — cmux 0.65.2 refuses that seat unforced. */
  force: boolean;
  item: CloseDonePlanItem & { readonly kind: "candidate" };
  /** The keep-alive this close retires, when the screen's only background shell was one. */
  keepAlive?: string;
}): Promise<CloseDoneOutcome> {
  if (!deps.dryRun) {
    const closed = await deps.client.closeWorkspace({ force, workspaceId: item.workspace.workspaceId });
    if (closed.isErr()) {
      return { item, kind: "close-failed", reason: closed.error.message };
    }
    // The ROW's ref, not the live one: the fold closes the row whose `workspaceRef` the event names, and after
    // a cmux restart the two differ (`../../../sessions/closeDone.ts`'s pairing).
    appendSessionEvent({
      event: {
        kind: "closed",
        sessionKey: item.row.sessionKey,
        tsIso: deps.nowIso,
        workspaceRef: item.row.workspaceRef,
      },
      home: deps.home,
    });
  }
  return { item, kind: "closed", ...(keepAlive === undefined ? {} : { keepAlive }) };
}

/** Read one candidate's screen and either close it or hold it. */
async function sweepCandidate({
  deps,
  item,
  sweep,
}: {
  deps: CloseDoneDeps;
  item: CloseDonePlanItem & { readonly kind: "candidate" };
  sweep: KeepAliveSweep;
}): Promise<CloseDoneOutcome> {
  const screen = await deps.client.readScreen({ target: { workspaceId: item.workspace.workspaceId } });
  const read = screen.isOk() ? screen.value : undefined;
  const verdict = judgeScreen({ screen: read });
  if (verdict === "busy") {
    const keepAlive = await keepAliveSeatVerdict({ deps, screen: read, sweep, workspace: item.workspace });
    if (keepAlive.kind === "force") {
      return closeCandidate({ deps, force: true, item, keepAlive: keepAlive.note });
    }
    return { item, kind: "held", verdict, ...(keepAlive.kind === "held" ? { keepAlive: keepAlive.note } : {}) };
  }
  if (verdict !== "idle") {
    return { item, kind: "held", verdict };
  }
  // An idle verdict with no Claude prompt to prove it (a blank screen) still closes, as it always has, but
  // unforced: cmux then refuses it if a process is running there (`../../../sessions/closeForce.ts`). A retired
  // chair's tree is noted as it closes, so a watch it still held never covers a later chair this sweep.
  return closeRecordingChair({
    close: ({ client }) =>
      closeCandidate({ deps: { ...deps, client }, force: closeForceDecision({ screen: read }).kind === "force", item }),
    deps,
    sweep,
    workspace: item.workspace,
  });
}

/** Close a drifted row on the ledger — its workspace is already gone, so there is nothing to close in cmux. */
function closeDrifted({
  deps,
  item,
}: {
  deps: CloseDoneDeps;
  item: CloseDonePlanItem & { readonly kind: "drifted" };
}): CloseDoneOutcome {
  if (!deps.dryRun) {
    appendSessionEvent({
      event: { kind: "closed", sessionKey: item.row.sessionKey, tsIso: deps.nowIso, workspaceRef: item.workspaceRef },
      home: deps.home,
    });
  }
  return { item, kind: "drift-closed" };
}

/**
 * Act on one planned item.
 *
 * @param sweep this sweep's keep-alive record, shared across its items in plan order
 * @returns the row's outcome
 */
export async function sweepItem({
  deps,
  item,
  sweep,
}: {
  deps: CloseDoneDeps;
  item: CloseDonePlanItem;
  sweep: KeepAliveSweep;
}): Promise<CloseDoneOutcome> {
  switch (item.kind) {
    case "candidate":
      return sweepCandidate({ deps, item, sweep });
    case "drifted":
      return closeDrifted({ deps, item });
    case "park-candidate":
      return closeRecordingChair({
        close: ({ client }) =>
          parkCandidate({ deps: { ...deps, client, runsDir: stateHomePaths({ home: deps.home }).runs }, item }),
        deps,
        sweep,
        workspace: item.workspace,
      });
    case "kept":
      return { item, kind: "kept" };
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}
