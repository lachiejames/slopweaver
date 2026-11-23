/**
 * Reading the fleet offline over an empty throwaway home and an in-memory fleet store (a legacy journal file under the
 * home is imported into it once, on the first read): only the fields the home determines are asserted — the
 * configuration passes through, the instant is the one given, and with no supervisor pin, journal or register there
 * is no chair, no attempt, no reorientation and no signed-out store. What the real machine's sessions look like is
 * deliberately not asserted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ownProcessStart } from "../../../admit/lockHolder.js";
import type { FleetPort } from "../../../fleet/port.js";
import { type FleetMachineRead, readFleetEvidence } from "../../../fleet/read.js";
import { chairEvidenceOf } from "../../../fleet/readChair.js";
import { unwrap } from "../../../lib/result.js";
import type { CodexThreadObservation, CodexThreadObserver } from "../../../measurement/codexSessions.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import { supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import { supervisorTickLedgerPath } from "../../../supervisor/tickStore.js";
import { SUPERVISOR_TICK_SCHEMA_VERSION, TICK_SOURCE_KINDS } from "../../../supervisor/tickTypes.js";
import { memoryFleetPort, unavailableFleetPort } from "../../fleetStoreFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW_MS = Date.parse("2026-10-04T05:10:00.000Z");
const CONFIG = { capacity: 9, schemaVersion: 1 } as const;

const LIVE: CodexThreadObservation = { kind: "live", path: "/u/.codex/thread-writer-locks/thread-1.lock", pid: 4242 };

/** An observer answering `live` for every thread, recording each thread it was asked about. */
function recordingObserver(): { readonly asked: string[]; readonly observe: CodexThreadObserver } {
  const asked: string[] = [];
  return {
    asked,
    observe: ({ threadId }) => {
      asked.push(threadId);
      return LIVE;
    },
  };
}

let home = "";

/**
 * The machine half as a fixed reading: an empty process table, no live session record and an unmeasured console,
 * because none of them is a field the home determines and no case here asserts one. The one machine fact a case
 * reads is this process's own start, so the starts map carries exactly that. It was a REAL reading
 * (`readFleetMachine`: the whole process table, every process's start, the Claude session registry and git over
 * the installed checkout), and on a loaded local lap that read alone outran the 20-second hook timeout and failed
 * every case in the file. What `readFleetMachine` decides is not this file's subject, so no assertion is lost.
 */
let machine: FleetMachineRead;

