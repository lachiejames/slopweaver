/**
 * A live per-pull-request checks rollup — the "3/5 checks passed" read `slopweaver github checks` reports,
 * instead of every session hand-rolling its own `gh pr checks` polling loop. The read (`./checksRead.ts`)
 * returns GitHub's own aggregate `statusCheckRollup` for the pull request's head commit, together with the
 * individual Check Runs and legacy commit Statuses it rolls up — the same two systems `gh pr checks` itself
 * merges, so this reports the identical picture without shelling out to it. This file parses and counts it.
 *
 * ## Re-runs, and why every context is deduped by name before counting
 *
 * A re-run (a new push-triggered or description-triggered workflow run against the SAME head commit)
 * creates a NEW check suite rather than replacing the old one, so GraphQL's `contexts` connection keeps
 * returning every prior suite's check runs alongside the new one — confirmed live: editing a pull request's
 * own description mid-flight retriggered its CI, and the very next poll answered six contexts for three
 * check names, three of them stale and COMPLETED. The connection's own ORDER does not separate old from
 * new either — a fresh `IN_PROGRESS` run for a name can sit before its own stale `COMPLETED` predecessor.
 * `gh pr checks` itself shows only the latest per name, so {@link parseChecksSnapshot} keeps only the
 * context with the newest `checkSuite.createdAt` (Check Runs) or `createdAt` (legacy Statuses) for each
 * `kind:name` pair — otherwise a re-run would double-count and a poll could report a stale PASS next to the
 * fresh run that superseded it.
 *
 * The dedupe's discards do not vanish, though: GitHub's own `rollupState` is computed over every check suite
 * on the head commit, superseded ones included, so it can keep reading `FAILURE` after a re-run fixed the
 * one thing that failed — the latest-per-name view {@link formatChecksLine} counts from would look fully
 * green at the very same moment. {@link dedupeLatestByName} keeps every discard as a `SupersededGithubCheck`
 * for exactly this: naming which superseded run is still pinning the rollup, in the one clause
 * {@link formatChecksLine} adds when the two disagree.
 *
 * Each discard also names the run that TOOK its slot, and only when GitHub's own timestamps ORDERED the two
 * ({@link SupersededGithubCheck.replacedBy}) — because losing the newest-per-name race and having been
 * superseded are different facts: that race resolves an UNDATED side either way, so a context GitHub dated
 * nothing loses it on position rather than on time.
 *
 * Every judgement ABOUT that disagreement lives next door in `./rollupSupersession.ts` — this file parses a
 * read and counts it, that one decides what the count and the rollup together prove, which is what turns
 * into one of the two findings `github landing --press` may answer for itself.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { asGithubMergeable, type GithubMergeable } from "../../review/reviewState.js";
import { nextWaitDelayMs, PROVIDER_WAIT_CEILING_MS, PROVIDER_WAIT_SCHEDULE_MS } from "../../wait/loop.js";
import {
  type CheckWithSortKey,
  dedupeLatestByName,
  type GithubCheck,
  type GithubCheckState,
  type SupersededGithubCheck,
} from "./checksDedupe.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { rollupMismatchClause } from "./rollupSupersession.js";

/** A pull request's checks, as of one read of its head commit. */
export interface GithubChecksSnapshot {
  readonly headSha: string;
  /**
   * The branch these checks answer to — the base whose protection and rulesets decide which of them are
   * REQUIRED, which is what `../../live/github/requiredContexts.ts` compares them against.
   *
   * `undefined` is a real state rather than a default: a snapshot parsed from a bare commit node
   * ({@link parseChecksForCommit}) was never addressed to a pull request, so there is no base to name and no
   * required set a caller could judge it against.
   */
  readonly baseRef: string | undefined;
  /**
   * Whether GitHub can currently build this pull request's merge ref — the one field that tells a required
   * context which NEVER RAN apart from one that ran and failed, because a `pull_request` workflow is not
   * created at all while the merge ref cannot be computed.
   *
   * `undefined` carries the same meaning `baseRef`'s does: this read did not select it. A snapshot parsed
   * from a bare commit node ({@link parseChecksForCommit}) was never addressed to a pull request, so there
   * is no mergeability to report — and it must never be read as `MERGEABLE`, since "not measured" and
   * "measured clean" are exactly the two states the finding behind this field confused.
   */
  readonly mergeable: GithubMergeable | undefined;
  /** GitHub's own aggregate rollup state (e.g. `SUCCESS`, `FAILURE`, `PENDING`), carried verbatim. */
  readonly rollupState: string;
  readonly checks: readonly GithubCheck[];
  /** Every duplicate {@link dedupeLatestByName} discarded — the evidence behind a rollup/count disagreement. */
  readonly supersededChecks: readonly SupersededGithubCheck[];
  /**
   * Whether {@link checks} is short of the head — GitHub's own `pageInfo.hasNextPage` past this read's
   * `limit`, or a context node that did not decode — carried as a typed fact rather than only as advisory
   * prose in {@link residue}.
   *
   * It is a field because `./requiredContexts.ts` BRANCHES on it: {@link checks} is the whole head only
   * when this is `false`, so a required name absent from a truncated page measures nothing. Inferring that
   * by string-matching {@link residue} would make the one guard that exists to refuse a false green depend
   * on prose no type checks.
   */
  readonly truncated: boolean;
  readonly residue: readonly string[];
}

