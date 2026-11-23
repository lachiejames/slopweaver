/**
 * `talk slack-open` over plain fake `conversations.replies` and `.history` seams, through the real permalink parser,
 * page walk and projection: a thread comes back whole with its root kept, a DM message with no replies comes back
 * as the conversation around it, and a lone channel message — or one whose conversation cannot be told — alone.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { toIngestError } from "../../../lib/ingestError.js";
import { errAsync, okAsync, unwrap } from "../../../lib/result.js";
import { SLACK_READ_ANSWER_MAX_BYTES } from "../../../talk/slackMessageFit.js";
import { readSlackOpen, SLACK_OPEN_MAX_BYTES, type SlackOpenDeps } from "../../../talk/slackOpen.js";

const OWNER = "U0SYNOWNER1234";
const ROSA = "U0SYNROSA123";
const NOW_MS = Date.parse("2026-10-06T05:00:00.000Z");
const MAPS = { channelNames: {}, userNames: { [OWNER]: "Ada Owner", [ROSA]: "Rosa Lindqvist" } };

const ROOT_TS = "1791000000.000100";
const ISO_THREAD = [
  { reply_count: 2, text: "ISO audit: A annual or B quarterly?", thread_ts: ROOT_TS, ts: ROOT_TS, user: ROSA },
  { text: "leaning B", thread_ts: ROOT_TS, ts: "1791000100.000100", user: OWNER },
  { text: `<@${OWNER}> so B?`, thread_ts: ROOT_TS, ts: "1791000200.000100", user: ROSA },
];

/** `conversations.info` as Slack answers it: a `D` id is a 1:1 DM, anything else a channel. */
const infoByPrefix: SlackOpenDeps["info"] = ({ channel }) =>
  okAsync({ channel: { id: channel, is_im: channel.startsWith("D"), is_mpim: false } });

/** Seams over fixed threads (by root ts) and one DM's history; any other read throws. */
function seamsOver({
  threads,
  dmHistory,
  info = infoByPrefix,
}: {
  threads: Readonly<Record<string, readonly unknown[]>>;
  dmHistory: readonly Record<string, unknown>[];
  info?: SlackOpenDeps["info"];
}): SlackOpenDeps {
  const replies: SlackApi["replies"] = async ({ ts }) => ({ hasMore: false, messages: threads[ts]! });
  // Slack's history answers newest first, `oldest`/`latest` exclusive unless `inclusive`.
  const history: SlackApi["history"] = async ({ oldest, latest, inclusive, pageSize }) => {
    const inRange = dmHistory.filter((row) => {
      const ts = Number(row["ts"]);
      const afterOldest = inclusive === true ? ts >= Number(oldest) : ts > Number(oldest);
      return afterOldest && ts < Number(latest);
    });
    return { hasMore: inRange.length > pageSize!, messages: inRange.toReversed().slice(0, pageSize) };
  };
  return { api: { history, replies }, info, maps: MAPS, nowMs: () => NOW_MS };
}

/** A lone message in a channel: its neighbours are other people's business, so history must never be read. */
const CHANNEL_MESSAGE = { text: "anyone own the GCP monitors?", ts: "1791000000.000100", user: ROSA };
const CHANNEL_NEIGHBOUR = { text: "unrelated chatter", ts: "1791000100.000100", user: OWNER };

