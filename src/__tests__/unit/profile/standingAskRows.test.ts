/**
 * The standing-ask register's Postgres half over a scripted client (`../../scriptedStoreClient.ts`): the statements a
 * read, a write, an import claim and a marker read issue, the rows they map back, and which failure a driver throw
 * becomes. What only a real database proves — the indexes, the lock's queueing, the CHECKs — is the opt-in
 * `src/__tests__/integration/standingAskStore.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readHomeFileStandingAsks } from "../../../profile/standingAskImport.js";
import { type StandingAskRows, standingAskPort, standingAskTransferPort } from "../../../profile/standingAskPort.js";
import { activeStandingAsksOf } from "../../../profile/standingAskProjection.js";
import {
  importedStandingAskEvents,
  importedStandingAskRows,
  type StoredStandingAsks,
} from "../../../profile/standingAskRecords.js";
import {
  productionStandingAskSeams,
  productionStandingAskTransferSeams,
  readStandingAskSnapshot,
  STANDING_ASKS_WRITE_LOCK,
} from "../../../profile/standingAskRows.js";
import { type StandingAsk, standingAskLine } from "../../../profile/standingAsks.js";
import { planStandingAskWrite, type StandingAskRequest } from "../../../profile/standingAskWrites.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";

const QUOTE = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "chuck anything worth a look on the board",
} as const;

/** One ask. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return { covers, id, quote: QUOTE, recordedAtIso: "2026-10-05T00:00:00.000Z" };
}

/** A two-ask journal's events, as its import reads them. */
function journal(): ReturnType<typeof importedStandingAskEvents> {
  const asks = [ask({ covers: ["findings"], id: "a" }), ask({ covers: ["bot-replies", "act:auto.merge"], id: "b" })];
  return importedStandingAskEvents({
    lines: asks.map((one, at) => ({ line: standingAskLine({ event: { kind: "recorded", ...one } }), number: at + 1 })),
  });
}

/** The register that journal's import leaves. */
function imported(): StoredStandingAsks {
  let next = 0;
  return importedStandingAskRows({
    events: unwrap(journal()),
    mintId: () => {
      next += 1;
      return `row-${String(next)}`;
    },
  });
}

/**
 * What a database holding `stored` and a marker counting `records` answers, each row in its select's field order.
 * A statement it does not recognise answers nothing, as an insert, an update or a lock does.
 *
 * @param stored the register's rows
 * @param records the marker's count, or undefined for no marker
 * @returns the answer a scripted client runs
 */
function databaseOf({
  stored,
  records,
}: {
  stored: StoredStandingAsks;
  records: number | undefined;
}): (statement: ScriptedStatement) => readonly (readonly unknown[])[] {
  const marker = records === undefined ? [] : [[records]];
  return ({ query }) => {
    if (query.includes('from "home_file_import"')) {
      return marker;
    }
    if (query.includes("count(")) {
      return [[stored.events.filter((one) => one.origin === "legacy-file").length]];
    }
    if (query.includes('from "standing_ask_event"')) {
      return stored.events.map((one) => [one.askRowId, one.exactLine, one.journalSeq, one.kind, one.origin]);
    }
    if (query.includes('from "standing_ask_coverage"')) {
      return stored.coverage.map((one) => [one.askRowId, one.coverage, one.ordinal, one.state]);
    }
    if (query.includes('from "standing_ask"')) {
      return stored.asks.map((one) => [
        one.askId,
        one.origin,
        one.quoteAnchor,
        one.quoteAt,
        one.quoteCut,
        one.quoteWhere,
        one.quoteWords,
        one.recordedAt,
        one.recordedSeq,
        one.rowId,
        one.state,
      ]);
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
    const table = /(?:from|into|update) ("[a-z_]+")/.exec(query);
    const verb = query.split(" ")[0]!;
    return table === null ? verb : `${verb} ${table[1]!}`;
  });
}

