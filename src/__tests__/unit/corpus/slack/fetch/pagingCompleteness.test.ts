/*
 * Paging completeness — the crawl keeps reading history, replies and the user directory past a page that shapes
 * to nothing while its cursor still moves, and names a channel-discovery cursor that repeats. It moved here when
 * `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { fetchSlackActivity, type SlackApi } from "../../../../../corpus/slack/fetch.js";
import { unwrap } from "../../../../../lib/result.js";
import { unusedFilesInfo, window } from "./harness.js";

/**
 * A Slack seam whose paging is scripted per method: each entry is one page, served in call order. Everything
 * not under test returns the empty shape, so a test names only the lane it is about.
 */
function pagedApi({
  history = [{ messages: [] }],
  replies = [{ messages: [] }],
  users = [{ members: [] }],
  channels = [{ channels: [{ id: "C_A", is_member: true, name: "alpha" }] }],
}: {
  history?: readonly { messages: readonly unknown[]; nextCursor?: string }[];
  replies?: readonly { messages: readonly unknown[]; nextCursor?: string }[];
  users?: readonly { members: readonly unknown[]; nextCursor?: string }[];
  channels?: readonly { channels: readonly unknown[]; nextCursor?: string }[];
}): SlackApi {
  let historyCall = 0;
  let repliesCall = 0;
  let usersCall = 0;
  let channelsCall = 0;
  return {
    filesInfo: unusedFilesInfo,
    grantedScopes: async () => [],
    history: async () => {
      const page = history[Math.min(historyCall, history.length - 1)]!;
      historyCall += 1;
      return page;
    },
    listChannels: async () => {
      const page = channels[Math.min(channelsCall, channels.length - 1)]!;
      channelsCall += 1;
      return page;
    },
    listUsers: async () => {
      const page = users[Math.min(usersCall, users.length - 1)]!;
      usersCall += 1;
      return page;
    },
    replies: async () => {
      const page = replies[Math.min(repliesCall, replies.length - 1)]!;
      repliesCall += 1;
      return page;
    },
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

describe("fetchSlackActivity paging completeness", () => {
  // The history crawl used to stop on a page that SHAPED to zero messages, before reading its cursor.
  it("keeps crawling history past a page that shapes to nothing but carries a cursor", async () => {
    const api = pagedApi({
      history: [
        { messages: [{ text: "first", ts: "1700000000.000100", user: "U1" }], nextCursor: "h2" },
        { messages: [{ no: "ts here" }], nextCursor: "h3" },
        { messages: [{ text: "last", ts: "1700000300.000100", user: "U1" }] },
      ],
    });
    const activity = unwrap(await fetchSlackActivity({ api, window }));
    expect(activity.retainedChannels[0]!.messages.map((m) => m.text)).toEqual(["first", "last"]);
  });

  // The highest-probability case in the repo: `conversations.replies` ALWAYS returns the thread parent, and
  // `shapeRepliesPage` always drops it, so a parent-only page shaped to zero and ended the walk — after which
  // the stored thread cursor advanced past every reply on the next page.
  it("keeps reading replies past a page whose only row is the thread parent", async () => {
    const api = pagedApi({
      history: [{ messages: [{ reply_count: 2, text: "root", ts: "1700000000.000100", user: "U1" }] }],
      replies: [
        { messages: [{ text: "root", ts: "1700000000.000100", user: "U1" }], nextCursor: "r2" },
        { messages: [{ text: "the reply that used to be lost", ts: "1700000100.000200", user: "U2" }] },
      ],
    });
    const activity = unwrap(await fetchSlackActivity({ api, window }));
    expect(activity.retainedChannels[0]!.replies.map((r) => r.text)).toEqual(["the reply that used to be lost"]);
  });

  // The user map is keyed by id, so a page of already-seen users grew it by nothing — which the old guard read
  // as "stop". A moving cursor means there is more.
  it("keeps reading the user directory past a page of already-seen users", async () => {
    const api = pagedApi({
      users: [
        { members: [{ id: "U1", real_name: "Ada" }], nextCursor: "u2" },
        { members: [{ id: "U1", real_name: "Ada" }], nextCursor: "u3" },
        { members: [{ id: "U9", real_name: "Grace" }] },
      ],
    });
    const activity = unwrap(await fetchSlackActivity({ api, window }));
    expect(activity.maps.userNames["U9"]).toBe("Grace");
  });

  it("warns by name when channel discovery's cursor repeats instead of advancing", async () => {
    const api = pagedApi({
      channels: [
        { channels: [{ id: "C_A", is_member: true, name: "alpha" }], nextCursor: "stuck-cursor" },
        { channels: [{ id: "C_A", is_member: true, name: "alpha" }], nextCursor: "stuck-cursor" },
      ],
    });
    const activity = unwrap(await fetchSlackActivity({ api, window }));
    expect(activity.warnings).toContain(
      "slack channel discovery may be incomplete: the endpoint repeated pagination cursor stuck-cursor instead of advancing",
    );
  });
});
