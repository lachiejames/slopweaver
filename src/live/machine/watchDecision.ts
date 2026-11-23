/**
 * WHAT ONE SAMPLE OF `slopweaver machine watch` SHOULD DO — pure, so the verb's shell is a loop around a
 * decision rather than a decision spread through a loop.
 *
 * ## The one rule this module exists to hold
 *
 * **A row is written for every anomalous reading; only the SEAT is rate-limited.** `./backoff.ts`'s header
 * carries the deadlock this avoids in full; the short version is that suppressing the row leaves the hold
 * true, the gate refusing, and the operator's own way past the refusal suppressed too.
 *
 * So there are exactly three outcomes, and the seated/unseated split is never silence:
 *
 * - **`nothing`** — the reading is clear. Write nothing, say nothing.
 * - **`dispatch` with a seat** — anomalous, nobody is on this signature, and the backoff window has passed.
 * - **`dispatch` without a seat** — anomalous, and one of two REAL reasons: a live investigation already
 *   holds this signature, or the backoff window has not passed. The row records which, in words.
 *
 * A live investigation is checked BEFORE the backoff and is not a backoff case. Doubling a window because an
 * investigation is still running would punish the fleet for working — the reason not to open a second seat
 * there is a liveness fact, not a rate limit.
 */
import type { MachineAnomaly } from "./anomaly.js";
import { backoffFor } from "./backoff.js";
import type { DispatchRow, DispatchSeat } from "./dispatchRow.js";
import { rowsForSignature } from "./dispatchStore.js";

/** What one sample concluded. */
export type WatchDecision =
  /** The machine is fine. Nothing is written. */
  | { readonly kind: "nothing" }
  /** The machine is not fine. A row is written either way; `seat` says whether one was opened. */
  | { readonly kind: "dispatch"; readonly anomaly: MachineAnomaly & { kind: "anomalous" }; readonly seat: SeatCall };

/**
 * Whether to open a seat, or the reason — in words — that this dispatch opens none.
 *
 * @internal reached through {@link WatchDecision}'s `seat` arm; no consumer names the type itself.
 */
export type SeatCall =
  | { readonly kind: "open" }
  /** Pre-built so the caller never has to compose the sentence itself. */
  | { readonly kind: "skip"; readonly seated: DispatchSeat & { kind: "none" } };

/**
 * Decide what one sample should do.
 *
 * @param anomaly the judgement of this sample's capacity reading
 * @param rows every row already in the register
 * @param liveSignatures the signatures an investigation is CURRENTLY open on — a liveness fact the caller
 *   reads off cmux, never a rate limit
 * @param nowIso the instant the backoff window is measured against
 * @returns what to write and whether to seat
 */
export function watchDecision({
  anomaly,
  rows,
  liveSignatures,
  nowIso,
}: {
  anomaly: MachineAnomaly;
  rows: readonly DispatchRow[];
  liveSignatures: ReadonlySet<string>;
  nowIso: string;
}): WatchDecision {
  if (anomaly.kind === "clear") {
    return { kind: "nothing" };
  }
  if (liveSignatures.has(anomaly.signature)) {
    return {
      anomaly,
      kind: "dispatch",
      seat: {
        kind: "skip",
        seated: { kind: "none", why: `an investigation is already live on ${anomaly.signature}` },
      },
    };
  }
  const backoff = backoffFor({ nowIso, rows: rowsForSignature({ rows, signature: anomaly.signature }) });
  if (backoff.maySeat) {
    return { anomaly, kind: "dispatch", seat: { kind: "open" } };
  }
  let until = "an unreadable instant on the newest row";
  if (backoff.nextSeatIso !== undefined) {
    until = backoff.nextSeatIso;
  }
  return {
    anomaly,
    kind: "dispatch",
    seat: {
      kind: "skip",
      seated: {
        kind: "none",
        why:
          `backoff: ${String(backoff.consecutive)} unsettled dispatch(es) on this signature, ` +
          `${String(backoff.windowSeconds)}s window, next seat at ${until}`,
      },
    },
  };
}
