/**
 * The tick ledger on disk: the append, the bounded window read, and the four ways a read refuses.
 *
 * The refusals matter more than the happy path here. This is the only ledger in the home that holds the owner's own
 * words, so a line it cannot read is a turn it would be dropping — and every other ledger's habit of
 * skipping a bad line would make that silent.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import {
  appendSupervisorTick,
  readSupervisorTickWindow,
  readSupervisorTickWindowFromLines,
  supervisorTickLedgerPath,
  supervisorTickLine,
  TICK_WINDOW_PRIOR_DAYS,
} from "../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";

/** Every source, `unavailable` at the given instant. */
function allUnavailable({ observedAtIso }: { observedAtIso: string }): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/**
 * One valid row, finalised at the given instant.
 *
 * @param tickId the row's own id
 * @param finalisedIso when it was written; the tick is taken to have started a minute earlier
 * @returns the row
 */
function tickAt({ tickId, finalisedIso }: { tickId: string; finalisedIso: string }): SupervisorTickRow {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const parts = {
    actions: [],
    judgements: [],
    ownerTurns: {
      coverage: { earliestIso: undefined, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read" as const,
      turns: [],
    },
    sources: allUnavailable({ observedAtIso: startedIso }),
  };
  return {
    ...parts,
    finalisedIso,
    handoff: "handoff-9226",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:61",
  } as unknown as SupervisorTickRow;
}

describe("the supervisor tick ledger", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /**
   * A fresh throwaway home.
   *
   * @returns the home directory path
   */
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "sw-ticks-"));
    homes.push(home);
    return home;
  }

  it("appends one row per call, one line each", () => {
    const home = freshHome();
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:00:00.000Z", tickId: "t1" }) }));
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:20:00.000Z", tickId: "t2" }) }));

    const lines = readFileSync(supervisorTickLedgerPath({ home }), "utf8").trimEnd().split("\n");
    expect(lines.length).toBe(2);
  });

  it("refuses to read a ledger that is not there, rather than reporting an empty history", () => {
    const home = freshHome();
    const error = unwrapErr(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }) }));

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("does not exist");
  });

  it("puts the newest row's own local day in currentDay and the rest in priorDays", () => {
    const home = freshHome();
    // Melbourne runs ahead of UTC: a late-evening UTC instant is the next local morning, an early-UTC one is local midday, and the next late-evening one is the following local morning.
    for (const [tickId, finalisedIso] of [
      ["t1", "2026-09-08T22:00:00.000Z"],
      ["t2", "2026-09-09T02:00:00.000Z"],
      ["t3", "2026-09-09T22:00:00.000Z"],
      ["t4", "2026-09-09T23:00:00.000Z"],
    ] as const) {
      unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso, tickId }) }));
    }
    const window = unwrap(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }) }));

    expect(window.newest.tickId).toBe("t4");
    expect(window.currentDay.map((row) => row.tickId)).toEqual(["t3", "t4"]);
    expect(window.priorDays.length).toBe(1);
    expect(window.priorDays[0]!.dayKey).toBe("2026-09-09");
    expect(window.priorDays[0]!.ticks.map((row) => row.tickId)).toEqual(["t1", "t2"]);
    expect(window.olderDaysOmitted).toBe(0);
    expect(window.ticksInLedger).toBe(4);
  });

  it("counts the days it dropped rather than showing a window that pretends to be everything", () => {
    const home = freshHome();
    // Eight consecutive local days, one tick each, all at early UTC (midday Melbourne).
    for (let day = 1; day <= 8; day += 1) {
      unwrap(
        appendSupervisorTick({
          home,
          row: tickAt({ finalisedIso: `2026-09-0${String(day)}T02:00:00.000Z`, tickId: `t${String(day)}` }),
        }),
      );
    }
    const window = unwrap(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }) }));

    expect(window.priorDays.length).toBe(TICK_WINDOW_PRIOR_DAYS);
    expect(window.olderDaysOmitted).toBe(3);
    expect(window.ticksInLedger).toBe(8);
  });

  it("refuses a duplicate tickId rather than reading one of the two", () => {
    const home = freshHome();
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:00:00.000Z", tickId: "t1" }) }));
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:20:00.000Z", tickId: "t1" }) }));
    const error = unwrapErr(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }) }));

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("appears twice");
  });

  it("refuses a row whose finalisation goes backwards", () => {
    const home = freshHome();
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:20:00.000Z", tickId: "t1" }) }));
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:00:00.000Z", tickId: "t2" }) }));
    const error = unwrapErr(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }) }));

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("goes backwards");
  });

  it("refuses a malformed line rather than skipping it, because a skipped row is a dropped turn", () => {
    const home = freshHome();
    unwrap(appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:00:00.000Z", tickId: "t1" }) }));
    const path = supervisorTickLedgerPath({ home });
    writeFileSync(path, `${readFileSync(path, "utf8")}{"schemaVersion":1,"tickId":"broken"}\n`, "utf8");
    const error = unwrapErr(readSupervisorTickWindow({ path }));

    expect(supervisorCoreErrorLines({ error })[0]!).toContain(`${path}:2:`);
  });

  it("refuses to append onto a file whose last record is torn", () => {
    const home = freshHome();
    const row = tickAt({ finalisedIso: "2026-09-10T02:00:00.000Z", tickId: "t1" });
    unwrap(appendSupervisorTick({ home, row }));
    const path = supervisorTickLedgerPath({ home });
    writeFileSync(path, `${supervisorTickLine({ row })}`, "utf8");
    const error = unwrapErr(
      appendSupervisorTick({ home, row: tickAt({ finalisedIso: "2026-09-10T02:20:00.000Z", tickId: "t2" }) }),
    );

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("does not end in a newline");
  });

  it("keeps only the days a caller asked for, and counts the rest", () => {
    const home = freshHome();
    for (let day = 1; day <= 8; day += 1) {
      unwrap(
        appendSupervisorTick({
          home,
          row: tickAt({ finalisedIso: `2026-09-0${String(day)}T02:00:00.000Z`, tickId: `t${String(day)}` }),
        }),
      );
    }
    const window = unwrap(readSupervisorTickWindow({ path: supervisorTickLedgerPath({ home }), priorDays: 0 }));

    expect(window.priorDays).toEqual([]);
    expect(window.olderDaysOmitted).toBe(7);
    expect(window.ticksInLedger).toBe(8);
  });
});

