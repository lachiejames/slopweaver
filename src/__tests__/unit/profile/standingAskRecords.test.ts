/**
 * The standing-ask register's pure decisions: what the one-time import writes, what one write records, how a read
 * checks the tables against the journal's fold, and which failure a throw becomes.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import { activeStandingAsksOf } from "../../../profile/standingAskProjection.js";
import {
  importedStandingAskEvents,
  importedStandingAskRows,
  nextJournalSeq,
  type StoredStandingAsks,
  standingAskExportLines,
} from "../../../profile/standingAskRecords.js";
import { type StandingAsk, type StandingAskEvent, standingAskLine } from "../../../profile/standingAsks.js";
import {
  isStandingAskWriteRace,
  lockedStandingAskWrite,
  planStandingAskWrite,
  type StandingAskWriteRows,
  standingAskMarkerRefusal,
  standingAskStepFailure,
  standingAskWriteRows,
} from "../../../profile/standingAskWrites.js";

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

/** One recorded event's line. */
function recorded({ id, covers }: { id: string; covers: readonly string[] }): string {
  return standingAskLine({ event: { kind: "recorded", ...ask({ covers, id }) } });
}

/** One withdrawal's line. */
function withdrawn({ id }: { id: string }): string {
  const event: StandingAskEvent = {
    id,
    kind: "withdrawn",
    reason: "superseded",
    withdrawnAtIso: "2026-10-06T00:00:00.000Z",
  };
  return standingAskLine({ event });
}

/** A minter of `row-1`, `row-2`, …. */
function minter(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `row-${String(next)}`;
  };
}

/** The whole stored register a journal's import leaves, as a read returns it. */
function storedAfterImport({ lines }: { lines: readonly string[] }): StoredStandingAsks {
  const events = unwrap(importedStandingAskEvents({ lines: lines.map((line, at) => ({ line, number: at + 1 })) }));
  return importedStandingAskRows({ events, mintId: minter() });
}

/** One inactive imported generation `z`, row `row-z`, which no event records — the shape a left-inactive answer writes. */
function inactiveImported({ stored }: { stored: StoredStandingAsks }): StoredStandingAsks["asks"][number] {
  return {
    ...stored.asks[0]!,
    askId: "z",
    origin: "store-import",
    recordedSeq: null,
    rowId: "row-z",
    state: "inactive",
  };
}

/** Prefix of every row-unreadable message. */
const UNREADABLE = "the stored standing asks do not read as one register: ";

describe("importedStandingAskEvents", () => {
  it("numbers each event by its nonblank ordinal and leaves a withdrawn recording withdrawn", () => {
    const lines = [
      { line: recorded({ covers: ["findings"], id: "a" }), number: 1 },
      { line: recorded({ covers: ["bot-replies"], id: "b" }), number: 3 },
      { line: withdrawn({ id: "a" }), number: 4 },
    ];
    const events = unwrap(importedStandingAskEvents({ lines }));
    expect(
      events.map((event) =>
        event.kind === "recorded"
          ? [event.journalSeq, event.kind, event.ask.id, event.finalState]
          : [event.journalSeq, event.kind, event.recordedSeq],
      ),
    ).toEqual([
      [1, "recorded", "a", "withdrawn"],
      [2, "recorded", "b", "active"],
      [3, "withdrawn", 1],
    ]);
    expect(events.map((event) => event.exactLine)).toEqual(lines.map((one) => one.line));
  });

  it("refuses a journal that does not fold, naming the physical line", () => {
    const lines = [
      { line: recorded({ covers: ["findings"], id: "a" }), number: 1 },
      { line: withdrawn({ id: "ghost" }), number: 5 },
    ];
    expect(unwrapErr(importedStandingAskEvents({ lines })).code).toBe("UNKNOWN_WITHDRAWAL");
    expect(unwrapErr(importedStandingAskEvents({ lines: [{ line: "{", number: 7 }] })).message).toBe(
      "standing-ask journal line 7 does not read: not JSON",
    );
  });
});

