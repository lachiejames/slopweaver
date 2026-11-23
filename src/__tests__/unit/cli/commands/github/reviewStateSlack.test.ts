import { describe, expect, it } from "vitest";

import {
  gatherSlack,
  mentionsFor,
  type SlackLegDeps,
  slackIdentityOf,
} from "../../../../../cli/commands/github/reviewStateSlack.js";
import { readLiveSlack } from "../../../../../cli/commands/github/reviewStateSlackLive.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";
import {
  type ReviewerReadRow,
  type ReviewerRegisterError,
  ReviewerRegisterErrors,
  readingsByPr,
} from "../../../../../review/reviewerRegister.js";
import type { SlackMention } from "../../../../../review/slackEvidenceTypes.js";

const HEAD = "3333333333333333333333333333333333333333";
const WATERMARK = "2026-08-29T10:47:20.000Z";
const NOW = "2026-08-30T12:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/16371";

/** The collapsed hit: a bare link, no mention run on it — the message the search actually returned. */
const HIT_TS = "1788040000.000100";
/** Its sibling minutes later, which tags a reviewer and is the ask the search collapsed away. */
const SIBLING_TS = "1788040120.000200";

/** One live pull request, reduced to the fields the Slack legs read. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "octocat",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "main",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: {
    baseRef: "main",
    checks: [],
    headSha: HEAD,
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  },
  checksRead: { kind: "read" },
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-08-20T00:00:00Z",
  defaultBranch: "main",
  headOid: HEAD,
  headRefName: "a-branch",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  number: 16371,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a change",
  updatedAtIso: "2026-08-20T00:00:00Z",
  url: PR_URL,
  ...over,
});

/** The two messages the channel really holds, as `conversations.history` returns them: newest first. */
const HISTORY_ROWS: readonly unknown[] = [
  { text: `<@U9> could you review this? ${PR_URL}`, ts: SIBLING_TS, user: "U1" },
  { text: `${PR_URL}`, ts: HIT_TS, user: "U1" },
];

/** A thread root's key, `channel:rootTs`. */
const ROOT_KEY = "C8:1789775392.910229";

/** The owner's batch root as a visible session read it: an ask the classifier left undecided. */
const BATCH_READ: ReviewerReadRow = {
  atIso: "2026-09-18T08:00:00.000Z",
  bySession: "a-reader",
  channel: "C8",
  isDirectMessage: false,
  kind: "read",
  messageKey: ROOT_KEY,
  number: 16371,
  permalink: "https://acme.slack.com/archives/C8/p1789775392910229",
  prKey: "acme/widgets#16371",
  quote: "<@U9> <https://github.com/acme/widgets/pull/16371|#16371>",
  readAtIso: "2026-09-25T02:00:00.000Z",
  recipients: ["U9"],
  repoSlug: "acme/widgets",
  schema: 1,
  verdict: "ask",
};

/** A reply in that thread, reaching the pull request only through the root. */
const INHERITOR: SlackMention = {
  association: "thread",
  atIso: "2026-09-18T09:00:00.000Z",
  authorId: "U1",
  authorRole: "owner",
  authoredPrCount: 0,
  authoredText: "Bump for review on these",
  channel: "#dev-alerts",
  conversation: "channel",
  counterpartId: "",
  excerpt: "Bump for review on these",
  firstLinkAt: -1,
  isDirectMessage: false,
  leg: "corpus",
  linkSpans: [],
  mentions: [],
  messageKey: "C8:1789779000.000100",
  permalink: "https://acme.slack.com/archives/C8/p1789779000000100",
  prKey: "acme/widgets#16371",
  quotedPrKeys: [],
  tagged: [],
  threadKey: ROOT_KEY,
  threadPrKeys: ["acme/widgets#16371"],
  versionsDisagree: false,
};

/** The root itself, as the corpus returned it. */
const FOUND_ROOT: SlackMention = {
  ...INHERITOR,
  association: "linked",
  atIso: "2026-09-18T08:00:00.000Z",
  authoredText: BATCH_READ.quote,
  excerpt: BATCH_READ.quote,
  messageKey: ROOT_KEY,
  permalink: BATCH_READ.permalink,
  threadPrKeys: [],
};

/** What the reviewer register answers when every row is read. */
type ReadingsAnswer = Result<ReadonlyMap<string, ReadonlyMap<string, ReviewerReadRow>>, ReviewerRegisterError>;