/** The statements one snapshot read issues, in order. */
const SNAPSHOT = [
  'select "standing_ask_event"',
  'select "standing_ask"',
  'select "standing_ask_coverage"',
  'select "home_file_import"',
  'select "standing_ask_event"',
];

/**
 * A decision as `profile standing` makes it, against what the write read.
 *
 * @param request the add or withdrawal
 * @returns the decide seam a write takes
 */
function deciding({ request }: { request: StandingAskRequest }): Parameters<StandingAskRows["write"]>[0]["decide"] {
  return ({ stored }) => planStandingAskWrite({ active: unwrap(activeStandingAsksOf({ stored })), request });
}

describe("readStandingAskSnapshot", () => {
  it("reads every row through one reader, then the marker and its count, and maps each column back", async () => {
    const stored = imported();
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2, stored }) });
    expect(unwrap(await readStandingAskSnapshot({ reader: client }))).toEqual(stored);
    expect(shapes({ statements: statements() })).toEqual(SNAPSHOT);
    expect(statements()[4]!.params).toEqual(["legacy-file"]);
  });

  it("refuses a register whose marker is gone, never an empty one", async () => {
    const { client } = scriptedStoreClient({ answer: databaseOf({ records: undefined, stored: imported() }) });
    expect(unwrapErr(await readStandingAskSnapshot({ reader: client })).message).toBe(
      "the store could not read the standing-ask import marker inside the reading snapshot: the marker the import wrote is gone",
    );
  });
});

