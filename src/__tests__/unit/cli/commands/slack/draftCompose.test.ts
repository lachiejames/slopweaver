/**
 * The pure half of `slack draft record`: what a recording is ALLOWED to be, which mentions survive the
 * round trip, and what the digest the owner's approval binds actually covers.
 *
 * Every case here calls the function directly — the module reads no clock, mints no id and touches no
 * Slack, which is the whole reason it was split out of `draftRun.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  composeParkedDraft,
  parkedMentions,
  placementOptions,
  recordDripOptions,
  threadParentFrom,
  withThreadPermalink,
} from "../../../../../cli/commands/slack/draftCompose.js";
import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import {
  type ParkedPriorAsk,
  type ParkedSlackDraft,
  parkedDraftDigest,
} from "../../../../../outbound/slack/draftRegister.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";

/** The form JSON a recording actually read, whether it arrived inline or on stdin. */
const FORM = '{"kind":"one-card","lines":[{"runs":[{"text":"Four groups.","type":"text"}]}]}';

const OPTIONS: DraftRecordOptions = {
  actor: "me",
  askedBefore: "undeclared",
  channel: "C0ISO",
  formSource: FORM,
  home: "/home",
  json: false,
  media: [],
  mode: "record",
  receipts: { kind: "undeclared" },
  supersedes: [],
  why: "the entry-group question the four-group thread left open",
};

const PAYLOAD: SlackDripMessagePayload = {
  blocks: [{ elements: [], type: "rich_text" }],
  form: "rich",
  text: "Four groups.",
  unfurl_links: false,
  unfurl_media: false,
};

const EMPTY: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
};

/** A resolution carrying one person and one group of each addressing verdict. */
function resolution(): MentionResolution {
  return {
    ...EMPTY,
    groupAddresses: new Map([
      [
        "@iso-owners",
        {
          group: { deleted: false, handle: "iso-owners", id: "S1", memberIds: ["U1"], name: "ISO owners" },
          handle: "iso-owners",
          kind: "addressable" as const,
        },
      ],
      [
        "@nobody",
        {
          group: { deleted: true, handle: "nobody", id: "S2", memberIds: [], name: "Nobody" },
          kind: "unreachable" as const,
          why: "empty" as const,
        },
      ],
    ]),
    resolved: new Map([["@ada", { origin: "override" as const, slackId: "U0SYNADAOWN" }]]),
  };
}

describe("recordDripOptions", () => {
  it("fixes every field a parked draft could not be, and carries only the three the invocation gives", () => {
    expect(recordDripOptions({ options: OPTIONS })).toEqual({
      actor: "me",
      channel: "C0ISO",
      dryRun: false,
      home: "/home",
      json: false,
      media: [],
      resendUnconfirmed: false,
      reviewer: "undeclared",
      shape: "top-level",
      source: { json: OPTIONS.formSource, kind: "form" },
      verb: "post",
    });
  });

  it("carries a declared reviewer through unchanged, and owes one as undeclared when none was given", () => {
    expect([
      recordDripOptions({ options: { ...OPTIONS, reviewer: "new" } }).reviewer,
      recordDripOptions({ options: { ...OPTIONS, reviewer: "not-an-ask" } }).reviewer,
      recordDripOptions({ options: OPTIONS }).reviewer,
    ]).toEqual(["new", "not-an-ask", "undeclared"]);
  });
});

describe("placementOptions — the drip a thread row prepares as", () => {
  it("prepares a top-level row as a post, and a thread row as a reply carrying its root", () => {
    expect([placementOptions({ threadTs: undefined }), placementOptions({ threadTs: "1789407961.767649" })]).toEqual([
      { shape: "top-level", verb: "post" },
      { shape: "thread", threadTs: "1789407961.767649", verb: "reply" },
    ]);
  });

  it("records a --thread-ts invocation as a thread reply, never a top-level post", () => {
    expect(recordDripOptions({ options: { ...OPTIONS, threadTs: "1789407961.767649" } })).toMatchObject({
      shape: "thread",
      threadTs: "1789407961.767649",
      verb: "reply",
    });
  });
});

