/**
 * The preflight's third read, beside the target console's registry and the machine's leases: a call in the shared
 * call store that this leg did not place, that never wrote its end, and that was heard from recently. Pure; the read
 * is `src/cli/commands/desktop/e2eCallLegPlan.ts`.
 *
 * A call held in ANOTHER console whose lease had lapsed is invisible to the other two reads,
 * since the registry asked is the target console's alone. Every console writes into the one call store, so a call that
 * is still being written to is seen here whichever console holds it. A call that dropped without an end stops being
 * written, so it ages out of {@link UNENDED_CALL_QUIET_MS} rather than blocking every leg after it. A call of the owner's that
 * is still up but went quiet here, its console no longer beating or writing, still holds the real microphone, which the
 * on-call hold reads before every scenario and after it (`./onCallHold.ts`). **One residual, stated**: a call whose console has stopped beating its lease, writing its file AND holding the microphone for
 * five minutes leaves nothing on this machine that tells it from a call that dropped, so it is read as dropped. Holding
 * every leg until such a call writes an end it never will is the alternative, and it would stop e2e for good.
 *
 * Only this leg's own calls are passed over, never every test instance's: another leg's call left
 * open is a call beside which no test call is placed either.
 */
import type { CallsKeep } from "../talk/callReadWindow.js";
import type { CallRecord } from "../talk/callRecord.js";

/**
 * Which calls the preflight reads: every one. A file's mtime is not when its call was last heard from — a restored or
 * copied file keeps an old one — so a window on the files would hide a call {@link unendedCallIds} counts as open
 * — a count with no ceiling rather than an early instant, which a file's mtime can precede. The store holds one small file per call, so reading them all costs little.
 */
export const UNENDED_CALLS_KEEP: CallsKeep = { limit: Number.POSITIVE_INFINITY };

/** How recently an unended call must have been heard from to count as open: a judgement value, generous on purpose. */
export const UNENDED_CALL_QUIET_MS = 5 * 60 * 1000;

/**
 * The calls that may still be open beside a test call.
 *
 * @param calls the calls the store holds, any order
 * @param nowMs the instant judged
 * @param placed the ids of the calls this leg placed itself
 * @returns the ids of every call this leg did not place, never ended and heard from within the quiet window
 */
export function unendedCallIds({
  calls,
  nowMs,
  placed,
}: {
  calls: readonly Pick<CallRecord, "callId" | "ended" | "lastIso">[];
  nowMs: number;
  placed: readonly string[];
}): readonly string[] {
  return calls
    .filter(
      (call) =>
        call.ended === undefined &&
        !placed.includes(call.callId) &&
        nowMs - Date.parse(call.lastIso) <= UNENDED_CALL_QUIET_MS,
    )
    .map((call) => call.callId);
}

/**
 * The calls this leg did not place that were open at any instant while one scenario ran. The preflight's reads are
 * snapshots, never a lock the owner's consoles take, so a call the owner opens between the last read and the test call is not
 * prevented; this is the read after the scenario that DETECTS it, so the leg stops and says so rather than placing
 * another beside it. A call is open from when it opened to when it ended, or to when it was last
 * heard from when it never wrote an end.
 *
 * @param calls the calls the store holds, any order
 * @param placed the ids of the calls this leg placed itself
 * @param fromMs when the scenario began, before its preflight's last read
 * @param toMs when the scenario's session was closed
 * @returns the ids of every call this leg did not place whose open span meets the scenario's
 */
export function overlappedCallIds({
  calls,
  placed,
  fromMs,
  toMs,
}: {
  calls: readonly Pick<CallRecord, "callId" | "ended" | "lastIso" | "openedIso">[];
  placed: readonly string[];
  fromMs: number;
  toMs: number;
}): readonly string[] {
  return calls
    .filter((call) => {
      let closedMs = Date.parse(call.lastIso);
      if (call.ended !== undefined) {
        closedMs = Date.parse(call.ended.atIso);
      }
      return !placed.includes(call.callId) && Date.parse(call.openedIso) <= toMs && closedMs >= fromMs;
    })
    .map((call) => call.callId);
}
