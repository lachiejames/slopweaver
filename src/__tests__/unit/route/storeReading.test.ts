/**
 * The history capability's grading — what an observation of the store does to the row a brief prints.
 *
 * The failure these pin: a row that declared `availability: available` as a literal
 * while the command it named refused in every bot turn. So the assertions that matter most are the
 * negative ones — an unreachable store does not produce an available row, and it does not print a command.
 */
import { describe, expect, it } from "vitest";

import type { SourceCapability } from "../../../route/profile.js";
import { buildRoutingCapabilities } from "../../../route/routingCapabilities.js";
import {
  gradeHistoryCapability,
  gradeHistoryRows,
  HISTORY_CAPABILITY_ID,
  opensTheStore,
  type StoreRouteReading,
} from "../../../route/storeReading.js";

/** The declared corpus row, as `GENERIC_SOURCE_CAPABILITIES` carries it before any grading. */
const DECLARED: SourceCapability = {
  availability: { kind: "available" },
  command: ["/abs/slopweaver", "store", "read", "what did we decide"],
  coverage: { detail: "declared, ungraded", kind: "bounded" },
  effect: "read",
  freshness: { detail: "declared, ungraded", kind: "snapshot" },
  id: HISTORY_CAPABILITY_ID,
  owner: "slopweaver",
  sourceClass: "corpus",
  terms: ["what did we decide"],
  truthMode: "history",
  what: "what the org's own records say",
};

/** A current-truth row, to prove grading never touches one. */
const CURRENT: SourceCapability = {
  ...DECLARED,
  command: ["/abs/slopweaver", "handover", "list"],
  id: "handover-list",
  sourceClass: "orchestration",
  truthMode: "current",
};

const LOADED: StoreRouteReading = {
  because: "reached, selected from the remembered selection",
  bySource: [
    { newest: "2026-09-12T02:06:17.000Z", rows: 1751712, source: "slack" },
    { newest: "2026-09-12T09:41:00.000Z", rows: 94585, source: "linear" },
  ],
  kind: "loaded",
  rows: 1846297,
};

