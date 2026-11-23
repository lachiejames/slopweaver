/**
 * `fleet history`'s projection and its backward ledger read — rows written to a real JSONL file in a temp home and
 * read back, never a mock.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runFleetHistory } from "../../../cli/commands/fleet/historyRun.js";
import { fleetHistoryLine, fleetHistoryOf, READY_NOT_RECORDED } from "../../../fleet/stateHistory.js";
import { readTickRowsSince } from "../../../fleet/stateHistoryRead.js";
import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import { supervisorTickLedgerPath, supervisorTickLine } from "../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";

/** A source the tick read, with the given facts. */
function readSource({ facts, observedAtIso }: { facts: Record<string, unknown>; observedAtIso: string }): unknown {
  return { facts, observedAtIso, status: "read", witness: { command: "fixture", exitCode: null } };
}

/** The capacity facts every read capacity source carries, with any overridden. */
function capacityFacts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dispatchBackoffSeconds: 0,
    dispatchCovering: 0,
    dispatchOpen: 0,
    dispatchSubject: "",
    hold: false,
    holdSubjects: [],
    load1: 12.5,
    segmentsPct: 15,
    swapfileCount: 2,
    topForeignGb: 1.1,
    topForeignLabel: "mds",
    ...over,
  };
}

/** The reconcile facts, with any overridden. */
function reconcileFacts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alignedCount: 3,
    headline: "3 of 6 live session(s) are on the board's top 5.",
    intakeClause: "no owner turn is unrowed.",
    misalignedCount: 1,
    rankedCount: 40,
    staleAskCount: 0,
    starvingCount: 0,
    unregisteredCount: 2,
    ...over,
  };
}

/**
 * One valid tick row: every source unavailable unless the fixture supplies it.
 *
 * @returns the row, valid against the ledger's own strict schema
 */
