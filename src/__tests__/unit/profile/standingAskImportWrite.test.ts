/**
 * An applied import's standing-ask writer over a scripted client (`../../scriptedStoreClient.ts`): the register read it
 * judges against, withdrawals before any insert, the count it reports, and which failure a vanished ask, a lost
 * withdrawal or a driver throw becomes. What only a real database proves — the active-generation and active-coverage
 * indexes, the lock — is the opt-in `src/__tests__/integration/storeImportWriters.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { ImportedStandingAskVersion } from "../../../profile/standingAskImportRows.js";
import { writeImportedStandingAsks } from "../../../profile/standingAskImportWrite.js";
import {
  importedStandingAskEvents,
  importedStandingAskRows,
  type StoredStandingAsks,
} from "../../../profile/standingAskRecords.js";
import { type StandingAsk, standingAskLine } from "../../../profile/standingAsks.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";

const WITHDRAWN_AT = "2026-11-02T00:00:00.000Z";

/** One ask under a fixed quote. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return {
    covers,
    id,
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
}

/** The register a one-ask journal's import leaves: ask `a`, covering `findings`, active. */
function holdingA(): StoredStandingAsks {
  const events = importedStandingAskEvents({
    lines: [
      { line: standingAskLine({ event: { kind: "recorded", ...ask({ covers: ["findings"], id: "a" }) } }), number: 1 },
    ],
  });
  return importedStandingAskRows({ events: unwrap(events), mintId: () => "row-a" });
}

/**
 * What a database holding `stored` and a marker counting its events answers, each row in its select's field order.
 * A withdrawal answers `withdrawn` rows; an insert answers nothing.
 *
 * @param stored the register's rows
 * @param withdrawn how many rows the withdrawing UPDATE reports
 * @returns the answer a scripted client runs
 */
