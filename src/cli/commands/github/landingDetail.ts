/**
 * `slopweaver github landing --pr <n>`'s shell: the two reads a single row's drill-down costs, and nothing else.
 *
 * The fleet line names which check failed; this reads that check's Actions job log for the test FILE that failed
 * (`../../../live/github/testFailurePaths.ts`, line by line as the log streams) and the pull request's own
 * changed-file list for whether it ADDED that file (`../../../live/github/pullRequestFilesRead.ts`). Both reads
 * happen only here, on one row, so a fleet tick never pays a job-log read per red pull request.
 *
 * What it cannot establish it says, in the evidence's residue or a check's `unread`, rather than dropping: a
 * check posted by a CI that is not Actions has no log GitHub serves, and a file list cut short leaves
 * `not-in-pr` unprovable.
 */

import { parseRepositorySlug, type Repository } from "../../../config.js";
import type { Result } from "../../../lib/result.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import { type JobLogSummary, MAX_LINE_CHARS } from "../../../live/github/jobLog.js";
import type { CheckLogTarget } from "../../../live/github/jobLogShape.js";
import { type PullRequestFileStatuses, testFileInPr } from "../../../live/github/pullRequestFilesRead.js";
import type { LandingRow } from "../../../review/landing.js";
import type { FailingCheckDetail } from "../../../review/prStateDetail.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import type { GithubChecksDeps } from "./checksSeams.js";
import type { CheckLogEvidence, LandingDetailEvidence } from "./landingDetailReport.js";
import { landingDetailLines } from "./landingDetailReport.js";

/** The edges the drill-down reads through — a subset of `./landingDepsContract.ts`'s, so a fake supplies four. */
export interface LandingDetailDeps {
  /** One Actions run's selected job logs, bounded — `github checks --log`'s own seam. */
  readonly readJobLogs: GithubChecksDeps["readJobLogs"];
  /** Every changed file of one pull request with GitHub's status for it, paged to the end. */
  readonly pullRequestFiles: (args: {
    home: string | undefined;
    owner: string;
    repo: string;
    number: number;
    /** The head the row was judged on; a list read once the branch moved is refused rather than used. */
    head: string;
  }) => Promise<Result<PullRequestFileStatuses, GithubLiveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * One Actions run's failed jobs, each with the failing checks that point at it — by their POSITION in the row's
 * `failingChecks`, never by name, because two runs can post a failing check under the same name.
 */
interface RunGroup {
  readonly runId: number;
  readonly checksByJob: Map<number, number[]>;
}

/** Why a Check Run whose details URL is not this repository's Actions job has no log to read. */
const UNREADABLE_URL = "its details URL is not one of this repository's Actions jobs, so GitHub serves no log for it";

/**
 * The run and job a details URL names when it is THIS repository's own Actions job on github.com — the ids are
 * only meaningful there, and an external CI's URL with the same shape would read an unrelated job's log. The
 * ids come from the PATH alone, whole-segment, so a query string or fragment carrying `/actions/runs/…` names
 * nothing.
 */
function ownActionsJob({
  url,
  repository,
}: {
  url: string | undefined;
  repository: Repository;
}): CheckLogTarget | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "github.com") {
    return undefined;
  }
  const segments = parsed.pathname.split("/");
  const [, owner, repo, actions, runs, runText, job, jobText] = segments;
  const ours =
    owner?.toLowerCase() === repository.owner.toLowerCase() && repo?.toLowerCase() === repository.repo.toLowerCase();
  const shaped = actions === "actions" && runs === "runs" && job === "job";
  if (!ours || !shaped || !isDigits({ text: runText }) || !isDigits({ text: jobText })) {
    return undefined;
  }
  return { jobId: Number(jobText), runId: Number(runText) };
}

/** Whether a path segment is present and wholly a decimal id. */
function isDigits({ text }: { text: string | undefined }): boolean {
  return text !== undefined && /^\d+$/u.test(text);
}

