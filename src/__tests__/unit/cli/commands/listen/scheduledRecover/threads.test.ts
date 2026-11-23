/**
 * `listen recover --scheduled`'s cycle — the remembered-thread inventory: a thread in a left channel, a deleted
 * root, and a fresh reply under a root that has left the history window. A real temp home, plain fake Slack API +
 * write transport, an injected clock; never a real network call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runScheduledRecover } from "../../../../../../cli/commands/listen/scheduledRecover.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";
import { unwrap } from "../../../../../../lib/result.js";
import { RECOVERY_INTERVAL_MS } from "../../../../../../live/listen/recoverSchedule.js";
import { readRecoverySweepState, writeRecoverySweepState } from "../../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, BOT, fakeTransport, listOnlyC1, NOW_MS } from "../scheduledRecoverFakes.js";

/** A read seam whose only thread poll answers not_in_channel — a live shape. */
function leftChannelApi(): Pick<SlackApi, "history" | "replies" | "listChannels"> {
  return {
    history: async () => ({ messages: [] }),
    listChannels: listOnlyC1,
    replies: async () => {
      throw new Error("An API error occurred: not_in_channel");
    },
  };
}

describe("runScheduledRecover", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-recover-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("completes, names the excluded channel, and ADVANCES the watermark when a remembered thread answers not_in_channel", async () => {
    // A live shape: a V2 inventory still holding a thread in a channel the bot had left.
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786500000.000000",
        nextDueAtIso: "2026-08-13T11:55:00.000Z",
        threadCheckpoints: { "C_LEFT:1786400000.000100": { cursorTs: "1786400000.000105" } },
        version: 2,
      },
    });

    const code = await runScheduledRecover({
      ...BASE_OPTIONS,
      api: leftChannelApi(),
      home,
      transport: fakeTransport({ calls: [] }),
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const state = unwrap(readRecoverySweepState({ home }))!;
    expect(state.completedThroughTs).toBe("1786622400.000000");
    expect(state.version === 2 && state.threadCheckpoints).toEqual({
      "C_LEFT:1786400000.000100": { cursorTs: "1786400000.000105" },
    });
  });

  it("completes, ADVANCES the watermark and persists the inventory WITHOUT a remembered root that was deleted", async () => {
    // A live shape: a reply-less root registration whose root was then deleted answered
    // thread_not_found on every poll, and 3 of 4 due sweeps went partial with nothing recovered.
    writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786500000.000000",
        nextDueAtIso: "2026-08-13T11:55:00.000Z",
        threadCheckpoints: { "C1:1786400000.000100": { cursorTs: "1786400000.000100" } },
        version: 2,
      },
    });
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () => ({ messages: [] }),
      listChannels: listOnlyC1,
      replies: async () => {
        throw new Error("An API error occurred: thread_not_found");
      },
    };

    const code = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readRecoverySweepState({ home }))).toEqual({
      completedThroughTs: "1786622400.000000",
      nextDueAtIso: expect.any(String),
      threadCheckpoints: {},
      version: 2,
    });
  });

  it("a second sweep discovers a fresh reply in a root that has already left the history window", async () => {
    const ROOT = "1786400000.000100";
    const NEW_REPLY = "1786622500.000000";
    let sweep = 1;
    const api: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
      history: async () =>
        sweep === 1 ? { messages: [{ text: `<@${BOT}> help`, ts: ROOT, user: "U_ASKER" }] } : { messages: [] },
      listChannels: listOnlyC1,
      replies: async () =>
        sweep === 1
          ? { messages: [{ ts: ROOT, user: "U_ASKER" }] }
          : { messages: [{ text: `<@${BOT}> a fresh reply`, ts: NEW_REPLY, user: "U_ASKER" }] },
    };

    const first = await runScheduledRecover({ ...BASE_OPTIONS, api, home, transport: fakeTransport({ calls: [] }) });
    expect(first).toBe(EXIT_OK);

    sweep = 2;
    const second = await runScheduledRecover({
      ...BASE_OPTIONS,
      api,
      home,
      nowMs: () => NOW_MS + RECOVERY_INTERVAL_MS,
      transport: fakeTransport({ calls: [] }),
    });

    expect(second).toBe(EXIT_OK);
    const state = unwrap(readRecoverySweepState({ home }));
    expect(state).toEqual({
      completedThroughTs: "1786622700.000000",
      nextDueAtIso: "2026-08-13T12:10:00.000Z",
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: NEW_REPLY, lastCheckedAtIso: "2026-08-13T12:05:00.000Z" } },
      version: 2,
    });
  });
});