function tickAt({
  tickId,
  finalisedIso,
  capacity,
  reconcile,
  working,
}: {
  tickId: string;
  finalisedIso: string;
  capacity?: Record<string, unknown>;
  reconcile?: Record<string, unknown>;
  working?: number;
}): SupervisorTickRow {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: `${kind} not read by this fixture`,
      observedAtIso: startedIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  if (capacity !== undefined) {
    sources["capacity"] = readSource({ facts: capacity, observedAtIso: startedIso });
  }
  if (reconcile !== undefined) {
    sources["reconcile"] = readSource({ facts: reconcile, observedAtIso: startedIso });
  }
  if (working !== undefined) {
    const rows = [
      ...Array.from({ length: working }, (_unused, index) => ({
        on: "a row",
        session: `w${String(index)}`,
        state: "working",
      })),
      { on: "nothing", session: "idle-one", state: "idle" },
    ];
    sources["watch"] = readSource({ facts: { rows, suppressed: 0 }, observedAtIso: startedIso });
  }
  const parts = {
    actions: [],
    judgements: [],
    ownerTurns: {
      coverage: { earliestIso: undefined, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read" as const,
      turns: [],
    },
    sources,
  };
  return {
    ...parts,
    finalisedIso,
    handoff: "handoff-9001",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:1",
  } as unknown as SupervisorTickRow;
}

describe("fleetHistoryOf", () => {
  it("carries a new tick's hold, load against its hold, ceiling, working count and open-ready count", () => {
    const tick = tickAt({
      capacity: capacityFacts({
        hold: true,
        holdSubjects: ["cpu"],
        load1: 26.6,
        loadHold: 22,
        workingSeatCeiling: { kind: "measured", seats: 4 },
      }),
      finalisedIso: "2026-10-10T01:00:00.000Z",
      reconcile: reconcileFacts({ openReadyCount: 2 }),
      tickId: "t1",
      working: 6,
    });

    const document = fleetHistoryOf({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks: [tick],
      toIso: "2026-10-10T02:00:00.000Z",
    });

    expect(document.rows).toStrictEqual([
      {
        atIso: "2026-10-10T01:00:00.000Z",
        capacity: {
          ceilings: null,
          hold: true,
          holdSubjects: ["cpu"],
          kind: "read",
          load1: 26.6,
          loadHold: 22,
          observedAtIso: "2026-10-10T00:59:00.000Z",
          seatCeiling: { kind: "measured", seats: 4 },
        },
        ready: { kind: "read", openReadyCount: 2 },
        tickId: "t1",
        working: { kind: "read", working: 6 },
      },
    ]);
    expect(fleetHistoryLine({ row: document.rows[0]! })).toBe(
      "2026-10-10T01:00:00.000Z  6 working · holding on cpu, load 26.6 against 22 · 2 ready with nobody on",
    );
  });

  it("says an old tick did not record the ready count or the hold's load, never a zero", () => {
    const tick = tickAt({
      capacity: capacityFacts(),
      finalisedIso: "2026-10-09T03:00:00.000Z",
      reconcile: reconcileFacts(),
      tickId: "old",
      working: 2,
    });

    const [row] = fleetHistoryOf({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks: [tick],
      toIso: "2026-10-10T02:00:00.000Z",
    }).rows;

    expect(row!.ready).toStrictEqual({ kind: "not-recorded", why: READY_NOT_RECORDED });
    expect(row!.capacity).toStrictEqual({
      ceilings: null,
      hold: false,
      holdSubjects: [],
      kind: "read",
      load1: 12.5,
      loadHold: null,
      observedAtIso: "2026-10-09T02:59:00.000Z",
      seatCeiling: null,
    });
  });

  it("carries each unread source's own reason", () => {
    const [row] = fleetHistoryOf({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks: [tickAt({ finalisedIso: "2026-10-09T04:00:00.000Z", tickId: "bare" })],
      toIso: "2026-10-10T02:00:00.000Z",
    }).rows;

    expect(row!.capacity).toStrictEqual({ kind: "unavailable", why: "capacity not read by this fixture" });
    expect(row!.working).toStrictEqual({ kind: "unavailable", why: "watch not read by this fixture" });
    expect(row!.ready).toStrictEqual({
      kind: "not-recorded",
      why: "the board was not read this tick: reconcile not read by this fixture",
    });
  });

  it("keeps only the window, oldest first, breaking a tie on tick id", () => {
    const ticks = [
      tickAt({ finalisedIso: "2026-10-10T01:00:00.000Z", tickId: "b" }),
      tickAt({ finalisedIso: "2026-10-09T01:59:59.000Z", tickId: "too-old" }),
      tickAt({ finalisedIso: "2026-10-10T01:00:00.000Z", tickId: "a" }),
      tickAt({ finalisedIso: "2026-10-09T02:00:00.000Z", tickId: "first" }),
      tickAt({ finalisedIso: "2026-10-10T02:00:01.000Z", tickId: "after" }),
    ];

    const document = fleetHistoryOf({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks,
      toIso: "2026-10-10T02:00:00.000Z",
    });

    expect(document.rows.map((row) => row.tickId)).toStrictEqual(["first", "a", "b"]);
  });

  it("is an empty window, not a refusal, when no tick finalised inside it", () => {
    const document = fleetHistoryOf({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks: [],
      toIso: "2026-10-10T02:00:00.000Z",
    });

    expect(document.rows).toStrictEqual([]);
  });
});

describe("readTickRowsSince", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A temp home holding a ledger of the given rows, and the ledger's path. */
  function ledgerOf({ ticks }: { ticks: readonly SupervisorTickRow[] }): { home: string; path: string } {
    const home = mkdtempSync(join(tmpdir(), "sw-history-"));
    homes.push(home);
    const path = supervisorTickLedgerPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ticks.map((row) => `${supervisorTickLine({ row })}\n`).join(""));
    return { home, path };
  }

  /** Six hourly ticks finalised from midnight UTC. */
  function sixHours(): readonly SupervisorTickRow[] {
    return Array.from({ length: 6 }, (_unused, hour) =>
      tickAt({ finalisedIso: `2026-10-10T0${String(hour)}:00:00.000Z`, tickId: `t${String(hour)}`, working: hour }),
    );
  }

  it("reads back from the end and stops at the first row before the window", () => {
    const { path } = ledgerOf({ ticks: sixHours() });

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-10T03:30:00.000Z", maxBytes: 1024 * 1024, path }));

    expect(read.reachedFrom).toBe(true);
    expect(read.rows.map((row) => row.tickId)).toStrictEqual(["t5", "t4"]);
  });

  it("reads every row when the window opens before the ledger's first", () => {
    const { path } = ledgerOf({ ticks: sixHours() });

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-01T00:00:00.000Z", maxBytes: 1024 * 1024, path }));

    expect(read.reachedFrom).toBe(true);
    expect(read.rows.map((row) => row.tickId)).toStrictEqual(["t5", "t4", "t3", "t2", "t1", "t0"]);
  });

  it("says it did not reach the window's start when the byte budget ran out, and drops the row it cut", () => {
    const ticks = sixHours();
    const { path } = ledgerOf({ ticks });
    const lastTwo = ticks
      .slice(-2)
      .reduce((bytes, row) => bytes + Buffer.byteLength(`${supervisorTickLine({ row })}\n`), 0);

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-01T00:00:00.000Z", maxBytes: lastTwo + 10, path }));

    expect(read.reachedFrom).toBe(false);
    expect(read.rows.map((row) => row.tickId)).toStrictEqual(["t5", "t4"]);
  });

  it("keeps a whole row the byte budget ends exactly at the start of", () => {
    const ticks = sixHours();
    const { path } = ledgerOf({ ticks });
    const lastTwo = ticks
      .slice(-2)
      .reduce((bytes, row) => bytes + Buffer.byteLength(`${supervisorTickLine({ row })}\n`), 0);

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-01T00:00:00.000Z", maxBytes: lastTwo, path }));

    expect(read.reachedFrom).toBe(false);
    expect(read.rows.map((row) => row.tickId)).toStrictEqual(["t5", "t4"]);
  });

  it("reaches the window's start when the row the budget ends exactly at predates it", () => {
    const ticks = sixHours();
    const { path } = ledgerOf({ ticks });
    const lastTwo = ticks
      .slice(-2)
      .reduce((bytes, row) => bytes + Buffer.byteLength(`${supervisorTickLine({ row })}\n`), 0);

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-10T04:30:00.000Z", maxBytes: lastTwo, path }));

    expect(read.reachedFrom).toBe(true);
    expect(read.rows.map((row) => row.tickId)).toStrictEqual(["t5"]);
  });

  it("refuses a whole line in the window that will not parse, rather than skipping it", () => {
    const { path } = ledgerOf({ ticks: sixHours() });
    appendFileSync(path, '{"tickId":"broken"}\n');

    const error = unwrapErr(readTickRowsSince({ fromIso: "2026-10-10T03:30:00.000Z", maxBytes: 1024 * 1024, path }));

    expect(error.code).toBe("HISTORY_ROW_REFUSED");
    expect(error.message).toContain(`a tick row in ${path} would not read`);
  });

  it("refuses a row finalised after the row below it, rather than trusting the order it stops on", () => {
    const { path } = ledgerOf({
      ticks: [
        tickAt({ finalisedIso: "2026-10-10T00:00:00.000Z", tickId: "t0", working: 0 }),
        tickAt({ finalisedIso: "2026-10-10T05:00:00.000Z", tickId: "t1", working: 1 }),
        tickAt({ finalisedIso: "2026-10-10T04:00:00.000Z", tickId: "t2", working: 2 }),
      ],
    });

    const error = unwrapErr(readTickRowsSince({ fromIso: "2026-10-10T03:00:00.000Z", maxBytes: 1024 * 1024, path }));

    expect(error.code).toBe("HISTORY_ROW_REFUSED");
    expect(error.message).toContain(
      "finalisedIso 2026-10-10T05:00:00.000Z is later than the row after it — the ledger is append-only in finalisation order",
    );
  });

  it("compares instants past the millisecond, as the row schema accepts them", () => {
    const { path } = ledgerOf({
      ticks: [
        tickAt({ finalisedIso: "2026-10-10T03:00:00.0004Z", tickId: "t0", working: 0 }),
        tickAt({ finalisedIso: "2026-10-10T03:00:00.0006Z", tickId: "t1", working: 1 }),
      ],
    });
    const unordered = ledgerOf({
      ticks: [
        tickAt({ finalisedIso: "2026-10-10T03:00:00.0009Z", tickId: "t0", working: 0 }),
        tickAt({ finalisedIso: "2026-10-10T03:00:00.0001Z", tickId: "t1", working: 1 }),
      ],
    });

    const read = unwrap(readTickRowsSince({ fromIso: "2026-10-10T03:00:00.0005Z", maxBytes: 1024 * 1024, path }));
    const error = unwrapErr(
      readTickRowsSince({ fromIso: "2026-10-10T00:00:00.000Z", maxBytes: 1024 * 1024, path: unordered.path }),
    );

    expect([read.reachedFrom, read.rows.map((row) => row.tickId)]).toStrictEqual([true, ["t1"]]);
    expect(error.message).toContain("finalisedIso 2026-10-10T03:00:00.0009Z is later than the row after it");
  });

  it("refuses an absent ledger rather than reporting a quiet fleet", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-history-"));
    homes.push(home);
    const path = supervisorTickLedgerPath({ home });

    const error = unwrapErr(readTickRowsSince({ fromIso: "2026-10-10T00:00:00.000Z", maxBytes: 1024, path }));

    expect(error).toStrictEqual({
      code: "HISTORY_LEDGER_ABSENT",
      message: `${path} does not exist, so no supervisor tick has been recorded on this home`,
    });
  });

  it("prints the window as one JSON document through the verb, judged at --now", () => {
    const { home, path } = ledgerOf({ ticks: sixHours() });
    const out: string[] = [];
    const diagnostics: string[] = [];

    const code = runFleetHistory({
      deps: {
        defaultHome: () => "/nowhere",
        now: () => "2030-01-01T00:00:00.000Z",
        readRows: ({ fromIso }) =>
          readTickRowsSince({ fromIso, maxBytes: 1024 * 1024, path }).mapErr((error) => [error.message]),
        writeDiagnostic: (line) => {
          diagnostics.push(line);
        },
        writeOut: (line) => {
          out.push(line);
        },
      },
      rest: ["--hours", "2", "--now", "2026-10-10T05:30:00Z", "--home", home, "--json"],
    });

    expect(code).toBe(0);
    expect(diagnostics).toStrictEqual([]);
    const document = JSON.parse(out[0]!) as { fromIso: string; toIso: string; rows: { tickId: string }[] };
    expect(document.fromIso).toBe("2026-10-10T03:30:00.000Z");
    expect(document.toIso).toBe("2026-10-10T05:30:00.000Z");
    expect(document.rows.map((row) => row.tickId)).toStrictEqual(["t4", "t5"]);
  });

  it("refuses --hours outside 1 to 168 before reading anything", () => {
    const diagnostics: string[] = [];
    const reads: string[] = [];

    const code = runFleetHistory({
      deps: {
        defaultHome: () => "/nowhere",
        now: () => "2026-10-10T05:30:00.000Z",
        readRows: ({ fromIso }) => {
          reads.push(fromIso);
          return err(["the parser should have refused first"]);
        },
        writeDiagnostic: (line) => {
          diagnostics.push(line);
        },
        writeOut: () => undefined,
      },
      rest: ["--hours", "169"],
    });

    expect(code).toBe(2);
    expect(reads).toStrictEqual([]);
    expect(diagnostics).toStrictEqual(["fleet history: --hours must be a whole number from 1 to 168, got 169"]);
  });
});