/** How many of a snapshot's checks are in each state. */
export interface GithubChecksSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
  readonly queued: number;
}

/** The injected checks-rollup seam. Production wraps `githubReadGraphql`'s safe transport; tests fake it. */
export type FetchGithubChecks = (args: {
  owner: string;
  repo: string;
  number: number;
  limit: number;
}) => Promise<Result<GithubChecksSnapshot, GithubLiveError>>;

/** A completed Check Run's conclusion that counts as passed rather than failed. */
const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Collapse one Check Run node's `status`/`conclusion` pair into a {@link GithubCheckState}. */
function checkRunState({
  status,
  conclusion,
}: {
  status: string | undefined;
  conclusion: string | undefined;
}): GithubCheckState {
  if (status !== "COMPLETED") {
    return status === "IN_PROGRESS" ? "running" : "queued";
  }
  return conclusion !== undefined && PASSING_CONCLUSIONS.has(conclusion) ? "passed" : "failed";
}

/** Collapse one legacy Status context's `state` into a {@link GithubCheckState}. */
function statusContextState({ state }: { state: string | undefined }): GithubCheckState {
  if (state === "SUCCESS") {
    return "passed";
  }
  return state === "FAILURE" || state === "ERROR" ? "failed" : "running";
}

/** The Check Run node's owning check suite, defensively unwrapped — both `createdAt` and `workflowRun` live here. */
function checkSuiteOf({ node }: { node: Record<string, unknown> }): Record<string, unknown> | undefined {
  const checkSuite = node["checkSuite"];
  return isRecord(checkSuite) ? checkSuite : undefined;
}

/** The check suite's own creation time — when the run it belongs to was started — used only to order re-runs. */
function checkSuiteCreatedAt({ node }: { node: Record<string, unknown> }): string | undefined {
  const checkSuite = checkSuiteOf({ node });
  return checkSuite === undefined ? undefined : optStr({ value: checkSuite["createdAt"] });
}

/** The Actions run this Check Run belongs to, GitHub's own numeric id, stringified. */
function workflowRunId({ node }: { node: Record<string, unknown> }): string | undefined {
  const checkSuite = checkSuiteOf({ node });
  const workflowRun = checkSuite === undefined ? undefined : checkSuite["workflowRun"];
  const databaseId = isRecord(workflowRun) ? workflowRun["databaseId"] : undefined;
  return typeof databaseId === "number" ? String(databaseId) : undefined;
}

