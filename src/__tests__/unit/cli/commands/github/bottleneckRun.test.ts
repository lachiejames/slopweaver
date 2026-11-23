/**
 * One whole `github bottleneck` pass over injected seams — the histogram it prints and the document it emits.
 *
 * The verb makes NO read of its own, so what this file really pins is the wiring: the same fleet read
 * `github landing` goes through, with drafts IN by default, reaching the cause ladder unmodified. A draft
 * bump is the largest bar on this repository, so a pass that quietly excluded drafts would hide it.
 *
 * Every seam is a plain recording function, not a mock (`.claude/rules/testing.md`).
 */
import { describe, expect, it } from "vitest";

import { runGithubBottleneck } from "../../../../../cli/commands/github/bottleneckRun.js";
import type { GithubLandingDeps } from "../../../../../cli/commands/github/landingRun.js";
import type { GithubReviewStateDeps } from "../../../../../cli/commands/github/reviewStateRun.js";
import { err, ok } from "../../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { PrLivePage, PrLiveState } from "../../../../../live/github/reviewState.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../review/reviewRoster.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

const HEAD = "2222222222222222222222222222222222222222";

const PASSING = { kind: "check-run", name: "build", state: "passed", url: undefined } as const;

/** One live pull request, green and unblocked unless the case says otherwise. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "acme-renovate",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "main",
  changedPaths: ["yarn.lock"],
  changedPathsTruncated: false,
  checks: {
    baseRef: "main",
    checks: [PASSING],
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
  createdAtIso: "2026-09-14T00:00:00Z",
  defaultBranch: "main",
  headOid: HEAD,
  headRefName: "renovate/typescript-6.x",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  number: 661,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "Update dependency typescript to v6",
  updatedAtIso: "2026-09-19T12:00:00Z",
  url: "https://github.com/acme/widgets/pull/661",
  ...over,
});

/** What one pass printed, and what it asked its seams for. */
interface Harness {
  readonly deps: GithubLandingDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly pressed: string[];
  readonly registered: string[][];
}

function harness({ prs }: { prs: readonly PrLiveState[] }): Harness {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const pressed: string[] = [];
  const registered: string[][] = [];
  const pages: readonly PrLivePage[] = [{ nextCursor: undefined, pullRequests: prs, totalCount: prs.length }];
  let page = 0;
  const reviewState: GithubReviewStateDeps = {
    api: () => ({
      codeowners: () => Promise.resolve(ok({ content: "", path: "CODEOWNERS" })),
      fleetPage: () => {
        const current = pages[page];
        page += 1;
        return Promise.resolve(
          current === undefined ? err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })) : ok(current),
        );
      },
      pr: () => Promise.resolve(ok(prs[0]!)),
    }),
    baseDistances:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(() => ({ kind: "read", value: { aheadBy: 1, behindBy: 319, status: "BEHIND" } }) as const),
        ),
    conflictPaths: () => ({ kind: "paths", paths: [] }),
    corpusMentions: () => ok([]),
    corpusThrough: () => "2026-09-19T00:00:00Z",
    checksCompletion: () => () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "this fixture carries no whole check list" }))),
    mergeableRecheck:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(
            (subject) => ({ kind: "read", value: { headOid: subject.headOid, mergeable: "MERGEABLE" } }) as const,
          ),
        ),
    monotonicMs: () => 0,
    pageDeadline: () => new Promise(() => undefined),
    now: () => new Date("2026-09-20T02:00:00.000Z"),
    requiredContexts: () => Promise.resolve(ok(["build"])),
    resolveRepo: () => ok({ owner: "acme", repo: "widgets" }),
    resolveRepository: () => Promise.reject(new Error("bottleneck must never ask the review-state resolution seam")),
    roster: () => Promise.resolve(ok(EMPTY_REVIEW_ROSTER)),
    slackIdentity: () => ({ ownerSlackUserId: "U1", selfUserIds: [] }),
    slackConversations: () => undefined,
    askReadings: () => ok(new Map()),
    slackSearch: () => undefined,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  const deps: GithubLandingDeps = {
    boardBranches: () => new Map(),
    checkoutFor: () => "/checkouts/widgets",
    headsNow:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(
            (subject) => ({ kind: "read", value: { headOid: subject.headOid, mergeable: "MERGEABLE" } }) as const,
          ),
        ),
    judgmentNow:
      () =>
      ({ number }) =>
        // Nothing in this verb ever re-judges one pull request, so a case reaching this seam is the harness
        // being wrong rather than an absence worth substituting for.
        Promise.resolve(ok(prs.find((state) => state.number === number)!)),
    now: () => new Date("2026-09-20T02:00:00.000Z"),
    // Nothing this verb does re-requests a CodeRabbit review; a case reaching these seams is the harness being wrong.
    nudgedHeads: () => ok(new Set()),
    requestCodeRabbitReview: () => Promise.resolve(0),
    reserveNudge: () => ok("reserved"),
    sleep: () => Promise.resolve(),
    // The backlog verbs read no census; a case reaching this seam is the harness being wrong.
    openCensus: () => Promise.resolve([]),
    // Only `landing --pr` reads a job log or a file list; a case reaching either is the harness being wrong.
    pullRequestFiles: () => Promise.reject(new Error("this verb reads no pull request file list")),
    readJobLogs: () => Promise.reject(new Error("this verb reads no job log")),
    press: ({ rest }) => {
      pressed.push(rest.join(" "));
      return Promise.resolve(0);
    },
    presses: () => Promise.resolve(ok(new Map())),
    queueFor: () => Promise.resolve(ok({ kind: "queue", url: "https://github.com/acme/widgets/queue/main" })),
    reads: () => Promise.resolve(ok(new Map())),
    readOrganisation: () => Promise.resolve(ok(ACME_ORGANISATION)),
    ledgerActs: () => Promise.resolve(ok([])),
    recordAutonomy: () => Promise.resolve(undefined),
    recordPress: () => Promise.resolve(undefined),
    recordRead: ({ record }) => Promise.resolve(ok(record)),
    appendReviewerAsks: () => ok(0),
    recordReading: () => ok("not recorded by this verb"),
    registerRow: ({ argv }) => {
      registered.push([...argv]);
      return Promise.resolve(0);
    },
    // Neither is reached: this verb never passes `--register`, so it never settles an ended pull request's row.
    prClosure: () => Promise.reject(new Error("bottleneck reads no pull request's closure")),
    rowNow: () => {
      throw new Error("bottleneck re-reads no board row");
    },
    settleRow: () => Promise.reject(new Error("bottleneck settles no board row")),
    reviewState,
    sessionRef: () => "workspace:291-49",
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { deps, diagnostics, out, pressed, registered };
}

