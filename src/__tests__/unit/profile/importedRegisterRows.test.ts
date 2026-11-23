/**
 * The rows an applied store import writes into the two journalled registers, apart from the SQL: the standing asks it
 * records, leaves inactive or takes over live ones, and the steer measurements it appends.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  type ImportedStandingAskVersion,
  type StandingAskImportRows,
  standingAskImportRows,
} from "../../../profile/standingAskImportRows.js";
import { activeStandingAsksOf } from "../../../profile/standingAskProjection.js";
import {
  importedStandingAskEvents,
  importedStandingAskRows,
  type StoredStandingAsks,
  standingAskExportLines,
} from "../../../profile/standingAskRecords.js";
import { type StandingAsk, standingAskLine } from "../../../profile/standingAsks.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import { importedSteerAppendRows } from "../../../profile/steerMeasurementImport.js";
import { importedSteerEventId } from "../../../profile/steerMeasurementRecords.js";

const QUOTE = {
  anchor: "talk:a0000017-0000-4000-8000-000000000019",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "chuck anything worth a look on the board",
} as const;

const WITHDRAWN_AT = "2026-11-02T00:00:00.000Z";

/** One ask. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return { covers, id, quote: QUOTE, recordedAtIso: "2026-10-05T00:00:00.000Z" };
}

/** A minter of `<prefix>-1`, `<prefix>-2`, …. */
function minter({ prefix }: { prefix: string }): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

/** The register a journal of these asks leaves after its one-time import. */
function registerOf({ asks }: { asks: readonly StandingAsk[] }): StoredStandingAsks {
  const lines = asks.map((one, at) => ({
    line: standingAskLine({ event: { kind: "recorded", ...one } }),
    number: at + 1,
  }));
  const events = unwrap(importedStandingAskEvents({ lines }));
  return importedStandingAskRows({ events, mintId: minter({ prefix: "live" }) });
}

/** One imported version. */
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
  return { ask: ask({ covers, id }), questionId: `import-q-${id}`, state, withdraws };
}

/** The register once the rows are applied the way the SQL half applies them. */
function applied({ stored, rows }: { stored: StoredStandingAsks; rows: StandingAskImportRows }): StoredStandingAsks {
  const retired = new Set(rows.withdrawRowIds);
  const retire = <T extends { readonly state: string }>({ row, rowId }: { row: T; rowId: string }): T =>
    retired.has(rowId) ? { ...row, state: "withdrawn" } : row;
  return {
    asks: [...stored.asks.map((row) => retire({ row, rowId: row.rowId })), ...rows.asks],
    coverage: [...stored.coverage.map((row) => retire({ row, rowId: row.askRowId })), ...rows.coverage],
    events: [...stored.events, ...rows.events],
  };
}

