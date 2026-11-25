import { describe, expect, it } from "vitest";

import {
  capacityJsonOutputOf,
  exitAfterRecording,
  MACHINE_CAPACITY_PRODUCER,
  type RecordCapacityReading,
} from "../../../../../cli/commands/machine/capacityReading.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { ReadingsErrors } from "../../../../../readings/errors.js";
import type { PrintedReadingAppend } from "../../../../../readings/printedReading.js";
import type { ReadingReceipt } from "../../../../../readings/types.js";

const FULL = { ceilings: { lowest: "machine" }, report: { hold: false } };
const BRIEF = { hold: false, lowest: "machine" };
const COMMON = {
  briefDocument: BRIEF,
  fullDocument: FULL,
  home: "/fixture/home",
  observedAtIso: "2026-11-25T05:00:00.000Z",
  recordedAtIso: "2026-11-25T05:00:01.000Z",
};

/** A sink that remembers every append and accepts it. */
function acceptingSink(): { appended: PrintedReadingAppend[]; recordReading: RecordCapacityReading } {
  const appended: PrintedReadingAppend[] = [];
  return {
    appended,
    recordReading: (input) => {
      appended.push(input);
      const receipt = {
        documentPath: "/fixture/home/readings/fixture.json",
        indexPath: "/fixture/home/readings/index.jsonl",
        record: {
          by: input.by,
          bytes: input.document.length,
          file: "fixture.json",
          observedAtIso: input.observedAtIso,
          producer: input.producer,
          readingId: `${input.nowIso}-machine-capacity`,
          recordedAtIso: input.nowIso,
        },
      } satisfies ReadingReceipt;
      return ok(receipt);
    },
  };
}

/** A log that keeps its error lines. */
function errorLog(): { errs: string[]; log: { error: (entry: { msg: string }) => void } } {
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
    },
  };
}

describe("capacityJsonOutputOf", () => {
  it("prints and appends one serialisation without --brief", () => {
    const output = capacityJsonOutputOf({ ...COMMON, brief: false, by: "tick-12" });
    expect(output.append!.document).toBe(output.text);
    expect([output.append!.by, output.append!.producer, output.append!.observedAtIso, output.append!.nowIso]).toEqual([
      "tick-12",
      MACHINE_CAPACITY_PRODUCER,
      "2026-11-25T05:00:00.000Z",
      "2026-11-25T05:00:01.000Z",
    ]);
  });

  it("prints the brief document under --brief but appends the full one", () => {
    const brief = capacityJsonOutputOf({ ...COMMON, brief: true, by: "tick-12" });
    const full = capacityJsonOutputOf({ ...COMMON, brief: false, by: "tick-12" });
    expect([JSON.parse(brief.text), brief.append!.document]).toEqual([BRIEF, full.text]);
  });

  it("builds no append when --record-reading was absent, brief or not", () => {
    expect([
      capacityJsonOutputOf({ ...COMMON, brief: false, by: undefined }).append,
      capacityJsonOutputOf({ ...COMMON, brief: true, by: undefined }).append,
    ]).toEqual([undefined, undefined]);
  });
});

describe("exitAfterRecording", () => {
  it("returns the run's own exit and touches no ledger when nothing was asked for", () => {
    const sink = acceptingSink();
    const { errs, log } = errorLog();
    const exit = exitAfterRecording({ append: undefined, exit: EXIT_DEFERRED, log, recordReading: sink.recordReading });
    expect([exit, sink.appended, errs]).toEqual([EXIT_DEFERRED, [], []]);
  });

  it("appends once and keeps the run's own exit when the append lands", () => {
    const sink = acceptingSink();
    const { errs, log } = errorLog();
    const { append } = capacityJsonOutputOf({ ...COMMON, brief: false, by: "tick-12" });
    const exit = exitAfterRecording({ append, exit: EXIT_OK, log, recordReading: sink.recordReading });
    expect([exit, sink.appended, errs]).toEqual([EXIT_OK, [append], []]);
  });

  it("outranks a timed-out wait's exit with EXIT_ERROR, naming the refusal, when the append is refused", () => {
    const { errs, log } = errorLog();
    const refusal = ReadingsErrors.ledgerBusy({ why: "held by pid 4242" });
    const { append } = capacityJsonOutputOf({ ...COMMON, brief: false, by: "tick-12" });
    const exit = exitAfterRecording({ append, exit: EXIT_DEFERRED, log, recordReading: () => err(refusal) });
    expect([exit, errs]).toEqual([EXIT_ERROR, [`machine capacity: the reading was not recorded — ${refusal.message}`]]);
  });
});