describe("readSlackOpen", () => {
  it("opens a thread whole, root kept as the opening, people named, with a sentence saying whose word is last", async () => {
    const deps = seamsOver({ dmHistory: [], threads: { [ROOT_TS]: ISO_THREAD } });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/C0SYNISO12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("thread");
    expect(answer.opening!.text).toBe("ISO audit: A annual or B quarterly?");
    expect(answer.messages.map((message) => `${message.author}: ${message.text}`)).toEqual([
      "Ada Owner: leaning B",
      "Rosa Lindqvist: @Ada Owner so B?",
    ]);
    expect(answer.people).toEqual(["Rosa Lindqvist", "Ada Owner"]);
    expect(answer.total).toBe(3);
    expect(answer.omitted).toBe(0);
    expect(answer.answer).toBe(
      "A thread Rosa Lindqvist started at 2026-10-03T04:00:00.000Z, with 2 replies; the last word is Rosa Lindqvist's " +
        "at 2026-10-03T04:03:20.000Z, read live at 2026-10-06T05:00:00.000Z.",
    );
    // The voice keeps each claim as the thread put it, never told to paraphrase it.
    expect(answer.note).toContain("a decision between options — each claim as a message put it (its number, 'not'");
    expect(answer.note).not.toContain("own words");
  });

  it("keeps the opening and the NEWEST replies when the thread is over the size cap", async () => {
    const deps = seamsOver({ dmHistory: [], threads: { [ROOT_TS]: ISO_THREAD } });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        // The opening serialises to ~116 bytes, the newest reply ~100, the older one ~90: room for one reply.
        maxBytes: 260,
        permalink: "https://acme.slack.com/archives/C0SYNISO12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.opening!.text).toBe("ISO audit: A annual or B quarterly?");
    expect(answer.messages.map((message) => message.text)).toEqual(["@Ada Owner so B?"]);
    expect(answer.omitted).toBe(1);
  });

  it("reads two long replies to their END — a thread once cut at 1,200 characters each", async () => {
    const review = `feedback from my robot to yours ${"the reach claim is wrong ".repeat(110)}— end of Jasper's review`;
    const answer = `in plain english ${"the fix was never wrong ".repeat(80)}— end of the bot's answer`;
    const thread = [
      { reply_count: 2, text: "fresh batch of vulnerability-fix PRs", thread_ts: ROOT_TS, ts: ROOT_TS, user: OWNER },
      { text: review, thread_ts: ROOT_TS, ts: "1791000100.000100", user: ROSA },
      { text: answer, thread_ts: ROOT_TS, ts: "1791000200.000100", user: OWNER },
    ];
    const read = unwrap(
      await readSlackOpen({
        deps: seamsOver({ dmHistory: [], threads: { [ROOT_TS]: thread } }),
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/C0SYNISO12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(review.length).toBeGreaterThan(2400);
    expect(read.messages.map((message) => message.text)).toEqual([review, answer]);
    expect(read.cut).toEqual([]);
    expect(read.omitted).toBe(0);
  });

  it("keeps a worst-case DM conversation's whole answer inside the read ceiling, naming what it cut", async () => {
    const authors = Array.from({ length: 55 }, (_, at) => `U0PERSON${String(at).padStart(3, "0")}`);
    const names = Object.fromEntries(
      authors.map((id, at) => [id, `A colleague with a long display name ${String(at)}`]),
    );
    const linked = { text: `"quoted"\n${"\\".repeat(900)}`, ts: "1791000000.000100", user: authors[0]! };
    const following = authors.slice(1).map((user, at) => ({
      text: `"${"é\u0001".repeat(700)}"`,
      ts: `${String(1791000001 + at)}.000100`,
      user,
    }));
    const base = seamsOver({ dmHistory: [linked, ...following], threads: { [linked.ts]: [linked] } });
    const read = unwrap(
      await readSlackOpen({
        deps: { ...base, maps: { channelNames: {}, userNames: names } },
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: ["read with the BOT token: a private conversation the bot is not in cannot be read"],
      }),
    );
    expect(Buffer.byteLength(JSON.stringify(read), "utf8")).toBeLessThanOrEqual(SLACK_READ_ANSWER_MAX_BYTES);
    expect(read.opening!.text).toBe(linked.text);
    expect(read.people.length).toBe(51);
    expect(read.cut.length).toBe(1);
    expect(read.answer).toContain(`Too long to carry whole in one answer, so cut: ${read.cut[0]!.author}'s at`);
    expect(read.omitted + read.messages.length).toBe(50);
  });

  it("opens a DM message with no replies as the conversation around it: context before, everything after", async () => {
    const dm = [
      { text: "morning", ts: "1790990000.000100", user: ROSA },
      { text: "morning!", ts: "1790990100.000100", user: OWNER },
      { text: "can you look at the ISO evidence?", ts: "1791000000.000100", user: ROSA },
      { text: "A or B, which do you want?", ts: "1791000100.000100", user: ROSA },
    ];
    const deps = seamsOver({ dmHistory: dm, threads: { "1791000000.000100": [dm[2]!] } });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("conversation");
    expect(answer.opening!.text).toBe("can you look at the ISO evidence?");
    expect(answer.messages.map((message) => message.text)).toEqual([
      "morning",
      "morning!",
      "A or B, which do you want?",
    ]);
    expect(answer.total).toBe(4);
    expect(answer.answer).toBe(
      "A conversation of 4 messages around Rosa Lindqvist's at 2026-10-03T04:00:00.000Z; the last word is Rosa " +
        "Lindqvist's at 2026-10-03T04:01:40.000Z, read live at 2026-10-06T05:00:00.000Z.",
    );
  });

  it("keeps the linked DM message as the opening when more than a page follows it, and says some between are missing", async () => {
    const linked = { text: "A or B for the audit?", ts: "1791000000.000100", user: ROSA };
    const following = Array.from({ length: 52 }, (_, index) => ({
      text: `reply ${String(index)}`,
      ts: `${String(1791000001 + index)}.000100`,
      user: OWNER,
    }));
    const deps = seamsOver({ dmHistory: [linked, ...following], threads: { [linked.ts]: [linked] } });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("conversation");
    expect(answer.opening!.text).toBe("A or B for the audit?");
    expect(answer.total).toBe(51);
    expect(answer.messages[0]!.text).toBe("reply 2");
    expect(answer.warnings).toEqual([
      "more than 50 messages follow the linked one; only the newest 50 were read, so some between are missing",
    ]);
  });

  it("opens a lone CHANNEL message alone, never the channel's history around it", async () => {
    const deps = seamsOver({
      dmHistory: [CHANNEL_MESSAGE, CHANNEL_NEIGHBOUR],
      threads: { [CHANNEL_MESSAGE.ts]: [CHANNEL_MESSAGE] },
    });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/C0SYNGCP12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("thread");
    expect(answer.opening!.text).toBe("anyone own the GCP monitors?");
    expect(answer.messages).toEqual([]);
    expect(answer.total).toBe(1);
    expect(answer.warnings).toEqual([]);
  });

  it("opens only the linked message, and says why, when whether it is a DM cannot be read", async () => {
    const deps = seamsOver({
      dmHistory: [CHANNEL_MESSAGE, CHANNEL_NEIGHBOUR],
      info: () =>
        errAsync(toIngestError({ error: new Error("channel_not_found"), operation: "slack.conversations.info" })),
      threads: { [CHANNEL_MESSAGE.ts]: [CHANNEL_MESSAGE] },
    });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("thread");
    expect(answer.total).toBe(1);
    expect(answer.warnings).toHaveLength(1);
    expect(answer.warnings[0]).toContain("whether this is a DM could not be read");
    expect(answer.warnings[0]).toContain("so only what the link names was opened");
  });

  it("warns, never opens it as a channel, when Slack's answer names no DM flags", async () => {
    const deps = seamsOver({
      dmHistory: [],
      info: ({ channel }) => okAsync({ channel: { id: channel }, ok: true }),
      threads: { [ROOT_TS]: ISO_THREAD },
    });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("thread");
    expect(answer.warnings).toEqual([
      "whether this is a DM could not be told (Slack's answer named no DM flags), so only what the link names was opened",
    ]);
  });

  it("opens a DM link to a message with replies as the thread AND the unread messages after it", async () => {
    // A DM row links its oldest unread message; here that one started a thread, and the question came after it.
    const doc = {
      reply_count: 1,
      text: "here is the ISO doc",
      thread_ts: "1791000100.000100",
      ts: "1791000100.000100",
      user: ROSA,
    };
    const reply = { text: "page 3 matters", thread_ts: doc.ts, ts: "1791000150.000100", user: ROSA };
    const question = { text: "option A or B?", ts: "1791000200.000100", user: ROSA };
    const deps = seamsOver({ dmHistory: [doc, question], threads: { [doc.ts]: [doc, reply] } });
    const answer = unwrap(
      await readSlackOpen({
        deps,
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000100000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("conversation");
    expect(answer.opening!.text).toBe("here is the ISO doc");
    expect(answer.messages.map((message) => message.text)).toEqual(["page 3 matters", "option A or B?"]);
    expect(answer.total).toBe(3);
    expect(answer.warnings).toEqual([]);
  });

  it("opens what the link names, and says why, when the DM's history read fails — never a false timeout", async () => {
    const base = seamsOver({ dmHistory: [], threads: { [ROOT_TS]: ISO_THREAD } });
    const history: SlackApi["history"] = async () => {
      throw new Error("ratelimited");
    };
    const answer = unwrap(
      await readSlackOpen({
        deps: { ...base, api: { ...base.api, history } },
        maxBytes: SLACK_OPEN_MAX_BYTES,
        permalink: "https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100",
        warnings: [],
      }),
    );
    expect(answer.shape).toBe("thread");
    expect(answer.total).toBe(3);
    expect(answer.warnings).toHaveLength(1);
    expect(answer.warnings[0]).toContain("the conversation around it could not be read");
    expect(answer.warnings[0]).toContain("ratelimited");
  });
});
