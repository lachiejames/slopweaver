/**
 * The production edges for `slopweaver github landing`, and for the two backlog verbs that read through it.
 *
 * Split out of `./landingRun.ts` because it is the whole of that verb's effectful SHELL: every credential
 * read, every local-state write and every seam that reaches a provider is here, and nothing here decides
 * anything. The pure core, the report and the dispatch ladder stay in `./landingRun.ts`.
 */

import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { githubToken, parseRepositorySlug, slopweaverHome } from "../../../config.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { checkoutForRepo } from "../../../live/checkout/checkoutForRepo.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import { makeMergeableRecheck } from "../../../live/github/mergeableRecheck.js";
import { makeGithubMergeQueueReads } from "../../../live/github/mergeQueue.js";
import { readOpenCensus } from "../../../live/github/openCensus.js";
import { MAX_PULL_FILE_PAGES, readPullRequestFileStatuses } from "../../../live/github/pullRequestFilesRead.js";
import { githubReadGraphql, githubReadRest } from "../../../live/github/read.js";
import { CHECK_PAGE, makeGithubReviewStateApi, type PrLiveState } from "../../../live/github/reviewState.js";
import { readOrganisation } from "../../../organisation/read.js";
import { recordReading } from "../../../readings/store.js";
import { readCodeRabbitNudgedHeads, reserveCodeRabbitNudge } from "../../../review/codeRabbitNudgeJournal.js";
import { pressJournalPort } from "../../../review/pressJournalStoreRows.js";
import { readJournalPort } from "../../../review/readJournalStoreRows.js";
import { appendReviewerRows } from "../../../review/reviewerRegisterStore.js";
import { resolveHome } from "../../optionParsers.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { LANDING_PRODUCER } from "../reading/core.js";
import { productionGithubChecksDeps } from "./checksDeps.js";
import { type GithubCommentDeps, productionGithubCommentDeps, runGithubComment } from "./commentRun.js";
import { type GithubEnqueueDeps, productionGithubEnqueueDeps } from "./enqueueDeps.js";
import { runGithubEnqueue } from "./enqueueRun.js";
import { readBoardBranches } from "./landingBoardRead.js";
import { productionLandingClosureDeps } from "./landingClosureRun.js";
import type { GithubLandingDeps } from "./landingRun.js";
import { pressLedgerActs } from "./pressLedgerCheck.js";
import { productionGithubReviewStateDeps } from "./reviewStateRun.js";

/**
 * The production press-time conversation re-read.
 *
 * Its own function rather than an inline member of {@link productionGithubLandingDeps} because the smallest
 * useful selection is a decision worth reading in one place: only the threads, the reviews and the CHECKS are
 * read off what comes back, so bodies — the expensive half by an order of magnitude — are left unasked for,
 * and the file page is still asked at one.
 *
 * The check page is `CHECK_PAGE` (`../../../live/github/reviewState.ts`), the same one the fleet read asks
 * for, because the press judges the head's own rollup at press time (`rollupSupersessionProof`,
 * `../../../live/github/rollupSupersession.ts`) and a page smaller than the head it reads cannot see a
 * superseded run at all — the defect measured on `acme/acme-admin`, whose heads carry 93-94 contexts, is
 * stated where that constant is declared. A head past that one page is re-read whole inside the read itself
 * (`../../../live/github/wholeChecks.ts`), so the press judges every context rather than the first hundred.
 *
 * @param home the state home whose credential the read uses
 * @returns the reader for one pull request named by slug and number
 */
function productionJudgmentNow({
  home,
}: {
  home: string | undefined;
}): (args: { repoSlug: string; number: number }) => Promise<Result<PrLiveState, GithubLiveError>> {
  return ({ repoSlug, number }) => {
    const slug = parseRepositorySlug({ slug: repoSlug });
    if (slug.isErr()) {
      return Promise.resolve(err(GithubLiveErrors.invalidAddress({ message: slug.error.join("; ") })));
    }
    const api = makeGithubReviewStateApi({
      graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
    });
    return api.pr({
      number,
      checkLimit: CHECK_PAGE,
      fileLimit: 1,
      owner: slug.value.owner,
      repo: slug.value.repo,
      withBodies: false,
    });
  };
}

/**
 * The two CHILD VERB edges: pressing through `github enqueue`, which also resolves our own walkthrough threads
 * immediately before its mutation (`./walkthroughStep.ts`), and re-requesting a stuck CodeRabbit review
 * through `github comment create`.
 *
 * Built once and together because they share one property that is easy to drop when another joins them:
 * under `--json` a child's own readable prose must go to the DIAGNOSTIC channel, or this verb's document
 * stops parsing. Each child's production deps bag is constructed once here rather than per call.
 *
 * @returns the press and comment seams, each honouring `quiet`
 */