/** What one `gatherSlack` pass was given and what its fakes were asked for. */
interface Harness {
  readonly deps: SlackLegDeps;
  readonly diagnostics: string[];
  readonly historyCalls: string[];
  readonly replyCalls: string[];
}

/**
 * Plain fakes for every Slack seam — no mocks, per `.claude/rules/testing.md`.
 *
 * `conversations` is a seam a case can withhold entirely, which is how the "the walk never ran" case is
 * written without pretending a walk failed.
 */
function harness({
  historyRows = HISTORY_ROWS,
  historyThrows,
  conversations,
  corpus = [],
  readings = ok(new Map()),
}: {
  corpus?: readonly SlackMention[];
  historyRows?: readonly unknown[];
  historyThrows?: boolean;
  conversations?: boolean;
  readings?: ReadingsAnswer;
}): Harness {
  const diagnostics: string[] = [];
  const historyCalls: string[] = [];
  const replyCalls: string[] = [];
  const api: Pick<SlackApi, "history" | "replies"> = {
    history: ({ channel, oldest, latest }) => {
      historyCalls.push(`${channel}:${oldest}:${latest}`);
      if (historyThrows === true) {
        throw new Error("not_in_channel");
      }
      return Promise.resolve({ hasMore: false, messages: historyRows });
    },
    replies: ({ channel, ts }) => {
      replyCalls.push(`${channel}:${ts}`);
      // Slack's conversations.replies answers the root first; the owner's post roots every thread these tests read.
      return Promise.resolve({ hasMore: false, messages: [{ text: PR_URL, ts, user: "U1" }] });
    },
  };
  return {
    deps: {
      askReadings: () => readings,
      corpusMentions: () => ok(corpus),
      corpusThrough: () => WATERMARK,
      now: () => new Date(NOW),
      slackConversations: () => (conversations === false ? undefined : api),
      slackIdentity: () => ({ ownerSlackUserId: "U1", selfUserIds: [] }),
      slackSearch: () => () =>
        Promise.resolve(
          ok({
            matches: [
              {
                channelId: "C7",
                channelName: "dev-team",
                permalink: "https://acme.slack.com/archives/C7/p1788040000000100",
                text: PR_URL,
                ts: HIT_TS,
                tsIso: "2026-08-29T21:46:40.000Z",
                userId: "U1",
              },
            ],
            pageCount: 1,
            total: 1,
          }),
        ),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    historyCalls,
    replyCalls,
  };
}

describe("gatherSlack and the read around a collapsed live hit", () => {
  it("finds the tagged sibling the search collapsed away, so the ask is seen at all", async () => {
    const built = harness({});
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    const mentions = mentionsFor({ grouped: gathered.grouped, pr: pr() });
    expect(mentions.map((mention) => mention.messageKey)).toEqual([`C7:${SIBLING_TS}`, `C7:${HIT_TS}`]);
    expect(mentions[0]!.tagged).toEqual(["U9"]);
  });

  it("walks the conversation over exactly the corpus's blind window, and the hit's own thread", async () => {
    const built = harness({});
    await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(built.historyCalls).toEqual(["C7:1788000440.000000:1788091200.000000"]);
    // The hit's anchor thread, then whole the thread under each linking post of the owner's — the sibling ask's
    // too, since which of the owner's posts is a share is decided after the reads.
    expect(built.replyCalls).toEqual([`C7:${HIT_TS}`, `C7:${SIBLING_TS}`, `C7:${HIT_TS}`]);
  });

  it("reads whole the thread under each linking post of the owner's, for a share's absence of a reply", async () => {
    const built = harness({});
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(Object.keys(gathered.coverage.shareThreads)).toEqual([`C7:${SIBLING_TS}`, `C7:${HIT_TS}`]);
  });

  it("claims the window it read, so one live hit stops proving the exhaustive leg is behind", async () => {
    const built = harness({});
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(gathered.coverage.neighbourhoods).toEqual([{ channelId: "C7", fromIso: WATERMARK, throughIso: NOW }]);
  });

  it("claims NO window when the walk failed, and says why in the residue", async () => {
    const built = harness({ historyThrows: true });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(gathered.coverage.neighbourhoods).toEqual([]);
    expect(gathered.coverage.residue.join("\n")).toContain("read-around of C7 failed");
  });

  it("claims no window when there is no conversation seam to walk with", async () => {
    const built = harness({ conversations: false });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(gathered.coverage.neighbourhoods).toEqual([]);
    expect(built.historyCalls).toEqual([]);
  });

  it("walks no conversation when the live search leg is off, yet still reads the thread under the owner's post", async () => {
    // The owner's post as the corpus returned it, in a channel and linking the pull request.
    const post: SlackMention = {
      ...FOUND_ROOT,
      authorRole: "owner",
      conversation: "channel",
      messageKey: `C7:${HIT_TS}`,
      prKey: "acme/widgets#16371",
      threadKey: `C7:${HIT_TS}`,
    };
    const built = harness({ corpus: [post] });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: false,
    });
    expect(built.historyCalls).toEqual([]);
    expect(gathered.coverage.neighbourhoods).toEqual([]);
    // The tick and the page's Sync run without --slack-live; a share's "no reply" still needs its thread read.
    expect([built.replyCalls, Object.keys(gathered.coverage.shareThreads)]).toEqual([
      [`C7:${HIT_TS}`],
      [`C7:${HIT_TS}`],
    ]);
  });

  it("retires the collapsing caveat for the conversation it read, and names it", async () => {
    const built = harness({});
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: true,
    });
    expect(gathered.coverage.residue.join("\n")).toContain("which were read exhaustively: C7");
  });
});

