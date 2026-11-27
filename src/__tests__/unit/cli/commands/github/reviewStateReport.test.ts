import { describe, expect, it } from "vitest";
import { assembleReviewState } from "../../../../../cli/commands/github/reviewStateReport.js";
import { reviewedOnGithub } from "../../../../../cli/commands/github/reviewStateShare.js";
import {
  approverCell,
  recommendationTally,
  reviewStateDocument,
  reviewStateRow,
} from "../../../../../cli/commands/github/reviewStateTable.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";
import { parseCodeowners } from "../../../../../review/codeowners.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../../../review/prLink.js";
import { threadDetails } from "../../../../../review/prStateDetail.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../review/reviewRoster.js";
import type { SlackCoverage, SlackMention } from "../../../../../review/slackEvidenceTypes.js";
import { soloPlace } from "../../../../../review/stack.js";
import { CODEOWNERS, COVERAGE, NO_REQUIRED_CONTEXTS, NOW, pr, SOLO } from "./reviewStateReportFixtures.js";

/**
 * A Slack mention, with the fields a test cares about overridden.
 *
 * The authored text is DERIVED from `tagged` unless a test supplies its own, exactly as the effectful shell
 * derives the tags from the text — so `tagged: ["U9"]` means "the owner wrote a review ask naming U9".
 */
const mention = (over: Partial<SlackMention> = {}): SlackMention => {
  const {
    tagged = [],
    authoredText = `${tagged.map((id) => `<@${id}>`).join(" ")} pls review <https://github.com/o/r/pull/1>`.trimStart(),
  } = over;
  const links = findPrLinkSpans({ text: authoredText });
  return {
    atIso: "2026-08-28T00:30:00.000Z",
    authoredPrCount: new Set(links.map((entry) => `${entry.ref.owner}/${entry.ref.repo}#${entry.ref.number}`)).size,
    authoredText,
    firstLinkAt: firstLinkStart({ spans: links }),
    versionsDisagree: false,
    quotedPrKeys: [],
    authorId: "U1",
    authorRole: "owner",
    channel: "#dev",
    conversation: "channel",
    counterpartId: "",
    excerpt: "please review",
    isDirectMessage: false,
    leg: "corpus",
    linkSpans: links.map((entry) => entry.span),
    mentions: mentionRunsIn({ text: authoredText }),
    messageKey: "C1:1",
    threadKey: "C1:1",
    association: "linked",
    threadPrKeys: [],
    permalink: "p1",
    prKey: "o/r#1",
    tagged,
    ...over,
  };
};

describe("assembleReviewState", () => {
  it("answers all seven questions for a green, unasked, undrafted pull request", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.ci).toBe("green");
    expect(state.codeRabbit).toBe("none");
    expect(state.undrafted).toBe(true);
    expect(state.requiredApprovers).toEqual([
      { isAuthor: false, kind: "user", paths: ["apps/etl/main.ts"], token: "@kel" },
    ]);
    expect(state.slack.mentioned).toBe("no");
    expect(state.slack.asked).toBe("no");
    expect(state.recommendation).toBe("send-ask");
  });

  it("carries GitHub's merge status through the projection, because the landing tests decide on it", () => {
    // `assembleReviewState` narrows a live read down to what the six landing tests may see. A field dropped
    // here reads as `unread` downstream and every pending code-owner request goes back to holding.
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ githubMergeStatus: { kind: "blocked", status: "BLOCKED" } }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.githubMergeStatus).toEqual({ kind: "blocked", status: "BLOCKED" });
  });

  it("reports the repository declaring no CODEOWNERS as residue rather than as no owner", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: undefined,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.approverResidue).toEqual(["o/r declares no CODEOWNERS, so no approver is required by ownership"]);
  });

  it("reports a truncated file read as residue, so a partial owner list never reads as complete", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ changedPathsTruncated: true }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.approverResidue[0]).toBe(
      "more files changed than --file-limit requested; the owner list may be missing a rule",
    );
  });

  it("recommends a bump once an ask has been silent for a business day", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [mention({ tagged: ["U9"] })],
      // Monday late evening AEST: the Friday-morning ask has had 35.5 business hours. NOW, a Sunday, has 13.5.
      nowIso: "2026-08-31T12:00:00.000Z",
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.slack.asked).toBe("yes");
    expect(state.recommendation).toBe("bump");
  });

  it("names the humans who reviewed since the ask, so a bump is never sent blind", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [mention({ tagged: ["U9"] })],
      nowIso: NOW,
      pr: pr({
        reviews: [
          {
            commitOid: "abc",
            login: "coderabbitai",
            state: "APPROVED",
            submittedAtIso: "2026-08-29T00:00:00Z",
            onBehalfOf: [],
          },
          {
            commitOid: "abc",
            login: "reviewer-one",
            state: "COMMENTED",
            submittedAtIso: "2026-08-29T00:00:00Z",
            onBehalfOf: [],
          },
        ],
      }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.reviewedSinceAsk).toEqual([
      { atIso: "2026-08-29T00:00:00Z", login: "reviewer-one", opinion: "commented" },
    ]);
  });

  it("names nobody as having reviewed since an ask that does not exist", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({
        reviews: [{ commitOid: "abc", login: "reviewer-one", state: "COMMENTED", submittedAtIso: NOW, onBehalfOf: [] }],
      }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.reviewedSinceAsk).toEqual([]);
  });
});