/** Shape one raw rollup context node — either a Check Run or a legacy Status — into a {@link CheckWithSortKey}. */
function toCheck({ node }: { node: Record<string, unknown> }): CheckWithSortKey | undefined {
  if (node["__typename"] === "StatusContext") {
    const name = optStr({ value: node["context"] });
    const postedAt = optStr({ value: node["createdAt"] });
    return name === undefined
      ? undefined
      : {
          completedAt: undefined,
          kind: "status",
          name,
          ...(postedAt === undefined ? {} : { datedAt: postedAt }),
          runId: undefined,
          sortKey: postedAt,
          state: statusContextState({ state: optStr({ value: node["state"] }) }),
          url: optStr({ value: node["targetUrl"] }),
        };
  }
  const name = optStr({ value: node["name"] });
  const conclusion = optStr({ value: node["conclusion"] });
  const completedAt = optStr({ value: node["completedAt"] });
  return name === undefined
    ? undefined
    : {
        completedAt,
        ...(conclusion === undefined ? {} : { conclusion }),
        ...(completedAt === undefined ? {} : { datedAt: completedAt }),
        kind: "check-run",
        name,
        runId: workflowRunId({ node }),
        sortKey: checkSuiteCreatedAt({ node }),
        state: checkRunState({
          conclusion,
          status: optStr({ value: node["status"] }),
        }),
        url: optStr({ value: node["detailsUrl"] }),
      };
}

/**
 * The pull request's most recent commit object, defensively unwrapped from the GraphQL connection shape.
 *
 * Exported alongside `CHECKS_ROLLUP_SELECTION` (`./checksRead.ts`), so a sibling read that embeds that
 * selection unwraps it the same way rather than reimplementing the two-deep connection walk.
 *
 * @param pullRequest one raw `PullRequest` node
 * @returns the head commit node, or `undefined` when the connection is empty or malformed
 */
export function headCommitOf({
  pullRequest,
}: {
  pullRequest: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const commits = pullRequest["commits"];
  if (!isRecord(commits) || !Array.isArray(commits["nodes"])) {
    return undefined;
  }
  const node = commits["nodes"][0];
  if (!isRecord(node)) {
    return undefined;
  }
  const commit = node["commit"];
  return isRecord(commit) ? commit : undefined;
}

/** The head commit's `statusCheckRollup` object, when GitHub reports one at all. */
function rollupOf({ commit }: { commit: Record<string, unknown> }): Record<string, unknown> | undefined {
  const rollup = commit["statusCheckRollup"];
  return isRecord(rollup) ? rollup : undefined;
}

/**
 * One page of the rollup's context nodes, whether more exist past it, and the cursor the next page starts from.
 * The nodes stay raw so {@link contextsView} can count one that does not decode instead of losing it here.
 */
interface ContextsPage {
  readonly nodes: readonly unknown[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | undefined;
}

/** The rollup's requested context nodes, plus whether more exist past the requested `--limit`. */
function contextNodesOf({ rollup }: { rollup: Record<string, unknown> }): ContextsPage {
  const contexts = rollup["contexts"];
  if (!isRecord(contexts) || !Array.isArray(contexts["nodes"])) {
    // Every rollup query selects the connection, so one missing is unread, never empty: carried as a node that
    // will not decode, it marks the view short rather than reading as a head with nothing left to run.
    return { endCursor: undefined, hasNextPage: false, nodes: [contexts] };
  }
  const pageInfo = contexts["pageInfo"];
  return {
    endCursor: isRecord(pageInfo) ? optStr({ value: pageInfo["endCursor"] }) : undefined,
    hasNextPage: isRecord(pageInfo) && pageInfo["hasNextPage"] === true,
    nodes: contexts["nodes"],
  };
}

/**
 * One raw paged-read response's head SHA and contexts page, or `undefined` when it carries neither.
 *
 * @param data one raw response to either of `./checksRead.ts`'s rollup queries
 * @returns the head the page was read on and the page itself
 */
export function headContextsPageOf({
  data,
}: {
  data: unknown;
}): { readonly headSha: string; readonly page: ContextsPage } | undefined {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  const commit = isRecord(pullRequest) ? headCommitOf({ pullRequest }) : undefined;
  const headSha = commit === undefined ? undefined : optStr({ value: commit["oid"] });
  const rollup = commit === undefined ? undefined : rollupOf({ commit });
  if (headSha === undefined || rollup === undefined) {
    return undefined;
  }
  return { headSha, page: contextNodesOf({ rollup }) };
}

/**
 * The counted view of a head's context nodes: latest run per name, every discard, and whether any were unread.
 *
 * A node that does not decode — not an object, or a context carrying no name — is unread exactly as one past
 * the last page is, so it marks the view truncated: dropping it silently would let a head whose only running
 * check failed to decode read as finished.
 *
 * @param nodes every raw context node read, across however many pages the read took
 * @param hasNextPage whether GitHub holds contexts past the last page read
 * @returns the snapshot fields a context list decides
 */
export function contextsView({
  nodes,
  hasNextPage,
}: {
  nodes: readonly unknown[];
  hasNextPage: boolean;
}): Pick<GithubChecksSnapshot, "checks" | "residue" | "supersededChecks" | "truncated"> {
  const shaped = nodes.map((node) => (isRecord(node) ? toCheck({ node }) : undefined));
  const decoded = shaped.filter((check): check is CheckWithSortKey => check !== undefined);
  const { checks, superseded } = dedupeLatestByName({ checks: decoded });
  const undecoded = shaped.length - decoded.length;
  const residue = [
    ...(hasNextPage ? ["more check contexts exist than the requested --limit; pass a larger one to see them all"] : []),
    ...(undecoded > 0 ? [`${String(undecoded)} check context(s) did not decode, so the read is short`] : []),
  ];
  return { checks, residue, supersededChecks: superseded, truncated: hasNextPage || undecoded > 0 };
}

/**
 * Parse one raw checks-rollup GraphQL response into a typed snapshot.
 *
 * A pull request with no CI configured at all (no commit rollup) is not an error — it parses to an empty,
 * already-terminal snapshot, matching how `isChecksTerminal` treats zero checks: nothing to wait for.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/repo#number` this read was for, folded into a `NOT_FOUND` message
 * @returns the typed snapshot, or a named parse/read failure
 */
export function parseChecksSnapshot({
  data,
  identity,
}: {
  data: unknown;
  identity: string;
}): Result<GithubChecksSnapshot, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "pull request" }));
  }
  const baseRef = optStr({ value: pullRequest["baseRefName"] });
  const rawMergeable = optStr({ value: pullRequest["mergeable"] });
  const mergeable = rawMergeable === undefined ? undefined : asGithubMergeable({ token: rawMergeable });
  const commit = headCommitOf({ pullRequest });
  if (commit === undefined) {
    return ok({
      baseRef,
      checks: [],
      headSha: "",
      mergeable,
      residue: [],
      rollupState: "PENDING",
      supersededChecks: [],
      truncated: false,
    });
  }
  return parseChecksForCommit({ commit }).map((snapshot) => ({ ...snapshot, baseRef, mergeable }));
}

