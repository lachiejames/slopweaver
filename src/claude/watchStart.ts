/**
 * Whether a new `claude watch` may start — pure. The verb reads the process table and the loop's own record,
 * this decides what the two mean.
 *
 * ## Why a start is checked at all
 *
 * Every watch rewrites the ONE keep-alive record and may rotate the active credential, so a second watch
 * beside a live one is not harmless redundancy: it doubles the credential writers and makes the gauge wrong
 * in both directions. MEASURED: a second watch, started by a mistyped flag the verb then
 * ignored, took the record over, and killing it made `session standing` say "keep-alive: NOT running"
 * while the first watch was still ticking. The strict parser now refuses the mistyped flag; this refuses
 * the second start.
 *
 * ## What it is NOT — the residue, stated rather than discovered
 *
 * This is a SNAPSHOT admission check, not a fence. Two watches started inside one snapshot window can both
 * read the table before either appears in it, and both pass; two `--wait` successors queued behind one
 * incumbent both see it exit and are both released. Each released loop re-checks admission itself, so two
 * released in one instant both run when neither sees the other, and both REFUSE when each does — leaving
 * none running, which the gauge then reads as absent rather than hiding a second writer. Nothing here claims more exclusivity than one reading
 * of the table shows. What closes the gap is that `session standing` reconciles the record against the
 * same table and reports every running watcher, so a duplicate that slips through is VISIBLE on the next
 * sweep and exits it non-clear — it is exposed, not prevented. A fenced lifetime-ownership protocol is
 * follow-up work, not a property
 * of this module.
 */
import { type ProcessSnapshot } from "../live/standing/inspect.js";
import { type ClaudeWatchProcess, standingWatchProcesses } from "../live/standing/processes.js";
import { type CheckoutComparator, lexicallySameCheckout } from "./watchSession.js";

/** What a start-up admission concluded. Only `ready` lets a watch begin writing. */
export type ClaudeWatchStartDecision =
  | { readonly kind: "ready" }
  /** The table could not be read, so no incumbent can be ruled out — fail closed. */
  | { readonly kind: "unreadable"; readonly problem: string }
  /** Another watch is already keeping the stores alive. */
  | { readonly kind: "occupied"; readonly watchers: readonly ClaudeWatchProcess[] };

/**
 * Decide whether this process may start keeping the stores alive.
 *
 * An incumbent is any other running watch that is not queued. A `--wait` watch counts as queued EXCEPT
 * when it is the one the record names: a waiter carries `--wait` in its argv for its whole life, including
 * after it was released and began ticking, and the record is the only thing that says it took over.
 * Without that promotion the canonical boot line (`claude watch --wait`) would produce an incumbent nothing
 * else ever sees, and the check would pass every second start beside it.
 *
 * @param processId this process's own pid, excluded so a watch never refuses itself
 * @param recorded the pid and checkout the keep-alive record names, when it could be read
 * @param snapshot one reading of the process table
 * @returns ready, occupied with every incumbent, or unreadable
 */
export function claudeWatchStartDecision({
  processId,
  recorded,
  sameCheckout = lexicallySameCheckout,
  snapshot,
}: {
  readonly processId: number;
  readonly recorded: { readonly pid: number; readonly cwd: string } | undefined;
  readonly sameCheckout?: CheckoutComparator;
  readonly snapshot: ProcessSnapshot;
}): ClaudeWatchStartDecision {
  if (snapshot.kind === "unreadable") {
    return { kind: "unreadable", problem: snapshot.problem };
  }
  const watchers = standingWatchProcesses({ processes: snapshot.rows }).filter((watcher) => {
    // Pid AND checkout, compared by the injected comparator exactly as the gauge's owner match is.
    const isRecordedOwner =
      recorded !== undefined &&
      watcher.pid === recorded.pid &&
      sameCheckout({ left: watcher.cwd, right: recorded.cwd });
    return watcher.pid !== processId && (!watcher.waiting || isRecordedOwner);
  });
  return watchers.length === 0 ? { kind: "ready" } : { kind: "occupied", watchers };
}

/**
 * The one clause a refusal or a wait line carries for a decision that is not `ready`.
 *
 * @param decision an `occupied` or `unreadable` decision
 * @returns what this invocation saw, for the refusal's detail
 */
export function claudeWatchStartDetail({
  decision,
}: {
  readonly decision: Exclude<ClaudeWatchStartDecision, { readonly kind: "ready" }>;
}): string {
  if (decision.kind === "unreadable") {
    return `${decision.problem}, so no running watch can be ruled out`;
  }
  const running = decision.watchers.map((watcher) => `pid ${String(watcher.pid)} from ${watcher.cwd}`).join(", ");
  return `already running: ${running}`;
}
