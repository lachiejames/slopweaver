/**
 * The tick ledger's line checks and the streamed walk over them: every refusal the window reader makes, made once.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { checkedTickRow, emptyTickLedgerCheck, visitSupervisorTicks } from "../../../supervisor/tickLedgerCheck.js";
import { supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import { supervisorTickLine } from "../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorJudgement,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";

/** One valid row's line, finalised at the given instant, carrying these judgements and owner-turn floor or none. */
function lineAt({
  tickId,
  finalisedIso,
  judgements = [],
  earliestIso,
}: {
  tickId: string;
  finalisedIso: string;
  judgements?: readonly SupervisorJudgement[];
  earliestIso?: string;
}): string {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: startedIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  const parts = {
    actions: [],
    judgements,
    ownerTurns: {
      coverage: { earliestIso, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read" as const,
      turns: [],
    },
    sources,
  };
  const row = {
    ...parts,
    finalisedIso,
    handoff: "handoff-9300",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:1",
  } as unknown as SupervisorTickRow;
  return supervisorTickLine({ row });
}

const first = lineAt({ finalisedIso: "2026-10-09T05:00:00.000Z", tickId: "t1" });
const second = lineAt({ finalisedIso: "2026-10-09T06:00:00.000Z", tickId: "t2" });

describe("checkedTickRow", () => {
  it("passes rows in order and skips a blank line", () => {
    const check = emptyTickLedgerCheck();
    const rows = [first, "", second].map((line, index) => checkedTickRow({ check, index, line, path: "l" }));

    expect([rows.map((row) => row?.tickId), check.defects]).toEqual([["t1", undefined, "t2"], []]);
  });

  it("refuses a duplicate id and a finalisation that goes backwards, then skips every later line", () => {
    const duplicate = emptyTickLedgerCheck();
    const backwards = emptyTickLedgerCheck();
    const dupRows = [first, first, second].map((line, index) =>
      checkedTickRow({ check: duplicate, index, line, path: "l" }),
    );
    [second, first].forEach((line, index) => checkedTickRow({ check: backwards, index, line, path: "l" }));

    expect(dupRows.map((row) => row?.tickId)).toEqual(["t1", undefined, undefined]);
    expect(duplicate.defects).toEqual(["l:2: tickId t1 appears twice — one of them is a copy"]);
    expect(backwards.defects[0]).toContain("l:2: finalisedIso 2026-10-09T05:00:00.000Z goes backwards");
  });
});

describe("visitSupervisorTicks", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A ledger file holding these lines, or none at all. */
  function ledgerWith({ lines }: { lines?: readonly string[] }): string {
    const home = mkdtempSync(join(tmpdir(), "sw-visit-"));
    homes.push(home);
    const path = join(home, "ledgers", "supervisor-ticks.jsonl");
    if (lines !== undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${lines.join("\n")}\n`);
    }
    return path;
  }

  it("visits every valid row, oldest first, and counts them", () => {
    const seen: string[] = [];
    const walked = visitSupervisorTicks({
      onTick: ({ row }) => seen.push(row.tickId),
      path: ledgerWith({ lines: [first, second] }),
    });

    expect([unwrap(walked).ticksRead, seen]).toEqual([2, ["t1", "t2"]]);
  });

  it("refuses an absent ledger, an empty one and a defective one, never reading them as no rows", () => {
    const absent = unwrapErr(visitSupervisorTicks({ onTick: () => undefined, path: ledgerWith({}) }));
    const empty = unwrapErr(visitSupervisorTicks({ onTick: () => undefined, path: ledgerWith({ lines: [""] }) }));
    const defective = unwrapErr(
      visitSupervisorTicks({ onTick: () => undefined, path: ledgerWith({ lines: [first, "not json"] }) }),
    );

    expect([absent.code, empty.code, defective.code]).toEqual(["LEDGER_EMPTY", "LEDGER_EMPTY", "LEDGER_DEFECTIVE"]);
    expect(absent.message).toContain("does not exist");
    expect(empty.message).toContain("holds no tick rows");
  });

  it("from an instant, passes over a defect finalised before it and visits only what follows", () => {
    const seen: string[] = [];
    const third = lineAt({ finalisedIso: "2026-10-09T07:00:00.000Z", tickId: "t3" });

    const walked = visitSupervisorTicks({
      fromIso: "2026-10-09T05:30:00.000Z",
      onTick: ({ row }) => seen.push(row.tickId),
      path: ledgerWith({ lines: [first, first, second, third] }),
    });

    expect([unwrap(walked).ticksRead, seen]).toEqual([2, ["t2", "t3"]]);
  });

  it("from an instant, still refuses a defect after it and a line that will not parse at all", () => {
    const fromIso = "2026-10-09T05:30:00.000Z";
    const late = unwrapErr(
      visitSupervisorTicks({ fromIso, onTick: () => undefined, path: ledgerWith({ lines: [first, second, second] }) }),
    );
    const unreadable = unwrapErr(
      visitSupervisorTicks({ fromIso, onTick: () => undefined, path: ledgerWith({ lines: ["not json", second] }) }),
    );

    expect([late.code, unreadable.code]).toEqual(["LEDGER_DEFECTIVE", "LEDGER_DEFECTIVE"]);
  });

  it("from an instant, refuses a malformed row claiming an old instant, and a row in the window repeating an old id", () => {
    const fromIso = "2026-10-09T05:30:00.000Z";
    const claimsOld = JSON.stringify({ finalisedIso: "2026-10-09T05:00:00.000Z", unknownKey: true });
    const repeatsOld = lineAt({ finalisedIso: "2026-10-09T07:00:00.000Z", tickId: "t1" });
    const malformed = unwrapErr(
      visitSupervisorTicks({ fromIso, onTick: () => undefined, path: ledgerWith({ lines: [claimsOld, second] }) }),
    );
    const repeated = unwrapErr(
      visitSupervisorTicks({
        fromIso,
        onTick: () => undefined,
        path: ledgerWith({ lines: [first, second, repeatsOld] }),
      }),
    );

    expect([malformed.message, repeated.message]).toEqual([
      expect.stringContaining(":1: "),
      expect.stringContaining("tickId t1 appears twice"),
    ]);
  });

  it("from an instant, refuses an old-dated row written after one the walk already visited", () => {
    const visited = lineAt({ finalisedIso: "2026-10-09T07:00:00.000Z", tickId: "dup" });
    const oldCopy = lineAt({ finalisedIso: "2026-10-09T05:00:00.000Z", tickId: "dup" });
    const seen: string[] = [];

    const walked = unwrapErr(
      visitSupervisorTicks({
        fromIso: "2026-10-09T05:30:00.000Z",
        onTick: ({ row }) => seen.push(row.tickId),
        path: ledgerWith({ lines: [visited, oldCopy] }),
      }),
    );

    expect([walked.code, seen]).toEqual(["LEDGER_DEFECTIVE", ["dup"]]);
  });

  it("from an instant, visits a row finalised before it whose hold was stamped after it", () => {
    const lateHold = lineAt({
      finalisedIso: "2026-10-09T05:00:00.000Z",
      judgements: [
        {
          claim: "held for review",
          judgementId: "j1",
          kind: "hold-rationale",
          recordedIso: "2026-10-09T06:00:00.000Z",
          subject: { id: "r", kind: "recipe", label: "r" },
          whyNotDerived: "operational-context",
          witness: { kind: "command", ref: "slopweaver automation due" },
        },
      ],
      tickId: "t1",
    });
    const seen: string[] = [];

    const walked = visitSupervisorTicks({
      fromIso: "2026-10-09T05:30:00.000Z",
      onTick: ({ row }) => seen.push(row.tickId),
      path: ledgerWith({ lines: [lateHold, second] }),
    });

    expect([unwrap(walked).ticksRead, seen]).toEqual([2, ["t1", "t2"]]);
  });

  it("from an instant, visits a row carrying an instant that will not parse, never passing it over", () => {
    const unparsed = lineAt({ earliestIso: "not-an-instant", finalisedIso: "2026-10-09T05:00:00.000Z", tickId: "t1" });
    const seen: string[] = [];

    const walked = visitSupervisorTicks({
      fromIso: "2026-10-09T05:30:00.000Z",
      onTick: ({ row }) => seen.push(row.tickId),
      path: ledgerWith({ lines: [unparsed, second] }),
    });

    expect([unwrap(walked).ticksRead, seen]).toEqual([2, ["t1", "t2"]]);
  });

  it("from an instant, refuses a visited row finalised before a row it passed over", () => {
    const goesBack = lineAt({
      finalisedIso: "2026-10-09T04:00:00.000Z",
      judgements: [
        {
          claim: "held for review",
          judgementId: "j1",
          kind: "hold-rationale",
          recordedIso: "2026-10-09T06:00:00.000Z",
          subject: { id: "r", kind: "recipe", label: "r" },
          whyNotDerived: "operational-context",
          witness: { kind: "command", ref: "slopweaver automation due" },
        },
      ],
      tickId: "t0",
    });

    const walked = unwrapErr(
      visitSupervisorTicks({
        fromIso: "2026-10-09T05:30:00.000Z",
        onTick: () => undefined,
        path: ledgerWith({ lines: [first, goesBack] }),
      }),
    );

    expect(walked.message).toContain("finalisedIso 2026-10-09T04:00:00.000Z goes backwards");
  });

  it("from an instant past every row, reads a history with nothing since rather than an empty ledger", () => {
    const walked = visitSupervisorTicks({
      fromIso: "2026-10-10T00:00:00.000Z",
      onTick: () => undefined,
      path: ledgerWith({ lines: [first, second] }),
    });

    expect(unwrap(walked).ticksRead).toBe(0);
  });

  it("refuses a row holding a byte that is not UTF-8, never reading it repaired", () => {
    const path = ledgerWith({ lines: [first] });
    const [before, after] = second.split("handoff-9300");
    writeFileSync(
      path,
      Buffer.concat([Buffer.from(`${first}\n${before!}handoff-`), Buffer.from([0xff]), Buffer.from(`${after!}\n`)]),
    );
    const seen: string[] = [];

    const walked = unwrapErr(visitSupervisorTicks({ onTick: ({ row }) => seen.push(row.tickId), path }));

    expect([walked.code, seen]).toEqual(["LEDGER_DEFECTIVE", ["t1"]]);
  });
});
