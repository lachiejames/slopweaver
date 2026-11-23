/**
 * The one step of `supervisor tick-capture` that writes outside the tick's own directory: appending a reading
 * it just took to the readings ledger, which every console page reads. Its own module because what may enter
 * that ledger is a rule of its own, and `scratchRun.ts` is held under the file-size ratchet.
 */
import { readFileSync } from "node:fs";

import { isSkipText } from "../../../readings/row.js";
import { type ReadingOutcome, type TickReading, tickReadingProducer } from "../../../supervisor/scratch/tickCapture.js";
import type { ScratchDeps } from "./scratchDeps.js";

/**
 * Append one reading to the readings ledger, when it is a complete JSON document its reading does not keep out
 * (`TickReading.ledgered`, the drafts slice): a text reading is not a document, and an incomplete or empty one is exactly what a page must never show as the world. Nor is a
 * cadence skip (`isSkipText`), `github landing --if-due` saying this tick did not read, which the console
 * once showed as the latest landing and blanked both sidebar badges over. The document is the file's own
 * bytes (`sizeOf` already bounded them) and the instant is the child's exit. A refusal is a diagnostic: the
 * tick keeps its file either way, and a ledger that would not take it is a fact about the ledger.
 *
 * @param by who took it, `tick-<label>`
 * @param home the state home the ledger lives under, when `--home` named one
 * @param path the file the child's stdout was streamed to
 * @returns the ledger row's id, or undefined when nothing was recorded
 */
export function appendToLedger({
  by,
  deps,
  home,
  outcome,
  path,
  reading,
}: {
  by: string;
  deps: Pick<ScratchDeps, "now" | "recordReading" | "writeDiagnostic">;
  home: string | undefined;
  outcome: ReadingOutcome;
  path: string;
  reading: TickReading;
}): string | undefined {
  if (reading.format !== "json" || reading.ledgered === false || !outcome.completed || outcome.bytes === 0) {
    return undefined;
  }
  let document: string;
  try {
    document = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    deps.writeDiagnostic(`supervisor tick-capture: ${reading.name} was not appended to the readings ledger — ${why}`);
    return undefined;
  }
  if (isSkipText({ printed: document })) {
    return undefined;
  }
  const recorded = deps.recordReading({
    by,
    document,
    home,
    observedAtIso: deps.now(),
    producer: tickReadingProducer({ reading }),
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(
      `supervisor tick-capture: ${reading.name} was not appended to the readings ledger — ${recorded.error}`,
    );
    return undefined;
  }
  return recorded.value;
}