/** The run and job of a failing check's Actions log, or why it has none to read. */
function logTarget({
  check,
  repository,
}: {
  check: FailingCheckDetail;
  repository: Repository;
}): { target: CheckLogTarget; why: undefined } | { target: undefined; why: string } {
  // A check still running or queued has no verdict yet, so its partial log is evidence of nothing.
  if (check.state !== "failed") {
    return { target: undefined, why: `it is still ${check.state}, so its log holds no verdict yet` };
  }
  // A legacy Status can point its URL anywhere, an Actions job of this repository included; only a Check Run is one.
  if (check.kind === "status") {
    return {
      target: undefined,
      why: "it is a commit status another CI posted, not a Check Run, so it has no Actions log",
    };
  }
  const target = ownActionsJob({ repository, url: check.url });
  if (target === undefined) {
    return { target: undefined, why: UNREADABLE_URL };
  }
  // The URL is the posting app's own claim; only GitHub's workflow-run tie proves the check IS that run's job.
  if (check.runId !== String(target.runId)) {
    return {
      target: undefined,
      why: "GitHub does not tie this check to the Actions run its details URL names, so that run's log is not its own",
    };
  }
  return { target, why: undefined };
}

/** Group the row's failing checks by the Actions run their details URLs name; a non-Actions check is unreadable. */
function groupByRun({ row, repository }: { row: LandingRow; repository: Repository }): {
  groups: readonly RunGroup[];
  unreadable: ReadonlyMap<number, string>;
} {
  const groups = new Map<number, RunGroup>();
  const unreadable = new Map<number, string>();
  for (const [index, check] of row.failingChecks.entries()) {
    const { target, why } = logTarget({ check, repository });
    if (target === undefined) {
      unreadable.set(index, why);
      continue;
    }
    let group = groups.get(target.runId);
    if (group === undefined) {
      group = { checksByJob: new Map<number, number[]>(), runId: target.runId };
      groups.set(target.runId, group);
    }
    const indices = group.checksByJob.get(target.jobId);
    if (indices === undefined) {
      group.checksByJob.set(target.jobId, [index]);
    } else {
      indices.push(index);
    }
  }
  return { groups: [...groups.values()], unreadable };
}

/** What the job-log reads established, keyed by the failing check's position in the row. */
interface LogFindings {
  readonly unread: Map<number, string>;
  readonly found: Map<number, readonly string[]>;
  readonly residue: string[];
  /** How many of the check's job log lines were searched only up to the line cap. */
  readonly cut: Map<number, number>;
}

/** One job the read returned, as far as the path search needs it. */
interface ReadJob {
  readonly name: string;
  readonly log: Pick<JobLogSummary, "linesTruncated" | "testFilePaths" | "testFilePathsDropped">;
}

/**
 * The bounds of one job's log that touch the path search. The read's own residue is about the lines it SHOWS (a
 * tail depth, dropped annotations); this shows none, so only these are carried.
 */
function jobResidue({ job }: { job: ReadJob }): string[] {
  const lines: string[] = [];
  if (job.log.testFilePathsDropped > 0) {
    lines.push(
      `${job.name}'s log named at least ${String(job.log.testFilePathsDropped)} more failing test files past the ` +
        `first ${String(job.log.testFilePaths.length)}, not listed`,
    );
  }
  if (job.log.linesTruncated > 0) {
    lines.push(
      `${String(job.log.linesTruncated)} line(s) of ${job.name}'s log were longer than ` +
        `${String(MAX_LINE_CHARS)} characters, and only their start was searched for failing test files`,
    );
  }
  return lines;
}

/** Read one run's failed jobs and record, per failing check, the test files its job named or why it was unread. */
async function readGroup({
  group,
  repository,
  home,
  deps,
  findings,
}: {
  group: RunGroup;
  repository: Repository;
  home: string | undefined;
  deps: LandingDetailDeps;
  findings: LogFindings;
}): Promise<void> {
  const read = await deps.readJobLogs({
    home,
    jobIds: [...group.checksByJob.keys()],
    lines: 0,
    owner: repository.owner,
    repo: repository.repo,
    runId: group.runId,
  });
  for (const [jobId, indices] of group.checksByJob) {
    if (read.isErr()) {
      indices.forEach((index) => findings.unread.set(index, read.error.message));
      continue;
    }
    const job = read.value.jobs.find((entry) => entry.jobId === jobId);
    if (job === undefined) {
      const why = `run ${String(group.runId)}'s job list carried no job ${String(jobId)}`;
      indices.forEach((index) => findings.unread.set(index, why));
      continue;
    }
    indices.forEach((index) => {
      findings.found.set(index, job.log.testFilePaths);
      findings.cut.set(index, job.log.linesTruncated);
    });
    findings.residue.push(...jobResidue({ job }));
  }
}

