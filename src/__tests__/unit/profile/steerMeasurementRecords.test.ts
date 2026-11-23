/**
 * The steer-measurement register's pure half: the ids an imported or appended line takes, the rows the one-time
 * import writes, how the stored lines read back numbered by their place in the old file, the append read-back, and
 * the marker refusals.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import {
  importedSteerEventId,
  importedSteerMeasurementRows,
  importedSteerMeasurements,
  newSteerEventId,
  nextSteerJournalSeq,
  steerAppendRow,
  steerHistoryOf,
  steerImportedRowRefusal,
  steerMarkerRefusal,
  steerMeasurementImportSource,
  steerSnapshotRefusal,
  steerStepFailure,
} from "../../../profile/steerMeasurementRecords.js";

const NOTHING: SteerVerdict = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  judgedAtIso: "2026-10-04T12:00:00.000Z",
  says: "nothing",
  turnAtIso: "2026-10-04T09:00:00.000Z",
};
const LINE = steerVerdictLine({ verdict: NOTHING });
const UUID = "00000000-0000-4000-8000-000000000001";

describe("importedSteerEventId", () => {
  it("names a line by its text and its place in the file, deterministically, in the schema's shape", () => {
    const first = importedSteerEventId({ exactLine: LINE, sourceOrdinal: 1 });

    expect(first).toMatch(/^steer-legacy-[0-9a-f]{64}$/u);
    expect(importedSteerEventId({ exactLine: LINE, sourceOrdinal: 1 })).toBe(first);
    expect(importedSteerEventId({ exactLine: LINE, sourceOrdinal: 2 })).not.toBe(first);
    expect(importedSteerEventId({ exactLine: `${LINE} `, sourceOrdinal: 1 })).not.toBe(first);
  });
});

describe("importedSteerMeasurements", () => {
  it("keeps every line exactly at its place in the file, a repeated line a measurement of its own", () => {
    const records = importedSteerMeasurements({
      lines: [
        { line: LINE, number: 2 },
        { line: "not json", number: 3 },
        { line: LINE, number: 5 },
      ],
    });

    expect(records).toEqual([
      { eventId: importedSteerEventId({ exactLine: LINE, sourceOrdinal: 2 }), exactLine: LINE, sourceOrdinal: 2 },
      {
        eventId: importedSteerEventId({ exactLine: "not json", sourceOrdinal: 3 }),
        exactLine: "not json",
        sourceOrdinal: 3,
      },
      { eventId: importedSteerEventId({ exactLine: LINE, sourceOrdinal: 5 }), exactLine: LINE, sourceOrdinal: 5 },
    ]);
  });

  it("imports nothing from an empty journal", () => {
    expect(importedSteerMeasurements({ lines: [] })).toEqual([]);
  });
});

describe("steerMeasurementImportSource", () => {
  it("writes nothing for an absent file, and every line with the file's witness for a present one", () => {
    const witness = { bytes: 40, sha256: "ab".repeat(32) };

    expect(steerMeasurementImportSource({ file: { state: "absent" } })).toEqual({ state: "absent" });
    expect(
      steerMeasurementImportSource({ file: { lines: [{ line: LINE, number: 1 }], state: "present", witness } }),
    ).toEqual({
      records: [
        { eventId: importedSteerEventId({ exactLine: LINE, sourceOrdinal: 1 }), exactLine: LINE, sourceOrdinal: 1 },
      ],
      state: "present",
      witness,
    });
  });
});

describe("importedSteerMeasurementRows", () => {
  it("gives each imported line its file place as its sequence and its ordinal, from the legacy file", () => {
    const records = importedSteerMeasurements({ lines: [{ line: LINE, number: 4 }] });

    expect(importedSteerMeasurementRows({ records })).toEqual([
      { eventId: records[0]!.eventId, exactLine: LINE, journalSeq: 4, origin: "legacy-file", sourceOrdinal: 4 },
    ]);
  });
});

describe("steerHistoryOf", () => {
  const measurements = [
    { eventId: "steer-legacy-a", exactLine: LINE, journalSeq: 2, origin: "legacy-file", sourceOrdinal: 2 },
    { eventId: "steer-legacy-b", exactLine: "not json", journalSeq: 3, origin: "legacy-file", sourceOrdinal: 3 },
  ] as const;

  it("reads every stored line, naming one that does not read by its sequence", () => {
    expect(steerHistoryOf({ measurements })).toEqual({ unparsed: [3], verdicts: [NOTHING] });
  });

  it("reads an empty register as an empty history", () => {
    expect(steerHistoryOf({ measurements: [] })).toEqual({ unparsed: [], verdicts: [] });
  });
});

describe("nextSteerJournalSeq", () => {
  it("starts an empty register at 1 and otherwise goes one past the highest", () => {
    expect(nextSteerJournalSeq({ highest: null })).toBe(1);
    expect(nextSteerJournalSeq({ highest: 7 })).toBe(8);
  });
});

describe("steerAppendRow", () => {
  it("appends a verdict as its own journal line, from the profile, with a fresh event id", () => {
    expect(unwrap(steerAppendRow({ journalSeq: 3, uuid: UUID, verdict: NOTHING }))).toEqual({
      eventId: newSteerEventId({ uuid: UUID }),
      exactLine: LINE,
      journalSeq: 3,
      origin: "profile",
      sourceOrdinal: null,
    });
    expect(newSteerEventId({ uuid: UUID })).toBe(`steer-event-${UUID}`);
  });

  it("refuses a verdict whose line the journal's grammar would not read back", () => {
    const refused = unwrapErr(
      steerAppendRow({
        journalSeq: 1,
        uuid: UUID,
        verdict: { ...NOTHING, judgedAtIso: "yesterday" },
      }),
    );

    expect(refused.code).toBe("STEER_WRITE_UNREADABLE");
    expect(refused.message).toBe(
      "this verdict would record a line the register cannot read back, so it wrote nothing: the journal's own grammar does not read it",
    );
  });
});

describe("steerMarkerRefusal", () => {
  it("lets a snapshot stand whose counted lines are the marker's", () => {
    expect(steerMarkerRefusal({ marker: { observedRows: 2, records: 2, tableHasRows: true } })).toBe(undefined);
  });

  it("refuses a snapshot whose marker is gone", () => {
    expect(steerMarkerRefusal({ marker: undefined })).toEqual({
      code: "STEER_STORE_UNAVAILABLE",
      message:
        "the store could not read the steer-measurement import marker inside the reading snapshot: the marker the import wrote is gone",
    });
  });

  it("refuses a snapshot that lost an imported line, naming both counts", () => {
    expect(steerMarkerRefusal({ marker: { observedRows: 1, records: 2, tableHasRows: true } })).toEqual({
      code: "STEER_IMPORT_MARKER_INCONSISTENT",
      expected: 2,
      message: "the steer-measurement import marker says 2 line(s) were imported, and the table holds 1",
      observed: 1,
    });
  });
});

describe("steerImportedRowRefusal and steerSnapshotRefusal", () => {
  const imported = importedSteerMeasurementRows({
    records: importedSteerMeasurements({
      lines: [
        { line: LINE, number: 1 },
        { line: "not json", number: 2 },
      ],
    }),
  });
  const intact = imported.map(({ eventId, exactLine, journalSeq, origin, sourceOrdinal }) => ({
    eventId,
    exactLine,
    journalSeq,
    origin,
    sourceOrdinal,
  }));
  const ALTERED_AT_1 =
    "the steer measurement at sequence 1 is not the line its legacy id was minted from, so the table was written " +
    "behind its own checks — restore the store from a backup rather than read it";
  const counted = { observedRows: 2, records: 2, tableHasRows: true };

  it("lets every imported row stand that is the line, at the place, its id was minted from", () => {
    expect(steerImportedRowRefusal({ measurements: intact })).toBe(undefined);
    expect(steerSnapshotRefusal({ marker: counted, measurements: intact })).toBe(undefined);
  });

  it("refuses two imported rows moved into each other's places, ids and count kept", () => {
    const moved = [
      { ...intact[1]!, journalSeq: 1, sourceOrdinal: 1 },
      { ...intact[0]!, journalSeq: 2, sourceOrdinal: 2 },
    ];

    expect(steerImportedRowRefusal({ measurements: moved })).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 1,
      message: ALTERED_AT_1,
    });
  });

  it("refuses an imported row whose ordinal no longer matches its sequence, id kept", () => {
    const shifted = [intact[0]!, { ...intact[1]!, sourceOrdinal: 7 }];

    expect(steerImportedRowRefusal({ measurements: shifted })).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 2,
      message:
        "the steer measurement at sequence 2 is not the line its legacy id was minted from, so the table was written behind its own checks — restore the store from a backup rather than read it",
    });
  });

  it("refuses an imported line edited in place, which keeps the count the marker checks", () => {
    const edited = [intact[0]!, { ...intact[1]!, exactLine: LINE }];

    expect(steerSnapshotRefusal({ marker: counted, measurements: edited })).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 2,
      message:
        "the steer measurement at sequence 2 is not the line its legacy id was minted from, so the table was written behind its own checks — restore the store from a backup rather than read it",
    });
  });

  it("refuses an imported row swapped for another with an id of the right shape", () => {
    const swapped = [{ ...intact[0]!, eventId: `steer-legacy-${"0".repeat(64)}` }, intact[1]!];

    expect(steerImportedRowRefusal({ measurements: swapped })).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 1,
      message: ALTERED_AT_1,
    });
  });

  it("refuses a store-import row stored under a legacy id its line and place never minted", () => {
    const forged = [
      {
        eventId: `steer-legacy-${"0".repeat(64)}`,
        exactLine: "x",
        journalSeq: 1,
        origin: "store-import" as const,
        sourceOrdinal: 1,
      },
    ];

    expect(steerImportedRowRefusal({ measurements: forged })).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 1,
      message: ALTERED_AT_1,
    });
  });

  it("lets a store-import row stand whose legacy id its line and source ordinal mint, at any sequence", () => {
    const carried = [
      {
        eventId: importedSteerEventId({ exactLine: "x", sourceOrdinal: 4 }),
        exactLine: "x",
        journalSeq: 9,
        origin: "store-import" as const,
        sourceOrdinal: 4,
      },
    ];

    expect(steerImportedRowRefusal({ measurements: carried })).toBe(undefined);
  });

  it("refuses a legacy id carrying no source ordinal, whoever stored it", () => {
    const unplaced = [{ ...intact[0]!, origin: "store-import" as const, sourceOrdinal: null }];

    expect(steerImportedRowRefusal({ measurements: unplaced })!.code).toBe("STEER_IMPORTED_ROW_ALTERED");
  });

  it("refuses an imported row stored under a profile id", () => {
    const relabelled = [{ ...intact[0]!, eventId: newSteerEventId({ uuid: UUID }) }];

    expect(steerImportedRowRefusal({ measurements: relabelled })!.code).toBe("STEER_IMPORTED_ROW_ALTERED");
  });

  it("never checks a profile row, whose id binds no line", () => {
    const appended = [
      {
        eventId: newSteerEventId({ uuid: UUID }),
        exactLine: "anything",
        journalSeq: 3,
        origin: "profile" as const,
        sourceOrdinal: null,
      },
    ];

    expect(steerImportedRowRefusal({ measurements: [...intact, ...appended] })).toBe(undefined);
  });

  it("names the marker's refusal first", () => {
    expect(steerSnapshotRefusal({ marker: undefined, measurements: intact })!.code).toBe("STEER_STORE_UNAVAILABLE");
  });
});

describe("steerStepFailure", () => {
  it("names a marker contradiction by its counts, and anything else as an outage", () => {
    expect(steerStepFailure({ doing: "x", markerInconsistency: { expected: 3, observed: 0 }, reason: "y" }).code).toBe(
      "STEER_IMPORT_MARKER_INCONSISTENT",
    );
    expect(steerStepFailure({ doing: "read the marker", reason: "connection reset" })).toEqual({
      code: "STEER_STORE_UNAVAILABLE",
      message: "the store could not read the marker: connection reset",
    });
  });
});