describe("importedStandingAskRows", () => {
  it("writes every row as legacy-file, a withdrawal naming the generation it withdrew", () => {
    const events = unwrap(
      importedStandingAskEvents({
        lines: [
          { line: recorded({ covers: ["findings", "act:auto.merge"], id: "a" }), number: 1 },
          { line: withdrawn({ id: "a" }), number: 2 },
        ],
      }),
    );
    const rows = importedStandingAskRows({ events, mintId: minter() });
    expect(rows.asks.map((one) => [one.rowId, one.askId, one.state, one.origin, one.recordedSeq])).toEqual([
      ["row-1", "a", "withdrawn", "legacy-file", 1],
    ]);
    expect(rows.coverage).toEqual([
      { askRowId: "row-1", coverage: "findings", ordinal: 0, state: "withdrawn" },
      { askRowId: "row-1", coverage: "act:auto.merge", ordinal: 1, state: "withdrawn" },
    ]);
    expect(rows.events.map((one) => [one.journalSeq, one.askRowId, one.kind, one.origin])).toEqual([
      [1, "row-1", "recorded", "legacy-file"],
      [2, "row-1", "withdrawn", "legacy-file"],
    ]);
  });
});

describe("activeStandingAsksOf", () => {
  it("answers the journal's fold when the tables agree with it", () => {
    const stored = storedAfterImport({
      lines: [
        recorded({ covers: ["findings"], id: "a" }),
        recorded({ covers: ["bot-replies"], id: "b" }),
        withdrawn({ id: "a" }),
      ],
    });
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["bot-replies"], id: "b" })]);
  });

  it("refuses an active generation that is not the ask its line records", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const edited = { ...stored, coverage: [{ ...stored.coverage[0]!, coverage: "bot-replies" }] };
    expect(unwrapErr(activeStandingAsksOf({ stored: edited })).message).toBe(
      `${UNREADABLE}generation a is not the ask its recording event 1 records`,
    );
  });

  it("refuses a WITHDRAWN generation edited apart from its line, though no read would answer it", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" }), withdrawn({ id: "a" })] });
    const tampered = { ...stored, asks: [{ ...stored.asks[0]!, quoteWords: "tampered" }] };
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([]);
    expect(unwrapErr(activeStandingAsksOf({ stored: tampered })).message).toBe(
      `${UNREADABLE}generation a is not the ask its recording event 1 records`,
    );
    const revived = {
      asks: [{ ...stored.asks[0]!, state: "active" as const }],
      coverage: [{ ...stored.coverage[0]!, state: "active" as const }],
      events: stored.events,
    };
    expect(unwrapErr(activeStandingAsksOf({ stored: revived })).message).toBe(
      `${UNREADABLE}generation a is stored active and the journal leaves it withdrawn`,
    );
  });

  it("refuses a withdrawal pointed at a later, content-identical generation of one id, the states swapped with it", () => {
    // Lines 1 and 3 are byte-identical, so no comparison of ask CONTENT can tell the two generations apart.
    const stored = storedAfterImport({
      lines: [
        recorded({ covers: ["findings"], id: "a" }),
        withdrawn({ id: "a" }),
        recorded({ covers: ["findings"], id: "a" }),
      ],
    });
    const swap = ({ state }: { state: string }): "active" | "withdrawn" =>
      state === "active" ? "withdrawn" : "active";
    const repointed = {
      asks: stored.asks.map((one) => ({ ...one, state: swap(one) })),
      coverage: stored.coverage.map((one) => ({ ...one, state: swap(one) })),
      events: stored.events.map((one) => (one.kind === "withdrawn" ? { ...one, askRowId: "row-2" } : one)),
    };
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(unwrapErr(activeStandingAsksOf({ stored: repointed })).message).toBe(
      `${UNREADABLE}withdrawal 2 names a generation other than the one the journal withdraws`,
    );
  });

  it("refuses a sequence past the safe-integer range, where two stored values would read alike", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const past = 2 ** 55;
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(
      unwrapErr(activeStandingAsksOf({ stored: { ...stored, events: [{ ...stored.events[0]!, journalSeq: past }] } }))
        .message,
    ).toBe(`${UNREADABLE}event sequence ${String(past)} is not a positive safe integer`);
    expect(
      unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [{ ...stored.asks[0]!, recordedSeq: past }] } }))
        .message,
    ).toBe(`${UNREADABLE}generation a has recorded sequence ${String(past)}, not a positive safe integer`);
  });

  it("refuses a recorded generation with no sequence, and an inactive one carrying one", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(
      unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [{ ...stored.asks[0]!, recordedSeq: null }] } }))
        .message,
    ).toBe(`${UNREADABLE}generation a is active with recorded sequence null: only an inactive one carries none`);
    const sequenced = { ...inactiveImported({ stored }), recordedSeq: 2 };
    expect(unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [...stored.asks, sequenced] } })).message).toBe(
      `${UNREADABLE}generation z is inactive with recorded sequence 2: only an inactive one carries none`,
    );
  });

  it("refuses a journal whose sequences do not run 1, 2, 3, where an event was removed from under the rest", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const shifted = {
      ...stored,
      asks: [{ ...stored.asks[0]!, recordedSeq: 2 }],
      events: [{ ...stored.events[0]!, journalSeq: 2 }],
    };
    expect(unwrapErr(activeStandingAsksOf({ stored: shifted })).message).toBe(
      `${UNREADABLE}event sequence 2 stands at position 1: the journal has a gap`,
    );
  });

  it("reads an inactive imported generation as audit state, outside the active asks and the export", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const audited = {
      asks: [...stored.asks, inactiveImported({ stored })],
      coverage: [
        ...stored.coverage,
        { askRowId: "row-z", coverage: "bot-replies", ordinal: 0, state: "inactive" as const },
      ],
      events: stored.events,
    };
    expect(unwrap(activeStandingAsksOf({ stored: audited }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(standingAskExportLines({ events: audited.events })).toEqual([recorded({ covers: ["findings"], id: "a" })]);
  });

  it("refuses an inactive generation from a writer that never leaves one, and an event naming one", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const fromProfile = { ...inactiveImported({ stored }), origin: "profile" as const };
    expect(
      unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [...stored.asks, fromProfile] } })).message,
    ).toBe(`${UNREADABLE}generation z is inactive and from profile, which never leaves one inactive`);
    const named = {
      asks: [...stored.asks, inactiveImported({ stored })],
      coverage: stored.coverage,
      events: [
        ...stored.events,
        {
          askRowId: "row-z",
          exactLine: withdrawn({ id: "a" }),
          journalSeq: 2,
          kind: "withdrawn" as const,
          origin: "profile" as const,
        },
      ],
    };
    expect(unwrapErr(activeStandingAsksOf({ stored: named })).message).toBe(
      `${UNREADABLE}event 2 names an inactive generation, which no event records`,
    );
    const namedRecorded = {
      ...named,
      events: [
        ...stored.events,
        {
          ...stored.events[0]!,
          askRowId: "row-z",
          exactLine: recorded({ covers: ["bot-replies"], id: "z" }),
          journalSeq: 2,
        },
      ],
    };
    expect(unwrapErr(activeStandingAsksOf({ stored: namedRecorded })).message).toBe(
      `${UNREADABLE}the journal records 2 generation(s) and the tables hold 1 recorded`,
    );
  });

  it("refuses an imported event after a later writer's, where two origins swapped together keep the count", () => {
    const stored = storedAfterImport({
      lines: [recorded({ covers: ["findings"], id: "a" }), recorded({ covers: ["bot-replies"], id: "b" })],
    });
    const fromProfile = "profile" as const;
    const swapped = {
      ...stored,
      asks: stored.asks.map((one) => (one.askId === "a" ? { ...one, origin: fromProfile } : one)),
      events: stored.events.map((one) => (one.journalSeq === 1 ? { ...one, origin: fromProfile } : one)),
    };
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([
      ask({ covers: ["findings"], id: "a" }),
      ask({ covers: ["bot-replies"], id: "b" }),
    ]);
    expect(unwrapErr(activeStandingAsksOf({ stored: swapped })).message).toBe(
      `${UNREADABLE}event 2 is from legacy-file and follows an event a later writer recorded`,
    );
  });

  it("refuses coverage renumbered in its order, which sorting by ordinal alone would read as the same ask", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings", "bot-replies"], id: "a" })] });
    const renumbered = {
      ...stored,
      coverage: stored.coverage.map((row) => (row.coverage === "bot-replies" ? { ...row, ordinal: 2 } : row)),
    };
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings", "bot-replies"], id: "a" })]);
    expect(unwrapErr(activeStandingAsksOf({ stored: renumbered })).message).toBe(
      `${UNREADABLE}generation a numbers its coverage other than 0, 1, 2 in order`,
    );
  });

  it("refuses a recording event whose origin is not its generation's, either way round", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const relabelledGeneration = { ...stored, asks: [{ ...stored.asks[0]!, origin: "profile" as const }] };
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings"], id: "a" })]);
    expect(unwrapErr(activeStandingAsksOf({ stored: relabelledGeneration })).message).toBe(
      `${UNREADABLE}generation a is stored from profile and its recording event 1 from legacy-file`,
    );
    const relabelledEvent = { ...stored, events: [{ ...stored.events[0]!, origin: "profile" as const }] };
    expect(unwrapErr(activeStandingAsksOf({ stored: relabelledEvent })).message).toBe(
      `${UNREADABLE}generation a is stored from legacy-file and its recording event 1 from profile`,
    );
  });

  it("refuses stray coverage, a missing generation, an event naming none, and a line of the wrong kind", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    expect(unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [] } })).message).toBe(
      `${UNREADABLE}coverage findings does not sit under a generation in its state`,
    );
    expect(unwrapErr(activeStandingAsksOf({ stored: { ...stored, asks: [], coverage: [] } })).message).toBe(
      `${UNREADABLE}the journal records 1 generation(s) and the tables hold 0 recorded`,
    );
    const moved = { ...stored, events: [{ ...stored.events[0]!, askRowId: "row-9" }] };
    expect(unwrapErr(activeStandingAsksOf({ stored: moved })).message).toBe(
      `${UNREADABLE}event 1 names no stored generation`,
    );
    const relabelled = { ...stored, events: [{ ...stored.events[0]!, kind: "withdrawn" as const }] };
    expect(unwrapErr(activeStandingAsksOf({ stored: relabelled })).message).toBe(
      `${UNREADABLE}event 1 is stored as withdrawn and its line reads as recorded`,
    );
  });
});

