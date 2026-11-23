import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import {
  overlappedCallIds,
  UNENDED_CALL_QUIET_MS,
  UNENDED_CALLS_KEEP,
  unendedCallIds,
} from "../../../desktop/unendedCalls.js";
import { unwrap } from "../../../lib/result.js";
import type { CallRecord } from "../../../talk/callRecord.js";
import { callsDir, readCalls } from "../../../talk/callStore.js";

/** Every state home a test minted, removed after it. */
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The instant judged. */
const NOW = Date.parse("2026-11-02T08:00:00.000Z");

/** A console a call was served from, never this install's own path. */
const ORIGIN = { checkoutRoot: "/acme/checkout", defaultPort: 3000, mainWorktree: true, port: 3000 };

/** One call as the store folds it. */
const call = ({
  callId,
  agoMs,
  ended = false,
  stamped = true,
}: {
  callId: string;
  agoMs: number;
  ended?: boolean;
  stamped?: boolean;
}): Pick<CallRecord, "callId" | "ended" | "lastIso" | "origin"> => {
  let origin: CallRecord["origin"];
  if (stamped) {
    origin = ORIGIN;
  }
  return {
    callId,
    ended: ended ? { atIso: new Date(NOW - agoMs).toISOString(), why: null } : undefined,
    lastIso: new Date(NOW - agoMs).toISOString(),
    origin,
  };
};

describe("unendedCallIds", () => {
  it("names a recent unended call from any console, an unstamped one and another leg's included", () => {
    const otherLeg = { ...call({ agoMs: 1000, callId: "other-leg" }), origin: { ...ORIGIN, instance: "e2e" as const } };
    expect(
      unendedCallIds({
        calls: [
          call({ agoMs: 1000, callId: "owner-call" }),
          call({ agoMs: 1000, callId: "legacy", stamped: false }),
          otherLeg,
        ],
        nowMs: NOW,
        placed: [],
      }),
    ).toEqual(["owner-call", "legacy", "other-leg"]);
  });

  it("passes over an ended call, one this leg placed and one quiet past the window", () => {
    expect(
      unendedCallIds({
        calls: [
          call({ agoMs: 1000, callId: "ended", ended: true }),
          call({ agoMs: 1000, callId: "ours" }),
          call({ agoMs: UNENDED_CALL_QUIET_MS + 1, callId: "dropped" }),
          call({ agoMs: UNENDED_CALL_QUIET_MS, callId: "edge" }),
        ],
        nowMs: NOW,
        placed: ["ours"],
      }),
    ).toEqual(["edge"]);
  });

  // A restored file keeps an old mtime while its last line is recent, even one before 1970.
  it("reads a call heard from a minute ago out of a file last modified before 1970", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-unended-"));
    homes.push(home);
    const callId = "a0000041-0000-4000-8000-000000000044";
    mkdirSync(callsDir({ home }), { recursive: true });
    const path = join(callsDir({ home }), `${callId}.jsonl`);
    const said = {
      atIso: new Date(NOW - 60_000).toISOString(),
      final: true,
      id: "s-1",
      kind: "segment",
      text: "hi",
      who: "owner",
    };
    writeFileSync(path, `${JSON.stringify(said)}\n`);
    const before1970 = -1;
    utimesSync(path, before1970, before1970);
    const calls = unwrap(readCalls({ home, keep: UNENDED_CALLS_KEEP })).calls;
    expect(unendedCallIds({ calls, nowMs: NOW, placed: [] })).toEqual([callId]);
  });

  it("says which calls hold the leg back", () => {
    const error = E2eCallErrors.callStillOpen({ callIds: ["a", "b"] });
    expect([error.code, error.message]).toEqual([
      "CALL_STILL_OPEN",
      "2 call(s) no test instance placed were heard from recently and never ended (a, b) — one may be open in a " +
        "console whose lease lapsed, so no test call is placed beside it",
    ]);
  });
});

/** One call open from `openedAgoMs` to `lastAgoMs` before NOW, ended there when `ended`. */
const span = ({
  callId,
  openedAgoMs,
  lastAgoMs,
  ended = false,
}: {
  callId: string;
  openedAgoMs: number;
  lastAgoMs: number;
  ended?: boolean;
}): Pick<CallRecord, "callId" | "ended" | "lastIso" | "openedIso"> => ({
  callId,
  ended: ended ? { atIso: new Date(NOW - lastAgoMs).toISOString(), why: null } : undefined,
  lastIso: new Date(NOW - lastAgoMs).toISOString(),
  openedIso: new Date(NOW - openedAgoMs).toISOString(),
});

// The preflight is a snapshot, so a call the owner begins after it is detected by the read after the scenario.
describe("overlappedCallIds", () => {
  const window = { fromMs: NOW - 60_000, toMs: NOW };

  it("names a call begun mid-scenario, one still open across it and one ended inside it", () => {
    expect(
      overlappedCallIds({
        ...window,
        calls: [
          span({ callId: "began-mid", lastAgoMs: 0, openedAgoMs: 30_000 }),
          span({ callId: "across", lastAgoMs: 0, openedAgoMs: 120_000 }),
          span({ callId: "ended-inside", ended: true, lastAgoMs: 30_000, openedAgoMs: 120_000 }),
          span({ callId: "edge", ended: true, lastAgoMs: 60_000, openedAgoMs: 90_000 }),
        ],
        placed: [],
      }),
    ).toEqual(["began-mid", "across", "ended-inside", "edge"]);
  });

  it("passes over this leg's own calls, one ended before the scenario and one begun after it", () => {
    expect(
      overlappedCallIds({
        ...window,
        calls: [
          span({ callId: "ours", lastAgoMs: 0, openedAgoMs: 30_000 }),
          span({ callId: "before", ended: true, lastAgoMs: 60_001, openedAgoMs: 90_000 }),
          span({ callId: "after", lastAgoMs: -2000, openedAgoMs: -1000 }),
        ],
        placed: ["ours"],
      }),
    ).toEqual([]);
  });

  it("says which calls overlapped and that the leg stops", () => {
    const error = E2eCallErrors.callOverlapped({ callIds: ["a"] });
    expect([error.code, error.message]).toEqual([
      "CALL_OVERLAPPED",
      "1 call(s) no test instance placed were open while the last scenario ran (a) — a call of the owner's began after the " +
        "preflight read, so the leg stops rather than place another",
    ]);
  });
});
