/**
 * Why a stopped row stopped, read off the supervisor's tick ledger: a hold the supervisor recorded on the recipe wins,
 * otherwise the passes that saw it waiting and did nothing are counted, and an unreadable ledger is said as that.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SilentRow } from "../../../../live/automation/silentRows.js";
import {
  explainSilentRows,
  foldRecipeSupervisorStops,
  supervisorStopWords,
} from "../../../../live/automation/supervisorStops.js";
import { supervisorTickStatsOf } from "../../../../supervisor/tickSchema.js";
import { supervisorTickLedgerPath, supervisorTickLine } from "../../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorJudgement,
  type SupervisorTickAction,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../../supervisor/tickTypes.js";

const SLACK = { id: "resync-corpus-slack", kind: "recipe", label: "Slack history sync" } as const;
const LAST_RUN = "2026-10-09T03:23:24.000Z";

/** A due reading naming each row as waiting to run, held by `heldBy`. */
function dueReading({
  observedAtIso,
  ids,
  heldBy = null,
}: {
  observedAtIso: string;
  ids: readonly string[];
  heldBy?: string | null;
}): Record<string, unknown> {
  return {
    facts: { rows: ids.map((id) => ({ heldBy, id, label: id, lateMinutes: 30, runs: "spawn" })) },
    observedAtIso,
    status: "read",
    witness: { command: "slopweaver automation due --json", exitCode: 0 },
  };
}

/**
 * One valid tick row, every source unavailable but the due reading given.
 *
 * @param recipeDue the due reading, or none for an unavailable one
 * @returns the row
 */
function tick({
  tickId,
  finalisedIso,
  recipeDue,
  actions = [],
  judgements = [],
}: {
  tickId: string;
  finalisedIso: string;
  recipeDue?: Record<string, unknown>;
  actions?: SupervisorTickAction[];
  judgements?: SupervisorJudgement[];
}): SupervisorTickRow {
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
  if (recipeDue !== undefined) {
    sources["recipeDue"] = recipeDue;
  }
  const parts = {
    actions,
    judgements,
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
    handoff: "handoff-9300",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:1",
  } as unknown as SupervisorTickRow;
}

/** A hold-rationale judgement on a subject. */
function hold({
  claim,
  recordedIso,
  subject = SLACK,
  relatedSubjects,
}: {
  claim: string;
  recordedIso: string;
  subject?: SupervisorJudgement["subject"];
  relatedSubjects?: SupervisorJudgement["relatedSubjects"];
}): SupervisorJudgement {
  return {
    claim,
    judgementId: "j1",
    kind: "hold-rationale",
    recordedIso,
    relatedSubjects,
    subject,
    whyNotDerived: "operational-context",
    witness: { kind: "command", ref: "slopweaver automation due" },
  };
}

/** An action on the Slack row. */
function action({
  kind,
  recordedIso,
  detail,
  outcome = "completed",
}: {
  kind: SupervisorTickAction["kind"];
  recordedIso: string;
  detail?: string;
  outcome?: SupervisorTickAction["outcome"];
}): SupervisorTickAction {
  return {
    actionId: "a1",
    detail,
    kind,
    outcome,
    recordedIso,
    subject: SLACK,
    witness: { kind: "command", ref: "slopweaver automation seat" },
  };
}

const windows = [{ recipeId: SLACK.id, sinceIso: LAST_RUN }];

