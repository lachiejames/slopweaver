/**
 * The four readers `briefing render` takes, never over stdin or the ambient home: the store's autonomy ledger
 * folds newest first with the owner's word on each act, and an outage or a self-contradicting ledger is refused at the
 * stage that failed; the open-artifact document
 * carries the file's own mtime; the your-list document reads back unchanged; and the tick ledger yields the
 * bounded window, its `priorDays` bound honoured, with an absent, empty or malformed ledger refused line by line.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AutonomyErrors } from "../../../../../autonomy/errors.js";
import type { AutonomyLedgerPort } from "../../../../../autonomy/port.js";
import { buildAutonomyAction, buildAutonomySteer } from "../../../../../autonomy/row.js";
import type { AutonomyActionRow, AutonomyRecord } from "../../../../../autonomy/types.js";
import { BriefingCommandErrors } from "../../../../../cli/commands/briefing/errors.js";
import {
  readFoldedAutonomy,
  readOpenArtifactsDocument,
  readTickWindow,
  readYourListDocument,
} from "../../../../../cli/commands/briefing/renderReaders.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { supervisorTickStatsOf } from "../../../../../supervisor/tickSchema.js";
import { appendSupervisorTick, supervisorTickLedgerPath } from "../../../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../../../supervisor/tickTypes.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  seedAutonomyRecords,
  unavailableAutonomyLedgerPort,
} from "../../../../autonomyLedgerFixture.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A throwaway directory this test may write into — the state home where one is needed, never the ambient one. */
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-render-readers-"));
  roots.push(root);
  return root;
}

/** One valid act on its own pull request, done at the given instant. */
function act({ actionId, doneIso, pr }: { actionId: string; doneIso: string; pr: number }): AutonomyActionRow {
  return unwrap(
    buildAutonomyAction({
      actionId,
      bySession: "workspace:7 render-readers",
      doneIso,
      kind: "press-merge-when-ready",
      run: undefined,
      said: undefined,
      steer: undefined,
      subject: `https://github.com/acme/widgets/pull/${String(pr)}`,
      why: "CI green and mergeable",
      witness: `slopweaver github enqueue --pr ${String(pr)} -> queued`,
    }),
  );
}

/** A ledger that answers exactly these records, whatever they are — a plain seam, so a fold refusal is reachable. */
function answering({ records }: { records: readonly AutonomyRecord[] }): AutonomyLedgerPort {
  return {
    appendRecord: () => Promise.resolve(err(AUTONOMY_FIXTURE_OUTAGE)),
    readRecords: () => Promise.resolve(ok(records)),
  };
}

