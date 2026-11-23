/*
 * One whole `github bump-drive` pass over injected seams — the acts it takes, in order, and what it records.
 *
 * Every seam is a plain recording function, not a mock (`.claude/rules/testing.md`).
 */
import type { AutonomyActionRow } from "../../../../../../autonomy/types.js";
import type { GithubBumpDriveDeps } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import type { GithubReviewStateDeps } from "../../../../../../cli/commands/github/reviewStateRun.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { PrLivePage, PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { Organisation } from "../../../../../../organisation/core.js";
import type { OrganisationError } from "../../../../../../organisation/errors.js";
import type { MergedRenovatePr, OwnOpenPr } from "../../../../../../review/bumpSupersede.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../../review/reviewRoster.js";
import { ACME_WITH_RENOVATE } from "./fixtures.js";

/** What one pass produced, and what it asked its seams for. */
interface Harness {
  readonly deps: GithubBumpDriveDeps;
  readonly out: string[];
  readonly closed: string[];
  readonly readied: string[];
  readonly pressed: string[];
  readonly registered: string[][];
  readonly rewritten: string[][];
  readonly seamAsks: { readonly ask: string; readonly checkout: string | undefined }[];
  readonly autonomyRows: AutonomyActionRow[];
  readonly diagnostics: string[];
  /** Every organisation read the pass made, by the home it asked under. */
  readonly organisationReads: (string | undefined)[];
  /** Every repository whose resolution the pass asked GitHub for. */
  readonly resolutions: string[];
  /** Every supersede read the pass made: `own` for the owner's open list, `merged:<repo>` for one merged search. */
  readonly supersedeReads: string[];
}

/**
 * The deps for one pass over `prs`, every seam a recording function and every answer the case does not name a
 * clean one.
 *
 * @param prs the fleet read's one page of open pull requests
 * @param unresolved what GitHub answers for a repository it does not resolve; every other one resolves
 * @param organisation what the organisation read answers: the acme organisation naming `acme-renovate` unless the case says otherwise
 * @param ledger acts already on the ledger before the pass; the rows the pass writes are read back after them
 * @returns the deps to pass, and every act, read and printed line they recorded
 */
