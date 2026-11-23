/**
 * The background phase's incremental polling: when a remembered or advertised thread is read at all, from which
 * cursor, in what order, and how far a fresh in-window reply moves that cursor.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import { classificationFor, tagRow, WINDOW } from "./fixtures.js";

describe("recoverWorkspace — background thread-checkpoint polling", () => {
  it("discovers a reply via the background phase when its unaddressed root only advertises reply_count", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000200";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({
        messages: [{ reply_count: 1, text: "an update", ts: ROOT, user: "U_ASKER" }],
      }),
      replies: async ({ oldest, ts }) => {
        expect(ts).toBe(ROOT);
        // The root's own registration seeded the cursor, so the poll starts AT the root rather than at the
        // epoch — nothing at or before a root can be a reply, so this reads strictly fewer rows for the
        // same answer.
        expect(oldest).toBe(ROOT);
        return { messages: [{ ts: ROOT, user: "U_ASKER" }, tagRow({ ts: REPLY })] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: WINDOW,
    });

    expect(result.candidates.some((c) => c.messageTs === REPLY)).toBe(true);
    expect(result.threadCoverage.backgroundReads).toBe(1);
    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(REPLY);
  });

  it("makes zero replies calls when a visible root's latest_reply matches its checkpoint's cursor exactly", async () => {
    const ROOT = "1786400000.000100";
    let repliesCalled = false;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({
        messages: [{ latest_reply: "1786400000.000200", reply_count: 1, text: "no tag", ts: ROOT, user: "U_ASKER" }],
      }),
      replies: async () => {
        repliesCalled = true;
        return { messages: [] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000200" } },
      window: WINDOW,
    });

    expect(repliesCalled).toBe(false);
    expect(result.threadCoverage.foregroundReads).toBe(0);
    expect(result.threadCoverage.skippedByLatestReply).toBe(1);
    expect(result.threadCoverage.backgroundReads).toBe(0);
  });

  it("triggers an incremental call, from the checkpoint's cursor, when a visible root's latest_reply is newer", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000300";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({
        messages: [{ latest_reply: "1786400000.000300", reply_count: 2, text: "no tag", ts: ROOT, user: "U_ASKER" }],
      }),
      replies: async ({ oldest }) => {
        expect(oldest).toBe("1786400000.000200");
        return { messages: [{ ts: REPLY, ...tagRow({ ts: REPLY }) }] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000200" } },
      window: WINDOW,
    });

    expect(result.candidates.some((c) => c.messageTs === REPLY)).toBe(true);
    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(REPLY);
  });

  it("polls an old checkpoint whose root has left the current history window, with exactly its stored cursor", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000300";
    const seenOldest: string[] = [];
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async ({ oldest }) => {
        seenOldest.push(oldest);
        return { messages: [tagRow({ ts: REPLY })] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000200" } },
      window: WINDOW,
    });

    expect(seenOldest).toEqual(["1786400000.000200"]);
    expect(result.candidates.some((c) => c.messageTs === REPLY)).toBe(true);
    expect(result.threadCoverage.backgroundReads).toBe(1);
    expect(result.threadCoverage.deferred).toBe(0);
  });

  it("filters an inclusive/repeated boundary row and advances the cursor only to the newest fresh pre-window row", async () => {
    const ROOT = "1786400000.000100";
    const CURSOR = "1786400000.000200";
    const FRESH = "1786400000.000300";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => ({
        messages: [
          { ts: CURSOR, user: "U_ASKER" }, // the echoed cursor row itself — must be dropped, not re-classified
          tagRow({ ts: FRESH }),
        ],
      }),
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: CURSOR } },
      window: WINDOW,
    });

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.messageTs).toBe(FRESH);
    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(FRESH);
  });

  it("keeps a post-window reply's answer metadata usable while excluding it as a candidate and a cursor advance", async () => {
    const ROOT = "1786400000.000100";
    const CURSOR = "1786400000.000200";
    const POST_WINDOW = "1786700000.000100"; // strictly after WINDOW.latestExclusiveTs
    const askIdentity = { channel: "C1", messageTs: "1786400000.000900", quality: "exact", threadTs: ROOT };
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => ({
        messages: [
          {
            metadata: {
              event_payload: { artifactFingerprint: "fp", askIdentity, renderer: "r" },
              event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
            },
            ts: POST_WINDOW,
            user: "U_BOT",
          },
        ],
      }),
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: CURSOR } },
      window: WINDOW,
    });

    expect(result.candidates).toEqual([]);
    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe(CURSOR);
  });

  it("polls its due threads oldest-check-first, deterministically", async () => {
    const checkpoints = {
      "C1:1786400000.000100": { cursorTs: "1786400000.000200", lastCheckedAtIso: "2026-08-01T00:00:00.000Z" },
      "C1:1786400000.000300": { cursorTs: "1786400000.000400", lastCheckedAtIso: "2026-08-11T00:00:00.000Z" },
      "C1:1786400000.000500": { cursorTs: "1786400000.000600", lastCheckedAtIso: "2026-08-12T00:00:00.000Z" },
    };
    const polled: string[] = [];
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async ({ ts }) => {
        polled.push(ts);
        return { messages: [] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: checkpoints,
      window: WINDOW,
    });

    expect(polled).toEqual(["1786400000.000100", "1786400000.000300", "1786400000.000500"]);
    expect(result.threadCoverage.backgroundReads).toBe(3);
    expect(result.threadCoverage.deferred).toBe(0);
  });
});