describe("standingAskExportLines and nextJournalSeq", () => {
  it("exports the exact lines in journal order, and numbers the next event past the highest", () => {
    const stored = storedAfterImport({
      lines: [recorded({ covers: ["findings"], id: "a" }), recorded({ covers: ["bot-replies"], id: "b" })],
    });
    const reversed = stored.events.toReversed();
    expect(standingAskExportLines({ events: reversed })).toEqual(stored.events.map((one) => one.exactLine));
    expect(nextJournalSeq({ events: reversed })).toBe(3);
    expect(nextJournalSeq({ events: [] })).toBe(1);
  });
});

describe("planStandingAskWrite and standingAskWriteRows", () => {
  it("records an add at the next sequence as an active profile generation", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const next = ask({ covers: ["bot-replies"], id: "b" });
    const write = unwrap(
      planStandingAskWrite({ active: [ask({ covers: ["findings"], id: "a" })], request: { ask: next, kind: "add" } }),
    );
    expect(write).toEqual({
      ask: next,
      exactLine: standingAskLine({ event: { kind: "recorded", ...next } }),
      kind: "record",
    });
    const { rows, journalSeq } = standingAskWriteRows({ mintId: () => "row-new", stored, write });
    expect(journalSeq).toBe(2);
    expect(rows.asks.map((one) => [one.rowId, one.state, one.origin, one.recordedSeq])).toEqual([
      ["row-new", "active", "profile", 2],
    ]);
    expect(rows.events).toEqual([
      { askRowId: "row-new", exactLine: write.exactLine, journalSeq: 2, kind: "recorded", origin: "profile" },
    ]);
    expect(rows.withdrawRowId).toBe(undefined);
  });

  it("withdraws the active generation by its row, and refuses an add over held coverage or an unknown withdrawal", () => {
    const stored = storedAfterImport({ lines: [recorded({ covers: ["findings"], id: "a" })] });
    const active = unwrap(activeStandingAsksOf({ stored }));
    const request = { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } as const;
    const write = unwrap(planStandingAskWrite({ active, request }));
    const { rows } = standingAskWriteRows({ mintId: () => "unused", stored, write });
    expect(rows.withdrawRowId).toBe("row-1");
    expect(rows.asks).toEqual([]);
    expect(rows.events.map((one) => [one.journalSeq, one.askRowId, one.kind])).toEqual([[2, "row-1", "withdrawn"]]);
    expect(unwrapErr(planStandingAskWrite({ active, request: { ...request, id: "b" } })).code).toBe(
      "UNKNOWN_WITHDRAWAL",
    );
    expect(
      unwrapErr(planStandingAskWrite({ active, request: { ask: ask({ covers: ["findings"], id: "c" }), kind: "add" } }))
        .code,
    ).toBe("COVERAGE_OVERLAP");
  });

  it("refuses a write whose line its own reader would refuse, an add or a withdrawal", () => {
    const fresh = ask({ covers: ["findings"], id: "a" });
    const notIso = "not-an-iso-instant";
    const add = planStandingAskWrite({
      active: [],
      request: { ask: { ...fresh, quote: { ...fresh.quote, atIso: notIso } }, kind: "add" },
    });
    expect(unwrapErr(add).code).toBe("STANDING_ASK_WRITE_UNREADABLE");
    expect(unwrapErr(add).message).toContain("quote.atIso");
    const withdrawal = planStandingAskWrite({
      active: [fresh],
      request: { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: notIso },
    });
    expect(unwrapErr(withdrawal).code).toBe("STANDING_ASK_WRITE_UNREADABLE");
    expect(unwrapErr(withdrawal).message).toContain("withdrawnAtIso");
  });
});