describe("standingAskImportRows", () => {
  it("records an activated ask past the journal, its generation naming the question that admitted it", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings"], id: "a" })] });
    const rows = unwrap(
      standingAskImportRows({
        mintId: minter({ prefix: "new" }),
        stored,
        versions: [version({ covers: ["bot-replies"], id: "b" })],
        withdrawnAtIso: WITHDRAWN_AT,
      }),
    );
    expect(rows.withdrawRowIds).toEqual([]);
    expect(
      rows.asks.map((one) => [one.rowId, one.askId, one.state, one.origin, one.recordedSeq, one.importQuestionId]),
    ).toEqual([["new-1", "b", "active", "store-import", 2, "import-q-b"]]);
    expect(rows.coverage).toEqual([{ askRowId: "new-1", coverage: "bot-replies", ordinal: 0, state: "active" }]);
    expect(rows.events).toEqual([
      {
        askRowId: "new-1",
        exactLine: standingAskLine({ event: { kind: "recorded", ...ask({ covers: ["bot-replies"], id: "b" }) } }),
        journalSeq: 2,
        kind: "recorded",
        origin: "store-import",
      },
    ]);
    expect(rows.writes).toBe(3);
    expect(unwrap(activeStandingAsksOf({ stored: applied({ rows, stored }) }))).toEqual([
      ask({ covers: ["findings"], id: "a" }),
      ask({ covers: ["bot-replies"], id: "b" }),
    ]);
  });

  it("leaves an inactive ask as a generation and its coverage with no event, read as nothing standing", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings"], id: "a" })] });
    const rows = unwrap(
      standingAskImportRows({
        mintId: minter({ prefix: "new" }),
        stored,
        versions: [version({ covers: ["findings", "bot-replies"], id: "a", state: "inactive" })],
        withdrawnAtIso: WITHDRAWN_AT,
      }),
    );
    expect(rows.asks.map((one) => [one.askId, one.state, one.recordedSeq, one.importQuestionId])).toEqual([
      ["a", "inactive", null, "import-q-a"],
    ]);
    expect(rows.coverage.map((one) => [one.coverage, one.state])).toEqual([
      ["findings", "inactive"],
      ["bot-replies", "inactive"],
    ]);
    expect(rows.events).toEqual([]);
    expect(rows.writes).toBe(3);
    const after = applied({ rows, stored });
    expect(unwrap(activeStandingAsksOf({ stored: after }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(standingAskExportLines({ events: after.events })).toEqual(standingAskExportLines({ events: stored.events }));
  });

  it("withdraws every live ask a taken-over one replaces first, each by its own event, cascaded coverage counted", () => {
    const stored = registerOf({
      asks: [ask({ covers: ["findings", "registered-rows"], id: "a" }), ask({ covers: ["bot-replies"], id: "b" })],
    });
    const rows = unwrap(
      standingAskImportRows({
        mintId: minter({ prefix: "new" }),
        stored,
        versions: [version({ covers: ["findings", "bot-replies"], id: "a", withdraws: ["a", "b"] })],
        withdrawnAtIso: WITHDRAWN_AT,
      }),
    );
    expect(rows.withdrawRowIds).toEqual(["live-1", "live-2"]);
    expect(rows.events.map((one) => [one.journalSeq, one.kind, one.askRowId, one.origin])).toEqual([
      [3, "withdrawn", "live-1", "store-import"],
      [4, "withdrawn", "live-2", "store-import"],
      [5, "recorded", "new-1", "store-import"],
    ]);
    expect(rows.events[0]!.exactLine).toBe(
      standingAskLine({
        event: {
          id: "a",
          kind: "withdrawn",
          reason: "replaced by an applied store import, question import-q-a",
          withdrawnAtIso: WITHDRAWN_AT,
        },
      }),
    );
    // Two withdrawals of 2 + 2 and 2 + 1 rows, then a generation, two coverage rows and an event.
    expect(rows.writes).toBe(11);
    expect(unwrap(activeStandingAsksOf({ stored: applied({ rows, stored }) }))).toEqual([
      ask({ covers: ["findings", "bot-replies"], id: "a" }),
    ]);
  });

  it("withdraws a live ask two imported asks both take over once, then records both", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings", "bot-replies"], id: "wide" })] });
    const rows = unwrap(
      standingAskImportRows({
        mintId: minter({ prefix: "new" }),
        stored,
        versions: [
          version({ covers: ["findings"], id: "findings-only", withdraws: ["wide"] }),
          version({ covers: ["bot-replies"], id: "replies-only", withdraws: ["wide"] }),
        ],
        withdrawnAtIso: WITHDRAWN_AT,
      }),
    );
    expect(rows.withdrawRowIds).toEqual(["live-1"]);
    expect(rows.events.map((one) => [one.journalSeq, one.kind, one.askRowId])).toEqual([
      [2, "withdrawn", "live-1"],
      [3, "recorded", "new-1"],
      [4, "recorded", "new-2"],
    ]);
    expect(rows.asks.map((one) => [one.rowId, one.askId, one.state])).toEqual([
      ["new-1", "findings-only", "active"],
      ["new-2", "replies-only", "active"],
    ]);
    // One withdrawal of 2 + 2 rows, then two generations of a generation, one coverage row and an event each.
    expect(rows.writes).toBe(10);
    expect(unwrap(activeStandingAsksOf({ stored: applied({ rows, stored }) }))).toEqual([
      ask({ covers: ["findings"], id: "findings-only" }),
      ask({ covers: ["bot-replies"], id: "replies-only" }),
    ]);
  });

  it("refuses a replacement that no longer stands, and an ask the register would not admit", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings"], id: "a" })] });
    const write = ({ versions }: { versions: readonly ImportedStandingAskVersion[] }) =>
      standingAskImportRows({ mintId: minter({ prefix: "new" }), stored, versions, withdrawnAtIso: WITHDRAWN_AT });
    expect(
      unwrapErr(write({ versions: [version({ covers: ["bot-replies"], id: "c", withdraws: ["gone"] })] })).code,
    ).toBe("STANDING_ASK_WRITE_CONFLICT");
    expect(unwrapErr(write({ versions: [version({ covers: ["findings"], id: "c" })] })).code).toBe("COVERAGE_OVERLAP");
    expect(unwrapErr(write({ versions: [version({ covers: ["bot-replies"], id: "a" })] })).code).toBe("DUPLICATE_ID");
  });

  it("refuses an inactive version that would withdraw live asks, before judging anything", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings"], id: "a" })] });
    const refused = unwrapErr(
      standingAskImportRows({
        mintId: minter({ prefix: "new" }),
        stored,
        versions: [
          version({ covers: ["bot-replies"], id: "c" }),
          version({ covers: ["findings"], id: "b", state: "inactive", withdraws: ["a"] }),
        ],
        withdrawnAtIso: WITHDRAWN_AT,
      }),
    );
    expect(refused.code).toBe("STANDING_ASK_IMPORT_ANSWER_CONTRADICTORY");
    expect(refused.message).toBe(
      "the import would withdraw live asks for b while writing it inactive, which no answer asks for; nothing was written",
    );
  });

  it("refuses a register that does not read, before writing anything over it", () => {
    const stored = registerOf({ asks: [ask({ covers: ["findings"], id: "a" })] });
    const broken = { ...stored, asks: [] };
    expect(
      unwrapErr(
        standingAskImportRows({
          mintId: minter({ prefix: "new" }),
          stored: broken,
          versions: [version({ covers: ["bot-replies"], id: "b" })],
          withdrawnAtIso: WITHDRAWN_AT,
        }),
      ).code,
    ).toBe("STANDING_ASK_ROW_UNREADABLE");
  });
});

