/**
 * The fresh-visible-session dispatch record's durability path: a real round-trip against a temp home,
 * because this function's whole job IS a filesystem effect — there is no pure core to extract it into and
 * test instead.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import {
  currentGenerationDispatchRecord,
  dispatchRecordPath,
  readDispatchRecord,
  unmatchedDispatchRecordVersion,
  writeDispatchRecord,
} from "../../../../live/turn/dispatchStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const RECORD: FreshDispatchRecord = {
  askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
  briefPath: "/tmp/brief.json",
  channel: "C1",
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    truthMode: "none",
    schemaVersion: 1,
    tier: "fresh-visible-session",
  },
  dispatchId: "dispatch-1",
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: "2026-08-12T02:00:00.000Z",
  messageTs: "1785000000.000100",
  schemaVersion: 3,
  session: {
    host: "claude-code",
    surfaceId: "id-surface:1",
    surfaceRef: "surface:1",
    workspaceId: "id-workspace:1",
    workspaceRef: "workspace:1",
  },
  threadTs: "1785000000.000100",
};

describe("dispatchRecordPath", () => {
  it("keys the path on channel and messageTs, under live/slack/dispatches", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);

    expect(dispatchRecordPath({ askIdentity: RECORD, home })).toBe(
      join(home, "live", "slack", "dispatches", "C1-1785000000.000100.json"),
    );
  });
});

describe("writeDispatchRecord / readDispatchRecord", () => {
  it("round-trips a record, creating the directory when it does not exist", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);

    writeDispatchRecord({ home, record: RECORD });

    expect(readDispatchRecord({ askIdentity: RECORD, home })).toEqual(RECORD);
  });

  it("overwrites its own record when the same ask is re-dispatched", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    const relaunched: FreshDispatchRecord = { ...RECORD, dispatchId: "dispatch-2" };

    writeDispatchRecord({ home, record: RECORD });
    writeDispatchRecord({ home, record: relaunched });

    expect(readDispatchRecord({ askIdentity: RECORD, home })).toEqual(relaunched);
  });

  it("returns undefined for an ask that was never dispatched", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);

    expect(readDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined rather than throwing when the file on disk fails validation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    writeDispatchRecord({ home, record: RECORD });
    // Overwrite with something that will not parse as a FreshDispatchRecord — invalid at the CURRENT version.
    const invalidAtCurrentVersion = {
      ...RECORD,
      session: {
        host: "claude-code",
        surfaceId: "id-",
        surfaceRef: "",
        workspaceId: "id-",
        workspaceRef: "",
      },
    };
    writeFileSync(dispatchRecordPath({ askIdentity: RECORD, home }), JSON.stringify(invalidAtCurrentVersion));

    expect(readDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });
});

describe("unmatchedDispatchRecordVersion", () => {
  it("returns undefined for a current-version record", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    writeDispatchRecord({ home, record: RECORD });

    expect(unmatchedDispatchRecordVersion({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined for an ask that was never dispatched", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);

    expect(unmatchedDispatchRecordVersion({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("names the stale V1 schema version on a file this build no longer parses as current", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    writeDispatchRecord({ home, record: RECORD });
    const v1Shape: Record<string, unknown> = { ...RECORD, schemaVersion: 1 };
    delete v1Shape["askPermalink"];
    writeFileSync(dispatchRecordPath({ askIdentity: RECORD, home }), JSON.stringify(v1Shape));

    expect(unmatchedDispatchRecordVersion({ askIdentity: RECORD, home })).toBe(1);
    expect(readDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });
});

describe("currentGenerationDispatchRecord", () => {
  /** Capture + dispatch this ask in the ask-lifecycle log, matching RECORD's own lease and decision by default. */
  function dispatchLifecycle({
    home,
    decision = RECORD.decision,
    leaseExpiresAt = RECORD.leaseExpiresAt,
  }: {
    home: string;
    decision?: FreshDispatchRecord["decision"];
    leaseExpiresAt?: string;
  }): void {
    ensureCapturedAskLifecycle({ askIdentity: RECORD, home, surface: "channel", userId: "U1" });
    appendAskLifecycleEvent({
      event: {
        ...RECORD,
        decision,
        kind: "dispatched",
        leaseExpiresAt,
        tier: "fresh-visible-session",
        tsIso: "2026-08-12T00:00:00.000Z",
      },
      home,
    });
  }

  it("returns the record when its lease AND decision both match the log's current dispatched event", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    dispatchLifecycle({ home });
    writeDispatchRecord({ home, record: RECORD });

    expect(currentGenerationDispatchRecord({ askIdentity: RECORD, home })).toEqual(RECORD);
  });

  it("refuses a record whose decision was hand-edited away from the log's own decision, even with a matching lease", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    dispatchLifecycle({ home });
    const editedRecord: FreshDispatchRecord = {
      ...RECORD,
      decision: {
        ...RECORD.decision,
        needs: [{ capabilityId: "fleet-status", reason: "n/a", requirement: "required" }],
      },
    };
    writeDispatchRecord({ home, record: editedRecord });

    expect(currentGenerationDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("refuses a current record when the log's dispatch predates truthMode, even with a matching lease", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    const { truthMode: _absentBefore436, ...preTruthModeDecision } = RECORD.decision;
    // @ts-expect-error — a fresh append must carry truthMode, so an August-shaped row is written past the compiler.
    dispatchLifecycle({ decision: preTruthModeDecision, home });
    writeDispatchRecord({ home, record: RECORD });

    expect(currentGenerationDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("refuses a record whose lease belongs to a PRIOR generation, even with a matching decision", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    dispatchLifecycle({ home, leaseExpiresAt: "2099-01-01T00:00:00.000Z" });
    writeDispatchRecord({ home, record: RECORD }); // RECORD's own leaseExpiresAt is the OLDER one.

    expect(currentGenerationDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined when the ask was never dispatched at all", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dispatch-"));
    fixtureDirs.push(home);
    writeDispatchRecord({ home, record: RECORD });

    expect(currentGenerationDispatchRecord({ askIdentity: RECORD, home })).toBeUndefined();
  });
});
