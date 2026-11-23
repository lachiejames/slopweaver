/**
 * The as-me drip and no-fold write calls, through a plain client object carrying only the one `chat` method
 * each call reaches. Pinned: the exact arguments each arm sends (rich posts one top-level block, plain posts
 * none, an edit always sends `blocks` and re-sends file ids only when there are some, no-fold sends blocks
 * and metadata), the identity a post returns, and the refusal when Slack answers without a channel or ts.
 *
 * Every call takes its own `scopeId`, so the write lane's per-scope pacing never delays a later call here.
 */
import type { RichTextBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { describe, expect, it } from "vitest";

import { postDripMessageCall, postNoFoldCall, updateDripMessageCall } from "../../../../corpus/slack/writeApiDrip.js";
import { noticeMetadata } from "../../../../outbound/slack/noticeMetadata.js";
import type { SlackNoFoldPayload } from "../../../../outbound/slack/types.js";

const BLOCK: RichTextBlock = {
  elements: [{ elements: [{ text: "ship it", type: "text" }], type: "rich_text_section" }],
  type: "rich_text",
};

/** A `chat.postMessage` that records every argument object and answers with the given body. */
function recordingPost({ sent, answer }: { sent: unknown[]; answer: { channel?: string; ts?: string } }): {
  chat: Pick<WebClient["chat"], "postMessage">;
} {
  const postMessage: WebClient["chat"]["postMessage"] = async (args) => {
    sent.push(args);
    return { ok: true, ...answer };
  };
  return { chat: { postMessage } };
}

describe("postDripMessageCall", () => {
  it("posts a rich message as one top-level blocks array with the thread ts, and returns the posted identity", async () => {
    const sent: unknown[] = [];
    const client = recordingPost({ answer: { channel: "C1", ts: "1700000000.000100" }, sent });

    const posted = await postDripMessageCall({
      channel: "C1",
      client,
      payload: { blocks: [BLOCK], form: "rich", text: "ship it", unfurl_links: false, unfurl_media: true },
      scopeId: "drip-rich",
      threadTs: "1699999999.000100",
    });

    expect(posted).toEqual({ channel: "C1", ts: "1700000000.000100" });
    expect(sent).toEqual([
      {
        blocks: [BLOCK],
        channel: "C1",
        text: "ship it",
        thread_ts: "1699999999.000100",
        unfurl_links: false,
        unfurl_media: true,
      },
    ]);
  });

  it("posts a plain message with no blocks key, and no thread_ts key when no thread is given", async () => {
    const sent: unknown[] = [];
    const client = recordingPost({ answer: { channel: "C1", ts: "1700000000.000200" }, sent });

    await postDripMessageCall({
      channel: "C1",
      client,
      payload: { form: "plain", text: "*bold* as typed", unfurl_links: true, unfurl_media: false },
      scopeId: "drip-plain",
      threadTs: undefined,
    });

    expect(sent).toEqual([{ channel: "C1", text: "*bold* as typed", unfurl_links: true, unfurl_media: false }]);
  });

  it("sends a plain bot notice's metadata so slack delete can later retract it", async () => {
    const sent: unknown[] = [];
    const client = recordingPost({ answer: { channel: "C1", ts: "1700000000.000250" }, sent });

    await postDripMessageCall({
      channel: "C1",
      client,
      payload: {
        form: "plain",
        metadata: noticeMetadata(),
        text: "picking it up",
        unfurl_links: false,
        unfurl_media: false,
      },
      scopeId: "drip-notice",
      threadTs: "1699999999.000100",
    });

    expect(sent).toEqual([
      {
        channel: "C1",
        metadata: {
          event_payload: { artifactKind: "notice", renderer: "slack-notice-v1", schemaVersion: 1 },
          event_type: "slopweaver_notice_v1",
        },
        text: "picking it up",
        thread_ts: "1699999999.000100",
        unfurl_links: false,
        unfurl_media: false,
      },
    ]);
  });

  it("refuses with slack.chat.postMessage returned no channel/ts when Slack answers without a ts, and without a channel", async () => {
    const noTs = recordingPost({ answer: { channel: "C1" }, sent: [] });
    const noChannel = recordingPost({ answer: { ts: "1700000000.000300" }, sent: [] });
    const payload = { form: "plain", text: "hi", unfurl_links: false, unfurl_media: false } as const;

    await expect(
      postDripMessageCall({ channel: "C1", client: noTs, payload, scopeId: "drip-no-ts", threadTs: undefined }),
    ).rejects.toThrow("slack.chat.postMessage returned no channel/ts");
    await expect(
      postDripMessageCall({
        channel: "C1",
        client: noChannel,
        payload,
        scopeId: "drip-no-channel",
        threadTs: undefined,
      }),
    ).rejects.toThrow("slack.chat.postMessage returned no channel/ts");
  });
});

describe("updateDripMessageCall", () => {
  /** A `chat.update` that records every argument object. */
  function recordingUpdate({ sent }: { sent: unknown[] }): { chat: Pick<WebClient["chat"], "update"> } {
    const update: WebClient["chat"]["update"] = async (args) => {
      sent.push(args);
      return { ok: true };
    };
    return { chat: { update } };
  }

  it("sends the rich block and re-sends the message's file ids when it has some", async () => {
    const sent: unknown[] = [];

    await updateDripMessageCall({
      client: recordingUpdate({ sent }),
      fileIds: ["F1", "F2"],
      payload: { blocks: [BLOCK], form: "rich", text: "ship it", unfurl_links: false, unfurl_media: false },
      posted: { channel: "C1", ts: "1700000000.000100" },
      scopeId: "drip-update-rich",
    });

    expect(sent).toEqual([
      { blocks: [BLOCK], channel: "C1", file_ids: ["F1", "F2"], text: "ship it", ts: "1700000000.000100" },
    ]);
  });

  it("sends blocks as the literal empty array for a plain edit, and no file_ids key for an empty file-id list", async () => {
    const sent: unknown[] = [];

    await updateDripMessageCall({
      client: recordingUpdate({ sent }),
      fileIds: [],
      payload: { form: "plain", text: "now plain", unfurl_links: false, unfurl_media: false },
      posted: { channel: "C1", ts: "1700000000.000100" },
      scopeId: "drip-update-plain",
    });

    expect(sent).toEqual([{ blocks: [], channel: "C1", text: "now plain", ts: "1700000000.000100" }]);
  });
});

describe("postNoFoldCall", () => {
  const PAYLOAD: SlackNoFoldPayload = {
    blocks: [BLOCK],
    metadata: {
      event_payload: {
        artifactFingerprint: "fp-1",
        artifactKind: "no-fold",
        renderer: "slack-no-fold-v1",
        schemaVersion: 1,
      },
      event_type: "slopweaver_no_fold",
    },
    text: "ship it",
    unfurl_links: false,
    unfurl_media: false,
  };

  it("posts top-level blocks with metadata and no attachments key, and returns the posted identity", async () => {
    const sent: unknown[] = [];
    const client = recordingPost({ answer: { channel: "C9", ts: "1700000000.000400" }, sent });

    const posted = await postNoFoldCall({
      channel: "C9",
      client,
      payload: PAYLOAD,
      scopeId: "no-fold",
      threadTs: "1699999999.000100",
    });

    expect(posted).toEqual({ channel: "C9", ts: "1700000000.000400" });
    expect(sent).toEqual([
      {
        blocks: [BLOCK],
        channel: "C9",
        metadata: PAYLOAD.metadata,
        text: "ship it",
        thread_ts: "1699999999.000100",
        unfurl_links: false,
        unfurl_media: false,
      },
    ]);
  });

  it("refuses with slack.chat.postMessage returned no channel/ts when Slack answers with neither", async () => {
    const client = recordingPost({ answer: {}, sent: [] });

    await expect(
      postNoFoldCall({ channel: "C9", client, payload: PAYLOAD, scopeId: "no-fold-empty", threadTs: undefined }),
    ).rejects.toThrow("slack.chat.postMessage returned no channel/ts");
  });
});
