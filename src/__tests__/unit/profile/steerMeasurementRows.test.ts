/**
 * The steer-measurement register's Postgres half over a scripted client (`../../scriptedStoreClient.ts`): the
 * statements a read, an append, an import claim and a marker read issue, the rows they map back, and which failure a
 * driver throw becomes. What only a real database proves — the triggers, the lock's queueing, the CHECKs — is the
 * opt-in `src/__tests__/integration/steerMeasurementStore.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { STANDING_ASKS_WRITE_LOCK } from "../../../profile/standingAskRows.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import { steerMeasurementPort, steerMeasurementTransferPort } from "../../../profile/steerMeasurementPort.js";
import { importedSteerEventId, importedSteerMeasurements } from "../../../profile/steerMeasurementRecords.js";
import {
  isSteerAppendRace,
  productionSteerMeasurementSeams,
  productionSteerMeasurementTransferSeams,
  readHomeFileSteerMeasurements,
  readSteerMeasurementSnapshot,
  STEER_MEASUREMENTS_WRITE_LOCK,
} from "../../../profile/steerMeasurementRows.js";
import { STORE_URL_ENV } from "../../../store/client.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";

const VERDICT: SteerVerdict = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  judgedAtIso: "2026-10-04T12:00:00.000Z",
  says: "nothing",
  turnAtIso: "2026-10-04T09:00:00.000Z",
};
const LINE = steerVerdictLine({ verdict: VERDICT });

/** Two imported lines, each row in the snapshot select's field order. */
const LEGACY_A = importedSteerEventId({ exactLine: LINE, sourceOrdinal: 1 });
const LEGACY_B = importedSteerEventId({ exactLine: "not json", sourceOrdinal: 2 });
const STORED = [
  [LEGACY_A, LINE, 1, "legacy-file", 1],
  [LEGACY_B, "not json", 2, "legacy-file", 2],
] as const;

/**
 * What a database holding {@link STORED} and a marker counting `records` answers. A statement it does not recognise
 * answers nothing, as an insert or a lock does.
 *
 * @param records the marker's count, or undefined for no marker
 * @param highest what `max(journal_seq)` answers
 * @returns the answer a scripted client runs
 */
function databaseOf({
  records,
  highest = 2,
}: {
  records: number | undefined;
  highest?: number | null;
}): (statement: ScriptedStatement) => readonly (readonly unknown[])[] {
  return ({ query }) => {
    if (query.includes('from "home_file_import"')) {
      return records === undefined ? [] : [[records]];
    }
    if (query.includes("count(")) {
      return [[STORED.length]];
    }
    if (query.includes("max(")) {
      return [[highest]];
    }
    if (query.includes('from "steer_measurement"')) {
      return STORED;
    }
    return [];
  };
}

/**
 * The verb and target of each statement, so a test asserts the order without restating Drizzle's SQL.
 *
 * @param statements what the client was sent
 * @returns one `verb "table"` line each
 */
function shapes({ statements }: { statements: readonly ScriptedStatement[] }): readonly string[] {
  return statements.map(({ query }) => {
    const table = /(?:from|into|update) ("[a-z_]+")/u.exec(query);
    const verb = query.split(" ")[0]!;
    return table === null ? verb : `${verb} ${table[1]!}`;
  });
}

/** The statements one snapshot read issues, in order. */
const SNAPSHOT = ['select "steer_measurement"', 'select "home_file_import"', 'select "steer_measurement"'];