function databaseOf({
  stored,
  withdrawn,
}: {
  stored: StoredStandingAsks;
  withdrawn: number;
}): (statement: ScriptedStatement) => readonly (readonly unknown[])[] {
  return ({ query }) => {
    if (query.startsWith("update")) {
      return Array.from({ length: withdrawn }, () => ["row-a"]);
    }
    if (query.includes('from "home_file_import"')) {
      return [[stored.events.length]];
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
 * The verb and target of each statement past the register read, so a test asserts the order without restating SQL.
 *
 * @param statements what the client was sent
 * @returns one `verb "table"` line each for every write
 */
function writes({ statements }: { statements: readonly ScriptedStatement[] }): readonly string[] {
  return statements
    .filter(({ query }) => !query.startsWith("select"))
    .map(({ query }) => {
      const table = /(?:into|update) ("[a-z_]+")/u.exec(query);
      return `${query.split(" ")[0]!} ${table![1]!}`;
    });
}

/** One imported version, active and replacing nothing unless told otherwise. */
function version({
  covers,
  id,
  state = "active",
  withdraws = [],
}: {
  covers: readonly string[];
  id: string;
  state?: "active" | "inactive";
  withdraws?: readonly string[];
}): ImportedStandingAskVersion {
  return { ask: ask({ covers, id }), questionId: `q-${id}`, state, withdraws };
}

/**
 * Run the writer in a transaction over `answer`.
 *
 * @param answer what the database answers
 * @param versions the imported asks
 * @returns the writer's outcome and every statement it issued
 */
async function write({
  answer,
  versions,
}: {
  answer: (statement: ScriptedStatement) => readonly (readonly unknown[])[];
  versions: readonly ImportedStandingAskVersion[];
}): Promise<{
  outcome: Awaited<ReturnType<typeof writeImportedStandingAsks>>;
  statements: readonly ScriptedStatement[];
}> {
  const { client, statements } = scriptedStoreClient({ answer });
  const outcome = await client.db.transaction(async (writer) =>
    writeImportedStandingAsks({ versions, withdrawnAtIso: WITHDRAWN_AT, writer }),
  );
  return { outcome, statements: statements() };
}

describe("writeImportedStandingAsks", () => {
  it("takes an ask over by withdrawing the replaced generation first, then its generation, cards and events", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 1 }),
      versions: [version({ covers: ["findings", "bot-replies"], id: "c", withdraws: ["a"] })],
    });
    expect(unwrap(outcome)).toBe(7);
    expect(writes({ statements })).toEqual([
      'update "standing_ask"',
      'insert "standing_ask"',
      'insert "standing_ask_coverage"',
      'insert "standing_ask_event"',
    ]);
    expect(statements.find(({ query }) => query.startsWith("update"))!.params).toEqual([
      "withdrawn",
      "row-a",
      "active",
    ]);
  });

  it("leaves an inactive ask without a recording, inserting only its generation and cards", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 0 }),
      versions: [version({ covers: ["findings"], id: "b", state: "inactive" })],
    });
    expect(unwrap(outcome)).toBe(2);
    expect(writes({ statements })).toEqual(['insert "standing_ask"', 'insert "standing_ask_coverage"']);
  });

  it("writes nothing for an import carrying no ask", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 0 }),
      versions: [],
    });
    expect(unwrap(outcome)).toBe(0);
    expect(writes({ statements })).toEqual([]);
  });

  it("refuses an inactive version that would withdraw live asks before any statement, the read included", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 1 }),
      versions: [version({ covers: ["findings"], id: "b", state: "inactive", withdraws: ["a"] })],
    });
    expect(unwrapErr(outcome).code).toBe("STANDING_ASK_IMPORT_ANSWER_CONTRADICTORY");
    expect(statements).toEqual([]);
  });

  it("refuses an import replacing an ask that no longer stands, writing nothing", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 0 }),
      versions: [version({ covers: ["registered-rows"], id: "c", withdraws: ["gone"] })],
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("STANDING_ASK_WRITE_CONFLICT");
    expect(refused.message).toContain("the import replaces gone, which no longer stands");
    expect(writes({ statements })).toEqual([]);
  });

  it("refuses when the withdrawal finds the replaced ask already withdrawn, inserting nothing after it", async () => {
    const { outcome, statements } = await write({
      answer: databaseOf({ stored: holdingA(), withdrawn: 0 }),
      versions: [version({ covers: ["findings"], id: "c", withdraws: ["a"] })],
    });
    const refused = unwrapErr(outcome);
    expect(refused.code).toBe("STANDING_ASK_WRITE_CONFLICT");
    expect(refused.message).toContain("a replaced ask stopped standing mid-import");
    expect(writes({ statements })).toEqual(['update "standing_ask"']);
  });

  it("refuses a register whose import marker is gone, before writing anything", async () => {
    const database = databaseOf({ stored: holdingA(), withdrawn: 0 });
    const { outcome, statements } = await write({
      answer: (statement) => (statement.query.includes('from "home_file_import"') ? [] : database(statement)),
      versions: [version({ covers: ["registered-rows"], id: "c" })],
    });
    expect(unwrapErr(outcome).message).toBe(
      "the store could not read the standing-ask import marker inside the reading snapshot: the marker the import wrote is gone",
    );
    expect(writes({ statements })).toEqual([]);
  });

  it("reads a racing writer's index violation as a write conflict, and any other failure as an outage", async () => {
    const failing = ({ thrown }: { thrown: unknown }): ((statement: ScriptedStatement) => readonly unknown[][]) => {
      const database = databaseOf({ stored: holdingA(), withdrawn: 0 });
      return (statement) => {
        if (statement.query.startsWith("insert")) {
          throw thrown;
        }
        return database(statement).map((row) => [...row]);
      };
    };
    const codeOf = async ({ thrown }: { thrown: unknown }): Promise<string> => {
      const { outcome } = await write({
        answer: failing({ thrown }),
        versions: [version({ covers: ["registered-rows"], id: "c" })],
      });
      return unwrapErr(outcome).code;
    };
    const race = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "uq_standing_ask_active",
    });
    expect(await codeOf({ thrown: race })).toBe("STANDING_ASK_WRITE_CONFLICT");
    expect(await codeOf({ thrown: new Error("connection reset") })).toBe("STANDING_ASK_STORE_UNAVAILABLE");
  });
});
