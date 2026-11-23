/*
 * `readListener` and an unarmed listener: `listen status` leaves `socketState` out when no listener has ever written a
 * heartbeat (`src/live/listen/supervise/report.ts`), and that reading is the no-op-by-design answer, never an
 * unreadable one. Refusing it drew a false staleness mark at the end of the sidebar's freshness strip on every page
 * load with no listener running.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readListener, readListenerReading } from "../../components/live/readNow";

/** The document `listen status --json` records with no listener running, as read off a real home. */
const unarmed = (over: Record<string, unknown>): Record<string, unknown> => ({
  deathsInWindow: 0,
  escalated: false,
  grade: "unarmed",
  liveness: { state: "unarmed" },
  problems: ["loop freshness: nothing to measure — no armed listener pid and no recorded worktree"],
  threadReplyChannels: [],
  why: "unarmed — no listener is running. A tag arriving now is a no-op BY DESIGN.",
  ...over,
});

/** The committed capture from a listener that had once beaten, so its socket state is present. */
const FIXTURE = join(__dirname, "..", "..", "fixtures", "listener-reading", "2026-09-20.json");

describe("readListener — an absent socket state", () => {
  it("reads an unarmed listener that never wrote a heartbeat, with no socket state", () => {
    const listener = readListener(unarmed({}))!;
    expect(listener.grade).toBe("unarmed");
    expect(listener.socketState).toBe(undefined);
  });

  it("reads the whole recorded reading, so the strip draws no unreadable mark", () => {
    const reading = readListenerReading({
      by: "tick-13",
      bytes: 367,
      document: unarmed({}),
      observedAtIso: "2026-11-02T19:19:00.496Z",
      producer: "listen status",
      readingId: "2026-11-02T19:19:00.496Z-listen-status",
      recordedAtIso: "2026-11-02T19:19:00.496Z",
    })!;
    expect(reading.value.livenessState).toBe("unarmed");
  });

  it("still hands on a socket state a capture carries", () => {
    const reading = readListenerReading(JSON.parse(readFileSync(FIXTURE, "utf8")))!;
    expect(reading.value.socketState).toBe("disconnected");
  });

  it("carries the last death's captured log tail, and reads its absence as not captured", () => {
    const death = { armId: "arm-1", atIso: "2026-11-02T19:00:00.000Z", reason: "socket-down" };
    expect([
      readListener(unarmed({ lastDeath: { ...death, lastLog: "socket closed: 1006" } }))!.lastDeath,
      readListener(unarmed({ lastDeath: death }))!.lastDeath,
    ]).toEqual([
      { ...death, lastLog: "socket closed: 1006" },
      { ...death, lastLog: undefined },
    ]);
  });

  it("refuses a socket state that is present but not a word, which is malformed rather than absent", () => {
    expect(readListener(unarmed({ socketState: 7 }))).toBe(undefined);
  });

  it("refuses a socket state or grade outside the producer's closed set, so a raw string never leads the tile", () => {
    expect([
      readListener(unarmed({ socketState: "Error: connect ECONNREFUSED 127.0.0.1:443\n    at foo (bar.js:1:1)" })),
      readListener(unarmed({ grade: "TypeError: x is not a function" })),
      readListener(unarmed({ socketState: "connected" }))!.socketState,
      readListener(unarmed({ grade: "down" }))!.grade,
    ]).toEqual([undefined, undefined, "connected", "down"]);
  });

  it("refuses a death whose log tail is present but not text, never reading it as a log it could not read", () => {
    const death = { armId: "arm-1", atIso: "2026-11-02T19:00:00.000Z", reason: "socket-down" };
    expect(readListener(unarmed({ lastDeath: { ...death, lastLog: 7 } }))).toBe(undefined);
  });
});
