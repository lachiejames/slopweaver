/*
 * Which thread a permalink resolves to: the whole thread behind a parent or reply link, the one redirect a bare
 * reply link earns, a malformed link refused before any network call, the bot-token caveat, and a permalink
 * handed back on the provider's canonical host rather than the one the caller pasted.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { readSlackThread } from "../../../../../live/slack/readThread.js";
import {
  apiServing,
  CANONICAL_WORKSPACE,
  LINK,
  type ReadApi,
  refusingFilesInfo,
  refusingHistory,
  refusingWorkspaceUrl,
  THREAD,
} from "./fixtures.js";
import { deps, tempRoot, useTempRoots } from "./harness.js";

useTempRoots();

describe("readSlackThread", () => {
  it("returns the whole thread with a reply target the write verb can consume", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              { text: "parent", ts: THREAD, user: "U1" },
              { text: "reply", thread_ts: THREAD, ts: "1785114500.000100", user: "U2" },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.messageCount).toBe(2);
    expect(doc.replyCount).toBe(1);
    expect(doc.observation.cursorExhausted).toBe(true);
    expect(doc.replyTarget).toEqual({ channel: "C123", threadTs: THREAD });
    expect(doc.warnings).toEqual([]);
  });

  it("warns that a bot read may be missing content", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps(),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "bot",
        token: "xoxb-test",
      }),
    );

    expect(doc.warnings).toEqual([
      "read with the BOT token: private conversations and files the bot cannot see are not included",
    ]);
  });

  it("refuses a malformed link before touching the network", async () => {
    let called = false;
    const result = await readSlackThread({
      deps: deps({
        api: {
          filesInfo: refusingFilesInfo,
          grantedScopes: async () => ["files:read"],
          history: refusingHistory,
          replies: async () => {
            called = true;
            return { messages: [] };
          },
          workspaceUrl: refusingWorkspaceUrl,
        },
      }),
      filesRoot: tempRoot(),
      permalink: "https://example.com/nope",
      principal: "user",
      token: "xoxp-test",
    });

    expect(result.isErr()).toBe(true);
    expect(called).toBe(false);
  });

  it("follows Slack's thread_ts when a bare reply link returns one foreign-threaded message", async () => {
    // MEASURED against the live API: conversations.replies given a REPLY's ts returns exactly ONE message
    // — the reply — whose thread_ts names the real root. A `thread_broadcast` is the everyday case: it sits
    // at channel top level and its copy-link carries no ?thread_ts=, so pasting it used to fail outright.
    const BROADCAST = "1782968549.138519";
    const ROOT = "1782955073.248579";
    const asked: string[] = [];
    const api: ReadApi = {
      filesInfo: refusingFilesInfo,
      grantedScopes: async () => ["files:read"],
      history: refusingHistory,
      replies: async ({ ts }) => {
        asked.push(ts);
        if (ts === BROADCAST) {
          return {
            messages: [{ subtype: "thread_broadcast", text: "also to channel", thread_ts: ROOT, ts: BROADCAST }],
          };
        }
        return {
          messages: [
            { text: "root", ts: ROOT, user: "U1" },
            { subtype: "thread_broadcast", text: "also to channel", thread_ts: ROOT, ts: BROADCAST },
          ],
        };
      },
      workspaceUrl: async () => CANONICAL_WORKSPACE,
    };

    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api }),
        filesRoot: tempRoot(),
        permalink: `https://example.slack.com/archives/C123/p${BROADCAST.replace(".", "")}`,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(asked).toEqual([BROADCAST, ROOT]); // exactly one redirect, no loop
    expect(doc.thread.threadTs).toBe(ROOT);
    expect(doc.thread.addressedTs).toBe(BROADCAST);
    expect(doc.thread.addressedReply).toBe(true);
    expect(doc.messageCount).toBe(2);
    expect(doc.replyTarget.threadTs).toBe(ROOT);
  });

  it("does NOT redirect when a single-message thread is genuinely the whole thread", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps(),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.messageCount).toBe(1);
    expect(doc.thread.threadTs).toBe(THREAD);
  });

  it("resolves a REPLY link to the whole thread and says which reply was linked", async () => {
    const replyLink = `https://example.slack.com/archives/C123/p1785114500000100?thread_ts=${THREAD}`;
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              { text: "parent", ts: THREAD, user: "U1" },
              { text: "the reply", thread_ts: THREAD, ts: "1785114500.000100", user: "U2" },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: replyLink,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.thread.threadTs).toBe(THREAD);
    expect(doc.thread.addressedTs).toBe("1785114500.000100");
    expect(doc.thread.addressedReply).toBe(true);
    expect(doc.messageCount).toBe(2);
  });
});

describe("readSlackThread — canonicalPermalink: the output permalink is the provider's, never the caller's", () => {
  const WRONG_HOST_LINK = `https://wrong-host.slack.com/archives/C123/p${THREAD.replace(".", "")}`;

  it("hands back the CANONICAL host resolved off auth.test, not the host the caller pasted", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          // `auth.test`'s real `url` field comes back WITH a trailing slash — proving the normalisation
          // happens here, the same guard `slackAskPermalink`/`slackPermalink` already apply.
          api: {
            ...apiServing({ messages: [{ text: "parent", ts: THREAD, user: "U1" }] }),
            workspaceUrl: async () => `${CANONICAL_WORKSPACE}/`,
          },
        }),
        filesRoot: tempRoot(),
        permalink: WRONG_HOST_LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    // The wrong host the caller typed survives nowhere in the output.
    expect(JSON.stringify(doc)).not.toContain("wrong-host");
    expect(doc.thread.workspace).toBe(CANONICAL_WORKSPACE);
    expect(doc.thread.permalink).toBe(`${CANONICAL_WORKSPACE}/archives/C123/p${THREAD.replace(".", "")}`);
  });

  it("refuses the read rather than falling back to the caller's host when auth.test cannot resolve a workspace", async () => {
    const result = await readSlackThread({
      deps: deps({
        api: { ...apiServing({ messages: [] }), workspaceUrl: async () => undefined },
      }),
      filesRoot: tempRoot(),
      permalink: LINK,
      principal: "user",
      token: "xoxp-test",
    });

    expect(unwrapErr(result).code).toBe("WORKSPACE_URL_UNRESOLVED");
  });
});
