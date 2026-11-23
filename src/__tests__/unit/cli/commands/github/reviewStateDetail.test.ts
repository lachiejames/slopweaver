import { describe, expect, it } from "vitest";

import {
  changesRequestedLine,
  codeownerTeamsLine,
  failingCheckLines,
  githubCodeownersLine,
  requiredContextsLine,
  reviewStateDetailBlock,
  threadLines,
  unresolvedLine,
} from "../../../../../cli/commands/github/reviewStateDetail.js";
import { codeownerReviewState } from "../../../../../review/codeownerRules.js";
import { parseCodeowners } from "../../../../../review/codeowners.js";
import { codeownerTeamRequirement } from "../../../../../review/codeownerTeams.js";
import { githubCodeownerRequirement } from "../../../../../review/githubCodeowners.js";
import type { FailingCheckDetail, ThreadDetail } from "../../../../../review/prStateDetail.js";
import type { PrReviewState } from "../../../../../review/reviewState.js";

const detail = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  commentCount: 1,
  id: "PRRT_kwDOfake1",
  disposition: "awaiting-us",
  isOutdated: false,
  lastCommentAtIso: "2026-09-03T07:11:23Z",
  lastCommentLine: "**Blocking.** This renders `CheckoutError`",
  lastCommentLogin: "arlom-acme",
  line: 209,
  openedAtIso: "2026-09-03T07:11:23Z",
  openedByLogin: "arlom-acme",
  openerLine: "**Blocking.** This renders `CheckoutError`",
  path: "apps/customerApp/webV2/src/components/CheckoutV2/CheckoutPaymentProcessPage.tsx",
  ...over,
});

const state = (over: Partial<PrReviewState> = {}): PrReviewState =>
  ({
    approvedBy: [],
    approverResidue: [],
    authorLogin: "octocat",
    baseRefName: "staging",
    createdAtIso: "2026-09-10T00:00:00Z",
    bump: { eligibleAtIso: "2026-09-08T00:00:00Z", kind: "too-soon", why: "asked 2h ago" },
    ci: "green",
    ciDetail: "22/22 passed, 0 failed, 0 pending",
    githubCodeowners: githubCodeownerRequirement({
      requests: [],
      requestsTruncated: false,
      reviews: [],
      reviewsTruncated: false,
    }),
    codeRabbit: "green",
    codeRabbitDetail: "CodeRabbit approved the current head with nothing outstanding",
    codeowners: {
      owed: [],
      rules: [],
      teams: codeownerTeamRequirement({ rules: [] }),
      verdict: "satisfied",
      why: "no codeowner rules apply",
    },
    conflict: { conflicted: false, paths: [], why: "" },
    failingChecks: [],
    headRefName: "mx-2387-checkout",
    number: 16415,
    recommendation: "already-asked",
    repoSlug: "acme/acme-admin",
    requestedReviewers: [],
    requiredApprovers: [],
    requiredContexts: {
      branch: "staging",
      kind: "read",
      mergeable: undefined,
      missing: [],
      required: ["build"],
      unproven: [],
    },
    reviewedSinceAsk: [],
    channelShare: undefined,
    slack: { asked: "yes", asks: [], mentioned: "yes", mentions: [], why: "" },
    stack: { chain: [], position: 0, stacked: false },
    standingChangesRequested: [],
    threadBodiesRead: true,
    threads: [],
    title: "fix(KK-2387): stop checkout bouncing a paying customer to the app root",
    undrafted: true,
    updatedAtIso: "2026-09-03T07:11:24Z",
    url: "https://github.com/acme/acme-admin/pull/16415",
    waitingOn: [],
    ...over,
  }) as PrReviewState;

describe("unresolvedLine", () => {
  it("answers no when every thread is resolved or our own", () => {
    const clean = state({ threads: [detail({ disposition: "resolved" }), detail({ disposition: "ours-open" })] });
    expect(unresolvedLine({ state: clean })).toBe("unresolved comments: no");
  });

  // The whole point of the verb, in one line: the count, and WHO is waiting.
  it("names the count and each waiting login", () => {
    const dirty = state({
      threads: [detail(), detail()],
      waitingOn: [{ login: "arlom-acme", open: 2 }],
    });
    expect(unresolvedLine({ state: dirty })).toBe("unresolved comments: YES — 2 open from arlom-acme (2)");
  });

  it("says separately how many open threads are our own self-review notes", () => {
    const mixed = state({
      threads: [detail(), detail({ disposition: "ours-open", openedByLogin: "octocat" })],
      waitingOn: [{ login: "arlom-acme", open: 1 }],
    });
    expect(unresolvedLine({ state: mixed })).toBe(
      "unresolved comments: YES — 1 open from arlom-acme (1); 1 more are our own self-review notes, not a reviewer's",
    );
  });
});

