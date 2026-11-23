/*
 * The thread reads a channel share's clock rests on: which threads are read whole, and what a read projects to.
 */
import { describe, expect, it } from "vitest";

import { shareThreadOf, shareThreadRootsOf } from "../../../review/channelShareEvidence.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";

const PR = "acme/acme-admin#17941";
const POST_KEY = "C0SYN000002:1790508621.312739";
const OWNER = "U0SYN000001";
const COLLEAGUE = "U0SYN000004";
const BOT = "U0SYNBOTSELF01";
const IDENTITY = { ownerSlackUserId: OWNER, selfUserIds: [BOT] };

/** One message of the legs' output; only the fields these functions read differ between cases. */
function mention({
  authorRole = "owner",
  conversation = "channel",
  association = "linked",
  threadKey = POST_KEY,
}: {
  authorRole?: SlackMention["authorRole"];
  conversation?: SlackMention["conversation"];
  association?: SlackMention["association"];
  threadKey?: string;
}): SlackMention {
  return {
    association,
    atIso: "2026-09-27T11:30:21.000Z",
    authorId: OWNER,
    authorRole,
    authoredPrCount: 1,
    authoredText: "",
    channel: "#dev-team",
    conversation,
    counterpartId: "",
    excerpt: "",
    firstLinkAt: 0,
    isDirectMessage: conversation === "direct-message",
    leg: "live",
    linkSpans: [],
    mentions: [],
    messageKey: threadKey,
    permalink: "",
    prKey: PR,
    quotedPrKeys: [],
    tagged: [],
    threadKey,
    threadPrKeys: [],
    versionsDisagree: false,
  };
}

describe("shareThreadRootsOf", () => {
  it("names each thread under a post of the owner's once, split at its colon", () => {
    const roots = shareThreadRootsOf({
      grouped: new Map([
        [PR, [mention({}), mention({ association: "thread" }), mention({ authorRole: "other-human" })]],
        ["acme/acme-admin#17873", [mention({})]],
      ]),
    });
    expect(roots).toEqual([{ channelId: "C0SYN000002", rootTs: "1790508621.312739", threadKey: POST_KEY }]);
  });

  it("names no thread under the owner's link posted as a reply — only their own root lends a thread its pull request", () => {
    const reply = { ...mention({ threadKey: "C0SYN000002:1790500000.000100" }), messageKey: POST_KEY };
    expect(shareThreadRootsOf({ grouped: new Map([[PR, [reply]]]) })).toEqual([]);
  });

  it("names no thread under a file, pin or canvas of the owner's — it answers its own id, but no thread sits under it", () => {
    const file = "C0SYN000002:1790508621.312739:file:F0FILE01";
    expect(shareThreadRootsOf({ grouped: new Map([[PR, [mention({ threadKey: file })]]]) })).toEqual([]);
  });

  it("names no thread whose key carries no conversation or no root", () => {
    const roots = shareThreadRootsOf({
      grouped: new Map([[PR, [mention({ threadKey: ":1790508621.312739" }), mention({ threadKey: "C0SYN000002:" })]]]),
    });
    expect(roots).toEqual([]);
  });
});

