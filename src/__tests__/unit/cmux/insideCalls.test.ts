import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";

import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import {
  cliFailureOutcome,
  type InsideCallOutcome,
  insideRecorder,
  newestInsideCall,
  readInsideCallEvidence,
  recordedWhenLive,
  recordInsideCall,
  recordingCmuxSocket,
  socketCallOutcome,
} from "../../../cmux/insideCalls.js";
import type { CmuxSocket } from "../../../cmux/socket.js";
import { runtimeCmuxDir } from "../../../stateRuntime.js";

const APP_STARTED_MS = Date.parse("2026-10-10T23:45:46.000Z");
const NOW_MS = Date.parse("2026-10-11T04:38:31.000Z");

let homes: string[] = [];

afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A fresh home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "inside-"));
  homes.push(home);
  return home;
}

/** A socket answering every call with one result. */
function socketAnswering({ result }: { result: Result<unknown, CmuxError> }): CmuxSocket {
  return { call: () => Promise.resolve(result), close: () => undefined };
}

describe("readInsideCallEvidence", () => {
  it("reads nothing from a home no seat has stamped", () => {
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home: freshHome(), nowMs: NOW_MS }))).toEqual({
      answeredIso: undefined,
      evidence: undefined,
      unreadable: 0,
    });
  });

  it("round-trips both stamps, picks the newer outcome, and keeps the last answer under it", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: "2026-10-11T03:11:36.000Z", home, outcome: "answered" }));
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:38:00.000Z", home, outcome: "unanswered" }));
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS }))).toEqual({
      answeredIso: "2026-10-11T03:11:36.000Z",
      evidence: { atIso: "2026-10-11T04:38:00.000Z", outcome: "unanswered" },
      unreadable: 0,
    });
  });

  it("never moves a stamp backwards when a seat finishes late", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:37:00.000Z", home, outcome: "answered" }));
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:30:00.000Z", home, outcome: "answered" }));
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS })).answeredIso).toBe(
      "2026-10-11T04:37:00.000Z",
    );
  });

  it("refuses an instant that is not ISO and leaves the stamp it would have replaced", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:37:00.000Z", home, outcome: "answered" }));
    const refused = recordInsideCall({ atIso: "not-a-date", home, outcome: "answered" });
    expect(unwrapErr(refused).code).toBe("STAMP_INVALID");
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS })).answeredIso).toBe(
      "2026-10-11T04:37:00.000Z",
    );
  });

  it("replaces a stamp from a clock that ran more than fifteen minutes ahead", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: "2026-10-11T06:00:00.000Z", home, outcome: "answered" }));
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:30:00.000Z", home, outcome: "answered" }));
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS })).answeredIso).toBe(
      "2026-10-11T04:30:00.000Z",
    );
  });

  it("keeps no answer from before the app started", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: new Date(APP_STARTED_MS - 60_000).toISOString(), home, outcome: "answered" }));
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:38:00.000Z", home, outcome: "unanswered" }));
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS })).answeredIso).toBe(
      undefined,
    );
  });

  it("trusts neither stamp when one will not decode, since it could have been the newer", () => {
    const home = freshHome();
    unwrap(recordInsideCall({ atIso: "2026-10-11T04:38:00.000Z", home, outcome: "answered" }));
    const stamps = unwrap(runtimeCmuxDir({ home }));
    mkdirSync(stamps, { recursive: true });
    writeFileSync(join(stamps, "cmux-inside-unanswered.json"), "{not json\n");
    expect(unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home, nowMs: NOW_MS }))).toEqual({
      answeredIso: undefined,
      evidence: undefined,
      unreadable: 1,
    });
  });
});

