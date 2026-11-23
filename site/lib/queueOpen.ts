/**
 * Which row a `?open=` key opens — its exact key first, then a row that answers to it as an alias.
 *
 * A decision hand step's note opens `ask:<slug>`, and that ask draws no row of its own: the step absorbed it
 * (`./handStepAsk.ts`'s `linkedHandDecision`). Before this, the link landed on the "no such row" panel for every
 * decision step ever posted. Exact-first, so a live row under the key itself can never be shadowed by an alias.
 *
 * Pure: rows and a key in, a row out, and shared by every page that opens a panel, so the unit lane tests it without
 * React or Next.
 */

import type { QueueRow } from "./queueRows";

/**
 * Whether `row` opens under `open` — its own key, or one of its aliases.
 *
 * @param row the queue row
 * @param open the key `?open=` names
 * @returns true when the row answers to that key
 */
export function rowOpensAs({ row, open }: { row: QueueRow; open: string }): boolean {
  return row.key === open || row.aliases?.includes(open) === true;
}

/**
 * The row `?open=` opens among `rows`: the one whose own key it is, else the first that answers to it as an alias.
 *
 * @param rows the rows to look in
 * @param open the key `?open=` names
 * @returns the row, or `undefined` when none answers to the key
 */
export function rowForOpen({ rows, open }: { rows: readonly QueueRow[]; open: string }): QueueRow | undefined {
  const exact = rows.find((row) => row.key === open);
  if (exact !== undefined) {
    return exact;
  }
  return rows.find((row) => row.aliases?.includes(open) === true);
}

/**
 * {@link rowOpensAs} over what a page holds mid-render: no panel open, or no row snapshotted yet, opens nothing.
 *
 * @param row the row, when there is one
 * @param open the key `?open=` names, or `null` when no panel is open
 * @returns true when both are present and the row answers to the key
 */
export function opensAs({ row, open }: { row: QueueRow | undefined; open: string | null }): boolean {
  if (row === undefined || open === null) {
    return false;
  }
  return rowOpensAs({ open, row });
}

/**
 * The snapshot an open panel may still draw once its row left the list: kept for a press's own outcome, and
 * dropped when the context does not show it — as it was snapshotted, or as every register holds it NOW. A board
 * refresh that moves an open row to the other workspace would otherwise leave the old placement on screen.
 *
 * @param snapshot the row as the panel last saw it
 * @param open the key `?open=` names, or `null` when no panel is open
 * @param every every row every register holds, in both work contexts
 * @param shows whether this context draws a row
 * @returns the snapshot to draw, or `undefined` when this context must not draw it
 */
export function keptSnapshot({
  snapshot,
  open,
  every,
  shows,
}: {
  snapshot: QueueRow | undefined;
  open: string | null;
  every: readonly QueueRow[];
  shows: (row: QueueRow) => boolean;
}): QueueRow | undefined {
  if (snapshot === undefined || !shows(snapshot)) {
    return undefined;
  }
  if (open === null) {
    return snapshot;
  }
  const current = rowForOpen({ open, rows: every });
  if (current !== undefined && !shows(current)) {
    return undefined;
  }
  return snapshot;
}

/**
 * The open key a switch of the selector closes: one whose row every register still holds and the context just
 * switched to does not show. The owner switched away from it, so the panel closes — the deep-link path, which switches
 * the selector TO a row's workspace, would otherwise take the switch they just made straight back.
 *
 * @param open the key `?open=` names, or `null` when no panel is open
 * @param every every row every register holds, in both work contexts
 * @param shows whether the context switched to draws a row
 * @returns the key to close, or `undefined` when the switch leaves the panel as it is
 */
export function closedBySwitch({
  open,
  every,
  shows,
}: {
  open: string | null;
  every: readonly QueueRow[];
  shows: (row: QueueRow) => boolean;
}): string | undefined {
  if (open === null) {
    return undefined;
  }
  const current = rowForOpen({ open, rows: every });
  if (current === undefined || shows(current)) {
    return undefined;
  }
  return open;
}