describe("the standing-ask row operations", () => {
  it("reads inside one read-only repeatable-read transaction", async () => {
    const stored = imported();
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2, stored }) });
    const rows = productionStandingAskTransferSeams().rowsOver({ client });
    expect(unwrap(await rows.readStored())).toEqual(stored);
    expect(shapes({ statements: statements() })).toEqual(["set", ...SNAPSHOT]);
    expect(statements()[0]!.query).toBe("set transaction isolation level repeatable read read only");
  });

  it("refuses a read the driver fails as STANDING_ASK_STORE_UNAVAILABLE, naming the statement Drizzle wraps it in", async () => {
    const { client } = scriptedStoreClient({
      answer: () => {
        throw new Error("connection reset");
      },
    });
    const refused = unwrapErr(await productionStandingAskTransferSeams().rowsOver({ client }).readStored());
    expect(refused.code).toBe("STANDING_ASK_STORE_UNAVAILABLE");
    expect(refused.message).toBe(
      "the store could not read the standing asks: Failed query: set transaction isolation level repeatable read read only\nparams: ",
    );
  });

  it("records an add after the lock and the read, generation then coverage then event, at the next sequence", async () => {
    const stored = imported();
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2, stored }) });
    const next = ask({ covers: ["unlinked-cards"], id: "c" });
    const outcome = await productionStandingAskTransferSeams()
      .rowsOver({ client })
      .write({ decide: deciding({ request: { ask: next, kind: "add" } }) });
    expect(unwrap(outcome)).toEqual({ journalSeq: 3, kind: "written" });
    expect(statements()[0]!.query).toBe(`select pg_advisory_xact_lock(${STANDING_ASKS_WRITE_LOCK.toString()})`);
    expect(shapes({ statements: statements() }).slice(1)).toEqual([
      ...SNAPSHOT,
      'insert "standing_ask"',
      'insert "standing_ask_coverage"',
      'insert "standing_ask_event"',
    ]);
    expect(statements().at(-1)!.params).toContain(standingAskLine({ event: { kind: "recorded", ...next } }));
  });

  it("withdraws by setting the active generation withdrawn, then records only the event", async () => {
    const stored = imported();
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2, stored }) });
    const request = { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } as const;
    const outcome = await productionStandingAskTransferSeams()
      .rowsOver({ client })
      .write({ decide: deciding({ request }) });
    expect(unwrap(outcome)).toEqual({ journalSeq: 3, kind: "written" });
    expect(shapes({ statements: statements() }).slice(1 + SNAPSHOT.length)).toEqual([
      'update "standing_ask"',
      'insert "standing_ask_event"',
    ]);
    expect(statements()[1 + SNAPSHOT.length]!.params).toEqual(["withdrawn", "row-1", "active"]);
  });

  it("writes nothing when the decision refuses", async () => {
    const stored = imported();
    const { client, statements } = scriptedStoreClient({ answer: databaseOf({ records: 2, stored }) });
    const outcome = await productionStandingAskTransferSeams()
      .rowsOver({ client })
      .write({ decide: deciding({ request: { ask: ask({ covers: ["findings"], id: "c" }), kind: "add" } }) });
    expect(unwrapErr(outcome).code).toBe("COVERAGE_OVERLAP");
    expect(shapes({ statements: statements() }).slice(1)).toEqual(SNAPSHOT);
  });

  it("reads a racing writer's index violation as a write conflict, and any other failure as an outage", async () => {
    const answerThen = ({ thrown }: { thrown: unknown }): ((statement: ScriptedStatement) => readonly unknown[][]) => {
      const database = databaseOf({ records: 2, stored: imported() });
      return (statement) => {
        if (statement.query.startsWith("insert")) {
          throw thrown;
        }
        return database(statement).map((row) => [...row]);
      };
    };
    const write = async ({ thrown }: { thrown: unknown }): Promise<string> => {
      const { client } = scriptedStoreClient({ answer: answerThen({ thrown }) });
      const outcome = await productionStandingAskTransferSeams()
        .rowsOver({ client })
        .write({ decide: deciding({ request: { ask: ask({ covers: ["unlinked-cards"], id: "c" }), kind: "add" } }) });
      return unwrapErr(outcome).code;
    };
    const race = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "uq_standing_ask_active",
    });
    expect(await write({ thrown: race })).toBe("STANDING_ASK_WRITE_CONFLICT");
    expect(await write({ thrown: new Error("connection reset") })).toBe("STANDING_ASK_STORE_UNAVAILABLE");
  });

  it("claims the import once and inserts the journal's rows inside the claim, and closes through the client", async () => {
    const won = scriptedStoreClient({
      answer: ({ query }) => (query.includes("returning") ? [["standing-asks"]] : []),
    });
    const rows = productionStandingAskTransferSeams().rowsOver({ client: won.client });
    const source = {
      records: unwrap(journal()),
      state: "present",
      witness: { bytes: 12, sha256: "ab".repeat(32) },
    } as const;
    expect(unwrap(await rows.claim({ source }))).toBe(true);
    expect(shapes({ statements: won.statements() })).toEqual([
      'insert "home_file_import"',
      'insert "standing_ask"',
      'insert "standing_ask_coverage"',
      'insert "standing_ask_event"',
    ]);
    await rows.close();
    expect(won.closes()).toBe(1);
  });

  it("reads what the marker recorded of its file", async () => {
    const { client } = scriptedStoreClient({ answer: () => [[12, "ab".repeat(32), "present"]] });
    expect(unwrap(await productionStandingAskTransferSeams().rowsOver({ client }).markedSource())).toEqual({
      state: "present",
      witness: { bytes: 12, sha256: "ab".repeat(32) },
    });
  });
});

describe("the production seams and ports", () => {
  it("read the real home journal, and build without opening a connection", () => {
    expect(productionStandingAskSeams().readHomeFile).toBe(readHomeFileStandingAsks);
    expect(productionStandingAskTransferSeams().readSnapshot).toBe(readStandingAskSnapshot);
    expect(Object.keys(standingAskPort()).toSorted()).toEqual(["readActive", "write"]);
    expect(Object.keys(standingAskTransferPort()).toSorted()).toEqual(["ensureImported", "readPortableJournal"]);
  });
});
