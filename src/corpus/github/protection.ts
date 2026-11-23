/**
 * One branch's REQUIRED STATUS-CHECK CONTEXTS — read and write — plus the one measurement that makes the
 * write safe on a branch with a merge queue.
 *
 * Split out of `./write.ts` for the same reason `./repoDescription.ts` was: the file-size ratchet
 * (`src/devLint/fileSizeRatchet.ts`). Same lane, same `WriteCtx`, every `client.rest` token LEXICALLY
 * inside `safeProviderCall(...)`, and the mutation is `retryMode: "never"`.
 *
 * ## Why the merge-group measurement lives beside the write
 *
 * GitHub's native merge queue tests each entry on its own `refs/heads/gh-readonly-queue/...` ref, which
 * fires `merge_group` and nothing else. A required context whose workflow has no `merge_group:` trigger
 * therefore produces NO check run on an entry, and the entry does not fail — the queue stalls waiting for a
 * verdict that can never arrive. Adding a name to `main`'s ruleset strands every open pull request and queue
 * entry on a check their own workflow file cannot produce, and this turns that hazard into a measurement.
 *
 * The measurement is an INTERSECTION and cannot be simplified to "check runs on the entry's head". On a
 * successful landing GitHub fast-forwards the base to the merge group's own head commit, so the `push`-event
 * workflow run attaches its check runs to the SAME sha — measured, the three most recent
 * `merge_group` `ci.yml` runs report head shas that are `main`'s
 * last three commits. Without filtering by the check suite each `merge_group` run owns, a push-only context
 * would read as present on a queue entry. Reproduce:
 *   slopweaver github required-contexts --repo lachiejames/slopweaver --branch main --json
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { type GithubProtectionReadError, settleProtectionRead } from "./protectionRead.js";
import type { RepoRef, WriteCtx } from "./write.js";

/**
 * One branch's required status-check rule, as classic branch protection stores it.
 *
 * `unprotected` is its own member rather than an empty `contexts`, exactly as `./writeMerge.ts`'s
 * `BranchProtection` splits them: "GitHub answered 404, nothing protects this branch" and "protection exists
 * and requires nothing" are different facts, and only the second one is a branch a write can PATCH at all.
 */
export type RequiredStatusChecks =
  | {
      readonly kind: "required";
      /** Every context the branch requires, in GitHub's own order. */
      readonly contexts: readonly string[];
      /** GitHub's "require branches to be up to date before merging" flag, carried so a write can send it back unchanged. */
      readonly strict: boolean;
    }
  | { readonly kind: "unprotected" }
  /** The repository's plan cannot protect a branch, so no rule exists here and none can be written. */
  | { readonly kind: "plan-unavailable" };

/**
 * What the merge-group observation window saw.
 *
 * `entries` is how many queue entries the window actually covered, and it is not decoration: a repository
 * whose queue has never run answers zero, and an empty `contexts` there means "nothing was measured" rather
 * than "nothing runs on a merge group". The caller must be able to tell those apart.
 */
export interface MergeGroupObservation {
  readonly entries: number;
  /**
   * How many check suites the queue-BRANCH criterion matched across the window.
   *
   * Reported rather than kept internal because it is the only falsifiable witness that half of the
   * criterion runs at all: the two suite sets are unioned, so a `head_branch` GitHub never populates would
   * leave the observed names identical and the widening silently dead. A window covering entries answers
   * non-zero on any repository with a merge queue.
   */
  readonly queueRefSuites: number;
  /** One context name observed on a merge-group ref, paired with the entry head it was observed on. */
  readonly contexts: readonly { readonly name: string; readonly headSha: string }[];
}

/**
 * Read one branch's required status-check contexts.
 *
 * GitHub answers 404 both for an unprotected branch and for a protected branch with no status-check rule;
 * both are STATES rather than faults, so both become `unprotected` here instead of surfacing as a failed
 * read the caller has to interpret — the same translation `branchProtectionVia` makes. A plan-gated 403 is
 * `plan-unavailable` and any other 403 a typed permission denial (`./protectionRead.ts`).
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and the branch whose rule to read
 * @returns the required contexts and the strict flag, that the branch carries no such rule, or that it cannot
 */
