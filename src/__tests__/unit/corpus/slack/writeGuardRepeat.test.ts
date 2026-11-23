/**
 * The repeat guard at the transport: every guarded post reads its place first, and a repeat from the same
 * identity is refused BEFORE the wire, naming the existing permalink. Plain fakes throughout — the place reader,
 * the clock and the hatch are seams, and the transport records what reached it.
 */
import { describe, expect, it } from "vitest";

import {
  guardRepeats,
  type RepeatGuardSeams,
  RepeatSendRefusedError,
} from "../../../../corpus/slack/writeGuardRepeat.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { err, ok } from "../../../../lib/result.js";
import { classifySendFailure } from "../../../../outbound/slack/sendFailure.js";
import type {
  SlackCardPayload,
  SlackCardWrapper,
  SlackDripMessagePayload,
  SlackNoFoldPayload,
  SlackTurnPayload,
} from "../../../../outbound/slack/types.js";
import { workspaceShapeRefusals } from "../../../slackWorkspaceShapeFake.js";

const OWNER_ID = "U0SYN000001";
const BOT_USER = "U0SYN000005";
const BOT_ID = "B0SYN000013";
const BUGS = "C0SYN000003";
const NOW_MS = 1790611538684;
const FIRST_LINE =
  "P2 in production, not tracked yet: every third-party provider call for the acme booking service has 404'd since 24 sep";
const PROMPT_DM = "D0SYN000001";
const PROMPT_TEXT =
  "Daily Datadog hunt for big problems nobody is talking about, not only what got worse since last week.\n" +
  "automation · datadog-regression-hunt-daily";

/** What reached the fake transport, and what the guard read. */
interface Calls {
  readonly posted: string[];
  readonly reads: string[];
  readonly opened: string[];
}