beforeAll(() => {
  machine = {
    console: { state: "unmeasured" },
    liveRecords: [],
    problems: [],
    snapshot: { kind: "rows", rows: [] },
    starts: new Map([[process.pid, ownProcessStart()!]]),
  };
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fleet-read-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Read the fleet over `home`, through a fresh in-memory fleet store unless the test names one. */
function readOver({ fleet = memoryFleetPort() }: { fleet?: FleetPort } = {}): ReturnType<typeof readFleetEvidence> {
  return readFleetEvidence({
    codexThread: recordingObserver().observe,
    config: CONFIG,
    fleet,
    home,
    machine,
    nowMs: NOW_MS,
    port: memoryPlanRegisterPort(),
  });
}

describe("readFleetEvidence", () => {
  it("passes the configuration and the instant through and reads an empty home as having no chair or attempt", async () => {
    const { evidence } = await readOver();
    expect(evidence.config).toEqual(CONFIG);
    expect(evidence.nowIso).toBe("2026-10-04T05:10:00.000Z");
    expect(evidence.chairSessionId).toBeUndefined();
    expect(evidence.chairPinnedAtIso).toBeUndefined();
    expect(evidence.chairSweep).toEqual({ kind: "none" });
    expect(evidence.attempt).toBeUndefined();
    expect(evidence.attemptRunning).toBe(false);
    expect([...evidence.reorientations]).toEqual([]);
    expect([...evidence.signedOutStores]).toEqual([]);
  });

  it("names no email for a plan the home does not hold", async () => {
    const { evidence } = await readOver();
    expect(evidence.accounts.emailFor({ alias: "plan-one" })).toBeUndefined();
  });

  it("reads the chair's session id off the supervisor pin under the home", async () => {
    writeSupervisorPin({
      home,
      record: {
        session: { host: "claude-code", id: "a0000006-0000-4000-8000-000000000007" },
        pinnedAtIso: "2026-10-04T05:00:00.000Z",
        workspaceId: "w-1",
        workspaceRef: "workspace:1",
      },
    });
    const { evidence } = await readOver();
    expect(evidence.chairSessionId).toBe("a0000006-0000-4000-8000-000000000007");
    expect(evidence.chairPinnedAtIso).toBe("2026-10-04T05:00:00.000Z");
    expect(evidence.chairSweep).toEqual({ kind: "none" });
  });

  it("reads the chair's half on its own, adding no problem and asking Codex nothing when the home holds no pin", () => {
    const problems: string[] = [];
    const codex = recordingObserver();
    expect(chairEvidenceOf({ codexThread: codex.observe, home, problems })).toEqual({
      chairPinnedAtIso: undefined,
      chairSessionId: undefined,
      chairSweep: { kind: "none" },
      chairWorkspaceRef: undefined,
    });
    expect(problems).toEqual([]);
    expect(codex.asked).toEqual([]);
  });

  it("never asks Codex about a Claude chair", () => {
    writeSupervisorPin({
      home,
      record: {
        pinnedAtIso: "2026-10-04T05:00:00.000Z",
        session: { host: "claude-code", id: "a0000006-0000-4000-8000-000000000007" },
        workspaceId: "w-1",
        workspaceRef: "workspace:1",
      },
    });
    const codex = recordingObserver();
    const evidence = chairEvidenceOf({ codexThread: codex.observe, home, problems: [] });
    expect(evidence.chairSessionId).toBe("a0000006-0000-4000-8000-000000000007");
    expect(evidence.chairCodex).toBe(undefined);
    expect(codex.asked).toEqual([]);
  });

  it("carries what Codex's open files say about a Codex pin's thread, never offering it as a Claude session", () => {
    const record = { pinnedAtIso: "2026-10-04T05:00:00.000Z", workspaceId: "w-1", workspaceRef: "workspace:1" };
    writeSupervisorPin({ home, record: { ...record, session: { host: "codex", id: "thread-1" } } });
    const codex = recordingObserver();
    expect(chairEvidenceOf({ codexThread: codex.observe, home, problems: [] })).toEqual({
      chairCodex: { observation: LIVE, threadId: "thread-1" },
      chairPinnedAtIso: "2026-10-04T05:00:00.000Z",
      chairSessionId: undefined,
      chairSweep: { kind: "none" },
      chairWorkspaceRef: "workspace:1",
    });
    expect(codex.asked).toEqual(["thread-1"]);
  });

  it("names a chain-only Codex chair as its thread, never reading the registry for it, when no pin is recorded", () => {
    appendSupervisorLink({
      home,
      link: {
        pinnedAtIso: "2026-10-04T05:00:00.000Z",
        session: { host: "codex", id: "thread-1" },
        source: "pin",
        workspaceId: "w-1",
        workspaceRef: "workspace:1",
      },
    });
    const notObserved: CodexThreadObservation = { kind: "not-observed", why: "no Codex process holds it" };
    expect(chairEvidenceOf({ codexThread: () => notObserved, home, problems: [] })).toEqual({
      chairCodex: { observation: notObserved, threadId: "thread-1" },
      chairPinnedAtIso: undefined,
      chairSessionId: undefined,
      chairSweep: { kind: "none" },
      chairWorkspaceRef: undefined,
    });
  });

  it("reads cmux as unmeasured when the revive journal holds nothing", async () => {
    const { evidence } = await readOver();
    expect(evidence.cmux).toEqual({ kind: "unmeasured" });
  });

  it("names the outage as a problem and reads no attempt and no cmux when the store cannot be reached", async () => {
    const read = await readOver({ fleet: unavailableFleetPort() });
    expect(read.evidence.attempt).toBeUndefined();
    expect(read.evidence.cmux).toEqual({ kind: "unmeasured" });
    expect(read.problems.filter((problem) => problem.includes("fixture outage"))).toHaveLength(2);
  });

  it("folds the attempt off the store's own rows, with no file under the home", async () => {
    const fleet = memoryFleetPort();
    unwrap(
      await fleet.appendResumeEvent({
        event: {
          atIso: "2026-10-04T05:00:00.000Z",
          attemptId: "att-5",
          episodeId: "ep-5",
          kind: "attempt-started",
          pid: 2_147_483_000,
          schemaVersion: 1,
        },
        home,
      }),
    );
    const { evidence } = await readOver({ fleet });
    expect(evidence.attempt!.attemptId).toBe("att-5");
    expect(evidence.attempt!.episodeId).toBe("ep-5");
  });

  describe("the chair's newest sweep, off the tick ledger", () => {
    /** Pin `workspace:1011` and write these tick rows to the ledger under the home. */
    function pinAndTicks({ rows }: { rows: readonly Record<string, unknown>[] }): void {
      writeSupervisorPin({
        home,
        record: {
          session: { host: "claude-code", id: "a0000006-0000-4000-8000-000000000007" },
          pinnedAtIso: "2026-10-04T05:00:00.000Z",
          workspaceId: "w-1011",
          workspaceRef: "workspace:1011",
        },
      });
      const path = supervisorTickLedgerPath({ home });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    }

    /**
     * One tick row valid against the ledger's own strict schema, every source unavailable, with any field replaced.
     *
     * @returns the row as written to the ledger
     */
    function tick(over: Record<string, unknown>): Record<string, unknown> {
      const startedIso = "2026-10-04T05:01:00.000Z";
      const sources = Object.fromEntries(
        TICK_SOURCE_KINDS.map((kind) => [
          kind,
          {
            diagnostic: `${kind} not read by this fixture`,
            observedAtIso: startedIso,
            status: "unavailable",
            witness: { command: `slopweaver ${kind}`, exitCode: null },
          },
        ]),
      );
      const parts = {
        actions: [],
        judgements: [],
        ownerTurns: {
          coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
          sinceIso: null,
          status: "read",
          turns: [],
        },
        sources,
      };
      return {
        ...parts,
        finalisedIso: "2026-10-04T05:02:00.000Z",
        handoff: "handoff-9001",
        schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
        startedIso,
        stats: supervisorTickStatsOf(parts),
        tickId: "h-1",
        workspace: "workspace:1011",
        ...over,
      };
    }

    it("reads the newest row the pinned workspace finalised, never another workspace's", async () => {
      const started = "2026-10-04T05:01:00.000Z";
      pinAndTicks({
        rows: [
          tick({ finalisedIso: "2026-10-04T05:02:00.000Z", tickId: "h-1" }),
          tick({ finalisedIso: "2026-10-04T05:04:00.000Z", tickId: "h-2" }),
          tick({ finalisedIso: "2026-10-04T05:06:00.000Z", tickId: "other-1", workspace: "workspace:7" }),
        ],
      });
      const read = await readOver();
      expect(read.evidence.chairSweep).toEqual({
        finalisedIso: "2026-10-04T05:04:00.000Z",
        kind: "swept",
        startedIso: started,
        tickId: "h-2",
      });
    });

    it("reports a ledger line that is not JSON as unreadable, and names it as a problem", async () => {
      pinAndTicks({ rows: [] });
      writeFileSync(supervisorTickLedgerPath({ home }), "{not json\n");
      const read = await readOver();
      expect(read.evidence.chairSweep).toEqual({
        kind: "unreadable",
        why: "a tick ledger line in the tail is not JSON",
      });
      expect(read.problems).toContain(
        "the supervisor's sweeps could not be read: a tick ledger line in the tail is not JSON",
      );
    });

    it("refuses the pinned workspace's row with no readable finalisation rather than skipping it", async () => {
      pinAndTicks({ rows: [tick({ finalisedIso: "later" })] });
      expect((await readOver()).evidence.chairSweep).toEqual({
        kind: "unreadable",
        why: "a tick row of workspace:1011 is not a valid tick: finalisedIso: Invalid ISO datetime",
      });
    });

    it("refuses the pinned workspace's row with no start, which is what keeps a predecessor's sweep out", async () => {
      pinAndTicks({ rows: [tick({ startedIso: undefined })] });
      expect((await readOver()).evidence.chairSweep).toEqual({
        kind: "unreadable",
        why: "a tick row of workspace:1011 is not a valid tick: startedIso: Invalid input: expected string, received undefined",
      });
    });

    it("refuses a row only shaped like a tick, which would otherwise read as the chair working", async () => {
      pinAndTicks({
        rows: [
          {
            finalisedIso: "2026-10-04T05:02:00.000Z",
            startedIso: "2026-10-04T05:01:00.000Z",
            tickId: "fake",
            workspace: "workspace:1011",
          },
        ],
      });
      expect((await readOver()).evidence.chairSweep).toEqual({
        kind: "unreadable",
        why: "a tick row of workspace:1011 is not a valid tick: actions: Invalid input: expected array, received undefined",
      });
    });

    it("refuses a row finalised before it started, which would otherwise pass the start boundary", async () => {
      pinAndTicks({ rows: [tick({ finalisedIso: "2026-10-04T04:59:00.000Z" })] });
      expect((await readOver()).evidence.chairSweep).toEqual({
        kind: "unreadable",
        why: "a tick row of workspace:1011 is not a valid tick: finalisedIso 2026-10-04T04:59:00.000Z is before startedIso 2026-10-04T05:01:00.000Z",
      });
    });
  });

  it("folds the newest attempt and every reorientation from the journal under the home", async () => {
    mkdirSync(join(home, "fleet"), { recursive: true });
    const base = { attemptId: "att-9", schemaVersion: 1 };
    const lines = [
      { ...base, atIso: "2026-10-04T05:00:00.000Z", episodeId: "ep-9", kind: "attempt-started", pid: 2_147_483_000 },
      { ...base, atIso: "2026-10-04T05:03:00.000Z", chairSessionId: "chair-9", kind: "chair-reoriented" },
    ];
    writeFileSync(join(home, "fleet", "resume.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    // The legacy file is imported into the store once, on the first read of a fresh store.
    const { evidence } = await readOver();
    expect(evidence.attempt!.attemptId).toBe("att-9");
    expect(evidence.attempt!.episodeId).toBe("ep-9");
    expect([...evidence.reorientations]).toEqual([["chair-9", "2026-10-04T05:03:00.000Z"]]);
    expect(evidence.attemptRunning).toBe(false);
  });

  it("reads an unfinished attempt as running only while its own process is, never one that inherited its pid", async () => {
    mkdirSync(join(home, "fleet"), { recursive: true });
    const started = ({ pidStart }: { pidStart: string }): string =>
      `${JSON.stringify({ atIso: "2026-10-04T05:00:00.000Z", attemptId: "att-1", episodeId: "ep-1", kind: "attempt-started", pid: process.pid, pidStart, schemaVersion: 1 })}\n`;
    writeFileSync(join(home, "fleet", "resume.jsonl"), started({ pidStart: ownProcessStart()! }));
    expect((await readOver()).evidence.attemptRunning).toBe(true);
    writeFileSync(join(home, "fleet", "resume.jsonl"), started({ pidStart: "Thu Jan  1 00:00:00 1970" }));
    expect((await readOver()).evidence.attemptRunning).toBe(false);
  });

  it("reads an unfinished attempt journalled with no start stamp as not running, even on a live pid", async () => {
    mkdirSync(join(home, "fleet"), { recursive: true });
    const unstamped = {
      atIso: "2026-10-04T05:00:00.000Z",
      attemptId: "att-1",
      episodeId: "ep-1",
      kind: "attempt-started",
      pid: process.pid,
      schemaVersion: 1,
    };
    writeFileSync(join(home, "fleet", "resume.jsonl"), `${JSON.stringify(unstamped)}\n`);
    expect((await readOver()).evidence.attemptRunning).toBe(false);
  });

  it("reports an unreadable journal as a problem and carries on with no attempt", async () => {
    mkdirSync(join(home, "fleet", "resume.jsonl"), { recursive: true });
    const read = await readOver();
    // The one-time import of the legacy file refuses a path that is not a file, naming it.
    expect(read.problems).toContain(
      `${join(home, "fleet", "resume.jsonl")}: EISDIR: illegal operation on a directory, read`,
    );
    expect(read.evidence.attempt).toBeUndefined();
  });
});