/**
 * Parse one already-unwrapped head-commit node into a checks snapshot.
 *
 * Split out of {@link parseChecksSnapshot} so a bulk read that already holds the commit node — the
 * review-state fleet read, which fetches many pull requests in one query — reuses the re-run dedupe rather
 * than reimplementing it. `parseChecksSnapshot` is now this function plus the unwrapping of one named read's
 * own `repository.pullRequest.commits` envelope.
 *
 * @param commit the `commit` node carrying `oid` and, when GitHub reports one, `statusCheckRollup`
 * @returns the typed snapshot, or a named read failure when the commit carries no SHA
 */
export function parseChecksForCommit({
  commit,
}: {
  commit: Record<string, unknown>;
}): Result<GithubChecksSnapshot, GithubLiveError> {
  const headSha = commit["oid"];
  if (typeof headSha !== "string") {
    return err(GithubLiveErrors.readFailed({ message: "GitHub returned a checks rollup with no head commit SHA" }));
  }
  const rollup = rollupOf({ commit });
  if (rollup === undefined) {
    return ok({
      baseRef: undefined,
      checks: [],
      headSha,
      mergeable: undefined,
      residue: [],
      rollupState: "PENDING",
      supersededChecks: [],
      truncated: false,
    });
  }
  const rollupState = optStr({ value: rollup["state"] }) ?? "UNKNOWN";
  const { nodes, hasNextPage } = contextNodesOf({ rollup });
  return ok({
    baseRef: undefined,
    headSha,
    mergeable: undefined,
    rollupState,
    ...contextsView({ hasNextPage, nodes }),
  });
}

/**
 * Count a snapshot's checks by state.
 *
 * @param checks the snapshot's checks
 * @returns how many are passed, failed, running or queued
 */
export function summarizeChecks({ checks }: { checks: readonly GithubCheck[] }): GithubChecksSummary {
  const count = ({ state }: { state: GithubCheckState }): number =>
    checks.filter((check) => check.state === state).length;
  return {
    failed: count({ state: "failed" }),
    passed: count({ state: "passed" }),
    queued: count({ state: "queued" }),
    running: count({ state: "running" }),
    total: checks.length,
  };
}