describe("foldRecipeSupervisorStops", () => {
  it("counts each pass after its last run that read it due and unseated and did nothing, from the first", () => {
    const rows = [
      tick({
        finalisedIso: "2026-10-09T03:00:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T03:00:00.000Z" }),
        tickId: "before",
      }),
      tick({
        finalisedIso: "2026-10-09T05:19:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:19:00.000Z" }),
        tickId: "t1",
      }),
      tick({
        finalisedIso: "2026-10-09T05:31:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:31:00.000Z" }),
        tickId: "t2",
      }),
      tick({
        finalisedIso: "2026-10-09T06:00:00.000Z",
        recipeDue: dueReading({ heldBy: "workspace:9", ids: [SLACK.id], observedAtIso: "2026-10-09T06:00:00.000Z" }),
        tickId: "seated",
      }),
      tick({
        actions: [action({ kind: "recipe-run", recordedIso: "2026-10-09T07:00:30.000Z" })],
        finalisedIso: "2026-10-09T07:01:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T07:00:00.000Z" }),
        tickId: "ran",
      }),
      tick({
        finalisedIso: "2026-10-09T08:00:00.000Z",
        recipeDue: dueReading({ ids: ["resync-atlas-slack"], observedAtIso: "2026-10-09T08:00:00.000Z" }),
        tickId: "other",
      }),
      tick({ finalisedIso: "2026-10-09T09:00:00.000Z", tickId: "unread" }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      firstSeenDueIso: "2026-10-09T05:19:00.000Z",
      kind: "passed-over",
      passes: 2,
    });
  });

  it("says a recorded hold over any count, the newest one winning, named as subject or related subject", () => {
    const rows = [
      tick({
        finalisedIso: "2026-10-09T05:19:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:19:00.000Z" }),
        tickId: "t1",
      }),
      tick({
        finalisedIso: "2026-10-09T06:00:00.000Z",
        judgements: [
          hold({ claim: "Four seats are taken by your own requests.", recordedIso: "2026-10-09T06:00:00.000Z" }),
        ],
        tickId: "t2",
      }),
      tick({
        finalisedIso: "2026-10-09T07:00:00.000Z",
        judgements: [
          hold({
            claim: "The machine is too busy to start a long sync.",
            recordedIso: "2026-10-09T07:00:00.000Z",
            relatedSubjects: [SLACK],
            subject: { id: "cpu", kind: "ceiling", label: "cpu" },
          }),
        ],
        tickId: "t3",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      kind: "held",
      reason: "The machine is too busy to start a long sync.",
      recordedIso: "2026-10-09T07:00:00.000Z",
    });
  });

  it("ends a hold once a later tick passes the row over without holding it again", () => {
    const rows = [
      tick({
        finalisedIso: "2026-10-09T05:00:00.000Z",
        judgements: [hold({ claim: "Four seats are taken.", recordedIso: "2026-10-09T05:00:00.000Z" })],
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:00.000Z" }),
        tickId: "held",
      }),
      tick({
        finalisedIso: "2026-10-09T06:00:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T06:00:00.000Z" }),
        tickId: "unheld",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      firstSeenDueIso: "2026-10-09T05:00:00.000Z",
      kind: "passed-over",
      passes: 2,
    });
  });

  it("keeps a hold that the latest passing tick recorded again", () => {
    const rows = [
      tick({
        finalisedIso: "2026-10-09T05:00:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:00.000Z" }),
        tickId: "unheld",
      }),
      tick({
        finalisedIso: "2026-10-09T06:00:00.000Z",
        judgements: [hold({ claim: "Four seats are taken.", recordedIso: "2026-10-09T06:00:00.000Z" })],
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T06:00:00.000Z" }),
        tickId: "held-again",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      kind: "held",
      reason: "Four seats are taken.",
      recordedIso: "2026-10-09T06:00:00.000Z",
    });
  });

  it("takes a held action's detail as the reason, and ignores a hold recorded before its last run", () => {
    const rows = [
      tick({
        finalisedIso: "2026-10-09T02:00:00.000Z",
        judgements: [hold({ claim: "an old hold", recordedIso: "2026-10-09T02:00:00.000Z" })],
        tickId: "old",
      }),
      tick({
        actions: [action({ detail: "a 24h ruling", kind: "recipe-held", recordedIso: "2026-10-09T15:11:00.000Z" })],
        finalisedIso: "2026-10-09T15:12:00.000Z",
        tickId: "ruled",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      kind: "held",
      reason: "a 24h ruling",
      recordedIso: "2026-10-09T15:11:00.000Z",
    });
  });

  it("still counts a pass whose tick also carries an action on it from before its last run", () => {
    const rows = [
      tick({
        actions: [action({ detail: "an old hold", kind: "recipe-held", recordedIso: "2026-10-09T03:00:00.000Z" })],
        finalisedIso: "2026-10-09T05:01:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:00.000Z" }),
        tickId: "spans",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      firstSeenDueIso: "2026-10-09T05:00:00.000Z",
      kind: "passed-over",
      passes: 1,
    });
  });

  it("takes a hold stamped after its own tick closed as written, because stamps are hand-written", () => {
    const rows = [
      tick({
        actions: [
          action({ detail: "a late-stamped hold", kind: "recipe-held", recordedIso: "2026-10-09T05:03:00.000Z" }),
        ],
        finalisedIso: "2026-10-09T05:01:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:30.000Z" }),
        tickId: "late-hold",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      kind: "held",
      reason: "a late-stamped hold",
      recordedIso: "2026-10-09T05:03:00.000Z",
    });
  });

  it("takes a run stamped after its own tick closed as the tick running it", () => {
    const rows = [
      tick({
        actions: [action({ kind: "recipe-run", recordedIso: "2026-10-09T05:03:00.000Z" })],
        finalisedIso: "2026-10-09T05:01:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:30.000Z" }),
        tickId: "late-run",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({ kind: "no-due-reading" });
  });

  it("never reads a failed hold or a failed run as having held or run it", () => {
    const due = dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:30.000Z" });
    const rows = [
      tick({
        actions: [
          action({
            detail: "capacity hold failed",
            kind: "recipe-held",
            outcome: "failed",
            recordedIso: "2026-10-09T05:00:40.000Z",
          }),
          action({ kind: "recipe-run", outcome: "failed", recordedIso: "2026-10-09T05:00:50.000Z" }),
        ],
        finalisedIso: "2026-10-09T05:01:00.000Z",
        recipeDue: due,
        tickId: "failed-actions",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({
      firstSeenDueIso: "2026-10-09T05:00:30.000Z",
      kind: "passed-over",
      passes: 1,
    });
  });

  it("does not count a pass whose tick ran it, stamped by hand before the tick started", () => {
    const rows = [
      tick({
        actions: [action({ kind: "recipe-run", recordedIso: "2026-10-09T04:55:00.000Z" })],
        finalisedIso: "2026-10-09T05:01:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:00:30.000Z" }),
        tickId: "early-stamp",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({ kind: "no-due-reading" });
  });

  it("ignores a hold on another recipe and says no check saw it waiting when none did", () => {
    const other = { id: "resync-atlas-slack", kind: "recipe", label: "Slack atlas" } as const;
    const rows = [
      tick({
        finalisedIso: "2026-10-09T06:00:00.000Z",
        judgements: [hold({ claim: "not this one", recordedIso: "2026-10-09T06:00:00.000Z", subject: other })],
        tickId: "t1",
      }),
    ];

    expect(foldRecipeSupervisorStops({ rows, windows }).get(SLACK.id)).toEqual({ kind: "no-due-reading" });
  });
});

describe("supervisorStopWords", () => {
  it("says each answer in plain words after when it last ran", () => {
    expect([
      supervisorStopWords({
        lastRunAtIso: LAST_RUN,
        stop: { kind: "held", reason: "a standing ruling", recordedIso: "T" },
      }),
      supervisorStopWords({
        lastRunAtIso: LAST_RUN,
        stop: { firstSeenDueIso: "F", kind: "passed-over", passes: 24 },
      }),
      supervisorStopWords({ lastRunAtIso: LAST_RUN, stop: { kind: "no-due-reading" } }),
      supervisorStopWords({ lastRunAtIso: LAST_RUN, stop: { kind: "unreadable" } }),
    ]).toEqual([
      `it last ran ${LAST_RUN}; the supervisor held it at T: a standing ruling`,
      `it last ran ${LAST_RUN}; the supervisor saw it waiting to run on 24 check(s) since F and neither ran it nor said why`,
      `it last ran ${LAST_RUN}; no supervisor check since has seen it waiting to run, and it runs again when one does`,
      `it last ran ${LAST_RUN}, and the supervisor's own record could not be read to say why it was not run since`,
    ]);
  });
});

describe("explainSilentRows", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway home, its tick ledger holding these lines when given. */
  function homeWith({ lines }: { lines?: readonly string[] }): string {
    const home = mkdtempSync(join(tmpdir(), "sw-stops-"));
    homes.push(home);
    if (lines !== undefined) {
      const path = supervisorTickLedgerPath({ home });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${lines.join("\n")}\n`);
    }
    return home;
  }

  const missed: SilentRow = {
    cadence: "0 */4 * * *",
    currentSlotHold: null,
    detail: "missed 3 firings",
    lastRunAtIso: LAST_RUN,
    missedSlots: 3,
    reason: "MISSED",
    recipeId: SLACK.id,
  };
  const failing: SilentRow = { ...missed, detail: "its newest run failed", reason: "FAILING", recipeId: "other" };

  it("rewrites only a MISSED row, off the ledger on disk", () => {
    const row = tick({
      finalisedIso: "2026-10-09T05:19:00.000Z",
      recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:19:00.000Z" }),
      tickId: "t1",
    });
    const home = homeWith({ lines: [supervisorTickLine({ row })] });

    expect(explainSilentRows({ home, rows: [missed, failing] })).toEqual({
      ledgerIssue: null,
      rows: [
        {
          ...missed,
          detail:
            `3 scheduled time(s) went by with no run; it last ran ${LAST_RUN}; the supervisor saw it waiting to run ` +
            "on 1 check(s) since 2026-10-09T05:19:00.000Z and neither ran it nor said why",
          supervisorStop: { firstSeenDueIso: "2026-10-09T05:19:00.000Z", kind: "passed-over", passes: 1 },
        },
        failing,
      ],
    });
  });

  it("walks a ledger whose oldest row predates the dispatch and staleness readings, to the newest pass", () => {
    const current = tick({
      finalisedIso: "2026-10-09T05:19:00.000Z",
      recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-09T05:19:00.000Z" }),
      tickId: "t2",
    });
    const historical = tick({ finalisedIso: "2026-09-01T00:00:00.000Z", tickId: "t1" });
    const witness = { command: "slopweaver machine capacity --json", exitCode: 0 };
    const observedAtIso = historical.startedIso;
    const sources = {
      ...historical.sources,
      capacity: {
        facts: {
          hold: false,
          holdSubjects: [],
          load1: 1,
          segmentsPct: 4,
          swapfileCount: 0,
          topForeignGb: 1,
          topForeignLabel: "Chrome",
        },
        observedAtIso,
        status: "read",
        witness,
      },
      friction: { facts: { hasGap: false, newestReport: null }, observedAtIso, status: "read", witness },
    };
    const old = {
      ...historical,
      sources,
      stats: supervisorTickStatsOf({ ...historical, sources }),
    } as unknown as SupervisorTickRow;
    const home = homeWith({ lines: [supervisorTickLine({ row: old }), supervisorTickLine({ row: current })] });

    // Its last run predates the old row, so the walk has to read that row rather than start past it.
    const explained = explainSilentRows({ home, rows: [{ ...missed, lastRunAtIso: "2026-08-31T00:00:00.000Z" }] });

    expect(explained.ledgerIssue).toBe(null);
    expect(explained.rows[0]!.supervisorStop).toStrictEqual({
      firstSeenDueIso: "2026-10-09T05:19:00.000Z",
      kind: "passed-over",
      passes: 1,
    });
  });

  it("says an absent ledger on the row and as an issue, never as zero checks, and never the diagnostic twice", () => {
    const explained = explainSilentRows({ home: homeWith({}), rows: [missed] });

    expect(explained.ledgerIssue).toContain("supervisor tick ledger: ");
    expect(explained.rows[0]!.supervisorStop).toStrictEqual({ kind: "unreadable" });
    expect(explained.rows[0]!.detail).toBe(
      `3 scheduled time(s) went by with no run; it last ran ${LAST_RUN}, and the supervisor's own record could ` +
        "not be read to say why it was not run since",
    );
  });

  it("keeps a non-MISSED row's own reason when the ledger will not read, and says the ledger once", () => {
    const explained = explainSilentRows({ home: homeWith({ lines: ["not json"] }), rows: [failing] });

    expect(explained.rows).toStrictEqual([failing]);
    expect(explained.ledgerIssue).toContain("supervisor tick ledger: ");
  });

  it("reads nothing when no row is silent", () => {
    expect(explainSilentRows({ home: homeWith({ lines: ["not json"] }), rows: [] })).toEqual({
      ledgerIssue: null,
      rows: [],
    });
  });

  describe("a hold on a row whose reason is not MISSED", () => {
    const heldTick = tick({
      finalisedIso: "2026-10-13T02:00:00.000Z",
      judgements: [hold({ claim: "Held on a ruling.", recordedIso: "2026-10-13T01:59:00.000Z" })],
      recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-13T02:00:00.000Z" }),
      tickId: "t1",
    });
    const held = { kind: "held", reason: "Held on a ruling.", recordedIso: "2026-10-13T01:59:00.000Z" } as const;
    const rowOf = ({
      reason,
      lastRunAtIso,
    }: {
      reason: SilentRow["reason"];
      lastRunAtIso: string | null;
    }): SilentRow => ({ ...missed, detail: "its own cause", lastRunAtIso, reason });

    it.each([
      ["NEVER RUN", null],
      ["FAILING", LAST_RUN],
      ["DEFERRED", LAST_RUN],
      ["UNSCHEDULABLE", null],
    ] as const)("carries the hold on a %s row and says it after the row's own cause", (reason, lastRunAtIso) => {
      const home = homeWith({ lines: [supervisorTickLine({ row: heldTick })] });

      expect(explainSilentRows({ home, rows: [rowOf({ lastRunAtIso, reason })] })).toStrictEqual({
        ledgerIssue: null,
        rows: [
          {
            ...rowOf({ lastRunAtIso, reason }),
            detail: "its own cause; the supervisor held it at 2026-10-13T01:59:00.000Z: Held on a ruling.",
            supervisorStop: held,
          },
        ],
      });
    });

    it("leaves the row untouched once a later pass saw it due and recorded no hold", () => {
      const passedOver = tick({
        finalisedIso: "2026-10-13T03:00:00.000Z",
        recipeDue: dueReading({ ids: [SLACK.id], observedAtIso: "2026-10-13T03:00:00.000Z" }),
        tickId: "t2",
      });
      const home = homeWith({ lines: [heldTick, passedOver].map((row) => supervisorTickLine({ row })) });

      const failingRow = rowOf({ lastRunAtIso: LAST_RUN, reason: "FAILING" });

      expect(explainSilentRows({ home, rows: [failingRow] })).toStrictEqual({ ledgerIssue: null, rows: [failingRow] });
    });

    it("ignores a hold recorded before the row last ran", () => {
      const home = homeWith({ lines: [supervisorTickLine({ row: heldTick })] });
      const ranAfter = rowOf({ lastRunAtIso: "2026-10-13T02:30:00.000Z", reason: "FAILING" });

      expect(explainSilentRows({ home, rows: [ranAfter] }).rows).toStrictEqual([ranAfter]);
    });
  });

  it("says a malformed ledger rather than a count", () => {
    const explained = explainSilentRows({ home: homeWith({ lines: ["not json"] }), rows: [missed] });

    expect(explained.ledgerIssue).toContain("supervisor tick ledger: ");
    expect(explained.rows[0]!.detail).toContain("could not be read to say why");
  });
});
