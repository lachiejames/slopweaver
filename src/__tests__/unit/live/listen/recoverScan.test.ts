/**
 * `recoverSlackAsks`'s COVERAGE contract — how much of the requested breadth a manual pass actually read,
 * and how each unread channel is classified.
 *
 * The defect these cover: the scan once `unwrap`ed the pagination `Result` and re-caught the
 * throw as a string, so the `SlackPageError` code that separates "not a member, forever" from "failed this
 * time" was destroyed, and nothing counted what had been skipped at all. Every fake here is a plain typed
 * `SlackApi` object, per `testing.md`'s zero-mocks rule; a provider failure is a REJECTION shaped the way
 * `src/live/slack/pagination.ts` recognises, because that is the only form the real code ever sees.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import type { IgnoredAsk } from "../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import type { AskLifecycle, TerminalAskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { type RecoveryScanTarget, recoverSlackAsks } from "../../../../live/listen/recoverScan.js";
import { ManualRecoveryReadErrors } from "../../../../live/listen/recoverScanErrors.js";
import { SlackPageErrors } from "../../../../live/slack/errors.js";

const BOT_ID = "U_BOT";
const CARD_EVENT_TYPE = "slopweaver_card";
const SINCE_ISO = "2026-08-01T00:00:00.000Z";
const NO_IGNORES: ReadonlyMap<string, IgnoredAsk> = new Map();
const NO_IGNORED_CONVERSATIONS: ReadonlyMap<string, IgnoredConversation> = new Map();
const NO_LIFECYCLES: ReadonlyMap<string, AskLifecycle> = new Map();
const NO_TERMINAL: ReadonlyMap<string, TerminalAskLifecycleEvent> = new Map();

/** What one channel's `conversations.history` does when the fake is asked for it. */
type ChannelBehaviour =
  { readonly kind: "ok"; readonly messages: readonly unknown[] } | { readonly kind: "throws"; readonly reason: string };

/** An empty, perfectly readable channel. */
const READABLE: ChannelBehaviour = { kind: "ok", messages: [] };

/** The provider text `pagination.ts` decodes into `NOT_IN_CHANNEL` — the 107-channel incident's own code. */
const NOT_IN_CHANNEL: ChannelBehaviour = { kind: "throws", reason: "An API error occurred: not_in_channel" };

/** The provider text `pagination.ts` decodes into `CHANNEL_NOT_FOUND`. */
const CHANNEL_NOT_FOUND: ChannelBehaviour = { kind: "throws", reason: "An API error occurred: channel_not_found" };

/** An ordinary fault — nothing `permanentExclusion` recognises, so a coverage FAILURE rather than an exclusion. */
const RATE_LIMITED: ChannelBehaviour = { kind: "throws", reason: "An API error occurred: ratelimited" };

/** One channel message row tagging the bot, shaped the way `conversations.history` returns it. */
function tag({ ts }: { ts: string }): Record<string, unknown> {
  return { text: `<@${BOT_ID}> help`, ts, user: "U_ASKER" };
}

/** A typed `SlackApi` whose history/replies answer from a per-channel script and count their own calls. */
function fakeApi({
  behaviour,
  threadBehaviour = () => READABLE,
}: {
  behaviour: (args: { channel: string }) => ChannelBehaviour;
  threadBehaviour?: (args: { channel: string; ts: string }) => ChannelBehaviour;
}): {
  readonly api: SlackApi;
  readonly historyCalls: () => readonly string[];
  readonly replyCalls: () => readonly string[];
} {
  const historyCalls: string[] = [];
  const replyCalls: string[] = [];
  const api: SlackApi = {
    filesInfo: () => Promise.reject(new Error("not used")),
    grantedScopes: async () => [],
    history: async ({ channel }) => {
      historyCalls.push(channel);
      const outcome = behaviour({ channel });
      if (outcome.kind === "throws") {
        throw new Error(outcome.reason);
      }
      return { messages: outcome.messages };
    },
    listChannels: async () => ({ channels: [] }),
    listUsers: async () => ({ members: [] }),
    replies: async ({ channel, ts }) => {
      replyCalls.push(`${channel}:${ts}`);
      const outcome = threadBehaviour({ channel, ts });
      if (outcome.kind === "throws") {
        throw new Error(outcome.reason);
      }
      return { messages: outcome.messages };
    },
    workspaceUrl: async () => undefined,
  };
  return { api, historyCalls: () => historyCalls, replyCalls: () => replyCalls };
}

