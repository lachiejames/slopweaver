/**
 * What `slopweaver github landing --pr <n>` prints: ONE row, whole — the drill-down the default fact line
 * folds away.
 *
 * Progressive disclosure names the shape: the fleet line says CI is
 * red on a check, and this says which unit test FILE failed in that check's job log and whether this pull
 * request added that file. Those two facts cost a job-log read and a changed-files read per row, so they are
 * read only here, on request, never for the fleet.
 *
 * Pure: a row and the evidence the shell read for it in, lines out. `./landingDetail.ts` is the shell.
 */

import type { TestFileInPr } from "../../../live/github/pullRequestFilesRead.js";
import type { LandingRow } from "../../../review/landing.js";
import { landingFacts, ownersCutNote } from "./landingFacts.js";
import { landingDispatchLineFor } from "./landingReport.js";

/** One test file a failed job's log named, and whether this pull request added it. */
interface FailingTestFile {
  readonly path: string;
  readonly inPr: TestFileInPr;
}

/** What one failed check's job log said, or why it could not be read. */
export interface CheckLogEvidence {
  readonly check: string;
  /** The failing test files the log named, in the order it named them. Empty when it named none. */
  readonly testFiles: readonly FailingTestFile[];
  /** Why this check's log was not read, when it was not — a non-Actions check carries no log to read. */
  readonly unread: string | undefined;
  /**
   * How many of its job's log lines were longer than the line cap and searched only up to it — a failing test
   * file past the cut is unseen, so a non-zero count never lets an empty {@link testFiles} read "names none".
   */
  readonly linesCut: number;
}

/** Everything `--pr` read past the fleet row. */
export interface LandingDetailEvidence {
  /** One entry per failing check, in the row's own `failingChecks` order. */
  readonly checks: readonly CheckLogEvidence[];
  /** What the log and file reads could not establish, said rather than folded into a verdict. */
  readonly residue: readonly string[];
}

/** The words for where a failing test file sits relative to this pull request's diff. */
const IN_PR_WORDS: Readonly<Record<TestFileInPr, string>> = {
  added: "ADDED in this pull request",
  "changed-existing": "an existing file this pull request changes",
  "not-in-pr": "not touched by this pull request",
  unknown: "whether this pull request touches it is unknown — its file list was not read to the end",
};

/** The word for whether a failing check is required, advisory, or of a requirement that was not read. */
function requirementWord({ required }: { required: boolean | undefined }): string {
  if (required === true) {
    return "REQUIRED";
  }
  if (required === false) {
    return "advisory";
  }
  return "requirement unknown";
}

/** What one check's job log said: why it was not read, or each failing test file it named and where it sits. */
function evidenceLines({ read }: { read: CheckLogEvidence }): readonly string[] {
  if (read.unread !== undefined) {
    return [`    log not read: ${read.unread}`];
  }
  const cut =
    read.linesCut > 0
      ? [
          `    ${String(read.linesCut)} log line(s) were cut at the line cap, so a failing test file past a cut is unseen`,
        ]
      : [];
  if (read.testFiles.length === 0 && cut.length > 0) {
    return ["    no failing test file found in the part of its log that was searched", ...cut];
  }
  if (read.testFiles.length === 0) {
    return ["    its log names no failing test file"];
  }
  return [...read.testFiles.map((file) => `    failing test file ${file.path} — ${IN_PR_WORDS[file.inPr]}`), ...cut];
}

/**
 * The not-passing checks block, each with its own state — failed, running or queued, never all called failing —
 * followed by the test files its log named.
 */
function failingCheckLines({ row, evidence }: { row: LandingRow; evidence: LandingDetailEvidence }): readonly string[] {
  if (row.failingChecks.length === 0) {
    return ["checks not passing: none"];
  }
  const lines = ["checks not passing:"];
  for (const [index, check] of row.failingChecks.entries()) {
    const url = check.url === undefined ? "" : ` ${check.url}`;
    lines.push(`  ${requirementWord({ required: check.required })} ${check.name} (${check.state})${url}`);
    // By POSITION, never by name: two failing runs can share a check name, and only this one's log is its evidence.
    const read = evidence.checks[index];
    if (read?.check === check.name) {
      lines.push(...evidenceLines({ read }));
    }
  }
  return lines;
}

/** Every ask Slack holds on this pull request, newest first. */
function askLines({ row }: { row: LandingRow }): readonly string[] {
  if (row.askTrail.length === 0) {
    return [`asks: none found in Slack (asked: ${row.slack.asked}${row.slack.why === "" ? "" : `, ${row.slack.why}`})`];
  }
  return [
    "asks:",
    ...row.askTrail.map((ask) => `  ${ask.atIso} in ${ask.channel} to ${ask.recipients.join(", ")} ${ask.permalink}`),
  ];
}

/**
 * One row, whole.
 *
 * @param row the broken-down pull request
 * @param evidence what the job-log and changed-file reads found for it
 * @returns the lines to print, the fact line first
 */
export function landingDetailLines({
  row,
  evidence,
}: {
  row: LandingRow;
  evidence: LandingDetailEvidence;
}): readonly string[] {
  const dispatch =
    row.dispatch.kind === "act"
      ? `act ${row.dispatch.verdict}: ${row.dispatch.why}`
      : `${row.dispatch.kind}: ${row.dispatch.why}`;
  const residue = [...row.residue, ...evidence.residue];
  return [
    landingFacts({ row }),
    row.url,
    "tests:",
    ...row.tests.map((test) => `  ${test.verdict.padEnd(7)} ${test.id} — ${test.why}`),
    `dispatch: ${dispatch}`,
    `act: ${row.action} — ${row.actionDetail}`,
    `detail: ${landingDispatchLineFor({ row }).trim()}`,
    `waiting on us: ${row.openThreads.length === 0 ? "nobody" : row.openThreads.map((one) => `${one.login} (${String(one.open)})`).join(", ")}${row.threadsTruncated ? " (thread list truncated)" : ""}`,
    `approved: ${row.approvedBy.length === 0 ? "nobody" : row.approvedBy.join(", ")}${row.reviewsTruncated ? " (review list truncated)" : ""}`,
    `code owners: ${row.githubCodeowners.sentence}${ownersCutNote({ row })}`,
    ...askLines({ row }),
    `CodeRabbit: ${row.codeRabbit} — ${row.codeRabbitDetail}`,
    ...failingCheckLines({ evidence, row }),
    ...(residue.length === 0 ? [] : ["residue:", ...residue.map((line) => `  ${line}`)]),
  ];
}