/** One ledger's lines, as the async iterable the streaming reader takes. */
async function* linesOf({ text }: { text: string }): AsyncGenerator<string> {
  for (const line of text.split("\n")) {
    yield line;
  }
}

describe("reading the ledger from a stream rather than a path", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /**
   * A ledger holding the given rows, and the text of it.
   *
   * @param rows the rows to append, in order
   * @returns the ledger's path and its bytes
   */
  function ledgerOf({ rows }: { rows: readonly SupervisorTickRow[] }): { path: string; text: string } {
    const home = mkdtempSync(join(tmpdir(), "sw-ticks-stream-"));
    homes.push(home);
    for (const row of rows) {
      unwrap(appendSupervisorTick({ home, row }));
    }
    const path = supervisorTickLedgerPath({ home });
    return { path, text: readFileSync(path, "utf8") };
  }

  it("answers exactly what the path reader answers, for the same bytes", async () => {
    const { path, text } = ledgerOf({
      rows: [
        tickAt({ finalisedIso: "2026-09-13T02:00:00.000Z", tickId: "t1" }),
        tickAt({ finalisedIso: "2026-09-14T02:00:00.000Z", tickId: "t2" }),
        tickAt({ finalisedIso: "2026-09-14T02:20:00.000Z", tickId: "t3" }),
      ],
    });

    const streamed = unwrap(await readSupervisorTickWindowFromLines({ label: "stdin", lines: linesOf({ text }) }));

    expect(streamed).toEqual(unwrap(readSupervisorTickWindow({ path })));
  });

  it("refuses a duplicate tickId on a stream, exactly as it does off disk", async () => {
    const { text } = ledgerOf({
      rows: [
        tickAt({ finalisedIso: "2026-09-14T02:00:00.000Z", tickId: "t1" }),
        tickAt({ finalisedIso: "2026-09-14T02:20:00.000Z", tickId: "t1" }),
      ],
    });

    const error = unwrapErr(await readSupervisorTickWindowFromLines({ label: "stdin", lines: linesOf({ text }) }));

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("stdin:2: tickId t1 appears twice");
  });

  it("refuses a malformed line on a stream rather than skipping it", async () => {
    const { text } = ledgerOf({ rows: [tickAt({ finalisedIso: "2026-09-14T02:00:00.000Z", tickId: "t1" })] });

    const error = unwrapErr(
      await readSupervisorTickWindowFromLines({
        label: "stdin",
        lines: linesOf({ text: `${text}{"schemaVersion":1,"tickId":"broken"}\n` }),
      }),
    );

    expect(supervisorCoreErrorLines({ error })[0]!).toContain("stdin:2:");
  });

  it("refuses an empty stream by name, rather than reporting a quiet fleet", async () => {
    const error = unwrapErr(await readSupervisorTickWindowFromLines({ label: "stdin", lines: linesOf({ text: "" }) }));

    expect(supervisorCoreErrorLines({ error })[0]!).toBe(
      "stdin holds no tick rows — nothing has been recorded yet, so there is no narrative to derive",
    );
  });
});