/** A plain fake transport: guarded posts record, identity is fixed, everything else throws. */
function fakeTransport({
  calls,
  self,
}: {
  calls: Calls;
  self: { userId?: string; botId?: string };
}): SlackWriteTransport {
  const unused =
    ({ name }: { name: string }) =>
    async (): Promise<never> => {
      throw new Error(`${name} is not exercised by this test`);
    };
  const record = async ({ channel }: { channel: string }): Promise<PostedMessage> => {
    calls.posted.push(channel);
    return { channel, ts: "1790611538.684019" };
  };
  return {
    ...workspaceShapeRefusals({ path: "the repeat guard" }),
    addReaction: async () => true,
    appendStream: unused({ name: "appendStream" }),
    attachAssistantMedia: unused({ name: "attachAssistantMedia" }),
    attachMedia: unused({ name: "attachMedia" }),
    attachRecipeResponseMedia: unused({ name: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: async () => true,
    deleteMessageOnce: async () => ({ kind: "gone" }),
    openConversation: async ({ userIds }) => {
      calls.opened.push(userIds.join(","));
      return { alreadyExisted: true, id: "D0SYN000005", name: undefined };
    },
    postAssistantMessage: record,
    postCard: record,
    postDripMessage: record,
    postNoFold: record,
    postPoll: record,
    postRecipeResponse: record,
    postTurn: record,
    readBackFileCount: async () => 0,
    readMessage: async () => undefined,
    readReactions: async () => undefined,
    removeReaction: async () => true,
    setAssistantStatus: unused({ name: "setAssistantStatus" }),
    setThreadTitle: unused({ name: "setThreadTitle" }),
    startStream: unused({ name: "startStream" }),
    stopStream: unused({ name: "stopStream" }),
    updateCard: unused({ name: "updateCard" }),
    correctMessage: unused({ name: "correctMessage" }),
    updateDripMessage: unused({ name: "updateDripMessage" }),
    updateTurn: unused({ name: "updateTurn" }),
    uploadPrivately: unused({ name: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({ ...self, workspaceUrl: "https://acme.slack.com/" }),
  };
}

/** Seams over a fixed place: every read answers `raw`, or the given failure. */
function seams({
  calls,
  raw,
  failure,
  hatch = false,
}: {
  calls: Calls;
  raw: readonly unknown[];
  failure?: string;
  hatch?: boolean;
}): RepeatGuardSeams {
  return {
    hatchIsOpen: () => hatch,
    nowMs: () => NOW_MS,
    readPlace: async ({ channel, threadTs }) => {
      calls.reads.push(threadTs === undefined ? channel : `${channel} ${threadTs}`);
      return failure === undefined ? ok(raw) : err(failure);
    },
  };
}

/** An as-me plain drip carrying `text`. */
function drip({ text }: { text: string }): SlackDripMessagePayload {
  return { form: "plain", text, unfurl_links: true, unfurl_media: true };
}

/** The accent wrapper a card and a turn frame share, its words in the fallback. */
function wrapper({ text }: { text: string }): SlackCardWrapper {
  return {
    blocks: [{ elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
    color: "#12B5A6",
    fallback: text,
  };
}

/** A bot card whose words ride in the wrapper's fallback. */
function card({ text }: { text: string }): SlackCardPayload {
  return {
    attachments: [wrapper({ text })],
    metadata: {
      event_payload: { artifactFingerprint: "fp", artifactKind: "update", renderer: "slack-card-v1", schemaVersion: 1 },
      event_type: "slopweaver_card_v1",
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** A no-fold bot message whose words ride in `text`, as the renderer sends them. */
function noFold({ text }: { text: string }): SlackNoFoldPayload {
  return {
    blocks: [{ elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
    metadata: {
      event_payload: {
        artifactFingerprint: "fp",
        artifactKind: "no-fold",
        renderer: "slack-no-fold-v1",
        schemaVersion: 1,
      },
      event_type: "slopweaver_card_v1",
    },
    text,
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** A live turn frame, keyed by its turn. */
function turnFrame({ text }: { text: string }): SlackTurnPayload {
  return {
    attachments: [wrapper({ text })],
    metadata: { event_payload: { renderer: "slack-turn-v1", schemaVersion: 1, turnId: "t-1" }, event_type: "turn" },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** The incident's first cut as Slack stores it, from the owner. */
const HIS_FIRST_CUT = { text: `${FIRST_LINE}\nfirst cut`, ts: "1790604264.247109", user: OWNER_ID };

/** The error a send threw, or undefined when it went through. */
async function thrownBy({ send }: { send: () => Promise<unknown> }): Promise<unknown> {
  try {
    await send();
    return undefined;
  } catch (error) {
    return error;
  }
}

const newCalls = (): Calls => ({ opened: [], posted: [], reads: [] });

describe("guardRepeats", () => {
  it("refuses the incident's second cut before the wire, naming the first cut's permalink", async () => {
    const calls = newCalls();
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [HIS_FIRST_CUT] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    const error = await thrownBy({
      send: () =>
        guarded.postDripMessage({
          channel: BUGS,
          payload: drip({ text: `${FIRST_LINE}\nsecond cut` }),
          threadTs: undefined,
        }),
    });
    expect(error).toBeInstanceOf(RepeatSendRefusedError);
    const refused = error as RepeatSendRefusedError;
    expect(refused.permalink).toBe("https://acme.slack.com/archives/C0SYN000003/p1790604264247109");
    expect(refused.message).toContain("https://acme.slack.com/archives/C0SYN000003/p1790604264247109");
    expect(refused.message).toContain("slopweaver hatch open repeat-send");
    expect(calls.posted).toEqual([]);
    expect(calls.reads).toEqual([BUGS]);
    expect(classifySendFailure({ error })).toEqual({ kind: "refused-before-wire" });
  });

  it("lets the same words through when somebody else said them", async () => {
    const calls = newCalls();
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [{ ...HIS_FIRST_CUT, user: "U0SYNSOMEONE" }] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    await guarded.postDripMessage({
      channel: BUGS,
      payload: drip({ text: `${FIRST_LINE}\nsecond cut` }),
      threadTs: undefined,
    });
    expect(calls.posted).toEqual([BUGS]);
  });

  it("matches the bot by its bot id, reading a card's words from its fallback, and reads the thread for a reply", async () => {
    const calls = newCalls();
    const botSaid = {
      bot_id: BOT_ID,
      attachments: [{ fallback: "Daily digest: nothing new" }],
      text: "",
      ts: "1790604264.247109",
      user: BOT_USER,
    };
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [botSaid] }),
      transport: fakeTransport({ calls, self: { botId: BOT_ID, userId: BOT_USER } }),
    });
    const error = await thrownBy({
      send: () =>
        guarded.postCard({
          channel: BUGS,
          payload: card({ text: "Daily digest: nothing new" }),
          threadTs: "1790600000.000100",
        }),
    });
    expect(error).toBeInstanceOf(RepeatSendRefusedError);
    expect(calls.reads).toEqual([`${BUGS} 1790600000.000100`]);
  });

  it("fails closed when the place cannot be read, and passes when the hatch is open", async () => {
    const calls = newCalls();
    const closed = guardRepeats({
      seams: seams({ calls, failure: "not_in_channel", raw: [] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    const error = await thrownBy({
      send: () => closed.postDripMessage({ channel: BUGS, payload: drip({ text: "hello" }), threadTs: undefined }),
    });
    expect((error as RepeatSendRefusedError).message).toContain(
      "could not be read to check for a repeat: not_in_channel",
    );
    const open = guardRepeats({
      seams: seams({ calls, failure: "not_in_channel", hatch: true, raw: [] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    await open.postDripMessage({ channel: BUGS, payload: drip({ text: "hello" }), threadTs: undefined });
    expect(calls.posted).toEqual([BUGS]);
  });

  it("refuses when auth.test names no user id", async () => {
    const calls = newCalls();
    const guarded = guardRepeats({ seams: seams({ calls, raw: [] }), transport: fakeTransport({ calls, self: {} }) });
    const error = await thrownBy({
      send: () => guarded.postDripMessage({ channel: BUGS, payload: drip({ text: "hello" }), threadTs: undefined }),
    });
    expect((error as RepeatSendRefusedError).message).toContain("auth.test named no user id");
    expect(calls.reads).toEqual([]);
  });

  it("refuses before the wire when opening a DM throws, so the reservation is released rather than held", async () => {
    const calls = newCalls();
    const transport = fakeTransport({ calls, self: { userId: OWNER_ID } });
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [] }),
      transport: {
        ...transport,
        openConversation: async () => {
          throw new Error("socket hang up");
        },
      },
    });
    const error = await thrownBy({
      send: () =>
        guarded.postDripMessage({ channel: "U0SYNSOMEONE", payload: drip({ text: "hello" }), threadTs: undefined }),
    });
    expect((error as RepeatSendRefusedError).message).toContain(
      "looking up the place failed (socket hang up), so U0SYNSOMEONE could not be checked for a repeat",
    );
    expect(classifySendFailure({ error })).toEqual({ kind: "refused-before-wire" });
    expect(calls.posted).toEqual([]);
  });

  it("reads a DM addressed by a person's id through its opened conversation", async () => {
    const calls = newCalls();
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    await guarded.postDripMessage({ channel: "U0SYNSOMEONE", payload: drip({ text: "hello" }), threadTs: undefined });
    expect(calls.opened).toEqual(["U0SYNSOMEONE"]);
    expect(calls.reads).toEqual(["D0SYN000005"]);
  });

  it("lets an automation prompt repeat its own words, and refuses the same no-fold message sent once", async () => {
    const calls = newCalls();
    const bot = { botId: BOT_ID, userId: BOT_USER };
    const yesterday = { bot_id: BOT_ID, text: PROMPT_TEXT, ts: "1790525138.684019", user: BOT_USER };
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [yesterday] }),
      transport: fakeTransport({ calls, self: bot }),
    });
    await guarded.postNoFold({
      channel: PROMPT_DM,
      payload: noFold({ text: PROMPT_TEXT }),
      recurrence: "automation-prompt",
      threadTs: undefined,
    });
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([PROMPT_DM]);
    const error = await thrownBy({
      send: () =>
        guarded.postNoFold({
          channel: PROMPT_DM,
          payload: noFold({ text: PROMPT_TEXT }),
          recurrence: "once",
          threadTs: undefined,
        }),
    });
    expect(error).toBeInstanceOf(RepeatSendRefusedError);
    expect((error as RepeatSendRefusedError).permalink).toBe(
      "https://acme.slack.com/archives/D0SYN000001/p1790525138684019",
    );
    expect(calls.reads).toEqual([PROMPT_DM]);
    expect(calls.posted).toEqual([PROMPT_DM]);
  });

  it("never reads for a turn frame", async () => {
    const calls = newCalls();
    const guarded = guardRepeats({
      seams: seams({ calls, raw: [HIS_FIRST_CUT] }),
      transport: fakeTransport({ calls, self: { userId: OWNER_ID } }),
    });
    await guarded.postTurn({ channel: BUGS, payload: turnFrame({ text: FIRST_LINE }), threadTs: undefined });
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([BUGS]);
  });
});
