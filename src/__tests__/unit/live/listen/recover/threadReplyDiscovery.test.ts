/**
 * Dropped-tag recovery's effectful scan finding a tagged REPLY inside a thread — over a plain typed `SlackApi`
 * fake, never a mock or the network: one read per thread, the echoed root never doubled, and each reply judged
 * by its own exact identity.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import type { RecordedAskIdentity } from "../../../../../live/ask/identity.js";
import { type IgnoredAsk, ignoredAskKey } from "../../../../../live/ask/ignore.js";
import { recoverSlackAsks } from "../../../../../live/listen/recoverScan.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import { CARD_EVENT_TYPE, NO_IGNORED_CONVERSATIONS, NO_IGNORES, NO_LIFECYCLES, NO_TERMINAL } from "./fixtures.js";

describe("recoverSlackAsks — thread-reply discovery", () => {
  const BOT_ID = "U_BOT";
  const CHANNEL = "C1";
  const SINCE_ISO = "2026-08-01T00:00:00.000Z";
  // Reuses NO_IGNORES/NO_LIFECYCLES/NO_TERMINAL from `./fixtures.ts` — same empty maps.

  /** The page index a thread's next `replies` call reads, from zero, advancing that thread's cursor past it. */
  function nextPageIndex({ indexByThread, ts }: { indexByThread: Map<string, number>; ts: string }): number {
    const index = indexByThread.get(ts);
    if (index === undefined) {
      indexByThread.set(ts, 1);
      return 0;
    }
    indexByThread.set(ts, index + 1);
    return index;
  }

  /** A full `SlackApi` fake — only `history`/`replies` do real work; everything else is unused-but-typed. */
  function fakeApi({
    historyMessages,
    repliesPages,
  }: {
    historyMessages: readonly unknown[];
    repliesPages: (args: { ts: string }) => readonly unknown[][];
  }): { readonly api: SlackApi; readonly repliesCallCount: () => number } {
    let repliesCalls = 0;
    const pageIndexByThread = new Map<string, number>();
    const api: SlackApi = {
      filesInfo: () => Promise.reject(new Error("not used")),
      grantedScopes: async () => [],
      history: async () => ({ messages: historyMessages }),
      listChannels: async () => ({ channels: [] }),
      listUsers: async () => ({ members: [] }),
      replies: async ({ ts }) => {
        repliesCalls += 1;
        const pages = repliesPages({ ts });
        const page = pages[nextPageIndex({ indexByThread: pageIndexByThread, ts })];
        if (page === undefined) {
          return { messages: [] };
        }
        return { messages: page };
      },
      workspaceUrl: async () => undefined,
    };
    return { api, repliesCallCount: () => repliesCalls };
  }

  /** One channel message row, tagging the bot, shaped the way `conversations.history`/`.replies` return it. */
  function tag({
    ts,
    threadTs,
    text = "help",
  }: {
    ts: string;
    threadTs?: string;
    text?: string;
  }): Record<string, unknown> {
    return {
      text: `<@${BOT_ID}> ${text}`,
      ts,
      user: "U_ASKER",
      ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
    };
  }

  it("finds a tagged reply inside a thread whose root never addressed the bot", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000200";
    const { api } = fakeApi({
      historyMessages: [{ reply_count: 1, text: "an ordinary update", ts: ROOT, user: "U_ASKER" }],
      repliesPages: () => [[{ ts: ROOT, user: "U_ASKER" }, tag({ threadTs: ROOT, ts: REPLY })]],
    });

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    const recoveredTs = result.report.recoverable.map((v) => v.candidate.messageTs);
    expect(recoveredTs).toEqual([REPLY]);
    expect(result.report.recoverable[0]?.candidate.threadTs).toBe(ROOT);
  });

  it("never duplicates the echoed root when it is repeated across reply pages", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000200";
    const { api } = fakeApi({
      historyMessages: [{ reply_count: 1, ts: ROOT, user: "U_ASKER" }],
      repliesPages: () => [
        [{ ts: ROOT, user: "U_ASKER" }, tag({ threadTs: ROOT, ts: REPLY }), { ts: ROOT, user: "U_ASKER" }],
      ],
    });

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    const withMessageTs = result.report.verdicts.filter((v) => v.candidate.messageTs === ROOT);
    expect(withMessageTs.length).toBe(1);
  });

  it("fetches one thread once and emits two exact reply candidates", async () => {
    const ROOT = "1786400000.000100";
    const REPLY_A = "1786400000.000200";
    const REPLY_B = "1786400000.000300";
    const { api, repliesCallCount } = fakeApi({
      historyMessages: [{ reply_count: 2, ts: ROOT, user: "U_ASKER" }],
      repliesPages: () => [
        [{ ts: ROOT, user: "U_ASKER" }, tag({ threadTs: ROOT, ts: REPLY_A }), tag({ threadTs: ROOT, ts: REPLY_B })],
      ],
    });

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(repliesCallCount()).toBe(1);
    const recoveredTs = result.report.recoverable.map((v) => v.candidate.messageTs).toSorted();
    expect(recoveredTs).toEqual([REPLY_A, REPLY_B]);
  });

  it("marks a reply already-answered when a real answer's metadata names exactly that reply", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000200";
    const askIdentity: RecordedAskIdentity = { channel: CHANNEL, messageTs: REPLY, quality: "exact", threadTs: ROOT };
    const { api } = fakeApi({
      historyMessages: [{ reply_count: 2, ts: ROOT, user: "U_ASKER" }],
      repliesPages: () => [
        [
          { ts: ROOT, user: "U_ASKER" },
          tag({ threadTs: ROOT, ts: REPLY }),
          {
            metadata: {
              event_payload: { artifactFingerprint: "fp", askIdentity, renderer: "r" },
              event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
            },
            ts: "1786400000.000400",
            user: "U_BOT",
          },
        ],
      ],
    });

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    const verdict = result.report.verdicts.find((v) => v.candidate.messageTs === REPLY);
    expect(verdict?.exclusions).toEqual(["already-answered"]);
  });

  it("excludes a reply older than the --since cutoff as too-old, never silently dropped", async () => {
    const ROOT = "1786400000.000100";
    const EARLY_REPLY = "1785000000.000200";
    const { api } = fakeApi({
      historyMessages: [{ reply_count: 1, ts: ROOT, user: "U_ASKER" }],
      repliesPages: () => [[{ ts: ROOT, user: "U_ASKER" }, tag({ threadTs: ROOT, ts: EARLY_REPLY })]],
    });

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    const verdict = result.report.verdicts.find((v) => v.candidate.messageTs === EARLY_REPLY);
    expect(verdict?.exclusions).toEqual(["too-old"]);
    expect(result.report.recoverable.some((v) => v.candidate.messageTs === EARLY_REPLY)).toBe(false);
  });

  it("an ignored root does not suppress a distinct tagged reply in the same thread", async () => {
    const ROOT = "1786400000.000100";
    const REPLY = "1786400000.000200";
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([
      [
        ignoredAskKey({ askIdentity: { channel: CHANNEL, messageTs: ROOT } }),
        { channel: CHANNEL, ignoredAtIso: SINCE_ISO, messageTs: ROOT, reason: "n/a", schemaVersion: 1 },
      ],
    ]);
    const { api } = fakeApi({
      historyMessages: [{ ...tag({ text: "casual chat", ts: ROOT }), reply_count: 1 }],
      repliesPages: () => [[tag({ text: "casual chat", ts: ROOT }), tag({ threadTs: ROOT, ts: REPLY })]],
    });
    // The root ADDRESSES the bot and is ignored, so it would need no read on its own account — but it also
    // advertises a real reply via `reply_count`, and that hint is what forces the read: the ROOT's ignore
    // status must never suppress discovering the REPLY.

    const result = await recoverSlackAsks({
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      allowedChannels: [CHANNEL],
      channels: [{ id: CHANNEL, kind: "explicit" }],
      ignored,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    const rootVerdict = result.report.verdicts.find((v) => v.candidate.messageTs === ROOT);
    expect(rootVerdict?.exclusions).toEqual(["deliberately-ignored"]);
    expect(result.report.recoverable.map((v) => v.candidate.messageTs)).toEqual([REPLY]);
  });
});
