/**
 * The owner-reply check `slack replied` prints and `handover currency` runs in-process, driven through
 * the real permalink parser, page walk and projection with plain fake `conversations.replies`/`history` seams.
 *
 * The three answers are the contract: replied (with the reply's own link), not yet, and could not check — an
 * unreadable thread must never read as "not yet", on every row that reads it.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import {
  firstOwnerReplyTs,
  ownerReplyLine,
  readOwnerReply,
  readOwnerReplyInThread,
} from "../../../../live/slack/ownerReply.js";

const OWNER = "U0SYNADAOWN";
const ROOT_TS = "1785114398.557099";
const ASK_TS = "1785114458.000100";
const HIS_TS = "1785114518.000200";
const HIS_ISO = "2026-07-27T01:08:38.000Z";
const NOW_MS = Date.parse("2026-10-02T12:00:00.000Z");

const ROOT_LINK = "https://acme.slack.com/archives/C123/p1785114398557099";
const ASK_LINK = `https://acme.slack.com/archives/C123/p1785114458000100?thread_ts=${ROOT_TS}&cid=C123`;
const DM_LINK = "https://acme.slack.com/archives/D777/p1785114458000100";

const root = { text: "the question", thread_ts: ROOT_TS, ts: ROOT_TS, user: OWNER };
const ask = { text: "the ask", thread_ts: ROOT_TS, ts: ASK_TS, user: "U02ARI" };
const ownerPost = { text: "go with A", thread_ts: ROOT_TS, ts: HIS_TS, user: OWNER };

/** A Slack seam over fixed threads and one DM's top-level history; any other read throws. */
function serving({
  threads,
  dm = [],
}: {
  threads: Readonly<Record<string, readonly unknown[]>>;
  dm?: readonly unknown[];
}): Pick<SlackApi, "replies" | "history"> {
  const replies: SlackApi["replies"] = async ({ ts }) => {
    const messages = threads[ts];
    if (messages === undefined) {
      throw new Error(`no thread should have been asked for at ${ts}`);
    }
    return { hasMore: false, messages };
  };
  const history: SlackApi["history"] = async () => ({ hasMore: false, messages: dm });
  return { history, replies };
}

const check = ({
  permalink,
  api,
  ownerUserId = OWNER,
}: {
  permalink: string;
  api: Pick<SlackApi, "replies" | "history">;
  ownerUserId?: string | null;
}): ReturnType<typeof readOwnerReply> => readOwnerReply({ deps: { api, nowMs: () => NOW_MS }, ownerUserId, permalink });

describe("firstOwnerReplyTs", () => {
  it("takes the owner's earliest message strictly after the anchor, whatever order the read returned", () => {
    const messages = [
      { ts: "1785114600.000000", userId: OWNER },
      { ts: HIS_TS, userId: OWNER },
      { ts: ASK_TS, userId: OWNER },
      { ts: "1785114500.000000", userId: "U02ARI" },
    ];

    expect(firstOwnerReplyTs({ afterTs: ASK_TS, messages, ownerUserId: OWNER })).toBe(HIS_TS);
  });

  it("never counts the anchor itself, even when it is the owner's own message", () => {
    expect(
      firstOwnerReplyTs({ afterTs: ASK_TS, messages: [{ ts: ASK_TS, userId: OWNER }], ownerUserId: OWNER }),
    ).toBeUndefined();
  });

  it("separates two messages inside the same second, which an ISO bound would merge", () => {
    expect(
      firstOwnerReplyTs({
        afterTs: "1785114458.000100",
        messages: [{ ts: "1785114458.000900", userId: OWNER }],
        ownerUserId: OWNER,
      }),
    ).toBe("1785114458.000900");
  });

  it("answers undefined for an empty read", () => {
    expect(firstOwnerReplyTs({ afterTs: ASK_TS, messages: [], ownerUserId: OWNER })).toBeUndefined();
  });
});

