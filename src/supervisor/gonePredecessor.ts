/**
 * The one ledger row a GONE predecessor chair answers to: a chair the supervisor pin record still names whose host no
 * longer holds it — a cmux workspace cmux no longer lists, or an app session the desktop app answers it does not
 * host. `cmux takeover` reads that row's slug for gate (c), so a chair whose run never reached a terminal phase is
 * never retired by its host's silence alone (`./takeoverSeat.ts` § A chair whose host no longer holds it).
 *
 * A live predecessor is paired by its directory as well (`appPredecessorLedgerRow`, `predecessorLedgerRow`), because a
 * live inventory reports one; a gone one has no inventory to report it, so the pairing is by the exact id the pin
 * record carries, and refuses unless exactly one open row of the same host carries it. A row spawned before the
 * ledger recorded a cmux `workspaceId` therefore answers to nothing, and the record is repaired by hand.
 *
 * Pure: the folded ledger and the record's target in, the row out.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import type { CmuxError } from "../cmux/errors.js";
import { foldSessions, type SessionEvent, type SessionItem } from "../sessions/session.js";
import type { SupervisorPinTarget } from "../sessions/supervisorPin.js";
import { appPinLabel } from "./appPin.js";
import { type TakeoverResolutionError, TakeoverResolutionErrors } from "./takeoverSeat.js";

/** The harness name an app-hosted session's ledger row records. */
const APP_HARNESS = "app";

/**
 * The label a gone predecessor is printed by: its recorded workspace ref, or `app:<id>`.
 *
 * @param target where the pin record says the chair was hosted
 * @returns the label
 */
export function gonePredecessorLabel({ target }: { target: SupervisorPinTarget }): string {
  if (target.kind === "app") {
    return appPinLabel({ appSessionId: target.appSessionId });
  }
  return target.workspaceRef;
}

/**
 * Whether cmux's STRICT inventory confirms a cmux chair gone. The everyday `listWorkspaces` drops a row missing a ref
 * or directory and a whole window whose reply carries no id, so a malformed reply reads as an empty inventory and a
 * live chair as unlisted; only `listWorkspacesStrict`, which fails where that one drops, may conclude it absent.
 *
 * @param inventory what `listWorkspacesStrict` answered
 * @param target the cmux chair the pin record names
 * @returns ok when the strict inventory read whole and lists no workspace with its id, else why it cannot be called gone
 */
export function goneCmuxConfirmation({
  inventory,
  target,
}: {
  inventory: Result<readonly CmuxWorkspaceSummary[], CmuxError>;
  target: Extract<SupervisorPinTarget, { readonly kind: "cmux" }>;
}): Result<void, TakeoverResolutionError> {
  const label = target.workspaceRef;
  if (inventory.isErr()) {
    return err(TakeoverResolutionErrors.goneUnconfirmed({ label, why: inventory.error.message }));
  }
  if (inventory.value.some((workspace) => workspace.workspaceId === target.workspaceId)) {
    return err(TakeoverResolutionErrors.goneUnconfirmed({ label, why: "the strict inventory lists it" }));
  }
  return ok(undefined);
}

/** The exact id the target names: the app session id, or the cmux workspace id. */
function targetId({ target }: { target: SupervisorPinTarget }): string {
  if (target.kind === "app") {
    return target.appSessionId;
  }
  return target.workspaceId;
}

/**
 * Whether a row carries the target's id in EITHER id field. The ledger fold reads a row's session id as its
 * `sessionId`, else its `workspaceId` (`../sessions/sessionRow.ts`), so a row carrying the id in either is one a
 * close naming that id can reach, and must count here, whichever host recorded it.
 */
function carriesId({ row, target }: { row: SessionItem; target: SupervisorPinTarget }): boolean {
  const id = targetId({ target });
  return row.sessionId === id || row.workspaceId === id;
}

/** Whether a row was recorded under the same host as the target. */
function sameHost({ row, target }: { row: SessionItem; target: SupervisorPinTarget }): boolean {
  return (row.harness === APP_HARNESS) === (target.kind === "app");
}

/**
 * The ONE open ledger row a gone predecessor answers to, matched by the exact id its pin record carries.
 *
 * @param rows the folded session ledger, any status
 * @param target where the pin record says the chair was hosted
 * @returns the row, or why no single row answers
 */
export function gonePredecessorLedgerRow({
  rows,
  target,
}: {
  rows: readonly SessionItem[];
  target: SupervisorPinTarget;
}): Result<SessionItem, TakeoverResolutionError> {
  const label = gonePredecessorLabel({ target });
  const open = rows.filter((row) => row.status === "open" && carriesId({ row, target }));
  if (open.some((row) => !sameHost({ row, target }))) {
    return err(
      TakeoverResolutionErrors.goneRowUnmatched({ label, why: "an open row carries its id under another host" }),
    );
  }
  const row = open[0];
  if (row === undefined || open.length > 1) {
    return err(
      TakeoverResolutionErrors.goneRowUnmatched({ label, why: `${String(open.length)} open rows carry its id` }),
    );
  }
  return ok(row);
}

/**
 * The `closed` event that ends a gone predecessor's row: its key, its session id and ref, and its own spawn instant,
 * so the fold closes exactly that row and never a sibling a duplicate spawn left under the same key or a reissued
 * ref (`../sessions/session.ts`'s `applyClosed`).
 *
 * @param row the row {@link gonePredecessorLedgerRow} chose
 * @param tsIso when the row is ended
 * @returns the event to append
 */
export function gonePredecessorCloseEvent({ row, tsIso }: { row: SessionItem; tsIso: string }): SessionEvent {
  return {
    kind: "closed",
    sessionKey: row.sessionKey,
    tsIso,
    ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
    ...(row.workspaceRef === undefined ? {} : { workspaceRef: row.workspaceRef }),
    ...(row.spawnedIso === undefined ? {} : { spawnedIso: row.spawnedIso }),
  };
}

/**
 * How many OPEN rows the close for `row` would end, found by folding the ledger with and without it: the fold is the
 * one reader whose targeting counts, so the check asks it rather than restating its precedence. A takeover ends the
 * row only when this is exactly one.
 *
 * @param events the session ledger's events, in file order
 * @param row the row {@link gonePredecessorLedgerRow} chose
 * @returns the number of rows the close moves from open to closed
 */
export function gonePredecessorCloseReach({
  events,
  row,
}: {
  events: readonly SessionEvent[];
  row: SessionItem;
}): number {
  const before = foldSessions({ events });
  const close = gonePredecessorCloseEvent({ row, tsIso: row.lastEventIso });
  const after = foldSessions({ events: [...events, close] });
  if (after.length !== before.length) {
    return 0;
  }
  return before.filter((item, index) => item.status === "open" && after[index]!.status === "closed").length;
}
