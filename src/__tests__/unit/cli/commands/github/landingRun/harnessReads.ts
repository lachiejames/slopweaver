/**
 * The read seams of the `runGithubLanding` harness: the board, the pull request as GitHub answers it at press time,
 * and GitHub's queue, census, file, log and organisation reads.
 */
import type { GithubLandingDeps } from "../../../../../../cli/commands/github/landingRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { GithubJobLogErrors } from "../../../../../../live/github/jobLogErrors.js";
import type { PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import { ACME_ORGANISATION } from "../../../../../organisationFixture.js";
import { pr } from "./fixtures.js";
import type { HarnessOptions } from "./harness.js";
import type { HarnessClock, HarnessRecord } from "./harnessTypes.js";

/**
 * The board seams: the rows each branch carries, the checkout a row declares, a row as re-read, and how a pull
 * request ended.
 *
 * @returns the board half of the landing verb's dependencies
 */
export function boardSeams({
  options,
  record,
}: {
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<GithubLandingDeps, "boardBranches" | "checkoutFor" | "prClosure" | "rowNow"> {
  const {
    board = new Map<string, readonly LandingBoardRow[]>(),
    checkout = "/checkouts/widgets",
    closures = new Map(),
    rowsNow = new Map(),
  } = options;
  return {
    boardBranches: () => board,
    // `null` is how a test says NO checkout is declared. Spelled as a branch rather than an operator, because a
    // `?? undefined` here would read as a default for a value the test deliberately withheld.
    checkoutFor: (): string | undefined => {
      if (checkout === null) {
        return undefined;
      }
      return checkout;
    },
    prClosure: ({ repoSlug, number }) => {
      record.closuresAsked.push(`${repoSlug}#${String(number)}`);
      const closure = closures.get(number);
      return Promise.resolve(
        closure === undefined ? err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })) : ok(closure),
      );
    },
    rowNow: ({ slug }) => {
      const changed = rowsNow.get(slug);
      if (changed !== undefined) {
        return changed;
      }
      const row = [...board.values()].flat().find((one) => one.kind === "row" && one.slug === slug);
      return row?.kind === "row" && row.run !== undefined ? { run: row.run, status: row.status } : undefined;
    },
  };
}

/**
 * The press-time seams: the head and the conversation GitHub reports at the moment of pressing.
 *
 * @returns the press-time re-reads of the landing verb's dependencies
 */
export function pressTimeSeams({
  options,
  record,
}: {
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<GithubLandingDeps, "headsNow" | "judgmentNow"> {
  const { headsNow, judgmentNow, pages } = options;
  // The conversation at PRESS time, in priority order: the one the case names, else the pull request exactly as
  // the fleet read saw it, else a default pull request for a number no page carries.
  const judgedNow = ({ number }: { number: number }): PrLiveState => {
    if (judgmentNow !== undefined) {
      return judgmentNow;
    }
    const asRead = pages.flatMap((one) => one.pullRequests).find((state) => state.number === number);
    if (asRead !== undefined) {
      return asRead;
    }
    return pr();
  };
  // The head a subject stands at when pressed: the one the case moves every head to, else the head the fleet read
  // saw — nothing pushed in between, which is what every test not about a moved head is asserting.
  const headAtPress = ({ subject }: { subject: { headOid: string } }): string => {
    if (headsNow === undefined) {
      return subject.headOid;
    }
    return headsNow;
  };
  return {
    headsNow:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(
            (subject) =>
              ({
                kind: "read",
                value: { headOid: headAtPress({ subject }), mergeable: "MERGEABLE" },
              }) as const,
          ),
        ),
    // Defaults to the pull request exactly as the fleet read saw it — "nothing arrived in between", which is
    // what every test not about this window is asserting.
    judgmentNow:
      () =>
      ({ number }) => {
        record.judged.count += 1;
        return Promise.resolve(ok(judgedNow({ number })));
      },
  };
}

/**
 * The GitHub read seams: the base branch's queue, the open census, a pull request's files and job logs, and the
 * organisation.
 *
 * @returns the GitHub-read half of the landing verb's dependencies
 */
export function githubReadSeams({
  clock,
  options,
  record,
}: {
  clock: HarnessClock;
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<GithubLandingDeps, "openCensus" | "pullRequestFiles" | "queueFor" | "readJobLogs" | "readOrganisation"> {
  const {
    jobLogs = err(GithubJobLogErrors.runNotFound({ runId: 0 })),
    organisation = ok(ACME_ORGANISATION),
    prFiles = err(GithubLiveErrors.readFailed({ message: "this fixture carries no file list" })),
    queue = { kind: "queue", url: "https://github.com/acme/widgets/queue/staging" },
    queueReadMs = 0,
  } = options;
  return {
    openCensus: ({ repos }) => {
      record.censusAsked.push(...repos);
      return Promise.resolve(
        repos.map((repo) => ({
          kind: "read",
          pullRequests: [
            {
              author: "ada",
              isDraft: false,
              number: 16378,
              title: "an own pull request",
              url: `https://github.com/${repo}/pull/16378`,
            },
            { author: "renovate", isDraft: true, number: 9, title: "a bump", url: `https://github.com/${repo}/pull/9` },
          ],
          repo,
          startedAtIso: "2026-09-09T12:29:00.000Z",
          totalCount: 2,
          viewer: "ada",
        })),
      );
    },
    pullRequestFiles: ({ owner, repo, number }) => {
      record.filesAsked.push(`${owner}/${repo}#${String(number)}`);
      return Promise.resolve(prFiles);
    },
    queueFor: ({ owner, repo, branch }) => {
      record.queueAsked.push(`${owner}/${repo}#${branch}`);
      clock.ms += queueReadMs;
      return Promise.resolve(ok(queue));
    },
    readJobLogs: ({ owner, repo, runId, jobIds }) => {
      record.logsAsked.push(`${owner}/${repo} run ${String(runId)} jobs ${jobIds.join(",")}`);
      return Promise.resolve(jobLogs);
    },
    readOrganisation: () => Promise.resolve(organisation),
  };
}