describe("readOwnerReply", () => {
  it("finds the owner's reply in the thread and links to it", async () => {
    const reply = await check({
      api: serving({ threads: { [ROOT_TS]: [root, ask, ownerPost] } }),
      permalink: ASK_LINK,
    });

    expect(reply).toEqual({
      atIso: HIS_ISO,
      kind: "replied",
      permalink: `https://acme.slack.com/archives/C123/p1785114518000200?thread_ts=${ROOT_TS}&cid=C123`,
      ts: HIS_TS,
    });
  });

  it("reads not yet when only someone else has posted since", async () => {
    const reply = await check({ api: serving({ threads: { [ROOT_TS]: [root, ask] } }), permalink: ASK_LINK });

    expect(reply).toEqual({ kind: "not-yet", readAtIso: "2026-10-02T12:00:00.000Z" });
  });

  it("does not count the owner's root message before a root link's own anchor", async () => {
    const reply = await check({ api: serving({ threads: { [ROOT_TS]: [root, ask] } }), permalink: ROOT_LINK });

    expect(reply.kind).toBe("not-yet");
  });

  it("counts a top-level answer in a DM, linked as its own root", async () => {
    const dmAsk = { text: "the ask", ts: ASK_TS, user: "U0BOT" };
    const dmAnswer = { text: "yes", ts: HIS_TS, user: OWNER };
    const reply = await check({
      api: serving({ dm: [dmAnswer, dmAsk], threads: { [ASK_TS]: [dmAsk] } }),
      permalink: DM_LINK,
    });

    expect(reply).toEqual({
      atIso: HIS_ISO,
      kind: "replied",
      permalink: "https://acme.slack.com/archives/D777/p1785114518000200",
      ts: HIS_TS,
    });
  });

  it("reads could not check — never not yet — when a DM message comes back with no ts, which may be the owner's", async () => {
    const dmAsk = { text: "the ask", ts: ASK_TS, user: "U0BOT" };
    const reply = await check({
      api: serving({ dm: [{ text: "sent", user: OWNER }, dmAsk], threads: { [ASK_TS]: [dmAsk] } }),
      permalink: DM_LINK,
    });

    expect(reply).toEqual({
      kind: "could-not-check",
      why: "the direct message returned 1 message(s) with no Slack ts",
    });
  });

  it("reads could not check — never not yet — when the thread will not read", async () => {
    const reply = await check({ api: serving({ threads: {} }), permalink: ASK_LINK });

    expect(reply.kind).toBe("could-not-check");
  });

  it("names the missing profile key when it does not know who the owner is", async () => {
    const reply = await check({
      api: serving({ threads: { [ROOT_TS]: [root, ask, ownerPost] } }),
      ownerUserId: null,
      permalink: ASK_LINK,
    });

    expect(reply).toEqual({
      kind: "could-not-check",
      why: "the profile records no Slack user id for you (slackBot.ownerUserId) — run `slopweaver profile`",
    });
  });

  it("reads could not check for a link that is not a Slack message", async () => {
    const reply = await check({ api: serving({ threads: {} }), permalink: "https://github.com/acme/repo/pull/12" });

    expect(reply.kind).toBe("could-not-check");
  });
});

describe("readOwnerReplyInThread", () => {
  const LATER_TS = "1785114600.000300";
  const later = { text: "later", thread_ts: ROOT_TS, ts: LATER_TS, user: "U02ARI" };
  const LATER_LINK = `https://acme.slack.com/archives/C123/p1785114600000300?thread_ts=${ROOT_TS}&cid=C123`;

  it("counts the owner's reply after notBeforeTs even when the link names a later message", async () => {
    const { reply } = await readOwnerReplyInThread({
      deps: { api: serving({ threads: { [ROOT_TS]: [root, ask, ownerPost, later] } }), nowMs: () => NOW_MS },
      notBeforeTs: ASK_TS,
      ownerUserId: OWNER,
      permalink: LATER_LINK,
    });

    expect(reply).toEqual({
      atIso: HIS_ISO,
      kind: "replied",
      permalink: `https://acme.slack.com/archives/C123/p1785114518000200?thread_ts=${ROOT_TS}&cid=C123`,
      ts: HIS_TS,
    });
  });

  it("does not count the owner's message at or before notBeforeTs", async () => {
    const { reply } = await readOwnerReplyInThread({
      deps: { api: serving({ threads: { [ROOT_TS]: [root, ask, ownerPost, later] } }), nowMs: () => NOW_MS },
      notBeforeTs: HIS_TS,
      ownerUserId: OWNER,
      permalink: ASK_LINK,
    });

    expect(reply).toEqual({ kind: "not-yet", readAtIso: "2026-10-02T12:00:00.000Z" });
  });

  it("reads a DM's top level from notBeforeTs, not from a later message the link names", async () => {
    const dmAsk = { text: "the ask", ts: ASK_TS, user: "U0BOT" };
    const dmAnswer = { text: "yes", ts: HIS_TS, user: OWNER };
    const dmLater = { text: "later", ts: LATER_TS, user: "U0BOT" };
    const dm = [dmLater, dmAnswer, dmAsk];
    const history: SlackApi["history"] = async ({ oldest }) => ({
      hasMore: false,
      messages: dm.filter((message) => Number(message.ts) > Number(oldest)),
    });
    const { reply } = await readOwnerReplyInThread({
      deps: { api: { ...serving({ threads: { [LATER_TS]: [dmLater] } }), history }, nowMs: () => NOW_MS },
      notBeforeTs: ASK_TS,
      ownerUserId: OWNER,
      permalink: "https://acme.slack.com/archives/D777/p1785114600000300",
    });

    expect(reply).toEqual({
      atIso: HIS_ISO,
      kind: "replied",
      permalink: "https://acme.slack.com/archives/D777/p1785114518000200",
      ts: HIS_TS,
    });
  });
});

describe("ownerReplyLine", () => {
  it("prints the line the derived done-check greps for", () => {
    const line = ownerReplyLine({
      permalink: ASK_LINK,
      reply: { atIso: HIS_ISO, kind: "replied", permalink: ROOT_LINK, ts: HIS_TS },
    });

    expect(line).toBe(`replied at ${HIS_ISO}: ${ROOT_LINK}`);
    expect(line.startsWith("replied at ")).toBe(true);
  });

  it("names the link and the read instant when the owner has not replied", () => {
    expect(
      ownerReplyLine({ permalink: ASK_LINK, reply: { kind: "not-yet", readAtIso: "2026-10-02T12:00:00.000Z" } }),
    ).toBe(`not yet: no message of yours after the one ${ASK_LINK} names, read 2026-10-02T12:00:00.000Z`);
  });

  it("says could not check with the reason, never not yet", () => {
    expect(ownerReplyLine({ permalink: ASK_LINK, reply: { kind: "could-not-check", why: "no token" } })).toBe(
      "could not check: no token",
    );
  });
});
