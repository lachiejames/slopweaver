/**
 * Dropped-tag recovery's effectful scan, where breadth is not permission: what the scan opens is the channel list it
 * was handed, what it answers is eligibility, and a surface is read off metadata, never guessed from an id — over
 * a plain typed `SlackApi` fake, never a mock or the network.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { recoverSlackAsks } from "../../../../../live/listen/recoverScan.js";
import { CARD_EVENT_TYPE, NO_IGNORED_CONVERSATIONS, NO_IGNORES, NO_LIFECYCLES, NO_TERMINAL } from "./fixtures.js";

describe("recoverSlackAsks — breadth is not permission", () => {
  const BOT_ID = "U_BOT";
  const SINCE_ISO = "2026-08-01T00:00:00.000Z";
  /** The private channel an earlier widened pass was blind to, by its real workspace id. */
  const ACME_BUGS = "C0SYN000011";
  /** One of the thirteen ids every live-loop handover doc hand-carried; it never named `ACME_BUGS`. */
  const TYPED = "C0SYN000002";
  const ASK_TS = "1786400000.000100";

  /** A seam whose history answers only for the channels named, and refuses anything else by name. */
  function apiOver({ messagesByChannel }: { messagesByChannel: Readonly<Record<string, readonly unknown[]>> }): {
    readonly api: SlackApi;
    readonly historyChannels: () => readonly string[];
  } {
    const asked: string[] = [];
    const api: SlackApi = {
      filesInfo: () => Promise.reject(new Error("not used")),
      grantedScopes: async () => [],
      history: async ({ channel }) => {
        asked.push(channel);
        const messages = messagesByChannel[channel];
        if (messages === undefined) {
          return { messages: [] };
        }
        return { messages };
      },
      listChannels: async () => ({ channels: [] }),
      listUsers: async () => ({ members: [] }),
      replies: async ({ ts }) => ({ messages: [{ text: `<@${BOT_ID}> is the queue draining?`, ts, user: "U_ASKER" }] }),
      workspaceUrl: async () => undefined,
    };
    return { api, historyChannels: () => asked };
  }

  const ACME_BUGS_TAG = { text: `<@${BOT_ID}> is the queue draining?`, ts: ASK_TS, user: "U_ASKER" };

  it("never opens the private channel when breadth is the hand-carried thirteen", async () => {
    const { api, historyChannels } = apiOver({ messagesByChannel: { [ACME_BUGS]: [ACME_BUGS_TAG] } });

    const result = await recoverSlackAsks({
      allowedChannels: [TYPED],
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      channels: [{ id: TYPED, kind: "explicit" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(historyChannels()).toEqual([TYPED]);
    expect(result.requestedChannels).toBe(1);
    expect(result.report.verdicts).toEqual([]);
  });

  it("opens it once breadth is discovered membership, and still refuses to answer there", async () => {
    const { api, historyChannels } = apiOver({ messagesByChannel: { [ACME_BUGS]: [ACME_BUGS_TAG] } });

    const result = await recoverSlackAsks({
      allowedChannels: [TYPED],
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      channels: [
        { channel: { id: TYPED, isMember: true }, kind: "discovered" },
        { channel: { id: ACME_BUGS, isMember: true, isPrivate: true }, kind: "discovered" },
      ],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(historyChannels()).toEqual([TYPED, ACME_BUGS]);
    expect(result.scannedChannels).toBe(2);
    expect(result.report.verdicts.map((verdict) => verdict.candidate.messageTs)).toEqual([ASK_TS]);
    expect(result.report.verdicts[0]!.exclusions).toEqual(["wrong-place"]);
    expect(result.report.recoverable).toEqual([]);
  });

  it("recovers the same ask the moment eligibility names that channel too", async () => {
    const { api } = apiOver({ messagesByChannel: { [ACME_BUGS]: [ACME_BUGS_TAG] } });

    const result = await recoverSlackAsks({
      allowedChannels: [TYPED, ACME_BUGS],
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      channels: [{ channel: { id: ACME_BUGS, isMember: true, isPrivate: true }, kind: "discovered" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(result.report.recoverable.map((verdict) => verdict.candidate.messageTs)).toEqual([ASK_TS]);
  });

  /**
   * Slack issues a group DM a `C…` id, so the id-prefix guess calls one a channel — and a channel IS
   * addressable, while a group DM deliberately is not (`recover.ts#notAddressedReason`). The two arms below
   * differ in nothing but where the surface came from, which is what makes this falsifiable.
   */
  it("reads a group DM's surface off its metadata, where the C-prefixed id alone would call it a channel", async () => {
    const MPIM = "C_MPIM";
    const messagesByChannel = {
      [MPIM]: [{ text: `<@${BOT_ID}> is the queue draining?`, ts: ASK_TS, user: "U_ASKER" }],
    };
    const shared = {
      allowedChannels: [MPIM],
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    };

    const discovered = await recoverSlackAsks({
      ...shared,
      api: apiOver({ messagesByChannel }).api,
      channels: [{ channel: { id: MPIM, isMember: true, isMpim: true }, kind: "discovered" }],
    });
    const guessed = await recoverSlackAsks({
      ...shared,
      api: apiOver({ messagesByChannel }).api,
      channels: [{ id: MPIM, kind: "explicit" }],
    });

    expect(discovered.report.verdicts.map((verdict) => verdict.candidate.surface)).toEqual(["group"]);
    expect(discovered.report.verdicts[0]!.exclusions).toEqual(["not-addressed"]);
    expect(guessed.report.verdicts.map((verdict) => verdict.candidate.surface)).toEqual(["channel"]);
    expect(guessed.report.recoverable.map((verdict) => verdict.candidate.messageTs)).toEqual([ASK_TS]);
  });

  it("fails the channel rather than guessing when discovered metadata contradicts itself", async () => {
    const { api, historyChannels } = apiOver({ messagesByChannel: {} });

    const result = await recoverSlackAsks({
      allowedChannels: [TYPED],
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      channels: [{ channel: { id: "C_BOTH", isIm: true, isMpim: true }, kind: "discovered" }],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(historyChannels()).toEqual([]);
    expect(result.requestedChannels).toBe(1);
    expect(result.scannedChannels).toBe(0);
    expect(result.failures.map((failure) => failure.stage)).toEqual(["history"]);
    expect(result.failures[0]!.reason).toContain("contradictory metadata");
  });

  it("keeps an unreadable channel out of the scanned count while the others still report", async () => {
    const api: SlackApi = {
      filesInfo: () => Promise.reject(new Error("not used")),
      grantedScopes: async () => [],
      history: async ({ channel }) => {
        if (channel === ACME_BUGS) {
          throw new Error("not_in_channel");
        }
        return { messages: [] };
      },
      listChannels: async () => ({ channels: [] }),
      listUsers: async () => ({ members: [] }),
      replies: async () => ({ messages: [] }),
      workspaceUrl: async () => undefined,
    };

    const result = await recoverSlackAsks({
      allowedChannels: [TYPED],
      api,
      botUserId: BOT_ID,
      cardEventType: CARD_EVENT_TYPE,
      channels: [
        { id: TYPED, kind: "explicit" },
        { id: ACME_BUGS, kind: "explicit" },
      ],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      selfBotId: undefined,
      sinceIso: SINCE_ISO,
      terminalByAsk: NO_TERMINAL,
    });

    expect(result.requestedChannels).toBe(2);
    expect(result.scannedChannels).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.excludedChannels).toEqual([{ channel: ACME_BUGS, reason: "not-a-member" }]);
  });
});
