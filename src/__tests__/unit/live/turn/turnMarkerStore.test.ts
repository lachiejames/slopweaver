/**
 * The durable turn-marker store's round-trip and its generation-binding — the whole point of this module is
 * that a marker from a PRIOR dispatch generation is never read as proof for a new one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../live/turn/dispatchStore.js";
import {
  type DurableTurnMarker,
  readCurrentGenerationTurnMarker,
  turnMarkerPath,
  writeTurnMarker,
} from "../../../../live/turn/turnMarkerStore.js";

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

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const READY_MARKER: DurableTurnMarker = {
  answerPath: "/tmp/answer.json",
  dispatchId: RECORD.dispatchId,
  kind: "ready",
  leaseExpiresAt: RECORD.leaseExpiresAt,
};

/** Capture + dispatch RECORD's ask in the ask-lifecycle log and write its dispatch record — the CURRENT generation. */
function dispatchCurrentGeneration({ home }: { home: string }): void {
  ensureCapturedAskLifecycle({ askIdentity: RECORD, home, surface: "channel", userId: "U1" });
  appendAskLifecycleEvent({
    event: {
      ...RECORD,
      kind: "dispatched",
      tier: "fresh-visible-session",
      tsIso: "2026-08-12T00:00:00.000Z",
    },
    home,
  });
  writeDispatchRecord({ home, record: RECORD });
}

describe("turnMarkerPath", () => {
  it("keys the path on channel and messageTs, under live/slack/turn-markers", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);

    expect(turnMarkerPath({ askIdentity: RECORD, home })).toBe(
      join(home, "live", "slack", "turn-markers", "C1-1785000000.000100.json"),
    );
  });
});

describe("writeTurnMarker / readCurrentGenerationTurnMarker", () => {
  it("round-trips a ready marker for the current generation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });

    writeTurnMarker({ askIdentity: RECORD, home, marker: READY_MARKER });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toEqual(READY_MARKER);
  });

  it("round-trips a failed marker for the current generation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });
    const failed: DurableTurnMarker = {
      dispatchId: RECORD.dispatchId,
      kind: "failed",
      leaseExpiresAt: RECORD.leaseExpiresAt,
      reason: "the answer did not validate",
    };

    writeTurnMarker({ askIdentity: RECORD, home, marker: failed });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toEqual(failed);
  });

  it("returns undefined for a marker left over from a PRIOR dispatch generation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });
    // Written by an EARLIER attempt, whose lease does not match the current generation's own.
    writeTurnMarker({
      askIdentity: RECORD,
      home,
      marker: { ...READY_MARKER, leaseExpiresAt: "2020-01-01T00:00:00.000Z" },
    });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined when the ask was never dispatched at all", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);

    writeTurnMarker({ askIdentity: RECORD, home, marker: READY_MARKER });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined for an ask with no marker file at all", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined rather than throwing when the file on disk is not valid JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });
    const path = turnMarkerPath({ askIdentity: RECORD, home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json");

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("returns undefined rather than throwing when the file fails validation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });
    const path = turnMarkerPath({ askIdentity: RECORD, home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ kind: "ready" }));

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toBeUndefined();
  });

  it("overwrites its own marker when the same ask completes again", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-marker-"));
    fixtureDirs.push(home);
    dispatchCurrentGeneration({ home });
    writeTurnMarker({ askIdentity: RECORD, home, marker: READY_MARKER });
    const relaunched: DurableTurnMarker = { ...READY_MARKER, answerPath: "/tmp/answer-2.json" };

    writeTurnMarker({ askIdentity: RECORD, home, marker: relaunched });

    expect(readCurrentGenerationTurnMarker({ askIdentity: RECORD, home })).toEqual(relaunched);
  });
});
