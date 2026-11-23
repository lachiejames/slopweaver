/**
 * The poll write calls, through plain client objects carrying only the one method each call reaches. Pinned:
 * the exact post arguments (one wrapper, top-level metadata), the reaction add/remove/read outcomes including
 * which failures read as the desired end state, how `conversations.info`'s flags become a surface (unknown
 * stays unknown), and which user groups resolve to a handle→id entry.
 *
 * A failure is thrown as a plain `Error` with no status, which the provider door classifies as permanent, so
 * each failing call makes exactly one attempt. Every call takes its own `scopeId`, so per-scope pacing never
 * delays a later call here.
 */
import type { KnownBlock } from "@slack/types";
import type { ConversationsInfoResponse, WebClient } from "@slack/web-api";
import { describe, expect, it } from "vitest";

import {
  addReactionCall,
  conversationInfoCall,
  postPollCall,
  readReactionsCall,
  removeReactionCall,
  userGroupIdsCall,
} from "../../../../corpus/slack/writeApiPoll.js";
import type { SlackPollPayload } from "../../../../outbound/slack/types.js";

const POSTED = { channel: "C1", ts: "1700000000.000100" };

/** A `reactions` method that records its arguments and either answers or throws the given Slack error text. */
function reactionsClient({ sent, failWith }: { sent: unknown[]; failWith?: string }): {
  reactions: Pick<WebClient["reactions"], "add" | "remove">;
} {
  const add: WebClient["reactions"]["add"] = async (args) => {
    sent.push({ add: args });
    if (failWith !== undefined) {
      throw new Error(`An API error occurred: ${failWith}`);
    }
    return { ok: true };
  };
  const remove: WebClient["reactions"]["remove"] = async (args) => {
    sent.push({ remove: args });
    if (failWith !== undefined) {
      throw new Error(`An API error occurred: ${failWith}`);
    }
    return { ok: true };
  };
  return { reactions: { add, remove } };
}