describe("assembleReviewState — shared with a channel, nobody named", () => {
  /** The owner's Friday-morning heads-up linking the pull request, naming nobody; Sunday night is under a business day on. */
  const HEADS_UP = mention({ authoredText: "heads up, E2Es now run on every PR <https://github.com/o/r/pull/1>" });
  const BOT_REVIEW = {
    commitOid: "abc",
    login: "coderabbitai",
    state: "COMMENTED",
    submittedAtIso: NOW,
    onBehalfOf: [],
  };

  /** The state's channel share, read over `live`. */
  const shareOver = (live: PrLiveState) =>
    assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [HEADS_UP],
      nowIso: NOW,
      pr: live,
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    }).channelShare;

  it("reads the post as the share state, citing it, while only a bot has reviewed", () => {
    const share = shareOver(pr({ reviews: [BOT_REVIEW] }))!;
    expect([share.tone, share.permalink, share.channel]).toEqual(["green", "p1", "#dev"]);
  });

  it("carries no ask absence past a corpus a live hit proves behind — only the corpus proves a no", () => {
    const whyOver = ({ leg }: { leg: SlackMention["leg"] }) =>
      assembleReviewState({
        conflictPaths: undefined,
        codeowners: CODEOWNERS,
        coverage: {
          ...COVERAGE,
          corpusThroughIso: "2026-08-27T00:00:00Z",
          shareThreads: { "C1:1": { readAtIso: NOW, replies: [] } },
        },
        mentions: [{ ...HEADS_UP, leg }],
        nowIso: NOW,
        pr: pr(),
        requiredContexts: NO_REQUIRED_CONTEXTS,
        roster: EMPTY_REVIEW_ROSTER,
        stack: SOLO,
        threadBodiesRead: true,
      }).channelShare!.why;
    expect([whyOver({ leg: "live" }), whyOver({ leg: "corpus" })]).toEqual([
      "0.6 business days into the first business day; live Slack holds a message newer than the corpus, so an ask may not be seen yet",
      "0.6 business days into the first business day; asks are read only through 2026-08-27 00:00Z, so an ask may not be seen yet",
    ]);
  });

  it("holds red over a URL-less reply of the owner's the thread read saw after the watermark, with live search off", () => {
    // The production `--no-slack-live` path: no live leg, the corpus a few hours behind, the thread read whole.
    const toneOver = ({ replies }: { replies: SlackCoverage["shareThreads"][string]["replies"] }) =>
      assembleReviewState({
        conflictPaths: undefined,
        codeowners: CODEOWNERS,
        coverage: {
          ...COVERAGE,
          corpusThroughIso: "2026-09-03T08:00:00Z",
          liveRan: false,
          shareThreads: { "C1:1": { readAtIso: "2026-09-03T12:00:00.000Z", replies } },
        },
        mentions: [HEADS_UP],
        nowIso: "2026-09-03T12:00:00.000Z",
        pr: pr(),
        requiredContexts: NO_REQUIRED_CONTEXTS,
        roster: EMPTY_REVIEW_ROSTER,
        stack: SOLO,
        threadBodiesRead: true,
      }).channelShare!.tone;
    const ask = { atIso: "2026-09-03T10:00:00.000Z", authorRole: "owner" as const, messageKey: "C1:2" };
    expect([toneOver({ replies: [] }), toneOver({ replies: [ask] })]).toEqual(["red", "unknown"]);
  });

  it("keeps the share over a review or thread GitHub typed a Bot, whose GraphQL login carries no [bot] suffix", () => {
    const copilot = { ...BOT_REVIEW, byBot: true as const, login: "copilot-pull-request-reviewer" };
    const [opened] = threadDetails({
      prAuthorLogin: pr().authorLogin,
      threads: [
        {
          commentCount: 1,
          id: "PRRT_bot",
          isOutdated: false,
          isResolved: false,
          lastCommentAtIso: "2026-08-30T10:00:00Z",
          lastCommentBody: "a suggestion",
          lastCommentLogin: "copilot-pull-request-reviewer",
          line: 1,
          openedAtIso: "2026-08-30T10:00:00Z",
          openedByBot: true,
          openedByLogin: "copilot-pull-request-reviewer",
          openerBody: "a suggestion",
          path: "a.ts",
        },
      ],
    });
    expect([
      reviewedOnGithub({ pr: pr({ reviews: [copilot] }), threads: [] }),
      reviewedOnGithub({ pr: pr(), threads: [opened!] }),
      reviewedOnGithub({
        pr: pr({ reviews: [{ ...BOT_REVIEW, login: "copilot-pull-request-reviewer" }] }),
        threads: [],
      }),
    ]).toEqual([false, false, true]);
  });

  it("stands down once a human has reviewed on GitHub", () => {
    expect(shareOver(pr({ reviews: [{ ...BOT_REVIEW, login: "reviewer-one" }] }))).toBe(undefined);
  });

  it("counts a colleague's or an authorless review as picked up, never the author's own or a bot's", () => {
    const by = ({ login }: { login: string }) =>
      reviewedOnGithub({ pr: pr({ reviews: [{ ...BOT_REVIEW, login }] }), threads: [] });
    expect(
      ["reviewer-one", pr().authorLogin, "coderabbitai", "renovate[bot]", ""].map((login) => by({ login })),
    ).toEqual([true, false, false, false, true]);
  });

  it("stands down when a capped review or thread read could be hiding a human's", () => {
    expect([
      shareOver(pr({ reviews: [BOT_REVIEW], reviewsTruncated: true })),
      shareOver(pr({ threadsTruncated: true })),
    ]).toEqual([undefined, undefined]);
  });

  // A base branch's NAME decides nothing: a personal-looking base is judged by the same stack and CODEOWNERS
  // facts as any other, so it is an ask when it is the default branch and stacked when it is not.
  it("recommends send-ask on a personal-looking base that is the repository's default branch", () => {
    const personal = pr({
      baseRefName: "v2-ada-owner-work-console",
      defaultBranch: "v2-ada-owner-work-console",
      number: 16294,
      repoSlug: "acme/acme-admin",
    });
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: personal,
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: soloPlace({ pr: personal }),
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("send-ask");
  });

  it("recommends stacked on a personal-looking base that is not the repository's default branch", () => {
    const personal = pr({
      baseRefName: "v2-ada-owner-work-console",
      number: 16294,
      repoSlug: "acme/acme-admin",
    });
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: personal,
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: soloPlace({ pr: personal }),
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("stacked");
  });

  it("still recommends send-ask on the very same repository when the base branch is a team-shared one", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ baseRefName: "staging", repoSlug: "acme/acme-admin" }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("send-ask");
  });
});