describe("readSteerMeasurementSnapshot", () => {
  it("reads every line in sequence order, then the marker and its count of imported lines", async () => {
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2 }) });

    expect(unwrap(await readSteerMeasurementSnapshot({ reader: client }))).toEqual([
      { eventId: LEGACY_A, exactLine: LINE, journalSeq: 1, origin: "legacy-file", sourceOrdinal: 1 },
      { eventId: LEGACY_B, exactLine: "not json", journalSeq: 2, origin: "legacy-file", sourceOrdinal: 2 },
    ]);
    expect(shapes({ statements: statements() })).toEqual(SNAPSHOT);
    expect(statements()[0]!.query).toContain('order by "steer_measurement"."journal_seq"');
    expect(statements()[2]!.params).toEqual(["legacy-file"]);
  });

  it("refuses a register whose marker is gone, never an empty one", async () => {
    const { client } = scriptedStoreClient({ answer: databaseOf({ records: undefined }) });

    expect(unwrapErr(await readSteerMeasurementSnapshot({ reader: client })).message).toBe(
      "the store could not read the steer-measurement import marker inside the reading snapshot: the marker the import wrote is gone",
    );
  });

  it("refuses a marker counting more lines than the table holds", async () => {
    const { client } = scriptedStoreClient({ answer: databaseOf({ records: 3 }) });

    expect(unwrapErr(await readSteerMeasurementSnapshot({ reader: client })).code).toBe(
      "STEER_IMPORT_MARKER_INCONSISTENT",
    );
  });
});

describe("the steer-measurement row operations", () => {
  it("reads inside one read-only repeatable-read transaction", async () => {
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2 }) });

    expect(unwrap(await productionSteerMeasurementTransferSeams().rowsOver({ client }).readStored())).toHaveLength(2);
    expect(shapes({ statements: statements() })).toEqual(["set", ...SNAPSHOT]);
    expect(statements()[0]!.query).toBe("set transaction isolation level repeatable read read only");
  });

  it("refuses a read the driver fails as STEER_STORE_UNAVAILABLE", async () => {
    const { client } = scriptedStoreClient({
      answer: () => {
        throw new Error("connection reset");
      },
    });

    const refused = unwrapErr(await productionSteerMeasurementTransferSeams().rowsOver({ client }).readStored());

    expect(refused.code).toBe("STEER_STORE_UNAVAILABLE");
    expect(refused.message).toContain("the store could not read the steer measurements: ");
  });

  it("appends after the lock and the highest sequence, one past it, as its own journal line", async () => {
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2 }) });

    const written = unwrap(
      await productionSteerMeasurementTransferSeams().rowsOver({ client }).append({ verdict: VERDICT }),
    );

    expect(written.journalSeq).toBe(3);
    expect(written.eventId).toMatch(/^steer-event-[0-9a-f-]{36}$/u);
    expect(statements()[0]!.query).toBe(`select pg_advisory_xact_lock(${STEER_MEASUREMENTS_WRITE_LOCK.toString()})`);
    expect(shapes({ statements: statements() }).slice(1)).toEqual([
      'select "steer_measurement"',
      'insert "steer_measurement"',
    ]);
    expect(statements().at(-1)!.params).toEqual([written.eventId, 3, "profile", LINE, null]);
  });

  it("starts an empty register's sequence at 1", async () => {
    const { client } = scriptedStoreClient({ answer: databaseOf({ highest: null, records: 0 }) });

    const written = unwrap(
      await productionSteerMeasurementTransferSeams().rowsOver({ client }).append({ verdict: VERDICT }),
    );

    expect(written.journalSeq).toBe(1);
  });

  it("writes nothing for a verdict its own reader would not read back", async () => {
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2 }) });

    const refused = await productionSteerMeasurementTransferSeams()
      .rowsOver({ client })
      .append({ verdict: { ...VERDICT, judgedAtIso: "yesterday" } });

    expect(unwrapErr(refused).code).toBe("STEER_WRITE_UNREADABLE");
    expect(shapes({ statements: statements() }).filter((shape) => shape.startsWith("insert"))).toEqual([]);
  });

  it("reads a racing appender's index violation as a conflict, and any other failure as an outage", async () => {
    const append = async ({ thrown }: { thrown: unknown }): Promise<string> => {
      const database = databaseOf({ records: 2 });
      const { client } = scriptedStoreClient({
        answer: (statement) => {
          if (statement.query.startsWith("insert")) {
            throw thrown;
          }
          return database(statement);
        },
      });
      const outcome = await productionSteerMeasurementTransferSeams().rowsOver({ client }).append({ verdict: VERDICT });
      return unwrapErr(outcome).code;
    };
    const race = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "uq_steer_measurement_seq",
    });

    expect(await append({ thrown: race })).toBe("STEER_APPEND_CONFLICT");
    expect(await append({ thrown: new Error("connection reset") })).toBe("STEER_STORE_UNAVAILABLE");
  });

  it("claims the import once, inserting the journal's lines inside the claim, and closes through the client", async () => {
    const won = scriptedStoreClient({
      answer: ({ query }) => (query.includes("returning") ? [["steer-measurements"]] : []),
    });
    const rows = productionSteerMeasurementTransferSeams().rowsOver({ client: won.client });
    const source = {
      records: importedSteerMeasurements({ lines: [{ line: LINE, number: 1 }] }),
      state: "present",
      witness: { bytes: LINE.length + 1, sha256: "ab".repeat(32) },
    } as const;

    expect(unwrap(await rows.claim({ source }))).toBe(true);
    expect(shapes({ statements: won.statements() })).toEqual([
      'insert "home_file_import"',
      'insert "steer_measurement"',
    ]);
    await rows.close();
    expect(won.closes()).toBe(1);
  });

  it("claims an absent journal's import with no lines to insert", async () => {
    const won = scriptedStoreClient({
      answer: ({ query }) => (query.includes("returning") ? [["steer-measurements"]] : []),
    });

    const claimed = await productionSteerMeasurementTransferSeams()
      .rowsOver({ client: won.client })
      .claim({ source: { state: "absent" } });

    expect(unwrap(claimed)).toBe(true);
    expect(shapes({ statements: won.statements() })).toEqual(['insert "home_file_import"']);
  });

  it("reads what the marker recorded of its file", async () => {
    const { client } = scriptedStoreClient({ answer: () => [[12, "ab".repeat(32), "present"]] });

    expect(unwrap(await productionSteerMeasurementTransferSeams().rowsOver({ client }).markedSource())).toEqual({
      state: "present",
      witness: { bytes: 12, sha256: "ab".repeat(32) },
    });
  });
});