/** Run the real scan over `channels` with everything else held empty. */
async function scan({ api, channels }: { api: SlackApi; channels: readonly string[] }) {
  return recoverSlackAsks({
    allowedChannels: channels,
    api,
    botUserId: BOT_ID,
    cardEventType: CARD_EVENT_TYPE,
    channels: channels.map((id): RecoveryScanTarget => ({ id, kind: "explicit" })),
    ignored: NO_IGNORES,
    ignoredConversations: NO_IGNORED_CONVERSATIONS,
    lifecycles: NO_LIFECYCLES,
    selfBotId: undefined,
    sinceIso: SINCE_ISO,
    terminalByAsk: NO_TERMINAL,
  });
}

describe("ManualRecoveryReadErrors", () => {
  it("carries the pagination failure WHOLE, so its code survives to the classifier", () => {
    const cause = SlackPageErrors.notInChannel({ channel: "C1" });

    const error = ManualRecoveryReadErrors.history({ channel: "C1", error: cause });

    expect(error.code).toBe("HISTORY_READ_FAILED");
    expect(error.channel).toBe("C1");
    expect(error.error).toBe(cause);
    // The whole defect was a re-worded string: the message is the provider's own, not a reconstruction.
    expect(error.message).toBe(cause.message);
  });

  it("names the thread ROOT a failed thread read was for", () => {
    const cause = SlackPageErrors.threadNotFound({ channel: "C1", threadTs: "1786400000.000100" });

    const error = ManualRecoveryReadErrors.thread({ channel: "C1", error: cause, messageTs: "1786400000.000100" });

    expect(error.code).toBe("THREAD_READ_FAILED");
    expect(error.messageTs).toBe("1786400000.000100");
    expect(error.error).toBe(cause);
    expect(error.message).toBe(cause.message);
  });
});