describe("postPollCall", () => {
  const BLOCK: KnownBlock = { text: { text: "Which day?", type: "mrkdwn" }, type: "section" };
  const PAYLOAD: SlackPollPayload = {
    attachments: [{ blocks: [BLOCK], color: "#7c3aed", fallback: "Which day?" }],
    metadata: {
      event_payload: { pollId: "poll-1", renderer: "slack-poll-v1", schemaVersion: 1 },
      event_type: "slopweaver_poll",
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };

  it("posts one wrapper with metadata at the top level and returns the posted identity", async () => {
    const sent: unknown[] = [];
    const postMessage: WebClient["chat"]["postMessage"] = async (args) => {
      sent.push(args);
      return { channel: "C1", ok: true, ts: "1700000000.000100" };
    };

    const posted = await postPollCall({
      channel: "C1",
      client: { chat: { postMessage } },
      payload: PAYLOAD,
      scopeId: "poll-post",
    });

    expect(posted).toEqual(POSTED);
    expect(sent).toEqual([
      {
        attachments: [{ blocks: [BLOCK], color: "#7c3aed", fallback: "Which day?" }],
        channel: "C1",
        metadata: PAYLOAD.metadata,
        text: "",
        unfurl_links: false,
        unfurl_media: false,
      },
    ]);
  });

  it("refuses with slack.chat.postMessage returned no channel/ts when Slack answers without a ts", async () => {
    const postMessage: WebClient["chat"]["postMessage"] = async () => ({ channel: "C1", ok: true });

    await expect(
      postPollCall({ channel: "C1", client: { chat: { postMessage } }, payload: PAYLOAD, scopeId: "poll-no-ts" }),
    ).rejects.toThrow("slack.chat.postMessage returned no channel/ts");
  });
});

describe("addReactionCall", () => {
  it("sends the channel, name and timestamp once and answers true on success", async () => {
    const sent: unknown[] = [];

    const added = await addReactionCall({
      client: reactionsClient({ sent }),
      name: "one",
      posted: POSTED,
      scopeId: "react-add-ok",
    });

    expect(added).toBe(true);
    expect(sent).toEqual([{ add: { channel: "C1", name: "one", timestamp: "1700000000.000100" } }]);
  });

  it("answers true for a failure whose message carries already_reacted, and false for invalid_name", async () => {
    const already = addReactionCall({
      client: reactionsClient({ failWith: "already_reacted", sent: [] }),
      name: "one",
      posted: POSTED,
      scopeId: "react-add-already",
    });
    const invalid = addReactionCall({
      client: reactionsClient({ failWith: "invalid_name", sent: [] }),
      name: "not-an-emoji",
      posted: POSTED,
      scopeId: "react-add-invalid",
    });

    expect(await already).toBe(true);
    expect(await invalid).toBe(false);
  });
});

describe("removeReactionCall", () => {
  it("sends the channel, name and timestamp once and answers true on success", async () => {
    const sent: unknown[] = [];

    const removed = await removeReactionCall({
      client: reactionsClient({ sent }),
      name: "eyes",
      posted: POSTED,
      scopeId: "react-remove-ok",
    });

    expect(removed).toBe(true);
    expect(sent).toEqual([{ remove: { channel: "C1", name: "eyes", timestamp: "1700000000.000100" } }]);
  });

  it("answers true for a failure whose message carries no_reaction, and false for invalid_name", async () => {
    const gone = await removeReactionCall({
      client: reactionsClient({ failWith: "no_reaction", sent: [] }),
      name: "eyes",
      posted: POSTED,
      scopeId: "react-remove-gone",
    });
    const invalid = await removeReactionCall({
      client: reactionsClient({ failWith: "invalid_name", sent: [] }),
      name: "eyes",
      posted: POSTED,
      scopeId: "react-remove-invalid",
    });

    expect(gone).toBe(true);
    expect(invalid).toBe(false);
  });
});

describe("readReactionsCall", () => {
  it("reads the full reaction list and keeps, in order, each entry carrying a name and a numeric count", async () => {
    const sent: unknown[] = [];
    const get: WebClient["reactions"]["get"] = async (args) => {
      sent.push(args);
      return {
        message: {
          reactions: [
            { count: 2, name: "one", users: ["U1", "U2"] },
            { count: 3, users: ["U3"] },
            { name: "two", users: ["U4"] },
            { count: 1, name: "three" },
          ],
        },
        ok: true,
      };
    };

    const tally = await readReactionsCall({ client: { reactions: { get } }, posted: POSTED, scopeId: "react-read" });

    expect(tally).toEqual([
      { count: 2, name: "one", users: ["U1", "U2"] },
      { count: 1, name: "three", users: [] },
    ]);
    expect(sent).toEqual([{ channel: "C1", full: true, timestamp: "1700000000.000100" }]);
  });

  it("answers an empty tally when the message carries no reactions", async () => {
    const get: WebClient["reactions"]["get"] = async () => ({ message: {}, ok: true });

    expect(
      await readReactionsCall({ client: { reactions: { get } }, posted: POSTED, scopeId: "react-read-empty" }),
    ).toEqual([]);
  });

  it("answers undefined for message_not_found, and throws slack.reactions.get failed for not_authed", async () => {
    const failing = ({ slackCode }: { slackCode: string }): { reactions: Pick<WebClient["reactions"], "get"> } => {
      const get: WebClient["reactions"]["get"] = async () => {
        throw new Error(`An API error occurred: ${slackCode}`);
      };
      return { reactions: { get } };
    };

    const gone = await readReactionsCall({
      client: failing({ slackCode: "message_not_found" }),
      posted: POSTED,
      scopeId: "react-read-gone",
    });

    expect(gone).toBe(undefined);
    await expect(
      readReactionsCall({ client: failing({ slackCode: "not_authed" }), posted: POSTED, scopeId: "react-read-auth" }),
    ).rejects.toThrow("slack.reactions.get failed: An API error occurred: not_authed");
  });
});

describe("conversationInfoCall", () => {
  /** A `conversations.info` answering one channel record. */
  function infoClient({ channel }: { channel: ConversationsInfoResponse["channel"] }): {
    conversations: Pick<WebClient["conversations"], "info">;
  } {
    const info: WebClient["conversations"]["info"] = async () => ({
      ok: true,
      ...(channel === undefined ? {} : { channel }),
    });
    return { conversations: { info } };
  }

  /** A `conversations.info` that fails with the given Slack error text. */
  function failingInfo({ slackCode }: { slackCode: string }): {
    conversations: Pick<WebClient["conversations"], "info">;
  } {
    const info: WebClient["conversations"]["info"] = async () => {
      throw new Error(`An API error occurred: ${slackCode}`);
    };
    return { conversations: { info } };
  }

  it("classifies is_im true as a direct message carrying the other member, with no membership key", async () => {
    // Slack sends `user` on a 1:1 DM's record though the SDK's `Channel` type does not declare it, so the record
    // is built apart from the call rather than as an inline literal the excess-property check would refuse.
    const dm = { id: "D1", is_im: true, user: "U9" };
    const read = await conversationInfoCall({
      channel: "D1",
      client: infoClient({ channel: dm }),
      scopeId: "info-dm",
    });

    expect(read).toStrictEqual({ name: undefined, surface: "direct-message", user: "U9" });
  });

  it("classifies is_im false with is_private true as private, and with is_private false as public, carrying name and membership", async () => {
    const privateRead = await conversationInfoCall({
      channel: "C1",
      client: infoClient({ channel: { is_im: false, is_member: true, is_private: true, name: "iso-27001" } }),
      scopeId: "info-private",
    });
    const publicRead = await conversationInfoCall({
      channel: "C2",
      client: infoClient({ channel: { is_im: false, is_member: false, is_private: false, name: "dev-team" } }),
      scopeId: "info-public",
    });

    expect(privateRead).toStrictEqual({ isMember: true, name: "iso-27001", surface: "private-channel" });
    expect(publicRead).toStrictEqual({ isMember: false, name: "dev-team", surface: "public-channel" });
  });

  it("stamps is_mpim true as a group DM on its private surface, and nothing else carries the stamp", async () => {
    const groupRead = await conversationInfoCall({
      channel: "C0SYN000021",
      client: infoClient({
        channel: { is_im: false, is_member: true, is_mpim: true, is_private: true, name: "mpdm-a--b--c-1" },
      }),
      scopeId: "info-mpim",
    });
    const notGroup = await conversationInfoCall({
      channel: "C3",
      client: infoClient({ channel: { is_im: false, is_mpim: false, is_private: true, name: "iso-27001" } }),
      scopeId: "info-not-mpim",
    });

    expect(groupRead).toStrictEqual({
      groupDm: true,
      isMember: true,
      name: "mpdm-a--b--c-1",
      surface: "private-channel",
    });
    expect(notGroup).toStrictEqual({ name: "iso-27001", surface: "private-channel" });
  });

  it("leaves the surface undefined when is_im is absent, and when is_im is false but is_private is absent", async () => {
    const noIm = await conversationInfoCall({
      channel: "C3",
      client: infoClient({ channel: { is_private: true, name: "mystery" } }),
      scopeId: "info-no-im",
    });
    const noPrivate = await conversationInfoCall({
      channel: "C4",
      client: infoClient({ channel: { is_im: false, name: "half" } }),
      scopeId: "info-no-private",
    });

    expect(noIm).toStrictEqual({ name: "mystery", surface: undefined });
    expect(noPrivate).toStrictEqual({ name: "half", surface: undefined });
  });

  it("answers both halves undefined when Slack sends no channel record", async () => {
    const read = await conversationInfoCall({
      channel: "C5",
      client: infoClient({ channel: undefined }),
      scopeId: "info-empty",
    });

    expect(read).toStrictEqual({ name: undefined, surface: undefined });
  });

  it("reads channel_not_found as not a member, and any other failure as unknown membership", async () => {
    const notFound = await conversationInfoCall({
      channel: "C6",
      client: failingInfo({ slackCode: "channel_not_found" }),
      scopeId: "info-not-found",
    });
    const other = await conversationInfoCall({
      channel: "C7",
      client: failingInfo({ slackCode: "not_authed" }),
      scopeId: "info-not-authed",
    });

    expect(notFound).toStrictEqual({ isMember: false, name: undefined, surface: undefined });
    expect(other).toStrictEqual({ name: undefined, surface: undefined });
  });
});

describe("userGroupIdsCall", () => {
  it("maps each group carrying a non-empty handle and id, dropping a group missing either", async () => {
    const list: WebClient["usergroups"]["list"] = async () => ({
      ok: true,
      usergroups: [
        { handle: "engineers", id: "S1" },
        { handle: "", id: "S2" },
        { handle: "design" },
        { id: "S4" },
        { handle: "ops", id: "S5" },
      ],
    });

    const groups = await userGroupIdsCall({ client: { usergroups: { list } }, scopeId: "groups" });

    expect([...groups]).toEqual([
      ["engineers", "S1"],
      ["ops", "S5"],
    ]);
  });

  it("answers an empty map when Slack sends no usergroups key", async () => {
    const list: WebClient["usergroups"]["list"] = async () => ({ ok: true });

    expect((await userGroupIdsCall({ client: { usergroups: { list } }, scopeId: "groups-empty" })).size).toBe(0);
  });
});
