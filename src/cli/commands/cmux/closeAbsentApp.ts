/**
 * `cmux close app:<id> --harness app` for a session the app no longer hosts: the app answers `SESSION_NOT_FOUND`
 * to the close's `resolve`, so no close is ever sent and, before this, nothing was written either — the ledger row
 * stayed open forever, read by every later spawn as a session to continue.
 *
 * The app's refusal is the proof the session is gone; what remains is which ledger row it ends. That choice is
 * EXACT: the operand must name one open app row by its recorded handle or session id. Never by slug, never the
 * newest row, never a near match — closing the wrong historical row would hide a live seat. Every other failure
 * (the app unreachable, an operation failure, a cmux session, no exact open row, two of them) keeps today's error.
 *
 * Pure decisions with one thin shell over injected effects, so a test drives it with plain functions.
 */
import { APP_SESSION_HANDLE_PREFIX as APP_PREFIX } from "../../../sessionHarness/appProtocol.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import type { HarnessName } from "../../../sessionHarness/harnessChoice.js";
import type { SessionEvent, SessionItem } from "../../../sessions/session.js";

/**
 * The handle an app row is addressed by: `app:` and its recorded session id, else the handle it recorded.
 *
 * @param row an app ledger row
 * @returns the handle, or `undefined` for a row that recorded neither
 */
function appRowHandle({ row }: { row: SessionItem }): string | undefined {
  if (row.sessionId !== undefined && row.sessionId.length > 0) {
    return `${APP_PREFIX}${row.sessionId}`;
  }
  return row.workspaceRef;
}

/**
 * Whether the operand names this row exactly: its recorded handle, its session id bare, or `app:` and that id.
 *
 * @param row an app ledger row
 * @param handle the operand the caller typed
 * @returns true only on an exact match
 */
function namesRow({ row, handle }: { row: SessionItem; handle: string }): boolean {
  if (handle.length === 0) {
    return false;
  }
  const id = row.sessionId;
  const byId = id !== undefined && id.length > 0 && (handle === id || handle === `${APP_PREFIX}${id}`);
  return byId || (row.workspaceRef !== undefined && row.workspaceRef === handle);
}

/**
 * The ONE open app ledger row a close may end after the app proved the session absent, or `undefined` to keep
 * today's failure.
 *
 * A target exists only when every condition holds: the caller named the app harness, the app answered
 * `SESSION_NOT_FOUND` (not unreachable, not an operation failure), and exactly one OPEN row the app hosts carries
 * the operand as its handle or session id. Two matching rows are ambiguous and close neither.
 *
 * @param harness the harness the caller named
 * @param handle the operand the caller typed
 * @param error what the harness answered
 * @param rows the folded session ledger
 * @returns the row to close, or `undefined`
 */
export function absentAppCloseTarget({
  harness,
  handle,
  error,
  rows,
}: {
  harness: HarnessName;
  handle: string;
  error: SessionHarnessError;
  rows: readonly SessionItem[];
}): SessionItem | undefined {
  if (harness !== "app" || error.code !== "SESSION_NOT_FOUND") {
    return undefined;
  }
  const matches = rows.filter((row) => row.status === "open" && row.harness === "app" && namesRow({ handle, row }));
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

/**
 * The `closed` event that ends an absent app session's row, and the line the verb prints for it — shaped as the
 * recording harness's own close of a parked session, naming both the session id and the handle so the fold lands
 * on exactly that row (`../../../sessions/session.ts`'s `closedTargets`).
 *
 * @param row the row {@link absentAppCloseTarget} chose
 * @param tsIso when the close is recorded
 * @returns the event to append and the stdout line
 */
export function absentAppClose({ row, tsIso }: { row: SessionItem; tsIso: string }): {
  readonly event: SessionEvent;
  readonly line: string;
} {
  const event: SessionEvent = {
    kind: "closed",
    sessionKey: row.sessionKey,
    tsIso,
    ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
    ...(row.workspaceRef === undefined ? {} : { workspaceRef: row.workspaceRef }),
  };
  return { event, line: `cmux close: ${closedRowName({ row })} is already gone; closed its ledger row` };
}

/**
 * The name the close line gives a row: its handle, else its session key when the row records neither an app
 * session id nor a workspace ref.
 *
 * @returns the handle or the session key
 */
function closedRowName({ row }: { row: SessionItem }): string {
  const handle = appRowHandle({ row });
  if (handle === undefined) {
    return row.sessionKey;
  }
  return handle;
}

/** The effects closing an absent app session's row needs: the real session ledger in production, plain functions in a test. */
export interface AbsentAppCloseDeps {
  /**
   * The folded session ledger as it stands now.
   *
   * @returns every row
   */
  readonly rows: () => readonly SessionItem[];
  /**
   * Append one event to the session ledger.
   *
   * @param options the event
   */
  readonly append: (options: { event: SessionEvent }) => void;
  /**
   * The current instant, ISO 8601.
   *
   * @returns the instant
   */
  readonly nowIso: () => string;
}

/**
 * After a close the harness failed: end the exact open app row when the app proved its session gone, and say so.
 *
 * @param harness the harness the caller named
 * @param handle the operand the caller typed
 * @param error what the harness answered
 * @param deps the ledger effects
 * @returns the line to print when a row was closed, or `undefined` to keep today's failure
 */
export function closeAbsentAppRow({
  harness,
  handle,
  error,
  deps,
}: {
  harness: HarnessName;
  handle: string;
  error: SessionHarnessError;
  deps: AbsentAppCloseDeps;
}): string | undefined {
  if (harness !== "app" || error.code !== "SESSION_NOT_FOUND") {
    // Decided before the ledger is read: every other failure keeps today's error without touching the file.
    return undefined;
  }
  const row = absentAppCloseTarget({ error, handle, harness, rows: deps.rows() });
  if (row === undefined) {
    return undefined;
  }
  const { event, line } = absentAppClose({ row, tsIso: deps.nowIso() });
  deps.append({ event });
  return line;
}
