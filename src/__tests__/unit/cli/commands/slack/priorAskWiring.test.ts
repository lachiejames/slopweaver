import { describe, expect, it } from "vitest";
import { readPriorAskVia } from "../../../../../cli/commands/slack/priorAskWiring.js";
import type { SlackApi, SlackMessagesPage } from "../../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const ROOT = "1789000000.000100";
const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";
const THREAD: readonly unknown[] = [
  { text: "is the key spend expected?", thread_ts: ROOT, ts: ROOT, user: "U0SYNADAOWN" },
  { text: "expected, the batch job", thread_ts: ROOT, ts: "1789000100.000100", user: "U0JONAH" },
];

/**
 * A client factory that records the token it was built for and serves `replies` from the given function.
 *
 * @param tokens where each token is written
 * @param replies what a `conversations.replies` call answers
 * @returns the factory
 */
function factory({
  tokens,
  replies,
}: {
  tokens: string[];
  replies: () => Promise<SlackMessagesPage>;
}): (args: { token: string }) => Pick<SlackApi, "replies" | "history"> {
  return ({ token }) => {
    tokens.push(token);
    return { history: async () => ({ messages: [] }), replies };
  };
}

describe("readPriorAskVia", () => {
  it("reads the earlier ask under the token it is given", async () => {
    const tokens: string[] = [];
    const read = readPriorAskVia({
      makeApi: factory({ replies: async () => ({ hasMore: false, messages: THREAD }), tokens }),
      nowMs: () => 1_789_000_200_000,
    });
    const result = await read({ permalink: PERMALINK, token: "xoxp-own" });
    expect(result.isOk()).toBe(true);
    expect([unwrap(result).messages.length, tokens]).toEqual([2, ["xoxp-own"]]);
  });

  it("reads an incomplete thread as unreadable, never as unanswered", async () => {
    const read = readPriorAskVia({
      makeApi: factory({ replies: async () => ({ hasMore: true, messages: THREAD }), tokens: [] }),
      nowMs: () => 1_789_000_200_000,
    });
    const result = await read({ permalink: PERMALINK, token: "xoxp-own" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toMatchObject({ code: "PRIOR_ASK_UNREADABLE", permalink: PERMALINK });
  });

  it("reads a thrown transport error as unreadable, carrying its words", async () => {
    const read = readPriorAskVia({
      makeApi: factory({
        replies: async () => {
          throw new Error("ratelimited");
        },
        tokens: [],
      }),
      nowMs: () => 1_789_000_200_000,
    });
    const result = await read({ permalink: PERMALINK, token: "xoxp-own" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("PRIOR_ASK_UNREADABLE");
    expect(unwrapErr(result).message).toContain("ratelimited");
  });
});
