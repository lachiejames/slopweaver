/**
 * The door half of "a commit message is a published surface": `github push`, `stack push` and `stack submit`
 * refuse, before anything is sent, a commit whose subject or body the publication scan
 * (`../outbound/publicationScan.ts`) refuses — first person, installation state, "this Mac", or a hygiene hit.
 *
 * ## Which commits a push publishes
 *
 * Every commit reachable from the head that the remote does not already hold:
 * `git log <head> --not --remotes=<remote> [<remote branch sha>]`. The remote-tracking refs are what this
 * checkout last saw the remote hold, and a push updates its own, so the range is the commits this push adds.
 * `--ignore-missing` lets a remote branch sha this checkout never fetched drop out rather than fail the read.
 *
 * Its residue, stated: the tracking refs can only be STALE, never ahead, so the range can only be too WIDE. A
 * branch rebased onto a base fetched into a private ref, while `refs/remotes/<remote>/<default>` still names an
 * older base, scans the base commits in between too — commits the remote already published. That is a false
 * refusal naming a commit this branch did not write, and `git fetch <remote>` clears it. It never misses an
 * unpublished commit: anything reachable from a tracking ref was on the remote when that ref was recorded.
 *
 * A read that fails refuses closed, like the proof-path gate beside it.
 */
import type { InstallationIdentifiers } from "../hygiene/installationIdentifiers.js";
import type { PrivateTerm } from "../hygiene/privateTerms.js";
import { err, ok, type Result } from "../lib/result.js";
import { type PublicationFinding, type PublicationHygiene, publicationFindings } from "../outbound/publicationScan.js";
import { type GithubPushDoorError, GithubPushDoorErrors } from "./githubPushErrors.js";

/**
 * One commit a push would publish: its sha and its whole message, subject and body.
 * @internal — the shape this module's own steps pass between them; callers read refusal lines.
 */
export interface PublishedCommit {
  readonly sha: string;
  readonly message: string;
}

/** The Git reader every gate here runs through, so `cwd` alone decides the repository. */
type ReadGit = (args: { cwd: string; args: readonly string[] }) => string;

/** The record separator each log entry opens with; a commit message cannot carry it unnoticed by git. */
const RECORD = "\u001e";

/**
 * Parse `git log --format=%x1e%H%x00%B` output into commits. Pure.
 *
 * @param output the log's stdout, trimmed or not
 * @returns each commit, newest first, its message trimmed
 * @internal — exported for its unit test; every caller goes through the gate functions below.
 */
export function parseCommitLog({ output }: { output: string }): readonly PublishedCommit[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const split = record.indexOf("\0");
      return { message: record.slice(split + 1).trim(), sha: record.slice(0, split).trim() };
    });
}

/**
 * Every commit a push of `localSha` would publish to `remote`.
 *
 * @param readGit the caller's isolated Git reader
 * @param repoRoot the repository the push is about
 * @param localSha the commit the push would send
 * @param remote the configured remote name, whose tracking refs bound the range
 * @param remoteSha the remote branch's current sha when the remote has the branch, excluded too
 * @returns the commits, or the typed failure to read them — which every caller refuses closed on
 * @internal — exported for its unit test; every caller goes through the gate functions below.
 */
export function commitsToPublish({
  readGit,
  repoRoot,
  localSha,
  remote,
  remoteSha,
}: {
  readGit: ReadGit;
  repoRoot: string;
  localSha: string;
  remote: string;
  remoteSha: string | undefined;
}): Result<readonly PublishedCommit[], GithubPushDoorError> {
  const excluded = remoteSha === undefined ? [] : [remoteSha];
  try {
    // `--no-replace-objects`: a replace ref never travels with a push, so the message read is the one sent.
    const output = readGit({
      args: [
        "--no-replace-objects",
        "log",
        "--ignore-missing",
        "--no-show-signature",
        "--encoding=UTF-8",
        "--format=%x1e%H%x00%B",
        localSha,
        "--not",
        `--remotes=${remote}`,
        ...excluded,
      ],
      cwd: repoRoot,
    });
    return ok(parseCommitLog({ output }));
  } catch (error: unknown) {
    return err(
      GithubPushDoorErrors.commitMessagesUnread({
        cause: error instanceof Error ? error.message : String(error),
        localSha,
      }),
    );
  }
}

/** The hygiene context a commit message is scanned with: the private denylist and terms, and the target's forgiveness. */
export interface CommitMessageHygiene {
  readonly denylist: readonly string[];
  readonly privateTerms: readonly PrivateTerm[];
  readonly ownRepository: string;
  readonly installationIdentifiers: InstallationIdentifiers | undefined;
}

