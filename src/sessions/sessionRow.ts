/**
 * Which ledger row a live session holds — by the session harness's id, which survives a cmux restart, before the
 * handle a restart reissues. The `closed` fold in `./session.ts` reads the same precedence.
 */
import type { SessionItem } from "./session.js";

/**
 * The id a row's session is addressed by for its whole life: the harness's own `sessionId`, else — on a row
 * written before the session harness, which equals it under cmux — the workspace UUID, else none.
 *
 * @param row the folded row
 * @returns the id, or `undefined` for a row that recorded neither
 */
export function rowSessionId({ row }: { row: SessionItem }): string | undefined {
  if (row.sessionId !== undefined) {
    return row.sessionId;
  }
  return row.workspaceId;
}

/**
 * The OPEN row one live session holds: by its session id first, which survives a cmux restart, then by its handle
 * (the recorded `workspaceRef`) for a row that recorded no id — exactly the precedence a `closed` event's fold uses
 * (`./session.ts`'s `closedTargets`). That includes its one subtlety: the handle fallback applies only when NO row, open or
 * closed, carries the id, because a close naming that id would land on that row and never fall back.
 *
 * @param items the folded ledger
 * @param sessionId the session's id as the harness reports it
 * @param handle the session's handle as the harness reports it
 * @returns the open row, or `undefined` when the ledger tracks none for it
 */
export function openRowForSession({
  items,
  sessionId,
  handle,
}: {
  items: readonly SessionItem[];
  sessionId: string;
  handle: string;
}): SessionItem | undefined {
  const byId = items.filter((row) => rowSessionId({ row }) === sessionId);
  if (byId.length > 0) {
    return byId.find((row) => row.status === "open");
  }
  return items.find(
    (row) => row.status === "open" && rowSessionId({ row }) === undefined && row.workspaceRef === handle,
  );
}

/**
 * The app session a run's `resume` continues: the newest OPEN row for the slug, keyed by it, that the desktop app
 * hosts. A row stays open only when nothing proved the session closed (a quit or a killed app), which is exactly when
 * its vendor transcript is worth continuing; the app itself refuses one it still runs or has journalled closed.
 *
 * @param items the folded ledger, newest row first as `foldSessions` returns it
 * @param slug the handover slug the run is for
 * @returns the app session id, or `undefined` when the run holds no open app row
 */
export function openAppSessionForSlug({
  items,
  slug,
}: {
  items: readonly SessionItem[];
  slug: string;
}): string | undefined {
  // Ledger order, newest row first as the fold returns it, never the timestamps a clock set back would reorder. Keyed
  // by the slug too, as the `resumed` event is written under it: a row under another key would not reopen. The newest
  // row decides, even one that recorded no id: an older id behind it is not the session to continue.
  const newest = items.find(
    (row) => row.status === "open" && row.harness === "app" && row.slug === slug && row.sessionKey === slug,
  );
  const sessionId = newest?.sessionId;
  // An empty id names no session the app could resume, so the run opens a fresh card, exactly as with none.
  if (sessionId === undefined || sessionId === "") {
    return undefined;
  }
  return sessionId;
}