function productionChildVerbDeps(): Pick<GithubLandingDeps, "press" | "requestCodeRabbitReview"> {
  const enqueueDeps: GithubEnqueueDeps = productionGithubEnqueueDeps();
  const commentDeps: GithubCommentDeps = productionGithubCommentDeps();
  // Typed off the deps bag rather than annotated, so the parameter's shape is the one the child verb chose —
  // `typescript-patterns.md` § inherit a callback's types rather than restate them.
  const warnOut: GithubEnqueueDeps["out"] = (line) => {
    logger.warn({ msg: line });
  };
  return {
    press: ({ rest, quiet }) =>
      runGithubEnqueue({ deps: quiet ? { ...enqueueDeps, out: warnOut } : enqueueDeps, rest }),
    // `runGithubComment` slices four leading argv words off (node, the CLI, `github`, `comment`), so the
    // sub-verb has to be the FIFTH token and the four before it are placeholders this call never reads.
    // Same shape as `registerRow`'s `["node", "slopweaver", …]` argv.
    requestCodeRabbitReview: ({ rest, quiet }) =>
      runGithubComment({
        argv: ["node", "slopweaver", "github", "comment", "create", ...rest],
        deps: quiet ? { ...commentDeps, out: warnOut } : commentDeps,
      }),
  };
}

/**
 * The stuck-CodeRabbit re-request's own local edges: the nudge register under the state home, and the real
 * wait (`./landingCodeRabbitNudge.ts`).
 *
 * @returns the register read, the exclusive claim and the sleep
 */
function productionCodeRabbitNudgeDeps(): Pick<GithubLandingDeps, "nudgedHeads" | "reserveNudge" | "sleep"> {
  return {
    nudgedHeads: ({ home }) => readCodeRabbitNudgedHeads(home === undefined ? {} : { home }),
    reserveNudge: ({ home, record }) => reserveCodeRabbitNudge({ record, ...(home === undefined ? {} : { home }) }),
    sleep: ({ milliseconds }) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  };
}

/**
 * The GitHub reads the landing verb makes past the review state: heads, the open census, a pull request's files,
 * its merge queue and failed jobs' logs.
 *
 * @returns the credential-aware read seams
 */
function productionGithubReadDeps(): Pick<
  GithubLandingDeps,
  "headsNow" | "openCensus" | "pullRequestFiles" | "queueFor" | "readJobLogs"
> {
  return {
    headsNow: ({ home }) =>
      makeMergeableRecheck({ graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }) }),
    openCensus: ({ home, repos }) => {
      const graphql = githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) });
      // Taken before any page is asked for, so the census never reads younger than its oldest page.
      const startedAtIso = new Date().toISOString();
      return Promise.all(repos.map((repo) => readOpenCensus({ graphql, repo, startedAtIso })));
    },
    pullRequestFiles: ({ home, owner, repo, number, head }) =>
      readPullRequestFileStatuses({
        head,
        maxPages: MAX_PULL_FILE_PAGES,
        number,
        owner,
        repo,
        rest: githubReadRest({ token: githubToken(home === undefined ? {} : { home }) }),
      }),
    queueFor: async ({ home, owner, repo, branch }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const reads = makeGithubMergeQueueReads({
        graphql: githubReadGraphql({ token }),
        rest: githubReadRest({ token }),
      });
      const answered = await reads.queue({ branch, owner, repo });
      if (answered.isErr()) {
        return err([answered.error.message]);
      }
      return ok(answered.value === undefined ? { kind: "none" } : { kind: "queue", url: answered.value.url });
    },
    readJobLogs: (args) => productionGithubChecksDeps().readJobLogs(args),
  };
}

/**
 * Production edges: the review-state seams whole, the merge-queue read, the handover board on disk, and the
 * press register under the state home.
 *
 * @returns the credential-aware GitHub, board, register, press, clock and output seams
 */