describe("runGithubBottleneck", () => {
  it("groups a draft and a clear pull request into their own bars and counts the whole backlog", async () => {
    const run = harness({ prs: [pr({ isDraft: true, number: 661 }), pr({ number: 662 })] });

    const code = await runGithubBottleneck({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.out[0]).toBe("2 open pull request(s), 2 distinct cause(s)");
    expect(run.out.filter((line) => line.includes("draft — 1"))).toEqual(["  draft — 1"]);
    expect(run.out.filter((line) => line.includes("clear — 1"))).toEqual(["  clear — 1"]);
  });

  it("counts a draft as a DRAFT even though `github landing` would not list it at all", async () => {
    const run = harness({ prs: [pr({ isDraft: true })] });

    const code = await runGithubBottleneck({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.out[0]).toBe("1 open pull request(s), 1 distinct cause(s)");
  });

  // The drafts-out filter itself lives in the fleet read's own query, which a page fake cannot exercise, so
  // what is falsifiable here is the ONE thing this verb decides: which way the flag reaches that read.
  it("reports drafts as EXCLUDED once `--exclude-drafts` is typed, and as included when it is not", async () => {
    const off = harness({ prs: [pr({ isDraft: true })] });
    const on = harness({ prs: [pr({ isDraft: true })] });

    const excluded = await runGithubBottleneck({
      deps: off.deps,
      rest: ["--repo", "acme/widgets", "--json", "--exclude-drafts"],
    });
    const included = await runGithubBottleneck({ deps: on.deps, rest: ["--repo", "acme/widgets", "--json"] });

    expect(excluded).toBe(0);
    expect(included).toBe(0);
    expect((JSON.parse(off.out[0]!) as { includedDrafts: boolean }).includedDrafts).toBe(false);
    expect((JSON.parse(on.out[0]!) as { includedDrafts: boolean }).includedDrafts).toBe(true);
  });

  it("emits the repositories it read and every row inside its --json document", async () => {
    const run = harness({ prs: [pr({ isDraft: true })] });

    const code = await runGithubBottleneck({ deps: run.deps, rest: ["--repo", "acme/widgets", "--json"] });

    expect(code).toBe(0);
    expect(run.out).toHaveLength(1);
    const doc = JSON.parse(run.out[0]!) as {
      repos: readonly string[];
      nowIso: string;
      includedDrafts: boolean;
      rows: readonly { number: number; cause: string }[];
    };
    expect(doc.repos).toEqual(["acme/widgets"]);
    expect(doc.nowIso).toBe("2026-09-20T02:00:00.000Z");
    expect(doc.includedDrafts).toBe(true);
    expect(doc.rows.map((row) => `${String(row.number)}:${row.cause}`)).toEqual(["661:draft"]);
  });

  it("writes NOTHING through the press or the board, because this verb only reads", async () => {
    const run = harness({ prs: [pr({ isDraft: true }), pr({ number: 662 })] });

    const code = await runGithubBottleneck({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.pressed).toEqual([]);
    expect(run.registered).toEqual([]);
  });

  it("refuses an unparseable --repo with the usage text and the usage exit code", async () => {
    const run = harness({ prs: [] });

    const code = await runGithubBottleneck({ deps: run.deps, rest: ["--repo", "widgets"] });

    expect(code).toBe(2);
    expect(run.diagnostics[0]).toBe("--repo takes one or more comma-separated owner/name slugs");
    expect(run.out).toEqual([]);
  });
});