describe("threadLines", () => {
  it("prints where the thread is, who raised it, its disposition and its opening line", () => {
    expect(threadLines({ thread: detail() })).toEqual([
      "  · apps/customerApp/webV2/src/components/CheckoutV2/CheckoutPaymentProcessPage.tsx:209 — arlom-acme, AWAITING US",
      '      "**Blocking.** This renders `CheckoutError`"',
    ]);
  });

  it("adds the reply line when somebody answered, so push-back is readable rather than inferred", () => {
    const answered = detail({
      commentCount: 2,
      disposition: "answered-open",
      lastCommentLine: "Disagree — the RUM query keys on the old string",
      lastCommentLogin: "octocat",
    });
    expect(threadLines({ thread: answered })[2]).toBe(
      '      ↳ octocat: "Disagree — the RUM query keys on the old string"',
    );
  });

  it("drops the line number for a file-level thread and marks an outdated one", () => {
    expect(threadLines({ thread: detail({ isOutdated: true, line: 0, openerLine: "" }) })).toEqual([
      "  · apps/customerApp/webV2/src/components/CheckoutV2/CheckoutPaymentProcessPage.tsx [outdated] — arlom-acme, AWAITING US",
    ]);
  });
});

describe("failingCheckLines", () => {
  const failing = (over: Partial<FailingCheckDetail> = {}): FailingCheckDetail => ({
    kind: "check-run",
    name: "build",
    required: true,
    state: "failed",
    url: "https://github.com/acme/acme-admin/actions/runs/1",
    ...over,
  });

  it("marks a required failure REQUIRED and an advisory one advisory", () => {
    expect(
      failingCheckLines({ failing: [failing(), failing({ name: "E2E", required: false, url: undefined })] }),
    ).toEqual([
      "  · build — failed, REQUIRED — https://github.com/acme/acme-admin/actions/runs/1",
      "  · E2E — failed, advisory",
    ]);
  });

  it("says required unknown rather than advisory when the base protection was unread", () => {
    expect(failingCheckLines({ failing: [failing({ required: undefined, url: undefined })] })).toEqual([
      "  · build — failed, required unknown",
    ]);
  });
});

describe("requiredContextsLine", () => {
  it("names the required set on a base that has one", () => {
    expect(requiredContextsLine({ state: state() })).toBe("staging requires build");
  });

  it("says plainly that every red is advisory when the base requires nothing", () => {
    const none = state({
      requiredContexts: {
        branch: "staging",
        kind: "read",
        mergeable: undefined,
        missing: [],
        required: [],
        unproven: [],
      },
    });
    expect(requiredContextsLine({ state: none })).toBe(
      "staging requires no status-check contexts, so every red above is advisory",
    );
  });

  it("names a required context that never ran at all — the false green", () => {
    const missing = state({
      requiredContexts: {
        branch: "staging",
        kind: "read",
        mergeable: undefined,
        missing: ["integration"],
        required: ["build", "integration"],
        unproven: [],
      },
    });
    expect(requiredContextsLine({ state: missing })).toBe(
      "staging requires build, integration · 1 REQUIRED NEVER RAN: integration",
    );
  });

  it("reports an unreadable gate with its reason instead of calling the base ungated", () => {
    const unread = state({ requiredContexts: { kind: "unreadable", reason: "the token cannot read protection" } });
    expect(requiredContextsLine({ state: unread })).toBe(
      "required contexts UNREAD (the token cannot read protection) — an advisory red cannot be told from a blocking one here",
    );
  });
});

