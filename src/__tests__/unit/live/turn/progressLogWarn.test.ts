import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  appendProgressLogEvent,
  decodeProgressLogLine,
  foldProgressLog,
  progressLogPath,
  readProgressLogStrict,
} from "../../../../live/turn/progressLog.js";

const ASK = { channel: "C1", messageTs: "1789186868.576709", threadTs: "1789186868.576709" };
const DISPATCHED = "2026-09-12T04:24:59.799Z";
const LEASE = "2026-09-12T06:24:48.249Z";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("decodeProgressLogLine — warn", () => {
  it("reads a clock warn bound to its generation", () => {
    const line = JSON.stringify({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "clock",
      tsIso: "2026-09-12T05:45:00.000Z",
    });
    expect(decodeProgressLogLine({ line })).toEqual({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "clock",
      tsIso: "2026-09-12T05:45:00.000Z",
    });
  });

  it("keeps a witness warn's one note", () => {
    const line = JSON.stringify({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      note: "round 2 carried the same three claims round 1 did",
      source: "witness",
      tsIso: "2026-09-12T05:30:00.000Z",
    });
    expect(decodeProgressLogLine({ line })).toEqual({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      note: "round 2 carried the same three claims round 1 did",
      source: "witness",
      tsIso: "2026-09-12T05:30:00.000Z",
    });
  });

  it("refuses a witness warn with no note", () => {
    const line = JSON.stringify({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "witness",
      tsIso: DISPATCHED,
    });
    expect(decodeProgressLogLine({ line })).toBeUndefined();
  });

  it("refuses a warn with no dispatch instant rather than reading it as every generation's", () => {
    const line = JSON.stringify({
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "clock",
      tsIso: "2026-09-12T05:45:00.000Z",
    });
    expect(decodeProgressLogLine({ line })).toBeUndefined();
  });

  it("refuses a warn from a source it does not know", () => {
    const line = JSON.stringify({
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "planner",
      tsIso: DISPATCHED,
    });
    expect(decodeProgressLogLine({ line })).toBeUndefined();
  });
});

describe("foldProgressLog — warns beside stages and writes", () => {
  it("folds interleaved kinds into their own arrays, in file order", () => {
    const folded = foldProgressLog({
      text: [
        JSON.stringify({ kind: "stage", text: "thread read", tsIso: "2026-09-12T04:26:00.000Z" }),
        JSON.stringify({
          dispatchedIso: DISPATCHED,
          kind: "warn",
          leaseExpiresAt: LEASE,
          source: "clock",
          tsIso: "2026-09-12T05:45:00.000Z",
        }),
        JSON.stringify({
          detail: "warn raised — now: Bash",
          kind: "card-write",
          stageCount: 1,
          tsIso: "2026-09-12T05:46:00.000Z",
        }),
      ].join("\n"),
    });
    expect([folded.stages.length, folded.warns.length, folded.writes.length]).toEqual([1, 1, 1]);
    expect(folded.warns[0]!.tsIso).toBe("2026-09-12T05:45:00.000Z");
  });
});

describe("readProgressLogStrict", () => {
  it("reads a missing file as an empty log", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-progress-strict-"));
    homes.push(home);
    expect(unwrap(readProgressLogStrict({ askIdentity: ASK, home }))).toEqual({
      stages: [],
      timeline: [],
      warns: [],
      writes: [],
    });
  });

  it("reports an unreadable log as an error, never as no warns", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-progress-strict-"));
    homes.push(home);
    mkdirSync(progressLogPath({ askIdentity: ASK, home }), { recursive: true });
    const read = readProgressLogStrict({ askIdentity: ASK, home });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("PROGRESS_LOG_UNREADABLE");
    expect(read._unsafeUnwrapErr().message).toContain("could not read the progress log");
  });

  it("round-trips an appended warn", () => {
    const home = mkdtempSync(join(tmpdir(), "slop-progress-strict-"));
    homes.push(home);
    const warn = {
      dispatchedIso: DISPATCHED,
      kind: "warn",
      leaseExpiresAt: LEASE,
      source: "clock",
      tsIso: "2026-09-12T05:45:00.000Z",
    } as const;
    appendProgressLogEvent({ askIdentity: ASK, event: warn, home });
    expect(unwrap(readProgressLogStrict({ askIdentity: ASK, home })).warns).toEqual([warn]);
  });
});
