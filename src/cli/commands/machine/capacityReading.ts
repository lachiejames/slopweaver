/**
 * What `machine capacity --json` prints, and what `--record-reading <by>` appends to the readings ledger.
 *
 * The supervisor's step-8 read is `--brief --json`, so the reading it records each pass comes off that one call
 * with no second provider read. That brief document carries no plans, and the Fleet page's plan usage reads the
 * plans off `reading last --producer "machine capacity"`, so under `--brief` the full document is appended while the
 * brief one is printed. That is the one intended exception to the printed-reading contract
 * (`../../../readings/printedReading.ts`), whose rule is printed == appended: both documents are built from the
 * same single read, so the appended one is what the print would have been without `--brief`. Without `--brief`
 * the contract holds exactly, one serialisation printed and appended.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import type { CeilingsReading } from "../../../capacity/ceilings.js";
import type { Logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { MachineCapacityReport } from "../../../live/machine/capacity.js";
import { briefCapacityJson } from "../../../live/machine/capacityBrief.js";
import { machineCapacityJson } from "../../../live/machine/capacityRender.js";
import { dispatchBlockFor } from "../../../live/machine/dispatchBlock.js";
import type { SpawnBackoffReport } from "../../../live/machine/spawnBackoff.js";
import type { ReadingsError } from "../../../readings/errors.js";
import { type PrintedReadingAppend, printedReadingOutputOf } from "../../../readings/printedReading.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** The producer the reading files under — the verb words `reading last --producer "machine capacity"` reads. */
export const MACHINE_CAPACITY_PRODUCER = "machine capacity";

/** The refusal of `--record-reading` without `--json`, printed before anything is read. */
export const RECORD_READING_NEEDS_JSON = "--record-reading records the JSON capacity reading, so it needs --json";

/** How the shell appends one reading — `recordReading` (`../../../readings/store.ts`), or a test's fake. */
export type RecordCapacityReading = (input: PrintedReadingAppend) => Result<ReadingReceipt, ReadingsError>;

/** What one `--json` run prints, and the append it makes when `--record-reading` was given. */
export interface CapacityJsonOutput {
  /** The printed document's JSON text, serialised once. */
  readonly text: string;
  /** `undefined` when `--record-reading` was not given. */
  readonly append: PrintedReadingAppend | undefined;
}

/**
 * Serialise the document `--json` prints and, under `--record-reading`, build the append of the FULL document,
 * which is the printed text itself unless `--brief` asked for the small one. Pure: the instants are passed in.
 *
 * @param brief whether `--brief` asked for the small document on stdout
 * @param by the `--record-reading` value — `tick-12` from the supervisor — or `undefined` when the flag was absent
 * @param fullDocument the full `--json` document, the one the ledger always holds
 * @param briefDocument the `--brief --json` document, printed in place of the full one under `--brief`
 * @param home the state home the reading was taken under, where it is recorded too
 * @param observedAtIso when the reading was true: the ceilings' own observation instant
 * @param recordedAtIso the append instant
 * @returns the text to print and the append, if any
 */
export function capacityJsonOutputOf({
  brief,
  by,
  fullDocument,
  briefDocument,
  home,
  observedAtIso,
  recordedAtIso,
}: {
  brief: boolean;
  by: string | undefined;
  fullDocument: unknown;
  briefDocument: unknown;
  home: string;
  observedAtIso: string;
  recordedAtIso: string;
}): CapacityJsonOutput {
  const full = printedReadingOutputOf({
    by,
    document: fullDocument,
    home,
    observedAtIso,
    producer: MACHINE_CAPACITY_PRODUCER,
    recordedAtIso,
  });
  if (!brief) {
    return full;
  }
  const text = safeJsonStringify({ label: `a ${MACHINE_CAPACITY_PRODUCER} --brief document`, value: briefDocument });
  return { append: full.append, text };
}

/**
 * Build both `--json` documents off ONE reading, the dispatch register's standing read once beside it, and hand them
 * to {@link capacityJsonOutputOf}. The brief document is built only when `--brief` asked for it.
 *
 * @param spawnBackoff the fleet spawn backoff's phase at the reading
 * @param by the `--record-reading` value, or `undefined` when the flag was absent
 * @param nowIso the reading's instant, which is also the append instant and the dispatch register's clock
 * @returns the text to print and the append, if any
 */
export function capacityJsonOf({
  report,
  ceilings,
  spawnBackoff,
  brief,
  by,
  home,
  nowIso,
}: {
  report: MachineCapacityReport;
  ceilings: CeilingsReading;
  spawnBackoff: SpawnBackoffReport;
  brief: boolean;
  by: string | undefined;
  home: string;
  nowIso: string;
}): CapacityJsonOutput {
  const dispatch = dispatchBlockFor({ home, nowIso });
  const documents = { ceilings, dispatch, report, spawnBackoff };
  return capacityJsonOutputOf({
    brief,
    briefDocument: brief ? briefCapacityJson(documents) : undefined,
    by,
    fullDocument: machineCapacityJson(documents),
    home,
    observedAtIso: ceilings.observedAtIso,
    recordedAtIso: nowIso,
  });
}

/**
 * Append the reading the print already carried, when one was asked for, and say what the run exits with. A refused
 * append outranks every other exit, a finding's and a timed-out wait's included, because the supervisor reads a
 * clean exit as a reading recorded.
 *
 * @param append the append the print built, or `undefined` when `--record-reading` was absent
 * @param exit what the run exits with when nothing was refused
 * @param recordReading the ledger append
 * @returns `exit`, or `EXIT_ERROR` when the append was refused
 */
export function exitAfterRecording({
  append,
  exit,
  recordReading,
  log,
}: {
  append: PrintedReadingAppend | undefined;
  exit: number;
  recordReading: RecordCapacityReading;
  log: Pick<Logger, "error">;
}): number {
  if (append === undefined) {
    return exit;
  }
  const recorded = recordReading(append);
  if (recorded.isErr()) {
    log.error({ msg: `machine capacity: the reading was not recorded — ${recorded.error.message}` });
    return EXIT_ERROR;
  }
  return exit;
}