describe("grading the history capability against the store it would read", () => {
  it("keeps it available and reports the real counts when the store is loaded", () => {
    const graded = gradeHistoryCapability({ capability: DECLARED, reading: LOADED });
    expect(graded.availability.kind).toBe("available");
    expect(graded.coverage.kind).toBe("bounded");
    expect(graded.coverage.detail).toContain("1846297 row(s)");
    expect(graded.coverage.detail).toContain("slack 1751712 to 2026-09-12T02:06:17.000Z");
  });

  it("keeps the `store read` command intact on a loaded store, so the session can run it verbatim", () => {
    expect(gradeHistoryCapability({ capability: DECLARED, reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "what did we decide",
    ]);
  });

  it("marks it UNAVAILABLE when no database was selected, which is the exact shape that once refused every turn", () => {
    const graded = gradeHistoryCapability({
      capability: DECLARED,
      reading: { because: "no database is selected", kind: "unselected" },
    });
    expect(graded.availability.kind).toBe("unavailable");
    expect(graded.availability).toEqual({ kind: "unavailable", reason: "no database is selected" });
  });

  it("strips the command when the store cannot be reached, so nothing prints a verb that will refuse", () => {
    expect(
      gradeHistoryCapability({
        capability: DECLARED,
        reading: { because: "nothing listening on that port", kind: "unreachable" },
      }).command,
    ).toEqual([]);
  });

  it("calls a reachable but EMPTY store unavailable, and says complete — the count is a fact, not a gap", () => {
    const graded = gradeHistoryCapability({
      capability: DECLARED,
      reading: { because: "reached, and it holds no content rows", kind: "empty" },
    });
    expect(graded.availability.kind).toBe("unavailable");
    expect(graded.coverage.kind).toBe("complete");
  });

  it("says UNKNOWN rather than zero when reachability held and the census did not finish", () => {
    const graded = gradeHistoryCapability({
      capability: DECLARED,
      reading: {
        because: "reached; the row census did not finish in the budget",
        bySource: null,
        kind: "loaded",
        rows: null,
      },
    });
    expect(graded.availability.kind).toBe("available");
    expect(graded.coverage.detail).toContain("UNKNOWN");
  });

  it("appends the home the observation was taken under, so the printed argv addresses the graded database", () => {
    expect(gradeHistoryCapability({ capability: DECLARED, home: "/tmp/home-b", reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "what did we decide",
      "--home",
      "/tmp/home-b",
    ]);
  });

  it("leaves the command alone when no home was named, so a default-home brief prints no redundant flag", () => {
    expect(gradeHistoryCapability({ capability: DECLARED, reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "what did we decide",
    ]);
  });

  it("appends no home to an UNAVAILABLE row, which carries no command to append it to", () => {
    expect(
      gradeHistoryCapability({
        capability: DECLARED,
        home: "/tmp/home-b",
        reading: { because: "nothing listening", kind: "unreachable" },
      }).command,
    ).toEqual([]);
  });

  it("names each source's NEWEST record, which is what a reader judges staleness by", () => {
    const detail = gradeHistoryCapability({ capability: DECLARED, reading: LOADED }).coverage.detail;
    expect(detail).toContain("linear 94585 to 2026-09-12T09:41:00.000Z");
    expect(detail).toContain("the store can only be as fresh as the last bronze refresh that fed it");
  });

  it("says the date is unknown rather than inventing one when a source has no datable record", () => {
    const detail = gradeHistoryCapability({
      capability: DECLARED,
      reading: { ...LOADED, bySource: [{ newest: null, rows: 3, source: "gold" }], rows: 3 },
    }).coverage.detail;
    expect(detail).toContain("gold 3 to an unknown date");
  });

  it("never promotes it out of history, however loaded the store is", () => {
    expect(gradeHistoryCapability({ capability: DECLARED, reading: LOADED }).truthMode).toBe("history");
  });
});

describe("grading history rows before the routing partition buckets them", () => {
  it("leaves a current-truth row byte-identical — grading is never allowed to touch one", () => {
    expect(gradeHistoryRows({ capabilities: [CURRENT], home: "/tmp/home-b", reading: LOADED })[0]).toEqual(CURRENT);
  });

  it("grades the corpus row and gives it the graded home", () => {
    const rows = gradeHistoryRows({ capabilities: [DECLARED], home: "/tmp/home-b", reading: LOADED });
    expect(rows[0]!.command.slice(-2)).toEqual(["--home", "/tmp/home-b"]);
  });

  it("offers the corpus row as declared when nobody looked — re-homed, but not re-judged", () => {
    const rows = gradeHistoryRows({ capabilities: [DECLARED], home: "/tmp/home-b", reading: undefined });
    expect(rows[0]!.availability).toEqual({ kind: "available" });
    expect(rows[0]!.command.slice(-2)).toEqual(["--home", "/tmp/home-b"]);
  });

  it("gives an overlay's SECOND history row the home too", () => {
    const overlay: SourceCapability = { ...DECLARED, id: "history-store" };
    expect(gradeHistoryRows({ capabilities: [overlay], home: "/tmp/home-b", reading: LOADED })[0]!.command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "what did we decide",
      "--home",
      "/tmp/home-b",
    ]);
  });

  // Grading was keyed on the row's ID, so a copy of the generic row under a
  // second id stayed AVAILABLE beside a command that refused with STORE_URL_MISSING while the original turned
  // UNAVAILABLE. The verdict is about the database the command opens, so every row opening it is graded.
  it("grades an overlay's SECOND store-reading row against the same store, whatever it is called", () => {
    const overlay: SourceCapability = { ...DECLARED, id: "history-store" };
    const graded = gradeHistoryRows({
      capabilities: [DECLARED, overlay],
      home: "/tmp/home-b",
      reading: { because: "no database is selected", kind: "unselected" },
    });
    expect(graded.map((row) => row.availability.kind)).toEqual(["unavailable", "unavailable"]);
    expect(graded.map((row) => row.command)).toEqual([[], []]);
  });

  it("grades a `store cite` row and a `store query` row too, because each opens the measured database", () => {
    const cite: SourceCapability = { ...DECLARED, command: ["slopweaver", "store", "cite", "q"], id: "store-cite" };
    const query: SourceCapability = {
      ...DECLARED,
      command: ["slopweaver", "store", "query", "--search", "q"],
      id: "store-query",
    };
    const graded = gradeHistoryRows({
      capabilities: [cite, query],
      home: undefined,
      reading: { because: "nothing listening", kind: "unreachable" },
    });
    expect(graded.map((row) => row.availability)).toEqual([
      { kind: "unavailable", reason: "nothing listening" },
      { kind: "unavailable", reason: "nothing listening" },
    ]);
  });

  it("leaves a history row of OURS that reads no store as declared — the probe says nothing about it", () => {
    const journal: SourceCapability = {
      ...DECLARED,
      command: ["/abs/slopweaver", "handover", "list"],
      id: "board-history",
    };
    const graded = gradeHistoryRows({
      capabilities: [journal],
      home: "/tmp/home-b",
      reading: { because: "nothing listening", kind: "unreachable" },
    });
    expect(graded[0]!.availability).toEqual({ kind: "available" });
    expect(graded[0]!.command).toEqual(["/abs/slopweaver", "handover", "list", "--home", "/tmp/home-b"]);
  });

  // A flag-shaped question is fenced behind `--` at materialisation, so the home
  // must be inserted BEFORE that fence and a question of exactly "--home" must survive the strip.
  it("inserts the home before a -- fence, so the question after it stays question text", () => {
    const fenced: SourceCapability = {
      ...DECLARED,
      command: ["/abs/slopweaver", "store", "read", "--", "-x"],
    };
    expect(gradeHistoryCapability({ capability: fenced, home: "/tmp/home-b", reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "--home",
      "/tmp/home-b",
      "--",
      "-x",
    ]);
  });

  it("keeps a question of exactly --home, because past the fence it is text rather than a flag", () => {
    const fenced: SourceCapability = {
      ...DECLARED,
      command: ["/abs/slopweaver", "store", "read", "--home", "/tmp/home-a", "--", "--home"],
    };
    expect(gradeHistoryCapability({ capability: fenced, home: "/tmp/home-b", reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "--home",
      "/tmp/home-b",
      "--",
      "--home",
    ]);
  });

  it("decides 'opens the store' by the launcher and a store verb, never by the row id", () => {
    expect(opensTheStore({ command: ["/abs/slopweaver", "store", "read", "q"] })).toBe(true);
    expect(opensTheStore({ command: ["slopweaver", "store", "cite", "q"] })).toBe(true);
    expect(opensTheStore({ command: ["slopweaver", "store", "status"] })).toBe(true);
    expect(opensTheStore({ command: ["slopweaver", "store", "load", "--source", "slack"] })).toBe(true);
    // `store collect` folds reply files into a plan and opens nothing, so the probe says nothing about it.
    expect(opensTheStore({ command: ["slopweaver", "store", "collect", "--plan", "p"] })).toBe(false);
    expect(opensTheStore({ command: ["slopweaver", "store"] })).toBe(false);
    // `handover list` is ours and reads no store at all.
    expect(opensTheStore({ command: ["slopweaver", "handover", "list"] })).toBe(false);
    // A retired noun of ours names no verb at all now, so it opens nothing either.
    expect(opensTheStore({ command: ["slopweaver", "ask", "q"] })).toBe(false);
    expect(opensTheStore({ command: ["yarn", "work-console", "store", "read", "q"] })).toBe(false);
    expect(opensTheStore({ command: [] })).toBe(false);
  });

  it("leaves a FOREIGN launcher's argv alone, because another layer's flags are not ours to pass", () => {
    const foreign: SourceCapability = { ...DECLARED, command: ["yarn", "work-console", "read"], id: "history-store" };
    expect(gradeHistoryRows({ capabilities: [foreign], home: "/tmp/home-b", reading: LOADED })[0]!.command).toEqual([
      "yarn",
      "work-console",
      "read",
    ]);
  });

  // This case once asserted the OPPOSITE, locking in a row that printed one database's counts beside
  // a command that opened another. The measured home has to win.
  it("REPLACES a home the row declared, so the counts and the command describe the same database", () => {
    const declared: SourceCapability = {
      ...DECLARED,
      command: ["/abs/slopweaver", "store", "read", "q", "--home", "/tmp/home-a"],
    };
    expect(gradeHistoryCapability({ capability: declared, home: "/tmp/home-b", reading: LOADED }).command).toEqual([
      "/abs/slopweaver",
      "store",
      "read",
      "q",
      "--home",
      "/tmp/home-b",
    ]);
  });

  it("drops a declared home's VALUE with its flag, so the directory cannot become a stray search term", () => {
    const declared: SourceCapability = {
      ...DECLARED,
      command: ["/abs/slopweaver", "store", "read", "q", "--home", "/tmp/home-a"],
    };
    const graded = gradeHistoryCapability({ capability: declared, home: "/tmp/home-b", reading: LOADED });
    expect(graded.command.filter((token) => token === "/tmp/home-a")).toEqual([]);
  });

  it("preserves row order, so the brief lists capabilities in the table's own declared order", () => {
    const rows = gradeHistoryRows({ capabilities: [CURRENT, DECLARED], home: undefined, reading: LOADED });
    expect(rows.map((row) => row.id)).toEqual(["handover-list", HISTORY_CAPABILITY_ID]);
  });
});

describe("the graded row, once the routing partition files it", () => {
  const WORLD_MODEL_ROW: SourceCapability = { ...DECLARED, command: ["slopweaver", "store", "read", "{question}"] };

  it("lands in HISTORICAL, carrying the graded home, when the store is loaded", () => {
    const inventory = buildRoutingCapabilities({
      baseCapabilities: [WORLD_MODEL_ROW],
      home: "/tmp/home-b",
      question: "q",
      slopweaverCommand: "/abs/slopweaver",
      storeReading: LOADED,
    });
    expect(inventory.historical.map((row) => row.id)).toEqual([HISTORY_CAPABILITY_ID]);
    expect(inventory.historical[0]!.command.slice(-2)).toEqual(["--home", "/tmp/home-b"]);
  });

  it("lands in UNAVAILABLE with no command when the store cannot be reached — the partition's own rule files it", () => {
    const inventory = buildRoutingCapabilities({
      baseCapabilities: [WORLD_MODEL_ROW],
      home: "/tmp/home-b",
      question: "q",
      slopweaverCommand: "/abs/slopweaver",
      storeReading: { because: "nothing listening", kind: "unreachable" },
    });
    expect(inventory.historical).toEqual([]);
    expect(inventory.unavailable.map((row) => row.command)).toEqual([[]]);
  });
});
