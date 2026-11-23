/**
 * An applied import's steer-measurement append, its pure numbering and its SQL half over a scripted client
 * (`../../scriptedStoreClient.ts`): rows numbered on from the highest sequence held, each re-derived against its own
 * id, and which failure an altered row, a racing append or a driver throw becomes. What only a real database proves —
 * the append-only triggers, the sequence key, the lock — is the opt-in
 * `src/__tests__/integration/storeImportWriters.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { appendImportedSteerMeasurements, importedSteerAppendRows } from "../../../profile/steerMeasurementImport.js";
import { steerMeasurementEnvelopeOfV1Line } from "../../../profile/steerMeasurementTransfer.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";
import { STEER_LINE } from "../store/transfer/fixtures.js";

const LEGACY = steerMeasurementEnvelopeOfV1Line({ exactText: STEER_LINE, sourceOrdinal: 1 });
const LATER = {
  eventId: "steer-event-00000000-0000-4000-8000-000000000001",
  exactText: STEER_LINE,
  parseStatus: "parsed" as const,
  schemaVersion: 2 as const,
  sourceOrdinal: null,
};

/**
 * Run the append in a transaction over a register whose highest sequence is `highest`.
 *
 * @param highest what `max(journal_seq)` answers
 * @param measurements the imported envelopes
 * @param thrown what an insert throws, when it should fail
 * @returns the append's outcome and every statement it issued
 */
async function append({
  highest,
  measurements,
  thrown,
}: {
  highest: number | null;
  measurements: Parameters<typeof appendImportedSteerMeasurements>[0]["measurements"];
  thrown?: unknown;
}): Promise<{
  outcome: Awaited<ReturnType<typeof appendImportedSteerMeasurements>>;
  statements: readonly ScriptedStatement[];
}> {
  const { client, statements } = scriptedStoreClient({
    answer: ({ query }) => {
      if (query.includes("max(")) {
        return [[highest]];
      }
      if (thrown !== undefined && query.startsWith("insert")) {
        throw thrown;
      }
      return [];
    },
  });
  const outcome = await client.db.transaction(async (writer) =>
    appendImportedSteerMeasurements({ measurements, writer }),
  );
  return { outcome, statements: statements() };
}

describe("importedSteerAppendRows", () => {
  it("numbers each row on from the highest held, keeping its id, line and place, every one store-import", () => {
    expect(unwrap(importedSteerAppendRows({ highest: 4, measurements: [LEGACY, LATER] }))).toEqual([
      { eventId: LEGACY.eventId, exactLine: STEER_LINE, journalSeq: 5, origin: "store-import", sourceOrdinal: 1 },
      { eventId: LATER.eventId, exactLine: STEER_LINE, journalSeq: 6, origin: "store-import", sourceOrdinal: null },
    ]);
  });

  it("starts an empty register at sequence 1", () => {
    expect(unwrap(importedSteerAppendRows({ highest: null, measurements: [LATER] }))[0]!.journalSeq).toBe(1);
  });

  it("refuses a legacy row whose id its own line and place do not mint", () => {
    const refused = unwrapErr(importedSteerAppendRows({ highest: 0, measurements: [{ ...LEGACY, sourceOrdinal: 5 }] }));
    expect(refused.code).toBe("STEER_IMPORTED_ROW_ALTERED");
  });
});

describe("appendImportedSteerMeasurements", () => {
  it("reads the highest sequence, then inserts every row in one statement", async () => {
    const { outcome, statements } = await append({ highest: 2, measurements: [LEGACY, LATER] });
    expect(unwrap(outcome)).toBe(2);
    expect(statements.map(({ query }) => query.split(" ")[0])).toEqual(["select", "insert"]);
    expect(statements[1]!.params).toEqual([
      LEGACY.eventId,
      3,
      "store-import",
      STEER_LINE,
      1,
      LATER.eventId,
      4,
      "store-import",
      STEER_LINE,
      null,
    ]);
  });

  it("issues no statement for an import carrying no measurement", async () => {
    const { outcome, statements } = await append({ highest: 2, measurements: [] });
    expect(unwrap(outcome)).toBe(0);
    expect(statements).toEqual([]);
  });

  it("refuses an altered row after the read, inserting nothing", async () => {
    const { outcome, statements } = await append({ highest: 2, measurements: [{ ...LEGACY, sourceOrdinal: 5 }] });
    expect(unwrapErr(outcome).code).toBe("STEER_IMPORTED_ROW_ALTERED");
    expect(statements.map(({ query }) => query.split(" ")[0])).toEqual(["select"]);
  });

  it("reads a racing append as STEER_APPEND_CONFLICT, and any other failure as an outage naming the step", async () => {
    const race = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "uq_steer_measurement_seq",
    });
    const raced = await append({ highest: 2, measurements: [LATER], thrown: race });
    expect(unwrapErr(raced.outcome).code).toBe("STEER_APPEND_CONFLICT");
    const down = await append({ highest: 2, measurements: [LATER], thrown: new Error("connection reset") });
    const refused = unwrapErr(down.outcome);
    expect(refused.code).toBe("STEER_STORE_UNAVAILABLE");
    expect(refused.message).toContain("append the imported steer measurements");
  });
});
