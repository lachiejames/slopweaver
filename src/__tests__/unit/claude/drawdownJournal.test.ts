/**
 * The drawdown journal.
 *
 * The parse tests are in-memory lines only. The store tests do a genuine round trip through a `mkdtempSync`
 * directory passed as an explicit `home`, which is the one filesystem shape `.claude/rules/testing.md`
 * allows — and never the ambient `$SLOPWEAVER_HOME`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeErrorLines } from "../../../claude/claudeErrors.js";
import type { DrawdownIncident, DrawdownSample, DrawdownTrigger } from "../../../claude/drawdownAnomaly.js";
import {
  admitDrawdownInvestigation,
  type DrawdownJournalEvent,
  parseDrawdownJournalLine,
  samplesOf,
} from "../../../claude/drawdownJournal.js";
import {
  appendDrawdownJournal,
  drawdownJournalPath,
  readDrawdownJournal,
} from "../../../claude/drawdownJournalStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const SAMPLE: DrawdownSample = {
  kind: "sample",
  observedAtIso: "2026-09-10T12:00:00.000Z",
  planAlias: "plan-a",
  resetAtIso: "2026-09-10T18:00:00.000Z",
  schemaVersion: 1,
  utilization: 0.25,
  window: "five-hour",
};

const TRIGGER: DrawdownTrigger = {
  baselineFractionPerHour: 0.01,
  currentFractionPerHour: 0.3,
  maturity: "ready",
  planAlias: "plan-a",
  ratio: 30,
  resetAtIso: "2026-09-10T18:00:00.000Z",
  window: "five-hour",
};

const INCIDENT: DrawdownIncident = {
  incidentId: "plan-a:five-hour:2026-09-10T18:00:00.000Z",
  observedAtIso: "2026-09-10T12:30:00.000Z",
  triggers: [TRIGGER],
};

describe("parseDrawdownJournalLine", () => {
  it("round-trips a sample", () => {
    const parsed = parseDrawdownJournalLine({ line: JSON.stringify(SAMPLE) });
    expect(unwrap(parsed)).toEqual(SAMPLE);
  });

  it("round-trips an attempt", () => {
    const attempt: DrawdownJournalEvent = {
      attemptedAtIso: "2026-09-10T12:30:00.000Z",
      incidentId: INCIDENT.incidentId,
      kind: "investigation-attempted",
      schemaVersion: 1,
      triggers: [TRIGGER],
    };
    expect(unwrap(parseDrawdownJournalLine({ line: JSON.stringify(attempt) }))).toEqual(attempt);
  });

  it("round-trips an opened investigation", () => {
    const opened: DrawdownJournalEvent = {
      incidentId: INCIDENT.incidentId,
      kind: "investigation-opened",
      recordedAtIso: "2026-09-10T12:31:00.000Z",
      schemaVersion: 1,
      workspaceRef: "workspace:44",
    };
    expect(unwrap(parseDrawdownJournalLine({ line: JSON.stringify(opened) }))).toEqual(opened);
  });

  it("refuses a line that is not JSON", () => {
    expect(claudeErrorLines({ error: unwrapErr(parseDrawdownJournalLine({ line: "{oops" })) })).toEqual([
      "a journal line is not readable JSON",
    ]);
  });

  it("refuses a sample naming a window it does not know", () => {
    const bad = { ...SAMPLE, window: "thirty-day" };
    expect(claudeErrorLines({ error: unwrapErr(parseDrawdownJournalLine({ line: JSON.stringify(bad) })) })).toEqual([
      "a sample line names an unknown window: thirty-day",
    ]);
  });

  it("refuses a sample whose utilization is not a number", () => {
    const bad = { ...SAMPLE, utilization: "lots" };
    expect(claudeErrorLines({ error: unwrapErr(parseDrawdownJournalLine({ line: JSON.stringify(bad) })) })).toEqual([
      "a sample line's utilization is not a finite number",
    ]);
  });

  it("refuses a sample whose reset Date.parse would only guess at", () => {
    const lines = ["0", "2026-10-04T11:00:00", "2026-10-04"].map((resetAtIso) =>
      claudeErrorLines({
        error: unwrapErr(parseDrawdownJournalLine({ line: JSON.stringify({ ...SAMPLE, resetAtIso }) })),
      }),
    );
    expect(lines).toEqual([
      ["a sample line's resetAtIso is not one ISO-8601 instant"],
      ["a sample line's resetAtIso is not one ISO-8601 instant"],
      ["a sample line's resetAtIso is not one ISO-8601 instant"],
    ]);
  });

  it("refuses a sample whose reading is not one instant", () => {
    const bad = { ...SAMPLE, observedAtIso: "yesterday" };
    expect(claudeErrorLines({ error: unwrapErr(parseDrawdownJournalLine({ line: JSON.stringify(bad) })) })).toEqual([
      "a sample line's observedAtIso is not one ISO-8601 instant",
    ]);
  });

  it("keeps a sample whose instants carry an offset", () => {
    const offset = { ...SAMPLE, observedAtIso: "2026-09-10T22:00:00+10:00", resetAtIso: "2026-09-11T04:00:00+10:00" };
    expect(unwrap(parseDrawdownJournalLine({ line: JSON.stringify(offset) }))).toEqual(offset);
  });

  it("refuses a line of an unknown kind rather than swallowing it", () => {
    expect(
      claudeErrorLines({
        error: unwrapErr(parseDrawdownJournalLine({ line: JSON.stringify({ kind: "something-else" }) })),
      }),
    ).toEqual(["a journal line names an unknown kind: something-else"]);
  });
});

describe("samplesOf", () => {
  it("keeps samples and drops investigation events", () => {
    const events: readonly DrawdownJournalEvent[] = [
      SAMPLE,
      {
        incidentId: "x",
        kind: "investigation-failed",
        reason: "no",
        recordedAtIso: "2026-09-10T12:00:00.000Z",
        schemaVersion: 1,
      },
    ];
    expect(samplesOf({ events })).toEqual([SAMPLE]);
  });
});

describe("admitDrawdownInvestigation", () => {
  it("admits an episode nothing has attempted", () => {
    expect(admitDrawdownInvestigation({ history: [], incident: INCIDENT })).toEqual({ kind: "attempt" });
  });

  it("suppresses a second attempt at the same episode", () => {
    const history: readonly DrawdownJournalEvent[] = [
      {
        attemptedAtIso: "2026-09-10T12:30:00.000Z",
        incidentId: INCIDENT.incidentId,
        kind: "investigation-attempted",
        schemaVersion: 1,
        triggers: [TRIGGER],
      },
    ];
    expect(admitDrawdownInvestigation({ history, incident: INCIDENT }).kind).toBe("suppress");
  });

  it("suppresses even when the first attempt FAILED, so a dying process cannot flood workspaces", () => {
    const history: readonly DrawdownJournalEvent[] = [
      {
        attemptedAtIso: "2026-09-10T12:30:00.000Z",
        incidentId: INCIDENT.incidentId,
        kind: "investigation-attempted",
        schemaVersion: 1,
        triggers: [TRIGGER],
      },
      {
        incidentId: INCIDENT.incidentId,
        kind: "investigation-failed",
        reason: "cmux refused",
        recordedAtIso: "2026-09-10T12:31:00.000Z",
        schemaVersion: 1,
      },
    ];
    expect(admitDrawdownInvestigation({ history, incident: INCIDENT }).kind).toBe("suppress");
  });

  it("admits a DIFFERENT episode on the same plan after a reset", () => {
    const history: readonly DrawdownJournalEvent[] = [
      {
        attemptedAtIso: "2026-09-10T12:30:00.000Z",
        incidentId: "plan-a:five-hour:2026-09-10T13:00:00.000Z",
        kind: "investigation-attempted",
        schemaVersion: 1,
        triggers: [TRIGGER],
      },
    ];
    expect(admitDrawdownInvestigation({ history, incident: INCIDENT })).toEqual({ kind: "attempt" });
  });
});

describe("the store, round-tripped through a temp home", () => {
  const homes: string[] = [];

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "drawdown-"));
    homes.push(dir);
    return dir;
  }

  afterEach(() => {
    while (homes.length > 0) {
      rmSync(homes.pop()!, { force: true, recursive: true });
    }
  });

  it("reads an absent journal as empty rather than as a failure", () => {
    const read = unwrap(readDrawdownJournal({ home: home() }));
    expect(read.events).toEqual([]);
    expect(read.unreadable).toBe(0);
  });

  it("appends and reads back in order", () => {
    const dir = home();
    expect(appendDrawdownJournal({ events: [SAMPLE], home: dir }).isOk()).toBe(true);
    const second: DrawdownSample = { ...SAMPLE, observedAtIso: "2026-09-10T12:30:00.000Z", utilization: 0.5 };
    expect(appendDrawdownJournal({ events: [second], home: dir }).isOk()).toBe(true);
    expect(unwrap(readDrawdownJournal({ home: dir })).events).toEqual([SAMPLE, second]);
  });

  it("writes nothing at all when handed no events", () => {
    const dir = home();
    expect(appendDrawdownJournal({ events: [], home: dir }).isOk()).toBe(true);
    expect(unwrap(readDrawdownJournal({ home: dir })).events).toEqual([]);
  });

  it("counts an unparseable line rather than dropping it silently", () => {
    const dir = home();
    const path = drawdownJournalPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(SAMPLE)}\n{not json\n`, "utf8");
    const read = unwrap(readDrawdownJournal({ home: dir }));
    expect(read.events).toEqual([SAMPLE]);
    expect(read.unreadable).toBe(1);
  });

  it("puts the journal under claude-accounts, beside the gauge's own state", () => {
    expect(drawdownJournalPath({ home: "/tmp/h" })).toBe("/tmp/h/claude-accounts/drawdown.jsonl");
  });
});