describe("composeParkedDraft over --thread-ts", () => {
  /** The same recording, top-level or into the thread rooted at `threadTs`. */
  function composed({
    threadTs,
    workspaceUrl,
  }: {
    threadTs: string | undefined;
    workspaceUrl?: string | undefined;
  }): ReturnType<typeof composeParkedDraft> {
    return composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "proj-monitoring",
      groupDm: undefined,
      form: FORM,
      id: "sd-1a2b3c4d",
      kind: undefined,
      media: [],
      options: { ...OPTIONS, ...(threadTs === undefined ? {} : { threadTs }) },
      payload: PAYLOAD,
      resolution: EMPTY,
      threadParent: threadTs === undefined ? undefined : { text: "staging pool exhausted", userId: "U0JONAH" },
      tsIso: "2026-09-28T12:00:00.000Z",
      workspaceUrl,
    });
  }

  it("parks a thread row carrying its root and parent, and a top-level row carrying neither", () => {
    const reply = composed({ threadTs: "1789407961.767649" });
    const post = composed({ threadTs: undefined });
    expect([reply.shape, reply.threadTs, reply.threadParent]).toEqual([
      "thread",
      "1789407961.767649",
      { text: "staging pool exhausted", userId: "U0JONAH" },
    ]);
    expect([post.shape, "threadTs" in post, "threadParent" in post]).toEqual(["top-level", false, false]);
  });

  it("links the thread's root on the parent when the workspace is known, so the card links what it talks about", () => {
    const reply = composed({ threadTs: "1789407961.767649", workspaceUrl: "https://acme.slack.com/" });
    expect(reply.threadParent!.permalink).toBe("https://acme.slack.com/archives/C0ISO/p1789407961767649");
  });

  it("keeps the permalink out of the digest, so linking the thread never changes what the owner's approval binds", () => {
    const linked = composed({ threadTs: "1789407961.767649", workspaceUrl: "https://acme.slack.com/" });
    expect(linked.digest).toBe(composed({ threadTs: "1789407961.767649" }).digest);
  });

  it("binds the thread into the digest, so the top-level approval cannot release the reply", () => {
    expect(composed({ threadTs: "1789407961.767649" }).digest).not.toBe(composed({ threadTs: undefined }).digest);
  });
});

describe("withThreadPermalink — the thread root's link, only where Slack would open it", () => {
  const parent = { text: "staging pool exhausted", userId: "U0JONAH" };

  it("links a channel thread's root, never the reply, so the card opens the whole conversation", () => {
    expect(
      withThreadPermalink({
        channel: "C0OBS",
        parent,
        threadTs: "1789407961.767649",
        workspaceUrl: "https://acme.slack.com/",
      }),
    ).toEqual({ ...parent, permalink: "https://acme.slack.com/archives/C0OBS/p1789407961767649" });
  });

  it("links nothing for a member id standing in as the channel, whose archive link Slack would not open", () => {
    expect(
      withThreadPermalink({
        channel: "U0JONAH",
        parent,
        threadTs: "1789407961.767649",
        workspaceUrl: "https://acme.slack.com/",
      }),
    ).toEqual(parent);
  });

  it("links nothing when the identity read named no workspace, or one that is not https", () => {
    const base = { channel: "C0OBS", parent, threadTs: "1789407961.767649" };
    expect([
      withThreadPermalink({ ...base, workspaceUrl: undefined }),
      withThreadPermalink({ ...base, workspaceUrl: "http://acme.slack.com/" }),
    ]).toEqual([parent, parent]);
  });

  it("answers no parent for a top-level row", () => {
    expect(
      withThreadPermalink({
        channel: "C0OBS",
        parent: undefined,
        threadTs: undefined,
        workspaceUrl: "https://acme.slack.com/",
      }),
    ).toBe(undefined);
  });
});