describe("recoverSlackAsks — coverage counting", () => {
  it("counts a readable, empty channel as scanned with no diagnostics", async () => {
    const { api } = fakeApi({ behaviour: () => READABLE });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.requestedChannels).toBe(1);
    expect(result.scannedChannels).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.excludedChannels).toEqual([]);
  });

  it("reads a repeated channel id once and counts it once", async () => {
    const { api, historyCalls } = fakeApi({ behaviour: () => READABLE });

    const result = await scan({ api, channels: ["C1", "C1", "C1"] });

    expect(historyCalls()).toEqual(["C1"]);
    expect(result.requestedChannels).toBe(1);
    expect(result.scannedChannels).toBe(1);
  });

  it("classifies not_in_channel as a not-a-member EXCLUSION, never scanned", async () => {
    const { api } = fakeApi({ behaviour: () => NOT_IN_CHANNEL });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.excludedChannels).toEqual([{ channel: "C1", reason: "not-a-member" }]);
    expect(result.failures).toEqual([]);
    expect(result.scannedChannels).toBe(0);
    expect(result.requestedChannels).toBe(1);
  });

  it("classifies channel_not_found as a gone EXCLUSION, never scanned", async () => {
    const { api } = fakeApi({ behaviour: () => CHANNEL_NOT_FOUND });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.excludedChannels).toEqual([{ channel: "C1", reason: "gone" }]);
    expect(result.failures).toEqual([]);
    expect(result.scannedChannels).toBe(0);
  });

  it("classifies an ordinary fault as a history-stage FAILURE carrying the provider's own words", async () => {
    const { api } = fakeApi({ behaviour: () => RATE_LIMITED });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.excludedChannels).toEqual([]);
    expect(result.failures).toEqual([
      { channel: "C1", reason: "reading history for C1 failed: An API error occurred: ratelimited", stage: "history" },
    ]);
    expect(result.scannedChannels).toBe(0);
  });

  it("names the thread ROOT when a thread read fails, and stops that channel there", async () => {
    const ROOT_A = "1786400000.000100";
    const ROOT_B = "1786400000.000200";
    const { api, replyCalls } = fakeApi({
      behaviour: () => ({
        kind: "ok",
        messages: [
          { reply_count: 1, ts: ROOT_A, user: "U_ASKER" },
          { reply_count: 1, ts: ROOT_B, user: "U_ASKER" },
        ],
      }),
      threadBehaviour: ({ ts }) => (ts === ROOT_A ? RATE_LIMITED : READABLE),
    });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.failures).toEqual([
      {
        channel: "C1",
        messageTs: ROOT_A,
        reason: `reading thread ${ROOT_A} failed: An API error occurred: ratelimited`,
        stage: "thread",
      },
    ]);
    expect(result.scannedChannels).toBe(0);
    // The channel scan is ATOMIC: it stops at its first failed read rather than half-reading the channel.
    expect(replyCalls()).toEqual([`C1:${ROOT_A}`]);
  });

  it("classifies a thread-stage not_in_channel as an exclusion, like the history stage does", async () => {
    const ROOT = "1786400000.000100";
    const { api } = fakeApi({
      behaviour: () => ({ kind: "ok", messages: [{ reply_count: 1, ts: ROOT, user: "U_ASKER" }] }),
      threadBehaviour: () => NOT_IN_CHANNEL,
    });

    const result = await scan({ api, channels: ["C1"] });

    expect(result.excludedChannels).toEqual([{ channel: "C1", reason: "not-a-member" }]);
    expect(result.failures).toEqual([]);
  });

  it("keeps a readable channel's survivor when a SIBLING channel is unreadable", async () => {
    const TAGGED = "1786400000.000300";
    const { api } = fakeApi({
      behaviour: ({ channel }) =>
        channel === "C_OK" ? { kind: "ok", messages: [tag({ ts: TAGGED })] } : NOT_IN_CHANNEL,
      // A tagged root earns its own full thread read, so the fake echoes it the way Slack does.
      threadBehaviour: () => ({ kind: "ok", messages: [tag({ ts: TAGGED })] }),
    });

    const result = await scan({ api, channels: ["C_BAD", "C_OK"] });

    expect(result.report.recoverable.map((verdict) => verdict.candidate.messageTs)).toEqual([TAGGED]);
    expect(result.scannedChannels).toBe(1);
    expect(result.excludedChannels).toEqual([{ channel: "C_BAD", reason: "not-a-member" }]);
  });

  it("holds the invariant: every requested channel lands in exactly one bucket", async () => {
    const { api } = fakeApi({
      behaviour: ({ channel }) => {
        if (channel === "C_OK") {
          return READABLE;
        }
        if (channel === "C_GONE") {
          return CHANNEL_NOT_FOUND;
        }
        return RATE_LIMITED;
      },
    });

    const result = await scan({ api, channels: ["C_OK", "C_GONE", "C_SLOW"] });

    expect(result.requestedChannels).toBe(
      result.scannedChannels + result.failures.length + result.excludedChannels.length,
    );
    expect(result.scannedChannels).toBe(1);
    expect(result.excludedChannels.length).toBe(1);
    expect(result.failures.length).toBe(1);
  });
});

describe("recoverSlackAsks — the pagination incident, as a witness", () => {
  /** The incident's own two runs: 121 requested with 107 unreadable, and the 14 readable ones alone. */
  const UNREADABLE = Array.from({ length: 107 }, (_value, index) => `C_BAD_${String(index)}`);
  const READABLE_IDS = Array.from({ length: 14 }, (_value, index) => `C_OK_${String(index)}`);

  it("reports the union pass PARTIAL, naming all 107 it never read", async () => {
    const { api, historyCalls } = fakeApi({
      behaviour: ({ channel }) => (channel.startsWith("C_OK_") ? READABLE : NOT_IN_CHANNEL),
    });

    const result = await scan({ api, channels: [...UNREADABLE, ...READABLE_IDS] });

    expect(result.requestedChannels).toBe(121);
    expect(result.scannedChannels).toBe(14);
    expect(result.excludedChannels.length).toBe(107);
    expect(result.excludedChannels.map((excluded) => excluded.channel)).toEqual(UNREADABLE);
    expect(result.failures).toEqual([]);
    expect(result.report.recoverable).toEqual([]);
    expect(historyCalls().length).toBe(121);
  });

  it("reports the 14-channel pass COMPLETE — the run whose stderr was 0 bytes", async () => {
    const { api } = fakeApi({ behaviour: () => READABLE });

    const result = await scan({ api, channels: READABLE_IDS });

    expect(result.requestedChannels).toBe(14);
    expect(result.scannedChannels).toBe(14);
    expect(result.excludedChannels).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.report.recoverable).toEqual([]);
  });
});