export function productionGithubLandingDeps(): GithubLandingDeps {
  const presses = pressJournalPort();
  const reads = readJournalPort();
  return {
    ...productionLedgerDeps(),
    ...productionChildVerbDeps(),
    ...productionCodeRabbitNudgeDeps(),
    ...productionGithubReadDeps(),
    ...productionLandingClosureDeps(),
    boardBranches: ({ home }) => readBoardBranches({ home }),
    checkoutFor: ({ home, repoSlug }) => declaredCheckout({ home, repoSlug }),
    judgmentNow: productionJudgmentNow,
    readOrganisation: ({ home }) => readOrganisation({ home: resolveHome({ named: home }) }),
    now: () => new Date(),
    presses: ({ home }) => presses.readLatest({ home: resolveHome({ named: home }) }),
    reads: ({ home }) => reads.readLatest({ home: resolveHome({ named: home }) }),
    recordRead: ({ home, record }) => reads.record({ home: resolveHome({ named: home }), record }),
    recordPress: async ({ home, repoSlug, number, headOid, entryState, atIso }) => {
      const recorded = await presses.append({
        home: resolveHome({ named: home }),
        record: { atIso, entryState, headOid, number, repoSlug },
      });
      return recorded.isErr() ? recorded.error.message : undefined;
    },
    registerRow: ({ argv, quiet }) =>
      registerAskRow({
        argv,
        origin: "automation",
        out: quiet
          ? ({ line }) => {
              logger.warn({ msg: line });
            }
          : logger.out,
      }),
    reviewState: productionGithubReviewStateDeps(),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * What identifies this session on an autonomy-ledger row.
 *
 * The verb's own address is the fallback rather than an empty string, and it is spelled as a branch: a row
 * reading `bySession: ""` would be a ledger entry nobody can trace back, which is the opposite of what the
 * ledger is for.
 *
 * @returns the session id, or the verb that made the press
 */
function sessionRefNow(): string {
  const session = currentSessionId({ env: process.env });
  if (session === undefined) {
    return "github landing --press";
  }
  return session;
}

/**
 * The autonomy-ledger and readings edges, built once so {@link productionGithubLandingDeps} stays readable.
 *
 * @returns the two local-state writers and the session reference
 */
function productionLedgerDeps(): Pick<
  GithubLandingDeps,
  "appendReviewerAsks" | "ledgerActs" | "recordAutonomy" | "recordReading" | "sessionRef"
> {
  const autonomy = autonomyLedgerPort();
  return {
    ledgerActs: ({ home }) => pressLedgerActs({ autonomy, home }),
    appendReviewerAsks: ({ home, rows, nowIso }) =>
      appendReviewerRows({ nowIso, rows, ...(home === undefined ? {} : { home }) })
        .map((receipt) => receipt.appended)
        .mapErr((failure) => failure.message),
    recordAutonomy: async ({ home, row }) => {
      // Caught, because this runs AFTER a press: a throw here would end the verb before it said the press happened.
      try {
        const written = await autonomy.appendRecord({ home: resolveHome({ named: home }), record: row });
        return written.isErr() ? written.error.message : undefined;
      } catch (cause) {
        return errorMessage({ error: cause });
      }
    },
    recordReading: ({ home, by, document, observedAtIso }) =>
      recordReading({
        by,
        document,
        nowIso: new Date().toISOString(),
        observedAtIso,
        producer: LANDING_PRODUCER,
        ...(home === undefined ? {} : { home }),
      })
        .map((receipt) => receipt.record.readingId)
        .mapErr((failure) => failure.message),
    sessionRef: sessionRefNow,
  };
}

/**
 * The local checkout one repository is DECLARED at, or undefined when none is.
 *
 * A worktree is cut from a main checkout, never from another worktree, so this resolves the DECLARATION
 * rather than answering with whatever tree this process is running in — the same reasoning
 * `../recipe/seat.ts` states for the seat it opens.
 *
 * @param home the state home whose profile declares the main checkouts
 * @param repoSlug the `owner/name` the pull request lives in
 * @returns the checkout path, or undefined when the slug will not parse or no checkout is declared for it
 */
function declaredCheckout({ home, repoSlug }: { home: string | undefined; repoSlug: string }): string | undefined {
  const slug = parseRepositorySlug({ slug: repoSlug });
  if (slug.isErr()) {
    return undefined;
  }
  // No `--home` means the resolved one, said in a line rather than by an operator: `checkoutForRepo` takes a
  // required home and reading which one it got should not need knowing what `??` does.
  if (home === undefined) {
    const resolved = checkoutForRepo({ home: slopweaverHome(), owner: slug.value.owner, repo: slug.value.repo });
    return resolved.isErr() ? undefined : resolved.value;
  }
  const resolved = checkoutForRepo({ home, owner: slug.value.owner, repo: slug.value.repo });
  return resolved.isErr() ? undefined : resolved.value;
}