describe("threadParentFrom — the root `conversations.replies` answers first", () => {
  it("reads the root's author and text", () => {
    const messages = [{ text: "staging pool exhausted", ts: "1789407961.767649", user: "U0JONAH" }];
    expect(unwrap(threadParentFrom({ channel: "C0OBS", messages, threadTs: "1789407961.767649" }))).toEqual({
      text: "staging pool exhausted",
      userId: "U0JONAH",
    });
  });

  it("cuts a long root to the cap, marking the cut", () => {
    const messages = [{ text: "x".repeat(400), ts: "1789407961.767649" }];
    const parent = unwrap(threadParentFrom({ channel: "C0OBS", messages, threadTs: "1789407961.767649" }));
    expect([parent.text.length, parent.text.endsWith("…"), parent.userId]).toEqual([280, true, undefined]);
  });

  it("refuses a ts that is a reply inside a thread, naming the root to pass instead", () => {
    const messages = [{ text: "root", ts: "1789407961.767649" }];
    const refused = unwrapErr(threadParentFrom({ channel: "C0OBS", messages, threadTs: "1789407999.000100" }));
    expect(refused).toEqual(
      SlackDraftErrors.threadNotRoot({ rootTs: "1789407961.767649", threadTs: "1789407999.000100" }),
    );
    expect(refused.message).toBe(
      "--thread-ts 1789407999.000100 is a reply inside the thread rooted at 1789407961.767649, not a root — pass " +
        "--thread-ts 1789407961.767649 to reply in that thread",
    );
  });

  it("refuses a ts naming no message at all", () => {
    const refused = unwrapErr(threadParentFrom({ channel: "C0OBS", messages: [], threadTs: "1789407961.767649" }));
    expect(refused).toEqual(SlackDraftErrors.threadNotFound({ channel: "C0OBS", threadTs: "1789407961.767649" }));
    expect(refused.code).toBe("DRAFT_THREAD_NOT_FOUND");
  });
});

describe("parkedMentions", () => {
  it("flattens the Maps that do not survive JSON, people first, groups after", () => {
    expect(parkedMentions({ resolution: resolution() })).toEqual([
      { key: "@ada", kind: "person", target: "U0SYNADAOWN" },
      { key: "@iso-owners", kind: "group", target: "S1" },
    ]);
  });

  it("drops a group that can address nobody rather than recording a target that notifies no one", () => {
    const targets = parkedMentions({ resolution: resolution() }).map((mention) => mention.target);
    expect(targets).toEqual(["U0SYNADAOWN", "S1"]);
  });

  it("answers an empty list for a form that named nobody", () => {
    expect(parkedMentions({ resolution: EMPTY })).toEqual([]);
  });
});