/** One commit and what the scan refused in it. */
interface RefusedCommit {
  readonly sha: string;
  readonly findings: readonly PublicationFinding[];
}

/** Every commit carrying a finding, in the order given. */
function refusedCommits({
  commits,
  hygiene,
}: {
  commits: readonly PublishedCommit[];
  hygiene: PublicationHygiene;
}): readonly RefusedCommit[] {
  return commits
    .map((commit) => ({
      findings: publicationFindings({ hygiene, surface: "commit-message", text: commit.message }),
      sha: commit.sha,
    }))
    .filter((commit) => commit.findings.length > 0);
}

/**
 * The refusal for a set of commits a push would publish, or nothing when every message may be published. Pure.
 *
 * Duplicate shas (a stack's lower commits, reachable from every head above them) are judged once.
 *
 * @param commits the commits the push would publish
 * @param hygiene the private denylist and the target's forgiveness
 * @returns the lines to print, empty when every message is clean
 * @internal — exported for its unit test; every caller goes through the gate functions below.
 */
export function commitMessageRefusal({
  commits,
  hygiene,
}: {
  commits: readonly PublishedCommit[];
  hygiene: CommitMessageHygiene;
}): readonly string[] {
  const unique = [...new Map(commits.map((commit) => [commit.sha, commit])).values()];
  const refused = refusedCommits({ commits: unique, hygiene });
  if (refused.length === 0) {
    return [];
  }
  return [
    `${String(refused.length)} commit message(s) cannot be published as written; nothing was sent:`,
    ...refused.flatMap((commit) => [
      `  commit ${commit.sha.slice(0, 12)}:`,
      ...commit.findings.map((finding) => `    ${finding.message}`),
    ]),
    "This is a hold, with no override: reword each message (`git commit --amend` for the head commit, a " +
      "reword rebase for an older one), then run the command again.",
  ];
}

/**
 * Read the commits a push would publish and refuse when any message may not be published.
 *
 * @param readGit the caller's isolated Git reader
 * @param repoRoot the repository the push is about
 * @param localSha the commit the push would send
 * @param remote the configured remote name
 * @param remoteSha the remote branch's current sha, when the remote has the branch
 * @param hygiene the private denylist and the target's forgiveness
 * @returns nothing when every message is clean, or the refusal
 */
export function refuseUnpublishableCommitMessages({
  readGit,
  repoRoot,
  localSha,
  remote,
  remoteSha,
  hygiene,
}: {
  readGit: ReadGit;
  repoRoot: string;
  localSha: string;
  remote: string;
  remoteSha: string | undefined;
  hygiene: CommitMessageHygiene;
}): Result<void, GithubPushDoorError> {
  const commits = commitsToPublish({ localSha, readGit, remote, remoteSha, repoRoot });
  if (commits.isErr()) {
    return err(commits.error);
  }
  const refusal = commitMessageRefusal({ commits: commits.value, hygiene });
  return refusal.length === 0 ? ok(undefined) : err(GithubPushDoorErrors.commitMessageUnpublishable({ refusal }));
}

/**
 * Why a submit may not send its heads: every commit message across every head that may not be published.
 *
 * Every head is read before any verdict, so one run names every commit rather than one per retry. A head whose
 * commits cannot be read refuses closed.
 *
 * @param readGit the isolated Git reader the pushes themselves use
 * @param plan what the planner admitted: each branch, its pull request, the sha it sends and the lease it holds
 * @param repoRoot the repository the heads are in
 * @param remote the configured remote name
 * @param hygiene the private denylist and the target's forgiveness
 * @returns the refusal lines, empty when every message is clean
 */
export function submitCommitMessageRefusal({
  readGit,
  plan,
  repoRoot,
  remote,
  hygiene,
}: {
  readGit: ReadGit;
  plan: { pushes: readonly { branch: string; expectedRemoteSha: string; toSha: string }[] };
  repoRoot: string;
  remote: string;
  hygiene: CommitMessageHygiene;
}): readonly string[] {
  const unread: string[] = [];
  const commits: PublishedCommit[] = [];
  for (const push of plan.pushes) {
    const read = commitsToPublish({
      localSha: push.toSha,
      readGit,
      remote,
      remoteSha: push.expectedRemoteSha.length === 0 ? undefined : push.expectedRemoteSha,
      repoRoot,
    });
    if (read.isErr()) {
      unread.push(`refused: ${push.branch}: ${read.error.message}`);
      continue;
    }
    commits.push(...read.value);
  }
  return [...unread, ...commitMessageRefusal({ commits, hygiene })];
}