describe("gatherSlack and the recorded readings", () => {
  it("attaches a reading to the message a leg found, so the landing answers with it", async () => {
    const built = harness({ corpus: [FOUND_ROOT, INHERITOR], readings: ok(readingsByPr({ rows: [BATCH_READ] })) });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: false,
    });
    const mentions = mentionsFor({ grouped: gathered.grouped, pr: pr() });
    expect(mentions.map((mention) => [mention.messageKey, mention.reading?.verdict])).toEqual([
      [INHERITOR.messageKey, undefined],
      [ROOT_KEY, "ask"],
    ]);
  });

  it("adds nothing for a reading of a message no leg returned, even while a reply in its thread is found", async () => {
    const built = harness({ corpus: [INHERITOR], readings: ok(readingsByPr({ rows: [BATCH_READ] })) });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: false,
    });
    expect(mentionsFor({ grouped: gathered.grouped, pr: pr() })).toEqual([INHERITOR]);
  });

  it("says so and reads past a register it cannot read, leaving what the legs found", async () => {
    const built = harness({
      readings: err(ReviewerRegisterErrors.corruptRow({ lineNumber: 3, why: "it is not JSON" })),
    });
    const gathered = await gatherSlack({
      deps: built.deps,
      home: "/nowhere",
      liveHome: undefined,
      prs: [pr()],
      slackLive: false,
    });
    expect(mentionsFor({ grouped: gathered.grouped, pr: pr() })).toEqual([]);
    expect(built.diagnostics).toEqual([
      "recorded ask readings were not applied: reviewer register line 3 is not a row this build can read: it is not JSON",
    ]);
  });
});

describe("readLiveSlack", () => {
  it("reads nothing and claims nothing when neither live seam runs", async () => {
    const grouped = new Map<string, SlackMention[]>();
    const lines: string[] = [];
    const read = await readLiveSlack({
      conversations: undefined,
      corpusThroughIso: "2026-08-29T10:47:20.000Z",
      grouped,
      identity: { ownerSlackUserId: "U1", selfUserIds: [] },
      nowIso: "2026-08-30T12:00:00.000Z",
      onProblem: (line) => lines.push(line),
      prs: [],
      search: undefined,
    });
    expect(read).toEqual({ problems: [], shareThreads: {}, windows: [] });
    expect([grouped.size, lines]).toEqual([0, []]);
  });
});

describe("slackIdentityOf", () => {
  it("carries the owner's declared as-me bot, so the whole-thread read can resolve its raw rows to them", () => {
    expect(
      slackIdentityOf({
        slackBot: { botIds: ["B0ASME"], ownerUserId: "U0SYN000001", selfUserIds: ["U0SYNBOTSELF01"] },
      }),
    ).toEqual({
      ownerBot: { appIds: [], botIds: ["B0ASME"], botUserIds: [], ownerSlackUserId: "U0SYN000001" },
      ownerSlackUserId: "U0SYN000001",
      selfUserIds: ["U0SYNBOTSELF01"],
    });
  });

  it("carries no as-me bot with no owner to resolve to, and nobody is the owner with no declaration", () => {
    expect([
      slackIdentityOf({ slackBot: { selfUserIds: ["U0SYNBOTSELF01"] } }),
      slackIdentityOf({ slackBot: undefined }),
    ]).toEqual([
      { ownerSlackUserId: "", selfUserIds: ["U0SYNBOTSELF01"] },
      { ownerSlackUserId: "", selfUserIds: [] },
    ]);
  });
});
