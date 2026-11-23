import { describe, expect, it } from "vitest";

import { readAroundHits, readShareThreads } from "../../../../../cli/commands/github/reviewStateReadAround.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import type { SlackSearchMatch } from "../../../../../live/slack/searchMessages.js";
import type { LiveCandidate, SlackMention } from "../../../../../review/slackEvidenceTypes.js";

const WATERMARK = "2026-08-29T10:47:20.000Z";
const NOW = "2026-08-30T12:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/16371";

/** The collapsed hit the live search returned, in a conversation the corpus has not reached. */
const HIT_TS = "1788040000.000100";
/** Its sibling minutes later — the ask the search collapsed away, which only a walk can find. */
const SIBLING_TS = "1788040120.000200";

/** One live search hit, as `search.messages` returned it. */
const match = (over: Partial<SlackSearchMatch> = {}): SlackSearchMatch => ({
  channelId: "C7",
  channelName: "dev-team",
  permalink: `https://acme.slack.com/archives/C7/p${HIT_TS.replace(".", "")}`,
  text: PR_URL,
  ts: HIT_TS,
  tsIso: "2026-08-29T23:06:40.000Z",
  userId: "U1",
  ...over,
});

/** What the conversation really holds, newest first, as `conversations.history` returns it. */
const HISTORY_ROWS: readonly unknown[] = [
  { text: `<@U9> could you review this? ${PR_URL}`, ts: SIBLING_TS, user: "U1" },
  { text: PR_URL, ts: HIT_TS, user: "U1" },
];

/** What one `readAroundHits` pass asked its seams for, and what it handed back to be judged. */
interface Harness {
  readonly api: Pick<SlackApi, "history" | "replies">;
  readonly historyCalls: string[];
  readonly replyCalls: string[];
  readonly folded: LiveCandidate[];
}

/** Plain fakes for both conversation reads — no mocks, per `.claude/rules/testing.md`. */
function harness({ rows = HISTORY_ROWS, throws = false }: { rows?: readonly unknown[]; throws?: boolean }): Harness {
  const historyCalls: string[] = [];
  const replyCalls: string[] = [];
  const folded: LiveCandidate[] = [];
  return {
    api: {
      history: ({ channel, oldest, latest }) => {
        historyCalls.push(`${channel}:${oldest}:${latest}`);
        if (throws) {
          throw new Error("not_in_channel");
        }
        return Promise.resolve({ hasMore: false, messages: rows });
      },
      replies: ({ channel, ts }) => {
        replyCalls.push(`${channel}:${ts}`);
        return Promise.resolve({ hasMore: false, messages: [] });
      },
    },
    folded,
    historyCalls,
    replyCalls,
  };
}

describe("readAroundHits", () => {
  it("walks the corpus's blind window in the hit's own conversation and hands back what it read", async () => {
    const h = harness({});
    const read = await readAroundHits({
      api: h.api,
      corpusThroughIso: WATERMARK,
      fold: ({ candidates }) => h.folded.push(...candidates),
      matches: [match()],
      nowIso: NOW,
    });
    expect(h.historyCalls).toEqual(["C7:1788000440.000000:1788091200.000000"]);
    expect(h.replyCalls).toEqual([`C7:${HIT_TS}`]);
    expect(h.folded.map((candidate) => candidate.ts)).toEqual([HIT_TS, SIBLING_TS]);
    expect(read.windows).toEqual([{ channelId: "C7", fromIso: WATERMARK, throughIso: NOW }]);
    expect(read.problems).toEqual([]);
  });

  it("claims NO window when the walk failed, while still reporting why", async () => {
    const h = harness({ throws: true });
    const read = await readAroundHits({
      api: h.api,
      corpusThroughIso: WATERMARK,
      fold: ({ candidates }) => h.folded.push(...candidates),
      matches: [match()],
      nowIso: NOW,
    });
    expect(read.windows).toEqual([]);
    expect(read.problems[0]).toContain("read-around of C7 failed");
  });

  it("does not walk at all with no watermark, because there is no window to start from", async () => {
    const h = harness({});
    const read = await readAroundHits({
      api: h.api,
      corpusThroughIso: undefined,
      fold: ({ candidates }) => h.folded.push(...candidates),
      matches: [match()],
      nowIso: NOW,
    });
    expect(h.historyCalls).toEqual([]);
    expect(read.windows).toEqual([]);
    expect(read.problems).toEqual([]);
  });

  it("claims no window for a conversation whose rows it could not read", async () => {
    const h = harness({ rows: ["not a row"] });
    const read = await readAroundHits({
      api: h.api,
      corpusThroughIso: WATERMARK,
      fold: ({ candidates }) => h.folded.push(...candidates),
      matches: [match()],
      nowIso: NOW,
    });
    expect(read.windows).toEqual([]);
    expect(read.problems[0]).toContain("read-around of C7 is unreadable");
    expect(h.folded).toEqual([]);
  });
});

describe("readShareThreads", () => {
  const OWNER = "U1";
  /** The owner's post in #dev-team linking the pull request, as the live leg hands it over. */
  const post: SlackMention = {
    association: "linked",
    atIso: "2026-08-29T21:46:40.000Z",
    authorId: OWNER,
    authorRole: "owner",
    authoredPrCount: 1,
    authoredText: PR_URL,
    channel: "#dev-team",
    conversation: "channel",
    counterpartId: "",
    excerpt: PR_URL,
    firstLinkAt: 0,
    isDirectMessage: false,
    leg: "live",
    linkSpans: [],
    mentions: [],
    messageKey: `C7:${HIT_TS}`,
    permalink: match().permalink,
    prKey: "acme/widgets#16371",
    quotedPrKeys: [],
    tagged: [],
    threadKey: `C7:${HIT_TS}`,
    threadPrKeys: [],
    versionsDisagree: false,
  };
  const grouped = new Map([["acme/widgets#16371", [post]]]);
  const identity = { ownerSlackUserId: OWNER, selfUserIds: [] };

  it("reads the whole thread under the owner's post, a reply that links nothing included", async () => {
    const calls: string[] = [];
    const read = await readShareThreads({
      api: {
        replies: ({ channel, ts }) => {
          calls.push(`${channel}:${ts}`);
          return Promise.resolve({
            hasMore: false,
            messages: [
              { text: PR_URL, ts: HIT_TS, user: OWNER },
              { text: "looking now", ts: SIBLING_TS, user: "U9" },
            ],
          });
        },
      },
      grouped,
      identity,
      nowIso: NOW,
    });
    expect(calls).toEqual([`C7:${HIT_TS}`]);
    expect(read.reads).toEqual({
      [`C7:${HIT_TS}`]: {
        readAtIso: NOW,
        replies: [{ atIso: "2026-08-29T21:48:40.000Z", authorRole: "other-human", messageKey: `C7:${SIBLING_TS}` }],
      },
    });
    expect(read.problems).toEqual([]);
  });

  it("claims no read of a thread that would not read, and says why", async () => {
    const read = await readShareThreads({
      api: { replies: () => Promise.reject(new Error("thread_not_found")) },
      grouped,
      identity,
      nowIso: NOW,
    });
    expect(read.reads).toEqual({});
    expect(read.problems[0]).toContain(`the thread under a shared post, C7:${HIT_TS}, would not read`);
  });
});