// max-lines-exempt: one plain-object fake of the whole GithubBumpDriveDeps interface, its length that interface's, moved verbatim out of a test file this gate skips
export function harness({
  prs,
  readyExit = 0,
  pressExit = 0,
  rewriteExit = 0,
  ledger = [],
  ledgerUnreadable = false,
  board = new Map(),
  askRefused = false,
  own = [],
  merged = [],
  organisation = ok(ACME_WITH_RENOVATE),
  unresolved = new Map(),
}: {
  prs: readonly PrLiveState[];
  /** What GitHub answers for a repository it does not resolve; every other one resolves. */
  unresolved?: ReadonlyMap<string, GithubLiveError>;
  /** What the organisation read answers: the acme organisation naming `acme-renovate` unless the case says otherwise. */
  organisation?: Result<Organisation, OrganisationError>;
  own?: readonly OwnOpenPr[];
  merged?: readonly MergedRenovatePr[];
  board?: ReadonlyMap<string, readonly LandingBoardRow[]>;
  readyExit?: number;
  pressExit?: number;
  rewriteExit?: number;
  /** Acts already on the ledger before the pass; the rows the pass writes are read back after them. */
  ledger?: readonly AutonomyActionRow[];
  ledgerUnreadable?: boolean;
  askRefused?: boolean;
}): Harness {
  const seamAsks: { readonly ask: string; readonly checkout: string | undefined }[] = [];
  const organisationReads: (string | undefined)[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const readied: string[] = [];
  const pressed: string[] = [];
  const registered: string[][] = [];
  const rewritten: string[][] = [];
  const closed: string[] = [];
  const autonomyRows: AutonomyActionRow[] = [];
  const resolutions: string[] = [];
  const supersedeReads: string[] = [];
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
    // Bump-drive's own top-level `resolveRepository` is its gate; the landing read beneath it never asks this one.
    resolveRepository: () => Promise.reject(new Error("the landing read must never ask the review-state seam")),
    roster: () => Promise.resolve(ok(EMPTY_REVIEW_ROSTER)),
    slackIdentity: () => ({ ownerSlackUserId: "U1", selfUserIds: [] }),
    slackConversations: () => undefined,
    askReadings: () => ok(new Map()),
    slackSearch: () => undefined,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  const deps: GithubBumpDriveDeps = {
    boardBranches: () => board,
    closePr: ({ rest }) => {
      closed.push(rest.slice(0, 4).join(" "));
      return Promise.resolve(0);
    },
    mergedRenovatePrs: ({ repoSlug }) => {
      supersedeReads.push(`merged:${repoSlug}`);
      return Promise.resolve(ok(merged));
    },
    ownOpenPrs: () => {
      supersedeReads.push("own");
      return Promise.resolve(ok(own));
    },
    recheckPr: ({ number }) => Promise.resolve(ok(own.find((pr) => pr.number === number))),
    // bump-drive reads no census; a case reaching this seam is the harness being wrong.
    openCensus: () => Promise.resolve([]),
    // Only `landing --pr` reads a job log or a file list; a case reaching either is the harness being wrong.
    pullRequestFiles: () => Promise.reject(new Error("this verb reads no pull request file list")),
    readJobLogs: () => Promise.reject(new Error("this verb reads no job log")),
    // bump-drive never passes `--register`, so it never settles an ended pull request's row.
    prClosure: () => Promise.reject(new Error("bump-drive reads no pull request's closure")),
    rowNow: () => {
      throw new Error("bump-drive re-reads no board row");
    },
    settleRow: () => Promise.reject(new Error("bump-drive settles no board row")),
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
        // Every case seeds `prs` with the row it then asks about, so a miss here is the harness being wrong
        // rather than an absent state worth substituting for.
        Promise.resolve(ok(prs.find((state) => state.number === number)!)),
    markReady: ({ rest }) => {
      readied.push(rest.join(" "));
      return Promise.resolve(readyExit);
    },
    now: () => new Date("2026-09-20T02:00:00.000Z"),
    // Nothing this verb does re-requests a CodeRabbit review; a case reaching these seams is the harness being wrong.
    nudgedHeads: () => ok(new Set()),
    requestCodeRabbitReview: () => Promise.resolve(0),
    reserveNudge: () => ok("reserved"),
    sleep: () => Promise.resolve(),
    press: ({ rest }) => {
      pressed.push(rest.join(" "));
      return Promise.resolve(pressExit);
    },
    presses: () => Promise.resolve(ok(new Map())),
    queueFor: () => Promise.resolve(ok({ kind: "queue", url: "https://github.com/acme/widgets/queue/main" })),
    reads: () => Promise.resolve(ok(new Map())),
    ledgerActs: () => {
      if (ledgerUnreadable) {
        return Promise.resolve(err("the autonomy ledger lives in the store, and the store could not be opened"));
      }
      return Promise.resolve(ok([...ledger, ...autonomyRows]));
    },
    recordAutonomy: ({ row }) => {
      autonomyRows.push(row);
      return Promise.resolve(undefined);
    },
    recordPress: () => Promise.resolve(undefined),
    recordRead: ({ record }) => Promise.resolve(ok(record)),
    appendReviewerAsks: () => ok(0),
    recordReading: () => ok("not recorded by this verb"),
    readOrganisation: ({ home }) => {
      organisationReads.push(home);
      return Promise.resolve(organisation);
    },
    resolveRepository: ({ repoSlug }) => {
      resolutions.push(repoSlug);
      const refusal = unresolved.get(repoSlug);
      return Promise.resolve(refusal === undefined ? ok({ nameWithOwner: repoSlug }) : err(refusal));
    },
    registerRow: ({ argv }) => {
      registered.push([...argv]);
      return Promise.resolve(0);
    },
    reviewState,
    rewriteBody: ({ argv }) => {
      rewritten.push([...argv]);
      return Promise.resolve(rewriteExit);
    },
    sessionRef: () => "workspace:291-49",
    askUnrootable: ({ ask, checkout }) => {
      seamAsks.push({ ask, checkout });
      return askRefused;
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return {
    autonomyRows,
    closed,
    deps,
    diagnostics,
    organisationReads,
    out,
    pressed,
    readied,
    registered,
    resolutions,
    rewritten,
    seamAsks,
    supersedeReads,
  };
}