describe("approverCell", () => {
  it("names only the owners who could actually clear the rule still owed", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: "CODEOWNERS", rules: parseCodeowners({ content: "* @author-login @org/eng\n" }) },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(approverCell({ state })).toBe("1/1 unproven: @org/eng");
  });

  it("says nobody can clear a rule the author alone owns", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: "CODEOWNERS", rules: parseCodeowners({ content: "* @author-login\n" }) },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(approverCell({ state })).toBe("1/1 OWED: self only, so nobody can");
  });

  // THE REGRESSION, end to end through the row a reader actually sees. A named approver whose
  // tick satisfied ONE rule used to fill this cell on its own, which read as ready while GitHub was showing
  // "Review required, 2 pending, merging blocked".
  it("leads with the rules still OWED when one of three is satisfied", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: {
        path: "CODEOWNERS",
        rules: parseCodeowners({
          content: "* @org/everyone\n/api/ @a-colleague\n/apps/data/ @org/data\n/infra/ @org/infra\n",
        }),
      },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({
        changedPaths: ["api/handler.ts", "apps/data/main.ts", "infra/stack.ts"],
        requestedReviewers: ["data", "infra"],
        reviews: [
          {
            commitOid: "abc",
            login: "a-colleague",
            state: "APPROVED",
            submittedAtIso: "2026-08-28T02:00:00Z",
            onBehalfOf: [],
          },
        ],
      }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.codeowners.verdict).toBe("unsatisfied");
    expect(state.approvedBy).toEqual(["a-colleague"]);
    // AND, not a space: two separate rules, so both teams owe their own review. The owner's ask
    // is exactly that a space-joined list cannot tell this apart from either-one-will-do.
    expect(approverCell({ state })).toBe("2/3 OWED: @org/data AND @org/infra");
    expect(state.codeowners.teams.quantifier).toBe("every");
    expect(state.codeowners.teams.sentence).toBe(
      "@org/data AND @org/infra — AND: every one of those teams owes its own review " +
        "(2 team requirements across 2 of 3 rules)",
    );
  });

  // The identical two tokens, one rule: OR. The cell and the team line have to say something different here
  // from the case above, or neither is worth reading.
  it("joins one rule's own two teams with OR, from the identical tokens the AND case prints", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: {
        path: "CODEOWNERS",
        rules: parseCodeowners({ content: "* @org/everyone\n/apps/data/ @org/data @org/infra\n" }),
      },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ changedPaths: ["apps/data/main.ts"], requestedReviewers: ["data", "infra"] }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(approverCell({ state })).toBe("1/1 OWED: @org/data OR @org/infra");
    expect(state.codeowners.teams.quantifier).toBe("any");
  });

  it("says every rule is approved only once nothing is owed", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: "CODEOWNERS", rules: parseCodeowners({ content: "/apps/etl @a-colleague\n" }) },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({
        reviews: [
          {
            commitOid: "abc",
            login: "a-colleague",
            state: "APPROVED",
            submittedAtIso: "2026-08-28T02:00:00Z",
            onBehalfOf: [],
          },
        ],
      }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(approverCell({ state })).toBe("1/1 rules approved");
  });

  // A reviewer who approved and later requested changes has NOT approved, and reading the older tick as
  // standing is how a blocked pull request reports itself ready.
  it("takes each reviewer's LATEST verdict, so a withdrawn approval stops counting", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: "CODEOWNERS", rules: parseCodeowners({ content: "/apps/etl @a-colleague\n" }) },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({
        requestedReviewers: [],
        reviews: [
          {
            commitOid: "abc",
            login: "a-colleague",
            state: "APPROVED",
            submittedAtIso: "2026-08-28T02:00:00Z",
            onBehalfOf: [],
          },
          {
            commitOid: "abc",
            login: "a-colleague",
            state: "CHANGES_REQUESTED",
            submittedAtIso: "2026-08-28T03:00:00Z",
            onBehalfOf: [],
          },
        ],
      }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.approvedBy).toEqual([]);
    expect(approverCell({ state })).toBe("1/1 OWED: @a-colleague");
  });

  it("says nothing is required when no rule matches at all", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: "CODEOWNERS", rules: [] },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(approverCell({ state })).toBe("—");
  });
});

