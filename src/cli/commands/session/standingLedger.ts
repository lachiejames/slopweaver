/**
 * `session standing`'s ledger lookups: which session-ledger row a caller's key names, open or whatever its status.
 *
 * These are ATTRIBUTION reads — which slug, which worktree — and liveness never comes from here: it is read from
 * each session's own records, never the ledger, and `./standing.ts`'s "Liveness is read from each session's own
 * records" header section carries the measurement that made it so.
 */
import type { SessionItem } from "../../../sessions/session.js";

/**
 * The ledger's own OPEN item for a given session key, or `undefined` when it is not tracked at all, or is
 * tracked but already closed.
 *
 * @param items every ledger item
 * @param sessionKey the key the caller resolved as the loop's own
 * @returns the loop's ledger item, if one is tracked and still open
 */
export function findOpenSession({
  items,
  sessionKey,
}: {
  readonly items: readonly SessionItem[];
  readonly sessionKey: string;
}): SessionItem | undefined {
  return items.find((item) => item.status === "open" && item.sessionKey === sessionKey);
}

/**
 * The ledger's item for a given key whatever its status — the ATTRIBUTION lookup, as distinct from
 * {@link findOpenSession}'s liveness one.
 *
 * A closed row still records the right worktree, and here that matters: measured, two `spawned`
 * rows for one loop slug and a single `closed` row carrying no workspace collapsed the pair, so the loop's
 * item folded to `closed` while the loop was demonstrably running. Reading only OPEN rows would have thrown
 * away the one cwd needed to find its cmux workspace — and with it the plugin-dir half of the whole report.
 * Liveness never comes from here (see this module's header); the path does.
 *
 * @param items every ledger item
 * @param sessionKey the key the caller resolved as the loop's own
 * @returns the item, open or closed, or `undefined` when the key is not tracked at all
 */
export function findAnySession({
  items,
  sessionKey,
}: {
  readonly items: readonly SessionItem[];
  readonly sessionKey: string;
}): SessionItem | undefined {
  return items.find((item) => item.sessionKey === sessionKey);
}
