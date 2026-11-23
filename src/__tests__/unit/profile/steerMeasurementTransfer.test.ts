/**
 * The steer-verdicts part as it travels: the v2 envelope a stored measurement exports as, the strict read that
 * refuses one whose fields disagree, the envelope a v1 journal line becomes, and the summary a question shows.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import { importedSteerEventId, type StoredSteerMeasurement } from "../../../profile/steerMeasurementRecords.js";
import {
  parseSteerMeasurementEnvelopeV2,
  steerExportLines,
  steerMeasurementEnvelopeOfV1Line,
  steerMeasurementEnvelopeV2,
  steerMeasurementSummary,
} from "../../../profile/steerMeasurementTransfer.js";

const NOTHING: SteerVerdict = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  judgedAtIso: "2026-10-04T12:00:00.000Z",
  says: "nothing",
  turnAtIso: "2026-10-04T09:00:00.000Z",
};
const LINE = steerVerdictLine({ verdict: NOTHING });
const RECORDED_ID = "steer-event-00000000-0000-4000-8000-000000000001";

const IMPORTED: StoredSteerMeasurement = {
  eventId: importedSteerEventId({ exactLine: LINE, sourceOrdinal: 2 }),
  exactLine: LINE,
  journalSeq: 2,
  origin: "legacy-file",
  sourceOrdinal: 2,
};
const UNPARSED: StoredSteerMeasurement = {
  eventId: importedSteerEventId({ exactLine: "not json", sourceOrdinal: 3 }),
  exactLine: "not json",
  journalSeq: 3,
  origin: "legacy-file",
  sourceOrdinal: 3,
};
const RECORDED: StoredSteerMeasurement = {
  eventId: RECORDED_ID,
  exactLine: LINE,
  journalSeq: 4,
  origin: "profile",
  sourceOrdinal: null,
};

describe("steerExportLines", () => {
  it("exports one envelope per stored measurement, in order, its fields in a fixed order", () => {
    expect(steerExportLines({ measurements: [IMPORTED, UNPARSED, RECORDED] })).toEqual([
      JSON.stringify({
        eventId: IMPORTED.eventId,
        exactText: LINE,
        parseStatus: "parsed",
        schemaVersion: 2,
        sourceOrdinal: 2,
      }),
      JSON.stringify({
        eventId: UNPARSED.eventId,
        exactText: "not json",
        parseStatus: "unparsed",
        schemaVersion: 2,
        sourceOrdinal: 3,
      }),
      JSON.stringify({
        eventId: RECORDED_ID,
        exactText: LINE,
        parseStatus: "parsed",
        schemaVersion: 2,
        sourceOrdinal: null,
      }),
    ]);
  });

  it("exports nothing for an empty register", () => {
    expect(steerExportLines({ measurements: [] })).toEqual([]);
  });
});

describe("parseSteerMeasurementEnvelopeV2", () => {
  it("reads back every envelope an export writes", () => {
    const envelopes = [IMPORTED, UNPARSED, RECORDED].map((measurement) => steerMeasurementEnvelopeV2({ measurement }));

    expect(envelopes.map((envelope) => unwrap(parseSteerMeasurementEnvelopeV2({ value: envelope })))).toEqual(
      envelopes,
    );
  });

  it("refuses an envelope whose parse status is not its line's", () => {
    const value = { ...steerMeasurementEnvelopeV2({ measurement: UNPARSED }), parseStatus: "parsed" };

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value }))).toEqual([
      "its parseStatus is parsed, and its line is unparsed",
    ]);
  });

  it("refuses a legacy id its line and place do not mint, and one with no place", () => {
    const envelope = steerMeasurementEnvelopeV2({ measurement: IMPORTED });

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, sourceOrdinal: 5 } }))).toEqual([
      "its legacy id is not the one its line and source ordinal mint",
    ]);
    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, sourceOrdinal: null } }))).toEqual([
      "a legacy id carries no source ordinal",
    ]);
  });

  it("refuses an ordinal past the largest safe integer, which JSON has already rounded", () => {
    // 2^53 + 1 reads back as 2^53, the ordinal this id is minted over: only the bound tells the two apart, and
    // Zod 4's `int()` is that bound. The table holds the same one (`steer_measurement_source_ordinal`).
    const eventId = importedSteerEventId({ exactLine: "x", sourceOrdinal: 9007199254740992 });
    const text = `{"eventId":"${eventId}","exactText":"x","parseStatus":"unparsed","schemaVersion":2,"sourceOrdinal":9007199254740993}`;

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: JSON.parse(text) }))).toEqual([
      "sourceOrdinal: Too big: expected int to be <=9007199254740991",
    ]);
  });

  it("refuses an id with a trailing line terminator, since an unflagged `$` ends only at the input's end", () => {
    const envelope = steerMeasurementEnvelopeV2({ measurement: RECORDED });
    const eventId = `${envelope.eventId}\n`;

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, eventId } }))).toEqual([
      `its event id ${JSON.stringify(eventId)} is neither a legacy nor a recorded id`,
    ]);
  });

  it("refuses a recorded id carrying a place, and an id of neither shape", () => {
    const envelope = steerMeasurementEnvelopeV2({ measurement: RECORDED });

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, sourceOrdinal: 1 } }))).toEqual([
      "a recorded id carries a source ordinal",
    ]);
    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, eventId: "steer-x" } }))).toEqual([
      'its event id "steer-x" is neither a legacy nor a recorded id',
    ]);
  });

  it("refuses an unknown field, a blank line and a version other than 2", () => {
    const envelope = steerMeasurementEnvelopeV2({ measurement: RECORDED });

    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, verdict: NOTHING } }))[0]).toContain(
      "envelope: ",
    );
    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, exactText: "  " } }))).toEqual([
      "exactText: is blank",
    ]);
    expect(unwrapErr(parseSteerMeasurementEnvelopeV2({ value: { ...envelope, schemaVersion: 1 } }))[0]).toContain(
      "schemaVersion: ",
    );
  });
});

describe("steerMeasurementEnvelopeOfV1Line", () => {
  it("gives a journal line the envelope its legacy import at that place exports", () => {
    expect(steerMeasurementEnvelopeOfV1Line({ exactText: LINE, sourceOrdinal: 2 })).toEqual(
      steerMeasurementEnvelopeV2({ measurement: IMPORTED }),
    );
  });
});

describe("steerMeasurementSummary", () => {
  it("names what a verdict says and of which turn, and an unparsed line by its place in the part", () => {
    const of = ({ measurement, sequence }: { measurement: StoredSteerMeasurement; sequence: number }): string =>
      steerMeasurementSummary({ measurement: { envelope: steerMeasurementEnvelopeV2({ measurement }), sequence } });

    expect(of({ measurement: IMPORTED, sequence: 1 })).toBe(`nothing ${NOTHING.anchor}`);
    expect(of({ measurement: UNPARSED, sequence: 7 })).toBe("unparsed line at sequence 7");
  });
});