describe("reviewStateRow and the tally", () => {
  const state = assembleReviewState({
    conflictPaths: undefined,
    codeowners: CODEOWNERS,
    coverage: COVERAGE,
    mentions: [],
    nowIso: NOW,
    pr: pr({ isDraft: true }),
    requiredContexts: NO_REQUIRED_CONTEXTS,
    roster: EMPTY_REVIEW_ROSTER,
    stack: SOLO,
    threadBodiesRead: true,
  });

  it("puts the pull-request number, the draft flag and the action on one line", () => {
    const row = reviewStateRow({ state });
    expect(row).toContain("#1");
    expect(row).toContain("YES");
    expect(row).toContain("still-draft");
    expect(row).toContain("@kel · a title");
  });

  it("counts each recommendation once", () => {
    expect(recommendationTally({ states: [state, state] })).toBe("still-draft 2");
  });

  it("labels a self-merging row with its own recommendation name, in the tally too", () => {
    const selfMerging = assembleReviewState({
      conflictPaths: undefined,
      codeowners: { path: ".github/CODEOWNERS", rules: parseCodeowners({ content: "* @author-login\n" }) },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(selfMerging.recommendation).toBe("self-merges");
    expect(reviewStateRow({ state: selfMerging })).toContain("self-merges");
    expect(recommendationTally({ states: [selfMerging] })).toBe("self-merges 1");
  });

  // The 16355 ruling: a pull request targeting another pull request's branch is stacked, never an ask, and
  // its row says so — even though it is a draft, which would otherwise read "still-draft".
  it("answers stacked for a draft pull request whose base is not the default branch, and carries its place", () => {
    const sixth = pr({ baseRefName: "stack/5", headRefName: "stack/6", isDraft: true, number: 16355 });
    const stacked = assembleReviewState({
      codeowners: CODEOWNERS,
      conflictPaths: undefined,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: sixth,
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: soloPlace({ pr: sixth }),
      threadBodiesRead: true,
    });
    expect(stacked.recommendation).toBe("stacked");
    expect(stacked.stack.baseRefName).toBe("stack/5");
    expect(reviewStateRow({ state: stacked })).toContain("stacked, no ask");
    expect(recommendationTally({ states: [stacked] })).toBe("stacked 1");
  });
});

describe("reviewStateDocument", () => {
  it("carries the coverage, the residue and the resolved owner names", () => {
    const state = assembleReviewState({
      conflictPaths: undefined,
      codeowners: CODEOWNERS,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    const document = reviewStateDocument({
      coverage: COVERAGE,
      residue: ["r1"],
      roster: EMPTY_REVIEW_ROSTER,
      states: [state],
    });
    expect(document["coverage"]).toEqual(COVERAGE);
    expect(document["residue"]).toEqual(["r1"]);
    expect(document["tally"]).toBe("send-ask 1");
  });
});
