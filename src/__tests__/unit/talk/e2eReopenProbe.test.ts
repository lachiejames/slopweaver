/*
 * The one window in which a desktop test instance's call may be a reopen: armed only while the probe file names an
 * instant still ahead and the run that wrote it is still running, by pid AND start, so no other scenario's call is ever
 * reminded — not even one started straight after a `call-reopen` run killed before it could remove the file, nor once
 * the OS has handed that run's pid to another process.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ownProcessStart } from "../../../admit/lockHolder.js";
import { unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  armReopenProbe,
  disarmReopenProbe,
  processAlive,
  readReopenProbe,
  reopenProbeArmed,
} from "../../../talk/e2eReopenProbe.js";
import { ReopenProbeErrors } from "../../../talk/e2eReopenProbeErrors.js";

const NOW = "2026-11-06T01:12:00.000Z";
const AHEAD = "2026-11-06T02:00:00.000Z";
const WRITER = 4242;
const STARTED = "Fri Nov  6 01:00:00 2026";

/** A plain fake: only the writer, by pid and start, is running. */
const writerRunning = ({ pid, start }: { pid: number; start: string }): boolean => pid === WRITER && start === STARTED;
/** A plain fake: nothing is running. */
const nothingRunning = (): boolean => false;

/** A probe file's text. */
const probe = ({ start = STARTED, untilIso = AHEAD }: { start?: string; untilIso?: string } = {}): string =>
  JSON.stringify({ pid: WRITER, start, untilIso });

describe("reopenProbeArmed", () => {
  it("is armed while the instant is ahead, and not at or after it", () => {
    const at = ({ untilIso }: { untilIso: string }): boolean =>
      reopenProbeArmed({ alive: writerRunning, nowIso: NOW, text: probe({ untilIso }) });
    expect([
      at({ untilIso: "2026-11-06T01:12:00.001Z" }),
      at({ untilIso: NOW }),
      at({ untilIso: "2026-11-06T01:11:59.999Z" }),
    ]).toEqual([true, false, false]);
  });

  it("is no window once the run that wrote it is gone, or its pid now names a process started later", () => {
    expect([
      reopenProbeArmed({ alive: writerRunning, nowIso: NOW, text: probe() }),
      reopenProbeArmed({ alive: nothingRunning, nowIso: NOW, text: probe() }),
      reopenProbeArmed({ alive: writerRunning, nowIso: NOW, text: probe({ start: "Fri Nov  6 01:30:00 2026" }) }),
    ]).toEqual([true, false, false]);
  });

  it("is no window with no file, a torn one, another shape, no writer, no start, or an undated read", () => {
    const armed = ({ text, nowIso = NOW }: { text: string | undefined; nowIso?: string }): boolean =>
      reopenProbeArmed({ alive: writerRunning, nowIso, text });
    expect([
      armed({ text: undefined }),
      armed({ text: '{"pid":4242,"start":"x","untilIso":"2026-11-06T02:00' }),
      armed({ text: probe({ untilIso: "tomorrow" }) }),
      armed({ text: JSON.stringify({ extra: 1, pid: WRITER, start: STARTED, untilIso: AHEAD }) }),
      armed({ text: JSON.stringify({ start: STARTED, untilIso: AHEAD }) }),
      armed({ text: JSON.stringify({ pid: 0, start: STARTED, untilIso: AHEAD }) }),
      armed({ text: JSON.stringify({ pid: WRITER, untilIso: AHEAD }) }),
      armed({ text: probe({ start: "" }) }),
      armed({ nowIso: "not a date", text: probe() }),
    ]).toEqual([false, false, false, false, false, false, false, false, false]);
  });
});

describe("ReopenProbeErrors.stillArmed", () => {
  it("names the path, carries the cause, and quotes an Error's message or a thrown value's string", () => {
    const cause = new Error("EACCES: permission denied");
    const fromError = ReopenProbeErrors.stillArmed({ cause, path: "/h/probe.json" });
    const fromValue = ReopenProbeErrors.stillArmed({ cause: 13, path: "/h/probe.json" });
    expect([fromError.code, fromError.path, fromError.cause]).toEqual([
      "REOPEN_PROBE_STILL_ARMED",
      "/h/probe.json",
      cause,
    ]);
    expect([fromError.message, fromValue.message]).toEqual([
      "could not remove the reopen probe at /h/probe.json, which a test call can still read: EACCES: permission denied",
      "could not remove the reopen probe at /h/probe.json, which a test call can still read: 13",
    ]);
  });
});

describe("processAlive", () => {
  it("says this process runs, the same pid under another start does not, and an exited child does not", () => {
    const mine = ownProcessStart()!;
    const exited = spawnSync(process.execPath, ["-e", ""]);
    expect([
      processAlive({ pid: process.pid, start: mine }),
      processAlive({ pid: process.pid, start: `${mine} not` }),
      processAlive({ pid: exited.pid, start: mine }),
    ]).toEqual([true, false, false]);
  });
});

describe("the probe file", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("round-trips an arm and reads nothing once disarmed, twice over", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-reopen-probe-"));
    homes.push(home);
    expect(readReopenProbe({ home })).toBe(undefined);
    armReopenProbe({ home, pid: WRITER, start: STARTED, untilIso: AHEAD });
    expect(reopenProbeArmed({ alive: writerRunning, nowIso: NOW, text: readReopenProbe({ home }) })).toBe(true);
    expect([disarmReopenProbe({ home }).isOk(), disarmReopenProbe({ home }).isOk()]).toEqual([true, true]);
    expect(readReopenProbe({ home })).toBe(undefined);
  });

  // `rmSync` cannot remove a directory, but no read opens one, so no window is armed.
  it("is closed, removing nothing, when a directory stands at the probe path", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-reopen-probe-"));
    homes.push(home);
    const path = stateHomePaths({ home }).talkE2eReopenProbeJson;
    mkdirSync(path, { recursive: true });
    expect([disarmReopenProbe({ home }).isOk(), existsSync(path), readReopenProbe({ home })]).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  // A probe that cannot be removed and still reads is returned, never thrown.
  it("returns why when the probe still reads after its removal failed", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-reopen-probe-"));
    homes.push(home);
    armReopenProbe({ home, pid: WRITER, start: STARTED, untilIso: AHEAD });
    const path = stateHomePaths({ home }).talkE2eReopenProbeJson;
    chmodSync(dirname(path), 0o500);
    try {
      const refused = unwrapErr(disarmReopenProbe({ home }));
      expect([refused.code, refused.path, readReopenProbe({ home })]).toEqual([
        "REOPEN_PROBE_STILL_ARMED",
        path,
        probe(),
      ]);
      expect(refused.message).toContain(
        `could not remove the reopen probe at ${path}, which a test call can still read`,
      );
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  });
});
