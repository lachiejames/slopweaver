/**
 * `handover currency --record-reading <by>` — the step that appends the document the verb just built to the readings
 * ledger, kept beside the run rather than inside it so `currencyRun.ts` stays under the file-size ratchet.
 *
 * Two actors take this reading: the supervisor tick, which records the child's stdout itself
 * (`../supervisor/scratchLedger.ts`), and the console's Queue on opening, whose sync row runs the verb with
 * `--record-reading sync-now` (`site/lib/syncVerbs.ts`). Unlike `github landing`'s recording, a refused append here
 * is a non-zero exit: the sync route discards stdout and reads exit 0 as "the reading was taken", so a ledger that
 * did not move must never answer 0 to it.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import type { CurrencyDocument } from "../../../handover/currency.js";
import type { ReadingsError } from "../../../readings/errors.js";
import { recordReading } from "../../../readings/store.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** The producer the reading files under — the verb words `reading last --producer "handover currency"` reads. */
export const CURRENCY_PRODUCER = "handover currency";

/** Exactly what one `--record-reading` append hands the readings ledger. */
export interface CurrencyReadingRecordInput {
  readonly by: string;
  /** The serialised document — the same bytes `--json` prints. */
  readonly document: string;
  readonly home: string;
  /** The document's own `checkedIso`: when it was true, and the instant every card mark ages from. */
  readonly observedAtIso: string;
  /** The append instant, read after the document was built. */
  readonly nowIso: string;
  readonly producer: typeof CURRENCY_PRODUCER;
}

/**
 * The document as one string — what `--json` prints and what the ledger stores, so the two cannot drift.
 *
 * @returns the JSON text
 */
export function currencyDocumentText({ document }: { document: CurrencyDocument }): string {
  return safeJsonStringify({ label: "handover currency document", value: document });
}

/**
 * The exact append one `--record-reading <by>` makes. Pure: the instant is passed in.
 *
 * The observed instant is the document's `checkedIso`, never the append clock: the console reads this reading's
 * `observedAtIso` as when the cards were checked, and an append minutes after the reads began would call them
 * fresher than they are.
 *
 * @param by who took it — the flag's value, `sync-now` from the console
 * @param home the state home the document was read under, where it is recorded too
 * @param recordedAtIso the append instant
 * @returns the ledger input
 */
export function currencyReadingRecordInput({
  by,
  document,
  home,
  recordedAtIso,
}: {
  by: string;
  document: CurrencyDocument;
  home: string;
  recordedAtIso: string;
}): CurrencyReadingRecordInput {
  return {
    by,
    document: currencyDocumentText({ document }),
    home,
    nowIso: recordedAtIso,
    observedAtIso: document.checkedIso,
    producer: CURRENCY_PRODUCER,
  };
}

/**
 * Append one reading to the ledger.
 *
 * @param input the append, from {@link currencyReadingRecordInput}
 * @returns the receipt, or the ledger's typed refusal
 */
export function recordCurrencyReading({
  input,
}: {
  input: CurrencyReadingRecordInput;
}): Result<ReadingReceipt, ReadingsError> {
  return recordReading({ ...input });
}

/** What the run prints, and the append's outcome when one was asked for. */
export interface CurrencyOutput {
  /** The document's JSON text, serialised once. */
  readonly text: string;
  /** `undefined` when `--record-reading` was not given. */
  readonly recorded: Result<ReadingReceipt, ReadingsError> | undefined;
}

/**
 * Serialise the document once and, when `--record-reading` named who took it, append that same text.
 *
 * @param recordReadingBy the flag's value, `undefined` when absent
 * @returns the text to print and the append's outcome
 */
export function currencyOutputOf({
  document,
  home,
  recordReadingBy,
}: {
  document: CurrencyDocument;
  home: string;
  recordReadingBy: string | undefined;
}): CurrencyOutput {
  if (recordReadingBy === undefined) {
    return { recorded: undefined, text: currencyDocumentText({ document }) };
  }
  const input = currencyReadingRecordInput({
    by: recordReadingBy,
    document,
    home,
    recordedAtIso: new Date().toISOString(),
  });
  return { recorded: recordCurrencyReading({ input }), text: input.document };
}

/**
 * Say on stderr what the append did, and the exit it earns: 0 when nothing was asked or the row landed, 1 when the
 * ledger refused it — after the document was printed, so a completed read is never hidden.
 *
 * @param recorded the append's outcome, `undefined` when none was asked for
 * @returns the exit code
 */
export function recordedExit({ recorded }: { recorded: CurrencyOutput["recorded"] }): number {
  if (recorded === undefined) {
    return EXIT_OK;
  }
  if (recorded.isErr()) {
    logger.error({ msg: `handover currency: the reading was not recorded — ${recorded.error.message}` });
    return EXIT_ERROR;
  }
  logger.info({
    msg: `handover currency: reading recorded as ${recorded.value.record.by} (${recorded.value.record.readingId})`,
  });
  return EXIT_OK;
}
