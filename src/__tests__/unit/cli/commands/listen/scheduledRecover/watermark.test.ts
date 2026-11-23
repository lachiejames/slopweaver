/**
 * `listen recover --scheduled`'s cycle — the watermark a complete sweep advances and a partial one retains. A real
 * temp home, plain fake Slack API + write transport, an injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecoverySweepState, writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, fakeTransport, listOnlyC1 } from "../scheduledRecoverFakes.js";
import { emptyApi } from "./harness.js";

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("bootstraps, scans nothing, and persists a complete watermark on an empty workspace", async () => {
    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: emptyApi(),
      home,
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const state = readRecoverySweepState({ home });
    expect(state.isOk()).toBe(true);
  });

  it("advances completedThroughTs to the window's latest bound on a complete sweep", async () => {
    await runScheduledRecover({ ...BASE_OPTIONS, api: emptyApi(), home, transport: fakeTransport({ calls: [] }) });

    const state = readRecoverySweepState({ home });
    expect(state.isOk()).toBe(true);
    expect(unwrap(state)!.completedThroughTs).toBe("1786622400.000000");
  });

  it("retains the previous watermark, refuses completion, and captures NOTHING on a partial (failed) channel read", async () => {
    writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786500000.000000", nextDueAtIso: "2026-08-13T11:55:00.000Z", version: 1 },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };
    const calls: string[] = [];

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls }) });

    expect(code).toBe(EXIT_ERROR);
    expect(calls).toEqual([]);
    const state = readRecoverySweepState({ home });
    expect(state.isOk()).toBe(true);
    expect(unwrap(state)!.completedThroughTs).toBe("1786500000.000000");
  });

  it("a partial NON-migrating sweep retains the previous thread-checkpoint inventory, discarding this attempt's own", async () => {
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786500000.000000",
        nextDueAtIso: "2026-08-13T11:55:00.000Z",
        threadCheckpoints: { "C1:1786400000.000100": { cursorTs: "1786400000.000200" } },
        version: 2,
      },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      listChannels: listOnlyC1,
      replies: async () => ({ messages: [] }),
    };

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    expect(code).toBe(EXIT_ERROR);
    const state = unwrap(readRecoverySweepState({ home }));
    expect(state).toEqual({
      completedThroughTs: "1786500000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: { "C1:1786400000.000100": { cursorTs: "1786400000.000200" } },
      version: 2,
    });
  });
});