/**
 * Whether every check in a summary has reached a terminal state — nothing left worth polling for.
 *
 * @param summary the checks summary
 * @returns true once no check is running or queued (including the vacuous case of zero checks)
 */
export function isChecksTerminal({ summary }: { summary: GithubChecksSummary }): boolean {
  return summary.running === 0 && summary.queued === 0;
}

/**
 * Render a snapshot — the pass count, GitHub's own rollup state beside it, and, when any check failed, its
 * name — as one compact line, instead of raw provider output. This is the direct fix for the cost a raw
 * `gh pr checks` polling loop was measured to have: every poll's full output landing in the calling session's
 * own transcript. The rollup state rides beside the count on every line, not only a disagreeing one, so the
 * two never read as interchangeable again — a count-only line once matched a genuinely green head byte for
 * byte with a head the rollup called `FAILURE` (a superseded dev-gate run), which cost a p0 registration.
 *
 * @param summary the checks summary
 * @param snapshot the snapshot the summary was built from — its `rollupState` and `supersededChecks`
 * @returns a single human-readable status line
 */
export function formatChecksLine({
  summary,
  snapshot,
}: {
  summary: GithubChecksSummary;
  snapshot: GithubChecksSnapshot;
}): string {
  if (summary.total === 0) {
    return "no checks reported for this commit";
  }
  const parts = [`${String(summary.passed)}/${String(summary.total)} checks passed (rollup ${snapshot.rollupState})`];
  if (summary.failed > 0) {
    const names = snapshot.checks.filter((check) => check.state === "failed").map((check) => check.name);
    parts.push(`${String(summary.failed)} failed (${names.join(", ")})`);
  }
  if (summary.running > 0) {
    parts.push(`${String(summary.running)} running`);
  }
  if (summary.queued > 0) {
    parts.push(`${String(summary.queued)} queued`);
  }
  const mismatch = rollupMismatchClause({ snapshot, summary });
  if (mismatch !== undefined) {
    parts.push(mismatch);
  }
  return parts.join(", ");
}

/**
 * The stepped poll backoff, grounded in this repository's own measured CI duration rather than picked
 * arbitrarily. RE-MEASURED through the door: 49 `ci.yml` laps across the 20 pull requests merged
 * in one three-day window ran p50 9m23s, p95 9m45s, band 8m47s–9m59s. That band does not OVERLAP an earlier
 * sample (ten runs, 7m40s–8m37s), so read the lap as growing with the repository
 * rather than as a fixed cost — `build` is the whole critical path and it is what grew. Reproduce:
 *
 * ```bash
 * slopweaver github read https://github.com/lachiejames/slopweaver/pull/<n> --json \
 *   | jq '.data.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[]
 *         | {name, startedAt, completedAt, detailsUrl}'
 * ```
 *
 * Group by the run id in `detailsUrl`; one group is one lap. The old line named `gh run list`, which rule 3
 * bans, so the only reproducible CI-duration measurement in this repository could not be re-run by a session
 * obeying the door — the command above is the doored replacement. The one thing it needs that the rollup
 * query in `./checksRead.ts` does not request is `startedAt`.
 *
 * A fixed short interval of 3s would need on the order of a hundred polls to wait one of these runs out. This schedule reaches roughly a dozen instead, while staying short enough at the start to still catch
 * a check that fails fast (a lint or typecheck step, typically under a minute).
 */
const CHECKS_POLL_SCHEDULE_MS: readonly number[] = PROVIDER_WAIT_SCHEDULE_MS;

/**
 * How long to wait before the next poll. The schedule is the one wait contract's provider schedule
 * (`src/wait/loop.ts`), which this measurement sized — so every other verb's `--wait` inherits it.
 *
 * @param attempt how many polls have already completed (0 before the second poll, 1 before the third, …)
 * @returns the delay in milliseconds
 */
export function nextChecksPollDelayMs({ attempt }: { attempt: number }): number {
  return nextWaitDelayMs({ attempt, ceilingMs: PROVIDER_WAIT_CEILING_MS, schedule: CHECKS_POLL_SCHEDULE_MS });
}