describe("newestInsideCall", () => {
  const stamp = ({ atIso, outcome }: { atIso: string; outcome: InsideCallOutcome }) => ({ atIso, outcome });

  it("lets an answer win a tie, so a tie never reads as a hang", () => {
    const stamps = [
      stamp({ atIso: "2026-10-11T04:00:00.000Z", outcome: "unanswered" }),
      stamp({ atIso: "2026-10-11T04:00:00.000Z", outcome: "answered" }),
    ];
    expect(newestInsideCall({ appStartedMs: APP_STARTED_MS, nowMs: NOW_MS, stamps })).toEqual({
      atIso: "2026-10-11T04:00:00.000Z",
      outcome: "answered",
    });
  });

  it("drops a stamp from before the app started and one from after now", () => {
    const stamps = [
      stamp({ atIso: "2026-10-10T23:45:46.000Z", outcome: "unanswered" }),
      stamp({ atIso: "2026-10-11T05:00:00.000Z", outcome: "unanswered" }),
    ];
    expect(newestInsideCall({ appStartedMs: APP_STARTED_MS, nowMs: NOW_MS, stamps })).toBe(undefined);
  });
});

describe("socketCallOutcome", () => {
  it("counts every reply as an answer, a timeout as none, and a dead connection as no evidence", () => {
    const outcomes = [
      ok({ windows: [] }),
      err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "no such workspace", method: "workspace.select" })),
      err(CmuxErrors.timedOut({ method: "window.list", timeoutMs: 15_000 })),
      err(CmuxErrors.socketUnavailable({ detail: "connect ECONNREFUSED", socketPath: "/tmp/cmux.sock" })),
    ].map((result) => socketCallOutcome({ result }));
    expect(outcomes).toEqual(["answered", "answered", "unanswered", undefined]);
  });
});

describe("cliFailureOutcome", () => {
  it("reads the CLI's own timeout as unanswered and any other failure as no evidence", () => {
    const timedOut = Object.assign(new Error("spawnSync cmux ETIMEDOUT"), { code: "ETIMEDOUT" });
    const missing = Object.assign(new Error("spawnSync cmux ENOENT"), { code: "ENOENT" });
    const exited = Object.assign(new Error("Command failed: cmux set-status"), { status: 1 });
    expect([timedOut, missing, exited].map((error) => cliFailureOutcome({ error }))).toEqual([
      "unanswered",
      undefined,
      undefined,
    ]);
  });
});

describe("recordingCmuxSocket", () => {
  it("records each call's outcome and hands its result back untouched", async () => {
    const recorded: InsideCallOutcome[] = [];
    const timeout = err(CmuxErrors.timedOut({ method: "window.list", timeoutMs: 15_000 }));
    const socket = recordingCmuxSocket({
      record: ({ outcome }) => {
        recorded.push(outcome);
        return Promise.resolve();
      },
      socket: socketAnswering({ result: timeout }),
    });
    const result = await socket.call({ method: "window.list" });
    expect(result).toEqual(timeout);
    expect(recorded).toEqual(["unanswered"]);
  });

  it("records nothing for a connection that failed", async () => {
    const recorded: InsideCallOutcome[] = [];
    const socket = recordingCmuxSocket({
      record: ({ outcome }) => {
        recorded.push(outcome);
        return Promise.resolve();
      },
      socket: socketAnswering({
        result: err(CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" })),
      }),
    });
    await socket.call({ method: "window.list" });
    expect(recorded).toEqual([]);
  });
});

describe("insideRecorder", () => {
  it("looks for the dialog after a timeout, once its stamp is written, and never after an answer", async () => {
    const home = freshHome();
    const looked: unknown[] = [];
    const instants = ["2026-10-11T04:29:00.000Z", "2026-10-11T04:30:00.000Z"];
    const record = insideRecorder({
      home,
      nowIso: () => instants.shift()!,
      recover: ({ home: recoveredHome }) => {
        looked.push(
          unwrap(readInsideCallEvidence({ appStartedMs: APP_STARTED_MS, home: recoveredHome, nowMs: NOW_MS })).evidence,
        );
        return Promise.resolve();
      },
    });
    await record({ outcome: "answered" });
    await record({ outcome: "unanswered" });
    expect(looked).toEqual([{ atIso: "2026-10-11T04:30:00.000Z", outcome: "unanswered" }]);
  });
});

describe("recordedWhenLive", () => {
  it("leaves a named socket as given", () => {
    const socket = socketAnswering({ result: ok(null) });
    expect(recordedWhenLive({ live: false, socket })).toBe(socket);
  });
});