describe("importedSteerAppendRows", () => {
  const verdict: SteerVerdict = {
    anchor: "talk:a0000017-0000-4000-8000-000000000019",
    judgedAtIso: "2026-10-04T12:00:00.000Z",
    says: "nothing",
    turnAtIso: "2026-10-04T09:00:00.000Z",
  };
  const line = steerVerdictLine({ verdict });
  const legacy = {
    eventId: importedSteerEventId({ exactLine: line, sourceOrdinal: 3 }),
    exactText: line,
    parseStatus: "parsed" as const,
    schemaVersion: 2 as const,
    sourceOrdinal: 3,
  };
  const later = {
    eventId: "steer-event-00000000-0000-4000-8000-000000000001",
    exactText: line,
    parseStatus: "parsed" as const,
    schemaVersion: 2 as const,
    sourceOrdinal: null,
  };

  it("keeps each imported id, line and place, and numbers the rows on from the highest held", () => {
    expect(unwrap(importedSteerAppendRows({ highest: 7, measurements: [legacy, later] }))).toEqual([
      { eventId: legacy.eventId, exactLine: line, journalSeq: 8, origin: "store-import", sourceOrdinal: 3 },
      { eventId: later.eventId, exactLine: line, journalSeq: 9, origin: "store-import", sourceOrdinal: null },
    ]);
    expect(
      unwrap(importedSteerAppendRows({ highest: null, measurements: [later] })).map((row) => row.journalSeq),
    ).toEqual([1]);
  });

  it("refuses a row whose legacy id its own line and place do not mint", () => {
    expect(
      unwrapErr(importedSteerAppendRows({ highest: 7, measurements: [{ ...legacy, sourceOrdinal: 4 }] })).code,
    ).toBe("STEER_IMPORTED_ROW_ALTERED");
  });
});
