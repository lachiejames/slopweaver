import { describe, expect, it } from "vitest";
import type { SlackApi, SlackMessagesPage } from "../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { readPriorAsk } from "../../../../live/slack/priorAskRead.js";

const ROOT = "1789000000.000100";
const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";
const THREAD: readonly unknown[] = [
  { text: "is the key spend expected?", thread_ts: ROOT, ts: ROOT, user: "U0SYNADAOWN" },
  { text: "expected, the batch job", thread_ts: ROOT, ts: "1789000100.000100", user: "U0JONAH" },
];
/** The channel's top level after ours: a person's answer, and an app's post. */
const TOP_LEVEL: readonly unknown[] = [
  { app_id: "A0LINEAR", bot_id: "B0LINEAR", text: "issue synced", ts: "1789000060.000100" },
  { text: "it's the batch job", ts: "1789000050.000100", user: "U0ADA" },
];

/**
 * A Slack seam serving one thread page and one history page, recording each call.
 *
 * @param page the replies page served
 * @param history the history page served
 * @param calls where each call is written
 * @returns the seam
 */
function api({
  page,
  history = { messages: [] },
  calls,
}: {
  page: SlackMessagesPage;
  history?: SlackMessagesPage;
  calls: string[];
}): Pick<SlackApi, "replies" | "history"> {
  return {
    history: async ({ channel, oldest, latest }) => {
      calls.push(`history:${channel}:${oldest}:${latest}`);
      return history;
    },
    replies: async ({ channel, ts }) => {
      calls.push(`replies:${channel}:${ts}`);
      return page;
    },
  };
}

describe("readPriorAsk", () => {
  it("reads the thread the link names, then the channel's top level after ours, kept apart", async () => {
    const calls: string[] = [];
    const read = await readPriorAsk({
      deps: {
        api: api({ calls, history: { messages: TOP_LEVEL }, page: { hasMore: false, messages: THREAD } }),
        nowMs: () => 1_789_000_200_000,
      },
      permalink: PERMALINK,
    });
    expect(read.isOk()).toBe(true);
    const { addressedTs, messages, channelTopLevel } = unwrap(read);
    expect(addressedTs).toBe(ROOT);
    expect(messages.map((message) => [message.ts, message.userId, message.text])).toEqual([
      [ROOT, "U0SYNADAOWN", "is the key spend expected?"],
      ["1789000100.000100", "U0JONAH", "expected, the batch job"],
    ]);
    expect(channelTopLevel).toEqual([
      { appId: "A0LINEAR", botId: "B0LINEAR", text: "issue synced", ts: "1789000060.000100" },
      { text: "it's the batch job", ts: "1789000050.000100", userId: "U0ADA" },
    ]);
    // A second past now: Slack's `latest` is exclusive, so a post at now itself is still read.
    expect(calls).toEqual([`replies:C0ISO:${ROOT}`, `history:C0ISO:${ROOT}:1789000201.000000`]);
  });

  it("bounds the channel read at four days after ours when now is later, a second past the cap", async () => {
    const calls: string[] = [];
    await readPriorAsk({
      deps: { api: api({ calls, page: { hasMore: false, messages: THREAD } }), nowMs: () => 1_789_400_000_000 },
      permalink: PERMALINK,
    });
    expect(calls.at(-1)).toBe(`history:C0ISO:${ROOT}:1789345601.000100`);
  });

  it("builds the cap off our ts to the microsecond, rounding neither down nor up", async () => {
    /**
     * The `latest` the channel read was bounded by, for an ask at one ts.
     *
     * @param ask our message's ts
     * @returns the history call's latest bound
     */
    const latestFor = async ({ ask }: { ask: string }): Promise<string | undefined> => {
      const calls: string[] = [];
      await readPriorAsk({
        deps: {
          api: api({
            calls,
            page: {
              hasMore: false,
              messages: [{ text: "who owns it?", thread_ts: ask, ts: ask, user: "U0SYNADAOWN" }],
            },
          }),
          nowMs: () => 1_789_400_000_000,
        },
        permalink: `https://acme.slack.com/archives/C0ISO/p${ask.replace(".", "")}`,
      });
      return calls.at(-1)?.split(":").at(-1);
    };
    // .000499 rounds DOWN to the millisecond, .999999 rounds UP to the next second: both stay exact.
    expect([await latestFor({ ask: "1789000000.000499" }), await latestFor({ ask: "1789000000.999999" })]).toEqual([
      "1789345601.000499",
      "1789345601.999999",
    ]);
  });

  it("refuses a channel top level Slack says has more with no cursor, never reading it as quiet", async () => {
    const read = await readPriorAsk({
      deps: {
        api: api({
          calls: [],
          history: { hasMore: true, messages: TOP_LEVEL },
          page: { hasMore: false, messages: THREAD },
        }),
        nowMs: () => 1_789_000_200_000,
      },
      permalink: PERMALINK,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).join(" ")).toContain("the channel's top level after ours could not be read whole");
  });

  it("refuses a channel top level holding a message with no ts, since that one may be the answer", async () => {
    const read = await readPriorAsk({
      deps: {
        api: api({
          calls: [],
          history: { messages: [...TOP_LEVEL, { text: "unplaceable", user: "U0ADA" }] },
          page: { hasMore: false, messages: THREAD },
        }),
        nowMs: () => 1_789_000_200_000,
      },
      permalink: PERMALINK,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(["the channel's top level returned 1 message(s) with no Slack ts"]);
  });

  it("reads a one-to-one DM's top level into the conversation, and no channel top level", async () => {
    const calls: string[] = [];
    const dmThread = [{ text: "is it expected?", ts: ROOT, user: "U0SYNADAOWN" }];
    const read = await readPriorAsk({
      deps: {
        api: api({
          calls,
          history: { messages: [{ text: "yes", ts: "1789000100.000100", user: "U0JONAH" }] },
          page: { hasMore: false, messages: dmThread },
        }),
        nowMs: () => 1_789_000_200_000,
      },
      permalink: "https://acme.slack.com/archives/D0DM/p1789000000000100",
    });
    expect(read.isOk()).toBe(true);
    const { messages, channelTopLevel } = unwrap(read);
    expect([messages.map((message) => message.text), channelTopLevel, calls.length]).toEqual([
      ["is it expected?", "yes"],
      [],
      2,
    ]);
  });

  it("refuses a thread Slack says has more with no cursor to read it, rather than reading a prefix", async () => {
    const read = await readPriorAsk({
      deps: { api: api({ calls: [], page: { hasMore: true, messages: THREAD } }), nowMs: () => 1_789_000_200_000 },
      permalink: PERMALINK,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).join(" ")).toContain("has_more");
  });

  it("refuses a link that names no Slack message, and reads nothing", async () => {
    const calls: string[] = [];
    const read = await readPriorAsk({
      deps: { api: api({ calls, page: { messages: THREAD } }), nowMs: () => 1_789_000_200_000 },
      permalink: "https://example.com/not-slack",
    });
    expect(read.isErr()).toBe(true);
    expect([unwrapErr(read).length, calls]).toEqual([1, []]);
  });
});
