/**
 * `listen recover --scheduled`'s cycle — the recovery-stalled alert a stale watermark raises under a healthy
 * listener, and its silence with none armed. A real temp home, plain fake Slack API + write transport, an injected
 * clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { readSupervisorEventsTail } from "../../../../../../events/store.js";
import { unwrap } from "../../../../../../lib/result.js";
import { RECOVERY_INTERVAL_MS } from "../../../../../../live/listen/recoverSchedule.js";
import { writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { writeListenerArm, writeListenerHeartbeat } from "../../../../../../live/listen/supervise/store.js";
import { BASE_OPTIONS, fakeTransport, listOnlyC1, NOW_MS } from "../scheduledRecoverFakes.js";

/** A listener that grades `healthy` at NOW_MS: this very process, armed a minute ago, beating with the socket up. */
function armHealthyListener({ home }: { home: string }): void {
  const startedAtIso = new Date(NOW_MS - 60_000).toISOString();
  writeListenerArm({
    arm: {
      armId: "arm-live",
      logPath: join(home, "arm.log"),
      pid: process.pid,
      scope: { kind: "all" },
      startedAtIso,
      threadReplyChannels: [],
    },
    home,
  });
  writeListenerHeartbeat({
    heartbeat: {
      armId: "arm-live",
      lastSocketEventAtIso: new Date(NOW_MS - 1_000).toISOString(),
      pid: process.pid,
      socketState: "connected",
      socketStateSinceIso: startedAtIso,
      writtenAtIso: new Date(NOW_MS - 1_000).toISOString(),
    },
    home,
  });
}

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("publishes ONE recovery-stalled alert when a partial sweep leaves an hour-old watermark under a healthy listener", async () => {
    armHealthyListener({ home });
    // Seven hours stale at NOW_MS, and the sweep below fails transiently so it stays pinned.
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786604400.000000",
        nextDueAtIso: "2026-08-13T11:55:00.000Z",
        version: 2,
        threadCheckpoints: {},
      },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("ratelimited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    const first = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });
    const second = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      nowMs: () => NOW_MS + RECOVERY_INTERVAL_MS,
      transport: fakeTransport({ calls: [] }),
    });

    expect(first).toBe(EXIT_ERROR);
    expect(second).toBe(EXIT_ERROR);
    const events = unwrap(readSupervisorEventsTail({ home }));
    expect(events.map((event) => event.kind)).toEqual(["recovery-stalled"]);
    expect(events[0]!.why).toContain("2026-08-13T07:00:00.000Z");
    expect(events[0]!.why).toContain("listener is healthy");
  });

  it("publishes nothing about a stale watermark when no listener is armed", async () => {
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786604400.000000",
        nextDueAtIso: "2026-08-13T11:55:00.000Z",
        version: 2,
        threadCheckpoints: {},
      },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("ratelimited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    expect(unwrap(readSupervisorEventsTail({ home }))).toEqual([]);
  });
});
