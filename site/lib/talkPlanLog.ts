/**
 * One line in the console server's own log for each plan call opened and ended, with why it ended and how long it
 * lived. Measured: before it, a call that ended on the absent-stream timer after the voice window crashed left nothing on
 * the server side saying when or why. The server's output is the run record's log
 * (`scripts/docs-site.sh` names it); reproduce a reading with `grep "talk plan call" <that log>`. Pure.
 */

/** What happened to the call. */
export type PlanCallLogEvent =
  | { readonly kind: "opened"; readonly outcome: string }
  | { readonly kind: "ended"; readonly reason: string; readonly livedMs: number };

/**
 * The line for one event.
 *
 * @param id the plan call's id
 * @param atIso when it happened
 * @param event opened with its handshake's outcome, or ended with its reason and lifetime
 * @returns one line, no newline
 */
export function planCallLogLine({ id, atIso, event }: { id: string; atIso: string; event: PlanCallLogEvent }): string {
  if (event.kind === "opened") {
    return `${atIso} talk plan call ${id} opened: ${event.outcome}`;
  }
  const seconds = Math.round(event.livedMs / 1000);
  return `${atIso} talk plan call ${id} ended after ${String(seconds)}s: ${event.reason}`;
}