export function requiredStatusChecksVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string };
}): ResultAsync<RequiredStatusChecks, GithubProtectionReadError> {
  const read = safeProviderCall({
    execute: async (): Promise<RequiredStatusChecks> => {
      const res = await ctx.client.rest.repos.getStatusChecksProtection({
        branch: input.branch,
        owner: input.owner,
        repo: input.repo,
      });
      return { contexts: res.data.contexts, kind: "required", strict: res.data.strict };
    },
    operation: "github.repos.getStatusChecksProtection",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
  return settleProtectionRead({
    branch: input.branch,
    planUnavailable: { kind: "plan-unavailable" },
    read,
    unprotected: { kind: "unprotected" },
  });
}

/**
 * Replace one branch's required status-check contexts. Sent once; the caller confirms by read-back.
 *
 * The endpoint REPLACES the whole array, so a caller sending only what it wants to add silently drops
 * everything already required — which on a queued branch is the ungated queue
 * `skills/github/reference/ungated-queue.md` exists about. `strict` is sent back as it was read for the same
 * reason: this write's subject is the context list and nothing else.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the branch, the complete context list to store, and the strict flag to preserve
 * @returns the rule GitHub stored
 */
export function setRequiredStatusChecksVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { branch: string; contexts: readonly string[]; strict: boolean };
}): ResultAsync<RequiredStatusChecks, IngestError> {
  return safeProviderCall({
    execute: async () => {
      // `checks`, never the deprecated `contexts` array GitHub still accepts: each entry may carry an
      // `app_id`, and omitting it is what keeps the any-app semantics this branch already has.
      const res = await ctx.client.rest.repos.updateStatusCheckProtection({
        branch: input.branch,
        checks: input.contexts.map((context) => ({ context })),
        owner: input.owner,
        repo: input.repo,
        strict: input.strict,
      });
      return { contexts: res.data.contexts, kind: "required", strict: res.data.strict } as const;
    },
    operation: "github.repos.updateStatusCheckProtection",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * The distinct queue-entry heads one page of `merge_group` runs covers, newest first, capped at `entries`.
 *
 * Pure, and separated from the read for that reason: the entry budget applying to HEAD SHAS rather than to
 * runs is the whole correctness of this measurement, and it is a property a test can hold down directly.
 *
 * @param runs one page of workflow runs, in GitHub's own newest-first order
 * @param entries how many queue entries the window should cover
 * @returns each distinct head sha, in the order GitHub listed it
 */
export function recentEntryHeads({
  runs,
  entries,
}: {
  runs: readonly { readonly head_sha: string }[];
  entries: number;
}): readonly string[] {
  const recent: string[] = [];
  for (const run of runs) {
    if (!recent.includes(run.head_sha) && recent.length < entries) {
      recent.push(run.head_sha);
    }
  }
  return recent;
}

/**
 * Every check suite a `merge_group` run of one of `heads` belongs to.
 *
 * This set is what separates a context that really ran on a queue entry from one that merely reports on the
 * same commit: a successful landing fast-forwards the base to the entry's own head, so the `push`-event
 * suite attaches its check runs to exactly the sha being read here.
 *
 * @param runs one page of `merge_group` workflow runs
 * @param heads the entry heads the window covers
 * @returns the suite ids a name has to belong to before it counts as observed
 */
export function mergeGroupSuiteIds({
  runs,
  heads,
}: {
  runs: readonly { readonly head_sha: string; readonly check_suite_id?: number | null }[];
  heads: readonly string[];
}): ReadonlySet<number> {
  const wanted = new Set(heads);
  const suites = new Set<number>();
  for (const run of runs) {
    if (wanted.has(run.head_sha) && run.check_suite_id != null) {
      suites.add(run.check_suite_id);
    }
  }
  return suites;
}

/**
 * The check suites on one ref that GitHub cut for a merge-queue entry, judged by the ref they were cut on.
 *
 * The Actions half above cannot see a suite no workflow run owns, and an App that posts a check run on the
 * entry branch has exactly that shape — so on its own it reports every such context as never observed, which
 * is a refusal firing on a name that really does gate the queue. A queue entry is always pushed to
 * `refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>`, and the suite carries that branch, so this reads the
 * property directly instead of inferring it. The two sets are UNIONED, never swapped: `head_branch` is
 * nullable on GitHub's own schema, and the Actions half needs no such field.
 *
 * @param suites every check suite GitHub reports for the ref
 * @returns the ids of the suites cut on a merge-queue branch
 */
export function queueRefSuiteIds({
  suites,
}: {
  suites: readonly { readonly id: number; readonly head_branch?: string | null }[];
}): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const suite of suites) {
    if (suite.head_branch?.startsWith(QUEUE_REF_PREFIX) === true) {
      ids.add(suite.id);
    }
  }
  return ids;
}

/**
 * The check-run names on one ref that belong to a `merge_group` suite.
 *
 * @param checkRuns every check run GitHub reports for the ref
 * @param suites the merge-group suite ids from {@link mergeGroupSuiteIds}
 * @returns each qualifying name, in GitHub's own order, duplicates kept
 */
export function namesInMergeGroupSuites({
  checkRuns,
  suites,
}: {
  checkRuns: readonly { readonly name: string; readonly check_suite?: { readonly id?: number } | null }[];
  suites: ReadonlySet<number>;
}): readonly string[] {
  const names: string[] = [];
  for (const check of checkRuns) {
    if (check.check_suite?.id != null && suites.has(check.check_suite.id)) {
      names.push(check.name);
    }
  }
  return names;
}

/**
 * Every check-run NAME actually observed on a merge-group ref over the last `entries` queue entries.
 *
 * Three reads, because no one of them decides it. `GET /actions/runs?event=merge_group` names the runs that
 * fired on a queue entry and, per run, the check SUITE it owns; `GET /commits/{sha}/check-suites` adds every
 * suite cut on the queue BRANCH, which is how a context an App posted gets counted at all; `GET
 * /commits/{sha}/check-runs` names every context on that commit whatever produced it. Keeping only the names
 * whose suite is in the union of the first two is what excludes the `push`-event run that lands on the same
 * sha once the entry merges.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository and how many recent queue entries to look at
 * @returns the observed context names with the entry head each was seen on, and the window actually covered
 */
export function mergeGroupContextsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { entries: number };
}): ResultAsync<MergeGroupObservation, IngestError> {
  return safeProviderCall({
    execute: async () => {
      // ONE page of runs, then `entries` is applied to the distinct HEAD SHAS it contains — not to the run
      // count. Several workflows fire on the same queue entry (here `ci.yml` does, and whether code scanning
      // does is exactly the question this read answers), so capping the RUN list at `entries` would return
      // one workflow's runs and report every other workflow's contexts as never observed. That is the
      // measurement inverting its own verdict, and it is how this read first answered.
      const runs = await ctx.client.rest.actions.listWorkflowRunsForRepo({
        event: "merge_group",
        owner: input.owner,
        per_page: RUN_PAGE,
        repo: input.repo,
      });
      const recent = recentEntryHeads({ entries: input.entries, runs: runs.data.workflow_runs });
      const fromRuns = mergeGroupSuiteIds({ heads: recent, runs: runs.data.workflow_runs });
      const observed: { name: string; headSha: string }[] = [];
      let queueRefSuites = 0;
      for (const headSha of recent) {
        const suiteList = await ctx.client.rest.checks.listSuitesForRef({
          owner: input.owner,
          per_page: CHECK_SUITE_PAGE,
          ref: headSha,
          repo: input.repo,
        });
        const onQueueRef = queueRefSuiteIds({ suites: suiteList.data.check_suites });
        queueRefSuites += onQueueRef.size;
        const suites = new Set([...fromRuns, ...onQueueRef]);
        const checks = await ctx.client.rest.checks.listForRef({
          owner: input.owner,
          per_page: CHECK_RUN_PAGE,
          ref: headSha,
          repo: input.repo,
        });
        for (const name of namesInMergeGroupSuites({ checkRuns: checks.data.check_runs, suites })) {
          observed.push({ headSha, name });
        }
      }
      return { contexts: observed, entries: recent.length, queueRefSuites };
    },
    operation: "github.actions.listWorkflowRunsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * How many recent `merge_group` workflow runs one page of the observation read asks for — GitHub's own
 * maximum. It is a RUN budget, not an entry budget: the caller's `entries` narrows the distinct head shas
 * inside this page, so every workflow that fired on those entries is in hand before any name is judged
 * absent.
 */
const RUN_PAGE = 100;

/**
 * The check-run page size the observation read asks for — GitHub's own maximum, so one queue entry's
 * contexts are never split across a page this read does not ask for. `src/live/github/requiredContexts.ts`
 * carries the measurement that made truncation a first-class concern rather than a footnote: a 50-context
 * default reported a required context absent from a head that carried 93.
 */
const CHECK_RUN_PAGE = 100;

/** One page of check SUITES per entry head — GitHub's maximum, and far past what any one commit carries. */
const CHECK_SUITE_PAGE = 100;

/**
 * The ref prefix GitHub pushes every merge-queue entry to, and the only thing that identifies a suite as a
 * queue entry's without a workflow run to ask. Read it in the queue's own docs, never derived from a name
 * here: `refs/heads/gh-readonly-queue/<base>/pr-<number>-<sha>`.
 */
const QUEUE_REF_PREFIX = "gh-readonly-queue/";