describe("shareThreadOf", () => {
  const root = { channelId: "C0SYN000002", rootTs: "1790508621.312739", threadKey: POST_KEY };

  it("projects every row but the root, with who wrote it", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: [
        { ts: "1790508621.312739", user: OWNER },
        { ts: "1790560800.000100", user: COLLEAGUE },
        { ts: "1790560900.000100", user: OWNER },
        { ts: "1790561000.000100", user: BOT },
        { bot_id: "B01", bot_profile: { user_id: "U0APPBOT" }, ts: "1790561100.000100", user: "U0APPBOT" },
        { subtype: "bot_message", ts: "1790561200.000100" },
        { bot_id: "B01", bot_profile: { user_id: "U0APPBOT" }, ts: "1790561300.000100", user: COLLEAGUE },
        { bot_id: "B02", subtype: "bot_message", ts: "1790561400.000100", user: OWNER },
      ],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    })!;
    expect(thread.readAtIso).toBe("2026-09-28T04:00:00.000Z");
    expect(thread.replies.map((row) => [row.messageKey, row.atIso, row.authorRole])).toEqual([
      ["C0SYN000002:1790560800.000100", "2026-09-28T02:00:00.000Z", "other-human"],
      ["C0SYN000002:1790560900.000100", "2026-09-28T02:01:40.000Z", "owner"],
      ["C0SYN000002:1790561000.000100", "2026-09-28T02:03:20.000Z", "app"],
      ["C0SYN000002:1790561100.000100", "2026-09-28T02:05:00.000Z", "app"],
      ["C0SYN000002:1790561200.000100", "2026-09-28T02:06:40.000Z", "app"],
      ["C0SYN000002:1790561300.000100", "2026-09-28T02:08:20.000Z", "other-human"],
      ["C0SYN000002:1790561400.000100", "2026-09-28T02:10:00.000Z", "owner"],
    ]);
  });

  it("reads the owner's declared as-me bot as the owner and any other bot as an app — the rows are raw, never projected", () => {
    const ownerBot = { appIds: ["A0ASME"], botIds: ["B0ASME"], botUserIds: ["U0SYNASMEBOT"], ownerSlackUserId: OWNER };
    const thread = shareThreadOf({
      identity: { ...IDENTITY, ownerBot },
      rawMessages: [
        { ts: "1790508621.312739", user: OWNER },
        { bot_id: "B0ASME", ts: "1790560800.000100", user: OWNER },
        { app_id: "A0ASME", bot_id: "B0OTHER", subtype: "bot_message", ts: "1790560900.000100" },
        { bot_id: "B0OTHER", subtype: "bot_message", ts: "1790561000.000100" },
      ],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    })!;
    expect(thread.replies.map((row) => row.authorRole)).toEqual(["owner", "owner", "app"]);
  });

  it("keeps when Slack says a row or the root was edited — a key is not a version", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: [
        { edited: { ts: "1790561000.000000", user: OWNER }, ts: "1790508621.312739", user: OWNER },
        { edited: { ts: "1790561100.000000", user: OWNER }, ts: "1790560900.000100", user: OWNER },
        { ts: "1790560800.000100", user: COLLEAGUE },
      ],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    })!;
    expect(thread.rootEditedAtIso).toBe("2026-09-28T02:03:20.000Z");
    expect(thread.replies.map((row) => row.editedAtIso)).toEqual(["2026-09-28T02:05:00.000Z", undefined]);
  });

  it("keeps the root's newest edit when a paged read answers the root more than once", () => {
    const rootAt = ({ editedTs }: { editedTs?: string }) => ({
      ...(editedTs === undefined ? {} : { edited: { ts: editedTs, user: OWNER } }),
      ts: "1790508621.312739",
      user: OWNER,
    });
    const read = (...rawMessages: unknown[]) =>
      shareThreadOf({ identity: IDENTITY, rawMessages, readAtIso: "2026-09-28T04:00:00.000Z", root })!.rootEditedAtIso;
    expect([
      read(rootAt({ editedTs: "1790561100.000000" }), rootAt({ editedTs: "1790561000.000000" })),
      read(rootAt({ editedTs: "1790561000.000000" }), rootAt({ editedTs: "1790561100.000000" })),
      read(rootAt({ editedTs: "1790561100.000000" }), rootAt({})),
    ]).toEqual(["2026-09-28T02:05:00.000Z", "2026-09-28T02:05:00.000Z", "2026-09-28T02:05:00.000Z"]);
  });

  it("reads no thread when Slack marks a row edited with no instant — an undated version proves nothing", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: [
        { ts: "1790508621.312739", user: OWNER },
        { edited: { user: OWNER }, ts: "1790560900.000100", user: OWNER },
      ],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    });
    expect(thread).toBe(undefined);
  });

  it("reads no thread whose root is missing or not the owner's — the read is authoritative for the root too", () => {
    const read = (...rawMessages: unknown[]) =>
      shareThreadOf({ identity: IDENTITY, rawMessages, readAtIso: "2026-09-28T04:00:00.000Z", root });
    expect([
      read({ ts: "1790560800.000100", user: COLLEAGUE }),
      read({ ts: "1790508621.312739", user: COLLEAGUE }),
      read({ bot_id: "B01", bot_profile: { user_id: "U0APPBOT" }, ts: "1790508621.312739", user: "U0APPBOT" }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads the owner's post sent through an app with their own token as theirs — a bot_id beside their user is not the app's", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: [{ bot_id: "B0APP", bot_profile: { user_id: "U0APPBOT" }, ts: "1790508621.312739", user: OWNER }],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    });
    expect(thread).toEqual({ readAtIso: "2026-09-28T04:00:00.000Z", replies: [] });
  });

  it("keeps a reply's newest edit across copies, and reads no thread whose copies disagree on who wrote it", () => {
    const ownerReply = { ts: "1790560900.000100", user: OWNER };
    const read = (...rawMessages: unknown[]) =>
      shareThreadOf({
        identity: IDENTITY,
        rawMessages: [{ ts: "1790508621.312739", user: OWNER }, ...rawMessages],
        readAtIso: "2026-09-28T04:00:00.000Z",
        root,
      });
    expect(
      read({ ...ownerReply, edited: { ts: "1790561100.000000", user: OWNER } }, ownerReply)!.replies.map(
        (row) => row.editedAtIso,
      ),
    ).toEqual(["2026-09-28T02:05:00.000Z"]);
    expect([
      read(ownerReply, {
        bot_id: "B0OTHER",
        edited: { ts: "1790777400.000000" },
        subtype: "bot_message",
        ts: ownerReply.ts,
      }),
      read({ ts: ownerReply.ts, user: COLLEAGUE }, { ts: ownerReply.ts, user: "U0SYNSOMEONEELSE" }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads no thread when one row carries no timestamp — a half-read thread proves no absence", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: [{ ts: "1790508621.312739", user: OWNER }, { user: COLLEAGUE }],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    });
    expect(thread).toBe(undefined);
  });

  it("reads no thread when one row is not an object", () => {
    const thread = shareThreadOf({
      identity: IDENTITY,
      rawMessages: ["row"],
      readAtIso: "2026-09-28T04:00:00.000Z",
      root,
    });
    expect(thread).toBe(undefined);
  });
});