describe("isSteerAppendRace", () => {
  it("finds the sequence's index violation or a serialization failure a few causes down, and nothing else", () => {
    const unique = { code: "23505", constraint_name: "uq_steer_measurement_seq" };

    expect(isSteerAppendRace({ cause: new Error("wrapped", { cause: unique }) })).toBe(true);
    expect(isSteerAppendRace({ cause: { code: "40001" } })).toBe(true);
    expect(isSteerAppendRace({ cause: { code: "23505", constraint_name: "steer_measurement_pkey" } })).toBe(false);
    expect(isSteerAppendRace({ cause: new Error("connection reset") })).toBe(false);
  });
});

describe("the production seams and ports", () => {
  it("read the real home journal, and build without opening a connection", () => {
    expect(productionSteerMeasurementSeams().readHomeFile).toBe(readHomeFileSteerMeasurements);
    expect(productionSteerMeasurementTransferSeams().readSnapshot).toBe(readSteerMeasurementSnapshot);
    expect(Object.keys(steerMeasurementPort()).toSorted()).toEqual(["append", "readHistory"]);
    expect(Object.keys(steerMeasurementTransferPort()).toSorted()).toEqual(["ensureImported", "readPortableLines"]);
  });

  it("read a home that selects no store as unselected, and a refused selection as the store's own refusal", async () => {
    const home = mkdtempSync(join(tmpdir(), "sw-steer-connect-"));
    try {
      const unselected = unwrapErr(await productionSteerMeasurementSeams({ env: {} }).connect({ home }));
      const remote = unwrapErr(
        await productionSteerMeasurementSeams({
          env: { [STORE_URL_ENV]: "postgresql://postgres:postgres@db.acme.invalid:5432/postgres" },
        }).connect({ home }),
      );

      expect([unselected.code, remote.code]).toEqual(["STEER_STORE_UNSELECTED", "STEER_STORE_UNAVAILABLE"]);
      expect(remote.message).toContain("the store could not be opened: ");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("locks on a key of its own, never the standing asks' one", () => {
    expect(STEER_MEASUREMENTS_WRITE_LOCK).not.toBe(STANDING_ASKS_WRITE_LOCK);
  });
});