describe("lockedStandingAskWrite", () => {
  it("takes the lock before it reads, and applies only an admitted decision", async () => {
    const steps: string[] = [];
    const stored = storedAfterImport({ lines: [] });
    const applied: StandingAskWriteRows[] = [];
    const outcome = await lockedStandingAskWrite({
      apply: async ({ rows }) => {
        steps.push("apply");
        applied.push(rows);
      },
      decide: () => {
        steps.push("decide");
        return planStandingAskWrite({
          active: [],
          request: { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" },
        });
      },
      lock: async () => {
        steps.push("lock");
      },
      mintId: () => "row-1",
      read: async () => {
        steps.push("read");
        return ok(stored);
      },
    });
    expect(steps).toEqual(["lock", "read", "decide", "apply"]);
    expect(unwrap(outcome)).toEqual({ journalSeq: 1, kind: "written" });
    expect(applied.map((rows) => rows.asks.map((one) => one.askId))).toEqual([["a"]]);
  });

  it("applies nothing when the decision refuses", async () => {
    const applied: StandingAskWriteRows[] = [];
    const outcome = await lockedStandingAskWrite({
      apply: async ({ rows }) => {
        applied.push(rows);
      },
      decide: () =>
        planStandingAskWrite({
          active: [],
          request: { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" },
        }),
      lock: async () => undefined,
      mintId: () => "row-1",
      read: async () => ok(storedAfterImport({ lines: [] })),
    });
    expect(unwrapErr(outcome).code).toBe("UNKNOWN_WITHDRAWAL");
    expect(applied).toEqual([]);
  });
});

describe("standingAskMarkerRefusal and standingAskStepFailure", () => {
  it("refuses a vanished marker and a count the tables do not hold, and passes an exact one", () => {
    expect(standingAskMarkerRefusal({ marker: undefined })!.message).toBe(
      "the store could not read the standing-ask import marker inside the reading snapshot: the marker the import wrote is gone",
    );
    expect(standingAskMarkerRefusal({ marker: { observedRows: 1, records: 3, tableHasRows: true } })).toEqual({
      code: "STANDING_ASK_IMPORT_MARKER_INCONSISTENT",
      expected: 3,
      message: "the standing-ask import marker says 3 event(s) were imported, and the journal table holds 1",
      observed: 1,
    });
    expect(standingAskMarkerRefusal({ marker: { observedRows: 2, records: 2, tableHasRows: true } })).toBe(undefined);
  });

  it("names a marker inconsistency in its own code and anything else as an outage", () => {
    expect(
      standingAskStepFailure({ doing: "x", markerInconsistency: { expected: 2, observed: 0 }, reason: "y" }).code,
    ).toBe("STANDING_ASK_IMPORT_MARKER_INCONSISTENT");
    expect(standingAskStepFailure({ doing: "be opened", reason: "refused" }).message).toBe(
      "the store could not be opened: refused",
    );
  });
});

describe("isStandingAskWriteRace", () => {
  it("reads a unique violation on the register's own indexes, or a serialization failure, a few causes down", () => {
    const wrapped = { cause: { code: "23505", constraint_name: "uq_standing_ask_coverage_active" }, message: "x" };
    expect(isStandingAskWriteRace({ cause: wrapped })).toBe(true);
    expect(isStandingAskWriteRace({ cause: { code: "40001" } })).toBe(true);
    expect(isStandingAskWriteRace({ cause: { code: "23505", constraint_name: "uq_owner_directive_active" } })).toBe(
      false,
    );
    expect(isStandingAskWriteRace({ cause: new Error("connection reset") })).toBe(false);
  });
});