describe("readFoldedAutonomy", () => {
  it("folds the ledger newest first, with the owner's latest word on the act they steered", async () => {
    const older = act({ actionId: "101-enqueue", doneIso: "2026-10-10T01:00:00Z", pr: 101 });
    const newer = act({ actionId: "102-enqueue", doneIso: "2026-10-11T01:00:00Z", pr: 102 });
    const steer = unwrap(
      buildAutonomySteer({
        actionId: "101-enqueue",
        bySession: "workspace:1 supervisor",
        steer: "good call",
        steeredIso: "2026-10-12T01:00:00Z",
      }),
    );
    const autonomy = memoryAutonomyLedgerPort();
    await seedAutonomyRecords({ port: autonomy, records: [older, newer, steer] });

    const folded = unwrap(await readFoldedAutonomy({ autonomy, home: "/fixture-home" }));

    expect(folded).toEqual([
      { action: newer, classSteer: undefined, latestSteer: undefined, patternSteer: undefined },
      { action: older, classSteer: undefined, latestSteer: steer, patternSteer: undefined },
    ]);
  });

  it("refuses at the read stage when the store cannot answer, never as an empty ledger", async () => {
    const error = unwrapErr(
      await readFoldedAutonomy({ autonomy: unavailableAutonomyLedgerPort(), home: "/fixture-home" }),
    );

    expect(error.code).toBe("AUTONOMY_UNREADABLE");
    expect(error).toEqual({
      code: "AUTONOMY_UNREADABLE",
      message: `the autonomy register could not be read: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
      stage: "read",
    });
    expect(error).toEqual(
      BriefingCommandErrors.autonomyUnreadable({ cause: AUTONOMY_FIXTURE_OUTAGE.message, stage: "read" }),
    );
  });

  // The case that folded the readable lines and COUNTED an undecodable one went with the count's carrier: the
  // store-backed read refuses whole on one unreadable row, so there is no partial read left to count.

  it("refuses records carrying two different acts under one id at the fold stage", async () => {
    const first = act({ actionId: "103-enqueue", doneIso: "2026-10-10T01:00:00Z", pr: 103 });
    const second = { ...first, why: "a different reason entirely" };

    const error = unwrapErr(
      await readFoldedAutonomy({ autonomy: answering({ records: [first, second] }), home: "/fixture-home" }),
    );

    expect(error.code).toBe("AUTONOMY_UNREADABLE");
    expect(error).toEqual(
      BriefingCommandErrors.autonomyUnreadable({
        cause: AutonomyErrors.actionIdConflict({ actionId: "103-enqueue", field: "why" }).message,
        stage: "fold",
      }),
    );
  });
});

describe("readOpenArtifactsDocument", () => {
  it("reads the document with the instant its file was last written", () => {
    const path = join(freshRoot(), "open-artifacts.json");
    writeFileSync(path, '[{"slug":"a"}]\n', "utf8");
    const written = new Date("2026-10-01T03:04:05.000Z");
    utimesSync(path, written, written);

    expect(unwrap(readOpenArtifactsDocument({ source: path }))).toEqual({
      text: '[{"slug":"a"}]\n',
      writtenIso: "2026-10-01T03:04:05.000Z",
    });
  });

  it("refuses a path that is not there, naming the open-artifact document", () => {
    const path = join(freshRoot(), "missing.json");

    const error = unwrapErr(readOpenArtifactsDocument({ source: path }));

    expect(error).toEqual({
      code: "FILE_UNREADABLE",
      message: `${path}: could not read the open-artifact document — ENOENT: no such file or directory, open '${path}'`,
      path,
    });
  });
});

describe("readYourListDocument", () => {
  it("reads the document's text unchanged", () => {
    const path = join(freshRoot(), "your-list.json");
    writeFileSync(path, '{"nowIso":"2026-10-13T00:00:00Z"}\n\n', "utf8");

    expect(unwrap(readYourListDocument({ source: path }))).toBe('{"nowIso":"2026-10-13T00:00:00Z"}\n\n');
  });

  it("refuses a path that is not there, naming the session-start document", () => {
    const path = join(freshRoot(), "missing.json");

    const error = unwrapErr(readYourListDocument({ source: path }));

    expect(error).toEqual({
      code: "FILE_UNREADABLE",
      message: `${path}: could not read the session-start document — ENOENT: no such file or directory, open '${path}'`,
      path,
    });
  });
});

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

/** One valid tick row, finalised at the given instant and started a minute earlier. */
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
    handoff: "handoff-render",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:61",
  } as unknown as SupervisorTickRow;
}

describe("readTickWindow", () => {
  /** Four ticks on four consecutive local days (the 02:00 hour is midday Melbourne), plus a second on the last day. */
  function seededLedger(): { readonly path: string; readonly rows: readonly SupervisorTickRow[] } {
    const home = freshRoot();
    const rows = [
      tickAt({ finalisedIso: "2026-10-01T02:00:00.000Z", tickId: "t1" }),
      tickAt({ finalisedIso: "2026-10-02T02:00:00.000Z", tickId: "t2" }),
      tickAt({ finalisedIso: "2026-10-03T02:00:00.000Z", tickId: "t3" }),
      tickAt({ finalisedIso: "2026-10-04T02:00:00.000Z", tickId: "t4" }),
      tickAt({ finalisedIso: "2026-10-04T03:00:00.000Z", tickId: "t5" }),
    ];
    for (const row of rows) {
      unwrap(appendSupervisorTick({ home, row }));
    }
    return { path: supervisorTickLedgerPath({ home }), rows };
  }

  it("keeps every prior day under the reader's own ceiling when no bound is given", async () => {
    const { path, rows } = seededLedger();

    const window = unwrap(await readTickWindow({ priorDays: undefined, source: path }));

    expect(window).toEqual({
      currentDay: [rows[3], rows[4]],
      newest: rows[4],
      olderDaysOmitted: 0,
      priorDays: [
        { dayKey: "2026-10-03", ticks: [rows[2]] },
        { dayKey: "2026-10-02", ticks: [rows[1]] },
        { dayKey: "2026-10-01", ticks: [rows[0]] },
      ],
      ticksInLedger: 5,
    });
  });

  it("keeps only the prior days asked for, and counts the days it left out", async () => {
    const { path, rows } = seededLedger();

    const window = unwrap(await readTickWindow({ priorDays: 1, source: path }));

    expect(window).toEqual({
      currentDay: [rows[3], rows[4]],
      newest: rows[4],
      olderDaysOmitted: 2,
      priorDays: [{ dayKey: "2026-10-03", ticks: [rows[2]] }],
      ticksInLedger: 5,
    });
  });

  it("refuses a ledger that is not there with the absent-ledger line", async () => {
    const path = join(freshRoot(), "ticks.jsonl");

    expect(unwrapErr(await readTickWindow({ priorDays: undefined, source: path }))).toEqual([
      `${path} does not exist. The derived narrative was asked for, so an absent ledger is a refusal rather ` +
        "than an empty history — a page rendered from a missing file would report a quiet fleet.",
    ]);
  });

  it("refuses an empty ledger as holding no rows", async () => {
    const path = join(freshRoot(), "ticks.jsonl");
    writeFileSync(path, "", "utf8");

    expect(unwrapErr(await readTickWindow({ priorDays: undefined, source: path }))).toEqual([
      `${path} holds no tick rows — nothing has been recorded yet, so there is no narrative to derive`,
    ]);
  });

  it("refuses a ledger line that is not JSON rather than skipping it, naming the file and line", async () => {
    const path = join(freshRoot(), "ticks.jsonl");
    writeFileSync(path, "not json\n", "utf8");

    expect(unwrapErr(await readTickWindow({ priorDays: undefined, source: path }))).toEqual([
      `${path}:1: the line is not readable JSON: Unexpected token 'o', "not json" is not valid JSON`,
    ]);
  });
});
