/**
 * An acquire records the guardian its environment names beside its own pid and start, so a reader can still identify
 * a holder `ps` could not stamp — the desktop's Codex worker sets the two fields for every command its session runs.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { GUARDIAN_PID_ENV, GUARDIAN_START_ENV } from "../../../../admit/processGuardian.js";
import { processStartOf } from "../../../../talk/relayLease.js";
import { home, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

afterEach(() => {
  delete process.env[GUARDIAN_PID_ENV];
  delete process.env[GUARDIAN_START_ENV];
});

describe("an acquire records its guardian", () => {
  it("writes the guardian its environment names beside its pid and its own start", () => {
    process.env[GUARDIAN_PID_ENV] = "5151";
    process.env[GUARDIAN_START_ENV] = "Wed Nov  5 09:01:02 2026";
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-11-25T00:00:00Z" }).isOk()).toBe(true);

    expect(JSON.parse(readFileSync(lockFileIn({ h }), "utf8"))).toEqual({
      acquiredAtIso: "2026-11-25T00:00:00Z",
      guardian: { pid: 5151, start: "Wed Nov  5 09:01:02 2026" },
      pid: process.pid,
      start: processStartOf({ pid: process.pid }).start,
    });
  });

  it("writes no guardian field when the environment's pair is malformed", () => {
    process.env[GUARDIAN_PID_ENV] = "not-a-pid";
    process.env[GUARDIAN_START_ENV] = "Wed Nov  5 09:01:02 2026";
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-11-25T00:00:00Z" }).isOk()).toBe(true);

    expect(JSON.parse(readFileSync(lockFileIn({ h }), "utf8"))).toStrictEqual({
      acquiredAtIso: "2026-11-25T00:00:00Z",
      pid: process.pid,
      start: processStartOf({ pid: process.pid }).start,
    });
  });
});
