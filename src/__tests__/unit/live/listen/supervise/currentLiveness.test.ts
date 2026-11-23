/**
 * The listener's current liveness, read off a real home: both signals read and judged by `liveness.ts`, and a
 * signal that will not read reported rather than swallowed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { currentLiveness, pidAlive } from "../../../../../live/listen/supervise/currentLiveness.js";
import { writeListenerArm } from "../../../../../live/listen/supervise/store.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const STARTED = "2026-08-23T03:00:00.000Z";
const STARTED_MS = Date.parse(STARTED);

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "current-liveness-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("pidAlive", () => {
  it("answers true for this test's own process, which is certainly in the table", () => {
    expect(pidAlive({ pid: process.pid })).toBe(true);
  });
});

describe("currentLiveness", () => {
  it("reports unarmed with no problem when nothing has ever been armed", () => {
    expect(currentLiveness({ home, nowMs: STARTED_MS })).toEqual({ liveness: { state: "unarmed" }, problems: [] });
  });

  it("judges a live armed pid with no beat yet as starting", () => {
    unwrap(
      writeListenerArm({
        arm: {
          armId: "arm-1",
          logPath: join(home, "arm-1.log"),
          pid: process.pid,
          scope: { kind: "all" },
          startedAtIso: STARTED,
          threadReplyChannels: [],
        },
        home,
      }),
    );
    const read = currentLiveness({ home, nowMs: STARTED_MS + 1_000 });
    expect(read.liveness.state).toBe("starting");
    expect(read.problems).toEqual([]);
  });

  it("reads an arm that will not parse as unarmed, and names the failure as a problem", () => {
    const armPath = stateHomePaths({ home }).live.listener.armJson;
    mkdirSync(dirname(armPath), { recursive: true });
    writeFileSync(armPath, "{ not json");
    const read = currentLiveness({ home, nowMs: STARTED_MS });
    expect(read.liveness).toEqual({ state: "unarmed" });
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]).toContain(armPath);
  });
});
