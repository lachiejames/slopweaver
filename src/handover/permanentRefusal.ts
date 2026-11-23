/**
 * The refusals `cmux spawn` makes of a row that NO later tick can lift — a settled ask, a finished or shipped
 * run, a derived terminal status — said once, so the door that refuses and the wake that would knock on it
 * cannot drift apart.
 *
 * A pause is deliberately not here: it is a decision waiting on a person, and unpausing makes the row
 * spawnable again. MEASURED: two settled asks held parks with wakes, and every `handover wake`
 * spent two of its three spawns on a `cmux spawn` that refused them, deferring nine live parks
 * (`supervisor-scratch/handoff-<n>/tick-29/handover-wake.json`).
 *
 * Pure: a parsed doc and an already-read journal in, a verdict out.
 */

import { settledAskOf, settledAskRefusal } from "./askRow.js";
import { ALLOW_RERUN, finishedRunRefusal } from "./boardRefusal.js";
import { runDisposition } from "./boardTypes.js";
import { derivedRowState } from "./derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus } from "./doc.js";
import type { RunEvent } from "./ledger.js";

/** Which permanent refusal applies, the door's own sentence, and the short reason a journal line may carry. */
export interface PermanentRefusal {
  readonly kind: "settled-ask" | "finished-cycle" | "terminal-status";
  /** The sentence the execution door prints. */
  readonly message: string;
  /** One controlled line naming the fact, short enough for a journal `why`. */
  readonly reason: string;
}

/**
 * The refusal for a row whose journal records that its work SHIPPED anywhere in it, or whose current cycle
 * already finished — the closure half of `../cli/commands/handover/finishedCycleGate.ts`, which keeps only the
 * break-glass and the printing.
 *
 * A recorded shipment is asked first and across the WHOLE journal, because the case it exists for has no
 * cycle at all: `handover close` is the verb for a row whose probes already pass and which nobody ever ran,
 * and `runDisposition` reads only from the last `started`, so on such a row it answers `never-started`.
 *
 * @param unreadableLines line numbers the journal reader could not decode
 * @returns the sentence refusing it, or `undefined` when neither closure applies
 */
export function finishedCycleRefusal({
  doc,
  events,
  unreadableLines,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
}): string | undefined {
  const shipped = events.findLast((event) => event.kind === "closed");
  if (shipped === undefined) {
    return finishedRunRefusal({ doc, run: runDisposition({ events, unreadableLines }) });
  }
  return (
    `${doc.slug} recorded that its work SHIPPED at ${shipped.atIso}: ${shipped.summary} — ` +
    `a closed row is not work to pick up, whatever \`status:\` still says. Read what it did: ` +
    `\`slopweaver handover resume ${doc.slug}\`. If there is genuinely more to do, register a new row; ` +
    `to re-open THIS one deliberately, \`${ALLOW_RERUN}=1\` on the same command.`
  );
}

/**
 * The first permanent refusal a row meets, in the door's own order: settled ask, finished or shipped run, then
 * any other terminal status the register derives. With the finished-run break-glass open, a finished or shipped
 * run is no refusal at all, exactly as `cmux spawn` lets it through.
 *
 * @param unreadableLines line numbers the journal reader could not decode
 * @param rerunAllowed whether the caller's environment opened the finished-run break-glass ({@link ALLOW_RERUN})
 * @returns the refusal, or `undefined` when nothing permanent stops a spawn
 */
export function permanentRefusalOf({
  doc,
  events,
  rerunAllowed,
  unreadableLines,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  rerunAllowed: boolean;
  unreadableLines: readonly number[];
}): PermanentRefusal | undefined {
  const settled = settledAskOf({ doc });
  const settledMessage = settledAskRefusal({ doc });
  if (settled !== undefined && settledMessage !== undefined) {
    return { kind: "settled-ask", message: settledMessage, reason: `the ask is settled ${settled.settlement}` };
  }
  const finished = rerunAllowed ? undefined : finishedCycleRefusal({ doc, events, unreadableLines });
  if (finished !== undefined) {
    return { kind: "finished-cycle", message: finished, reason: "the run already finished or shipped" };
  }
  const derived = derivedRowState({ doc, events });
  if (isTerminalDocStatus(derived.status)) {
    return {
      kind: "terminal-status",
      message: `${doc.slug} is ${derived.status} — refusing to spawn a session on closed work`,
      reason: `the row is ${derived.status}`,
    };
  }
  return undefined;
}