/** Read the pull request's changed files when some failing test file needs classifying; a failed read is residue. */
async function readChangedFiles({
  row,
  repository,
  home,
  deps,
  findings,
}: {
  row: LandingRow;
  repository: Repository;
  home: string | undefined;
  deps: LandingDetailDeps;
  findings: LogFindings;
}): Promise<PullRequestFileStatuses | undefined> {
  if (![...findings.found.values()].some((paths) => paths.length > 0)) {
    return undefined;
  }
  const listed = await deps.pullRequestFiles({
    head: row.headOid,
    home,
    number: row.number,
    owner: repository.owner,
    repo: repository.repo,
  });
  if (listed.isOk()) {
    return listed.value;
  }
  findings.residue.push(
    `could not read #${String(row.number)}'s changed files (${listed.error.message}), so whether it added ` +
      "each failing test file is unknown",
  );
  return undefined;
}

/**
 * Read every failing check's job log and the file list, and classify each failing test file.
 *
 * @param row the one pull request being drilled into
 * @param repository the repository it lives in
 * @param home the state home credentials resolve from
 * @returns the per-check evidence and what the reads could not establish
 */
async function detailEvidence({
  row,
  repository,
  home,
  deps,
}: {
  row: LandingRow;
  repository: Repository;
  home: string | undefined;
  deps: LandingDetailDeps;
}): Promise<LandingDetailEvidence> {
  const { groups, unreadable } = groupByRun({ repository, row });
  const findings: LogFindings = { cut: new Map(), found: new Map(), residue: [], unread: new Map() };
  for (const [index, why] of unreadable) {
    findings.unread.set(index, why);
  }
  for (const group of groups) {
    await readGroup({ deps, findings, group, home, repository });
  }
  const files = await readChangedFiles({ deps, findings, home, repository, row });
  const checks: CheckLogEvidence[] = row.failingChecks.map((check, index) => ({
    check: check.name,
    linesCut: linesCut({ findings, index }),
    testFiles: foundPaths({ findings, index }).map((path) => ({ inPr: testFileInPr({ files, path }), path })),
    unread: findings.unread.get(index),
  }));
  return { checks, residue: findings.residue };
}

/** How many of one check's job log lines were cut at the line cap — none when its log was never read. */
function linesCut({ findings, index }: { findings: LogFindings; index: number }): number {
  const cut = findings.cut.get(index);
  if (cut === undefined) {
    return 0;
  }
  return cut;
}

/** The failing test files one check's job named — none when its log was never read, which `unread` then says. */
function foundPaths({ findings, index }: { findings: LogFindings; index: number }): readonly string[] {
  const paths = findings.found.get(index);
  if (paths === undefined) {
    return [];
  }
  return paths;
}

/**
 * Print one pull request whole, with the failing test files its job logs name and whether it added each.
 *
 * Exits `EXIT_EXPECTED_EMPTY` when the selection holds no such open pull request — "not found" is a status, not a
 * fault, so a harness does not count it as one.
 *
 * @param rows the rows the single-pull-request read produced
 * @param number the pull request `--pr` named
 * @param slug the one `--repo` it lives in, `owner/name`
 * @param home the state home credentials resolve from
 * @returns the process exit code
 */
export async function reportLandingDetail({
  rows,
  number,
  slug,
  home,
  deps,
}: {
  rows: readonly LandingRow[];
  number: number;
  slug: string;
  home: string | undefined;
  deps: LandingDetailDeps;
}): Promise<number> {
  const parsed = parseRepositorySlug({ slug });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const repository = parsed.value;
  const row = rows.find((one) => one.number === number);
  if (row === undefined) {
    deps.writeDiagnostic(
      `landing: ${repository.owner}/${repository.repo}#${String(number)} is not an open pull request this selection ` +
        "matches (a draft, a closed one, or another author's under --author)",
    );
    return EXIT_EXPECTED_EMPTY;
  }
  const evidence = await detailEvidence({ deps, home, repository, row });
  for (const line of landingDetailLines({ evidence, row })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}