describe("composeParkedDraft", () => {
  const draft = composeParkedDraft({
    advisory: ["the opener runs longer than the owner's measured median"],
    authorId: "U0SYNADAOWN",
    botCannotPost: undefined,
    channelName: "iso-27001",
    groupDm: undefined,
    id: "sd-1a2b3c4d",
    kind: undefined,
    form: FORM,
    media: [],
    options: OPTIONS,
    payload: PAYLOAD,
    resolution: resolution(),
    threadParent: undefined,
    tsIso: "2026-09-23T04:05:06.000Z",
    workspaceUrl: undefined,
  });

  it("records the form AND the payload, because a release re-prepares one and the digest binds the other", () => {
    expect(draft.form).toBe(FORM);
    expect(draft.payload).toEqual(PAYLOAD);
  });

  it("records the form it READ, never the stdin sentinel it was typed as, so a release can re-prepare it", () => {
    const piped = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      form: FORM,
      id: "sd-1a2b3c4d",
      kind: undefined,
      media: [],
      options: { ...OPTIONS, formSource: "-" },
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect(piped.form).toBe(FORM);
  });

  it("carries the id, instant, channel, name, author, why and advisory it was handed", () => {
    expect(draft.id).toBe("sd-1a2b3c4d");
    expect(draft.tsIso).toBe("2026-09-23T04:05:06.000Z");
    expect(draft.channel).toBe("C0ISO");
    expect(draft.channelName).toBe("iso-27001");
    expect(draft.authorId).toBe("U0SYNADAOWN");
    expect(draft.shape).toBe("top-level");
    expect(draft.why).toBe("the entry-group question the four-group thread left open");
    expect(draft.advisory).toEqual(["the opener runs longer than the owner's measured median"]);
    expect(draft.mentions).toEqual([
      { key: "@ada", kind: "person", target: "U0SYNADAOWN" },
      { key: "@iso-owners", kind: "group", target: "S1" },
    ]);
  });

  it("mints a 32-char digest that ignores the id, the instant and the advisory", () => {
    const same = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      id: "sd-99999999",
      kind: undefined,
      form: FORM,
      media: [],
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-24T00:00:00.000Z",
      workspaceUrl: undefined,
    });
    expect(draft.digest).toHaveLength(32);
    expect(same.digest).toBe(draft.digest);
  });

  it("carries --act onto the row and leaves the digest exactly as it was without one", () => {
    const bump = composeParkedDraft({
      advisory: ["the opener runs longer than the owner's measured median"],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      id: "sd-1a2b3c4d",
      kind: undefined,
      form: FORM,
      media: [],
      options: { ...OPTIONS, act: "bump" },
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect([bump.act, draft.act, bump.digest]).toEqual(["bump", undefined, draft.digest]);
    expect(Object.keys(draft).includes("act")).toBe(false);
  });

  it("changes the digest when the identity it would go out under changes", () => {
    const other = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNSOMEONE",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      id: "sd-1a2b3c4d",
      kind: undefined,
      form: FORM,
      media: [],
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect(other.digest).not.toBe(draft.digest);
  });

  it("changes the digest when the bytes change, even by one character", () => {
    const edited = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      id: "sd-1a2b3c4d",
      kind: undefined,
      form: FORM,
      media: [],
      options: OPTIONS,
      payload: { ...PAYLOAD, text: "Four groups!" },
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect(edited.digest).not.toBe(draft.digest);
  });

  it("leaves the channel name absent when the info read could not name the conversation", () => {
    const unnamed = composeParkedDraft({
      advisory: [],
      authorId: undefined,
      botCannotPost: undefined,
      channelName: undefined,
      groupDm: undefined,
      id: "sd-1a2b3c4d",
      kind: undefined,
      form: FORM,
      media: [],
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: EMPTY,
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect(unnamed.channelName).toBe(undefined);
    expect(unnamed.authorId).toBe(undefined);
    expect(unnamed.mentions).toEqual([]);
  });

  it("stamps a group DM's row and binds the stamp, leaving every unstamped row as it always was", () => {
    const groupDm = composeParkedDraft({
      advisory: ["the opener runs longer than the owner's measured median"],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: true,
      id: "sd-1a2b3c4d",
      kind: undefined,
      form: FORM,
      media: [],
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    const { authorId, channel, mentions, payload, priorAsk, threadTs } = groupDm;
    const rebound = parkedDraftDigest({
      draft: { authorId, channel, groupDm: true, mentions, payload, priorAsk, threadTs },
    });
    expect([groupDm.groupDm, Object.keys(draft).includes("groupDm"), groupDm.digest === draft.digest]).toEqual([
      true,
      false,
      false,
    ]);
    expect(groupDm.digest).toBe(rebound);
  });

  it("adds no media field for a draft with no attachments, so its digest reads as it always has", () => {
    expect(Object.keys(draft).includes("media")).toBe(false);
  });

  it("carries the stored attachments in attach order, and binds them into the digest", () => {
    const media = [
      { bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) },
      { bytes: 12, name: "still.png", sha256: "b".repeat(64) },
    ];
    const withMedia = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: undefined,
      channelName: "iso-27001",
      groupDm: undefined,
      form: FORM,
      id: "sd-1a2b3c4d",
      kind: undefined,
      media,
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: resolution(),
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect(withMedia.media).toEqual(media);
    expect(withMedia.digest).toHaveLength(32);
    expect(withMedia.digest).not.toBe(draft.digest);
  });

  describe("an asked-before declaration", () => {
    const prior: ParkedPriorAsk = {
      answerCount: 1,
      answers: [{ text: "expected, the batch job", ts: "1789000100.000100", userId: "U0JONAH" }],
      changed: "spend tripled",
      kind: "prior",
      ours: { text: "is the key spend expected?", ts: "1789000000.000100", userId: "U0SYNADAOWN" },
      permalink: "https://acme.slack.com/archives/C0ISO/p1789000000000100",
      proof: [{ bytes: 12, name: "spend.png", sha256: "c".repeat(64) }],
      readThroughTs: "1789000100.000100",
    };
    const withPrior = ({ priorAsk }: { priorAsk: ParkedPriorAsk | undefined }): ParkedSlackDraft =>
      composeParkedDraft({
        advisory: [],
        authorId: "U0SYNADAOWN",
        botCannotPost: undefined,
        channelName: "iso-27001",
        groupDm: undefined,
        form: FORM,
        id: "sd-1a2b3c4d",
        kind: undefined,
        media: [],
        options: OPTIONS,
        payload: PAYLOAD,
        priorAsk,
        resolution: resolution(),
        threadParent: undefined,
        tsIso: "2026-09-23T04:05:06.000Z",
        workspaceUrl: undefined,
      });

    it("adds no priorAsk field to a row that declared nothing, so its digest reads as it always has", () => {
      const none = withPrior({ priorAsk: undefined });
      expect([Object.keys(none).includes("priorAsk"), none.digest]).toEqual([false, draft.digest]);
    });

    it("leaves the digest unchanged by a declaration that carries no proof", () => {
      const { proof: _proof, ...unproven } = prior;
      expect(withPrior({ priorAsk: { kind: "none" } }).digest).toBe(draft.digest);
      expect(withPrior({ priorAsk: unproven }).digest).toBe(draft.digest);
    });

    it("binds the proof into the digest, so the charts the owner approved are the charts it carries", () => {
      const proven = withPrior({ priorAsk: prior });
      const swapped = withPrior({
        priorAsk: { ...prior, proof: [{ bytes: 12, name: "spend.png", sha256: "d".repeat(64) }] },
      });
      const reworded = withPrior({ priorAsk: { ...prior, changed: "spend doubled" } });
      expect(proven.priorAsk).toEqual(prior);
      expect(new Set([draft.digest, proven.digest, swapped.digest, reworded.digest]).size).toBe(4);
    });

    it("binds a --not-answered reason into the digest, so the reason the owner approved is the one it carries", () => {
      const { proof: _proof, changed: _changed, ...unanswered } = prior;
      const reasoned = withPrior({ priorAsk: { ...unanswered, notAnswered: "they answered a different question" } });
      const rereasoned = withPrior({ priorAsk: { ...unanswered, notAnswered: "the reply was a joke" } });
      expect(withPrior({ priorAsk: unanswered }).digest).toBe(draft.digest);
      expect(new Set([draft.digest, reasoned.digest, rereasoned.digest]).size).toBe(3);
    });
  });

  it("adds no actor, botCannotPost or kind field to an as-me row that declared none", () => {
    expect(["actor", "botCannotPost", "kind"].filter((key) => Object.keys(draft).includes(key))).toEqual([]);
  });

  it("records a bot row's actor and kind, and an as-me row's reason the bot cannot post there", () => {
    const bot = composeParkedDraft({
      advisory: [],
      authorId: "U0BOT",
      botCannotPost: undefined,
      channelName: "squad-web-platform",
      groupDm: undefined,
      form: FORM,
      id: "sd-1a2b3c4d",
      kind: "finding",
      media: [],
      options: { ...OPTIONS, actor: "bot" },
      payload: PAYLOAD,
      resolution: EMPTY,
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    const asMe = composeParkedDraft({
      advisory: [],
      authorId: "U0SYNADAOWN",
      botCannotPost: "not-in-channel",
      channelName: "squad-web-platform",
      groupDm: undefined,
      form: FORM,
      id: "sd-1a2b3c4d",
      kind: "finding",
      media: [],
      options: OPTIONS,
      payload: PAYLOAD,
      resolution: EMPTY,
      threadParent: undefined,
      tsIso: "2026-09-23T04:05:06.000Z",
      workspaceUrl: undefined,
    });
    expect([bot.actor, bot.kind, "botCannotPost" in bot]).toEqual(["bot", "finding", false]);
    expect([asMe.actor, asMe.kind, asMe.botCannotPost]).toEqual([undefined, "finding", "not-in-channel"]);
  });
});