describe("codeownerTeamsLine", () => {
  // THE OWNER'S ASK. Working the owning teams out in GitHub's own interface is a massive pain,
  // and the half that decides the owner's day is the connective: two teams that BOTH owe a review is a different
  // day from two teams either of which will do.
  it("names the teams and says AND when two rules are owned by two different teams", () => {
    const codeowners = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["apps/one/a.ts", "apps/two/b.ts"],
      requestedReviewers: ["alpha", "beta"],
      rules: parseCodeowners({ content: "/apps/one/ @org/alpha\n/apps/two/ @org/beta\n" }),
    });
    expect(codeownerTeamsLine({ state: state({ codeowners }) })).toBe(
      "codeowner teams: @org/alpha AND @org/beta — AND: every one of those teams owes its own review " +
        "(2 team requirements across 2 rules)",
    );
  });

  it("says OR when one rule names both teams, from the identical two tokens", () => {
    const codeowners = codeownerReviewState({
      approvedLogins: new Set<string>(),
      approvedTeams: new Set<string>(),
      authorLogin: "the-owner",
      changedPaths: ["apps/one/a.ts"],
      requestedReviewers: ["alpha", "beta"],
      rules: parseCodeowners({ content: "/apps/one/ @org/alpha @org/beta\n" }),
    });
    expect(codeownerTeamsLine({ state: state({ codeowners }) })).toBe(
      "codeowner teams: @org/alpha OR @org/beta — OR: any ONE of those teams satisfies it " +
        "(1 team requirement across 1 rule)",
    );
  });

  it("prints the line on a block whose paths invoke no rule at all, rather than dropping it", () => {
    const block = reviewStateDetailBlock({ state: state({ threads: [] }) });
    expect(block).toContain("codeowner teams: no CODEOWNERS rule was invoked at all, so no team owes a review");
  });
});

describe("githubCodeownersLine", () => {
  it("names the owners GitHub itself is applying, with the state of each", () => {
    const githubCodeowners = githubCodeownerRequirement({
      requests: [{ asCodeOwner: true, kind: "team", name: "org/eng" }],
      requestsTruncated: false,
      reviews: [{ login: "someone", onBehalfOf: ["org/data"], state: "APPROVED" }],
      reviewsTruncated: false,
    });
    expect(githubCodeownersLine({ state: state({ githubCodeowners }) })).toBe(
      "github codeowners: GitHub reports these code owners: @org/data (approved), @org/eng (pending)",
    );
  });

  it("prints the line above the two derived ones, on a block GitHub flags no owner on", () => {
    const block = reviewStateDetailBlock({ state: state({ threads: [] }) });
    expect(block).toContain("github codeowners: GitHub reports no code-owner review requirement on this pull request");
    expect(block.findIndex((line) => line.startsWith("github codeowners: "))).toBeLessThan(
      block.findIndex((line) => line.startsWith("codeowner teams: ")),
    );
  });
});

describe("reviewStateDetailBlock", () => {
  it("answers the owner's four questions in their order, for the pull request that started this", () => {
    const block = reviewStateDetailBlock({
      state: state({
        threads: [detail()],
        waitingOn: [{ login: "arlom-acme", open: 1 }],
      }),
    });
    expect(block[0]).toBe(
      "acme/acme-admin#16415 — fix(KK-2387): stop checkout bouncing a paying customer to the app root",
    );
    expect(block[4]).toBe("CodeRabbit approved: yes (CodeRabbit approved the current head with nothing outstanding)");
    expect(block[5]).toBe("changes requested by: none");
    expect(block[6]).toBe("unresolved comments: YES — 1 open from arlom-acme (1)");
    expect(block).toContain("CI: green — 22/22 passed, 0 failed, 0 pending");
  });

  it("says CodeRabbit is not approved, naming the verdict, when it is not green", () => {
    const block = reviewStateDetailBlock({
      state: state({ codeRabbit: "changes-requested", codeRabbitDetail: "CodeRabbit requested changes" }),
    });
    expect(block[4]).toBe("CodeRabbit approved: no — changes-requested (CodeRabbit requested changes)");
  });

  // A block whose quotes are missing must say WHY, or a reader reads an empty excerpt as an empty comment.
  it("says the comment text was not read when this run did not ask for bodies", () => {
    const block = reviewStateDetailBlock({
      state: state({ threadBodiesRead: false, threads: [detail({ openerLine: "" })] }),
    });
    expect(block).toContain(
      "      (comment text not read on this run — add --detail, or name one pull request with --number)",
    );
  });
});

describe("changesRequestedLine", () => {
  it("answers none rather than omitting the line", () => {
    expect(changesRequestedLine({ state: state() })).toBe("changes requested by: none");
  });

  // The owner asks what has changes requested: the bot and every standing human, together.
  it("names CodeRabbit first, then each human whose latest opinion still asks for changes", () => {
    const requested = state({
      codeRabbit: "changes-requested",
      standingChangesRequested: [{ atIso: "2026-09-07T03:26:04Z", login: "jonahy-acme", opinion: "changes-requested" }],
    });
    expect(changesRequestedLine({ state: requested })).toBe(
      "changes requested by: coderabbitai, jonahy-acme (2026-09-07)",
    );
  });
});
