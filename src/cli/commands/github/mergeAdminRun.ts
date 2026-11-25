/**
 * The effectful half of `slopweaver github merge --admin` — the one path in this verb that actually merges.
 *
 * ## The order is the contract, and blocking Git comes first
 *
 *   [the guard's own verdict, already clean] → resolve the local head → remeasure base freshness against the
 *   REMOTE → private terms over the merged change set, against that fetched base → token → read the pull
 *   request → agree it is the change we measured → admin/protection preflight → Codex floor re-read → ratchet-bump witness → resolve the author's own walkthrough threads → door →
 *   squash merge → [only once merged] probe the freshly-fetched base's own docs budget
 *
 * `--dry-run` walks that same order through the same functions and stops at the door: the walkthrough step names
 * what it would resolve and resolves nothing, a required context missing from the head is a note (a lap is about to post it),
 * the door is asked without recording and its hold refuses, and it prints `would merge` with no door record, merge or
 * hold release. `github lap --land` runs it before any lane.
 *
 * The ratchet-bump witness may `git fetch` a commit no checkout here holds — the one blocking Git call that
 * can run AFTER a GitHub request. It runs only when the commits are absent, and `measureBaseFreshness` has
 * already fetched the base, so it is the rare case rather than the path; the hazard below is named, not closed.
 *
 * Every blocking Git call happens BEFORE the first GitHub request, deliberately. `git fetch` blocks the
 * event loop, and a blocked loop between a pooled GET and a POST hands the POST a socket the server has
 * already closed — the exact hazard `./stackPushSend.ts` guards on create, reached here by the same
 * mechanism. Ordering it this way costs nothing and removes the failure entirely.
 *
 * ## The remeasure is the point, not a nicety
 *
 * A pull request's gates ran against the base as it was when the branch was last pushed. If the base moved
 * in the window between that push and the merge, the merge lands a change nothing ever validated against
 * what it is landing on — measured on this repository, a pull request was squashed onto a base that had
 * advanced by a whole other pull request between its last push and its merge. It was documentation, so the
 * base stayed green; a code change in that same window would have reddened it. So the freshness check is
 * re-run HERE, at merge time, against a freshly fetched remote tip rather than whatever the local checkout
 * happened to know — and it refuses, escapably, exactly like `github push`'s own.
 *
 * What this does NOT do is rebase the branch and re-run the gates for you. That mutates a working tree, and
 * a merge verb that silently rewrites the branch it is about to land is a worse failure than the one it
 * would be preventing. The refusal names the remedy and stops.
 *
 * ## The private terms are read by THIS build, over the tree this merge lands
 *
 * A branch cut before the pre-push hook learned the private terms pushes on its own hook, CI holds no terms file,
 * and this verb does not rebase — so nothing else reads the change set for them. The sweep runs here, in the build
 * running the verb, over every file the merge of the pinned head into the just-fetched base adds or changes
 * (`../../../outbound/github/privateTermsSweep.ts`). A hit, or a terms file that will not read, is a hold nothing
 * acknowledges; an absent terms file is `private-terms-unchecked`, landed only by naming it with a `--reason` the door
 * ledger records. `--dry-run` runs it too, so `github lap --land` refuses before its first lane. The residue: the base
 * can still move between this read and GitHub's merge, which pins the head and never the base, and local git is not
 * GitHub's merge implementation.
 *
 * ## The post-merge probe is a belt, not the buckle
 *
 * `./mergeRun.ts`'s own report already re-measures the docs budget against the tree THIS merge would produce
 * before reaching here (see `../../../outbound/github/docsBudgetSweep.js`), so the common case never reaches
 * a merged, over-budget base at all. This probe exists for what that check cannot see: a concurrent merge
 * landing in the window between the report and this door call, or an operator who typed
 * `--acknowledge always-on-docs-budget` over a real overrun. Either way, the base is measured again the
 * instant after IT actually changed, and a crossing is published to the supervisor stream rather than left
 * for whichever branch forks from it next to discover — see `docs/supervisor-events.md`'s `github-merge`
 * row. A probe that could not run at all (a transient fetch failure) is printed as a warning and never
 * published: "the probe didn't run" is not evidence the base is red.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type ThroughDoorResult, throughDoor } from "../../../admit/effects.js";
import type { DoorAcknowledgement, DoorRequest } from "../../../admit/types.js";
import type { AdminMergePr, GithubAdminMergeApi } from "../../../outbound/github/adminMerge.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { printBaseFreshnessPermit } from "./baseFreshnessCore.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  adminMergeDoorRefusalLines,
  adminMergeDoorRequest,
  adminMergePreflight,
  mergeOutcomeLines,
  remoteBaseBranchOf,
  repoAddressOf,
  squashCommitTitle,
} from "./mergeAdminCore.js";
import { readPreflightFacts } from "./mergeAdminPreflightReads.js";
import { runPostMergeDocsBudgetProbe } from "./mergeAdminProbe.js";
import { answerDryRun, recheckBeforeMerge, refuseAdminMerge as refuse } from "./mergeAdminRecheck.js";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "./mergeAdminTypes.js";
import { judgeCodexPairingFloor, readAndAgree } from "./mergeAdminVerdicts.js";
import { landingBaseOf, privateTermsPermit } from "./privateTermsPermit.js";

/** Send the squash merge through the door and report exactly what GitHub did with it. */
async function mergeThroughDoor({
  api,
  deps,
  home,
  owner,
  repo,
  slug,
  remote,
  repoRoot,
  pr,
  request,
  termsAcknowledgement,
}: {
  api: GithubAdminMergeApi;
  deps: GithubAdminMergeDeps;
  home: string;
  owner: string;
  repo: string;
  slug: string;
  remote: string;
  repoRoot: string;
  pr: AdminMergePr;
  request: AdminMergeRequest;
  termsAcknowledgement: DoorAcknowledgement | undefined;
}): Promise<number> {
  const recheck = await recheckBeforeMerge({ deps, home, owner, pr, repo, request });
  if (recheck.isErr()) {
    return recheck.error;
  }
  // The RECHECK's acknowledgement, never the first read's. A floor that was clean at the first read and
  // unmet at the second is waived by this invocation's flags, and recording the first read's `undefined`
  // would land the merge with no reason in the ledger — which is exactly what the canon promises it has.
  // A regression introduced by the re-read above and caught by the next Codex review of it.
  const doorRequest = adminMergeDoorRequest({
    acknowledgement: recheck.value,
    home,
    number: pr.number,
    repo: slug,
    termsAcknowledgement,
  });
  if (request.execution === "dry-run") {
    return answerDryRun({ deps, doorRequest, home, pr });
  }
  const through = await squashThroughDoor({ api, deps, doorRequest, home, owner, pr, repo });
  if (!through.performed) {
    return refuse({ deps, lines: adminMergeDoorRefusalLines({ through }) });
  }
  const { result } = through;
  if (result.isErr()) {
    return refuse({ deps, lines: [result.error.message] });
  }
  return reportMerge({ deps, home, merged: result.value.merged, pr, remote, repoRoot, sha: result.value.sha, slug });
}

/** The squash merge itself, pinned to the read head, run through the door under `doorRequest`. */
async function squashThroughDoor({
  api,
  deps,
  doorRequest,
  home,
  owner,
  pr,
  repo,
}: {
  api: GithubAdminMergeApi;
  deps: GithubAdminMergeDeps;
  doorRequest: DoorRequest;
  home: string;
  owner: string;
  pr: AdminMergePr;
  repo: string;
}): Promise<ThroughDoorResult<Awaited<ReturnType<GithubAdminMergeApi["merge"]>>>> {
  return throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async () =>
      api.merge({
        commitTitle: squashCommitTitle({ number: pr.number, title: pr.title }),
        number: pr.number,
        owner,
        repo,
        sha: pr.headSha,
      }),
    request: doorRequest,
  });
}

/**
 * Print the merge's outcome, release this session's own hold, and probe the base's docs budget.
 *
 * Split out so `mergeThroughDoor` stays inside the function-length cap and reads as door-then-outcome.
 *
 * @param merged whether GitHub reported the merge as landed
 * @param sha the commit GitHub landed, or the one it reported
 * @param slug the `owner/name`, for the hold release and the probe
 * @returns the process exit code
 */
function reportMerge({
  deps,
  home,
  pr,
  remote,
  repoRoot,
  sha,
  merged,
  slug,
}: {
  deps: GithubAdminMergeDeps;
  home: string;
  pr: AdminMergePr;
  remote: string;
  repoRoot: string;
  sha: string;
  merged: boolean;
  slug: string;
}): number {
  const outcome = mergeOutcomeLines({ merged, pr, sha });
  for (const line of outcome.lines) {
    deps.out({ line });
  }
  if (!outcome.failed) {
    deps.releaseOwnHold({ home, pr: pr.number, repo: slug, sha });
    runPostMergeDocsBudgetProbe({ baseBranch: pr.baseRef, deps, home, remote, repo: slug, repoRoot });
  }
  return outcome.failed ? EXIT_ERROR : EXIT_OK;
}

/**
 * Read the admin/protection facts, print every note, and report whether the preflight cleared.
 *
 * Its own function so `proceedToMerge` stays a readable sequence of decisions rather than one long body —
 * the refusals it prints are the preflight's own, already composed by `adminMergePreflight`.
 *
 * @param pr the pull request as the authoritative read found it
 * @param repoName the repository half of the slug, for the reads
 * @returns true when nothing in the preflight stands in the way
 */
async function runPreflight({
  api,
  deps,
  owner,
  pr,
  repoName,
  request,
}: {
  api: GithubAdminMergeApi;
  deps: GithubAdminMergeDeps;
  owner: string;
  pr: AdminMergePr;
  repoName: string;
  request: AdminMergeRequest;
}): Promise<boolean> {
  const facts = await readPreflightFacts({ api, branch: pr.baseRef, number: pr.number, owner, repo: repoName });
  if (facts.isErr()) {
    refuse({ deps, lines: githubVerbErrorLines({ error: facts.error }) });
    return false;
  }
  const preflight = adminMergePreflight({
    execution: request.execution,
    gate: facts.value.gate,
    isAdmin: facts.value.isAdmin,
    pr,
    protection: facts.value.protection,
    repo: request.repo,
    reviews: facts.value.reviews,
  });
  for (const note of preflight.notes) {
    deps.out({ line: note });
  }
  if (preflight.refusals.length > 0) {
    refuse({ deps, lines: preflight.refusals });
    return false;
  }
  return true;
}

/** Read the pull request, run the admin/protection preflight, and merge through the door — or refuse. */
async function proceedToMerge({
  api,
  baseBranch,
  headSha,
  owner,
  repoName,
  request,
  deps,
  termsAcknowledgement,
}: {
  api: GithubAdminMergeApi;
  baseBranch: string;
  headSha: string;
  owner: string;
  repoName: string;
  request: AdminMergeRequest;
  deps: GithubAdminMergeDeps;
  termsAcknowledgement: DoorAcknowledgement | undefined;
}): Promise<number> {
  const pr = await readAndAgree({ api, baseBranch, headSha, owner, repo: repoName, request });
  if (pr.isErr()) {
    return refuse({ deps, lines: pr.error });
  }
  const waiver = await judgeCodexPairingFloor({ deps, pr: pr.value, request });
  if (waiver.kind === "standing") {
    return refuse({ deps, lines: waiver.lines });
  }
  const cleared = await runPreflight({ api, deps, owner, pr: pr.value, repoName, request });
  if (!cleared) {
    return EXIT_ERROR;
  }
  return mergeThroughDoor({
    api,
    deps,
    home: request.home,
    owner,
    pr: pr.value,
    remote: request.remote,
    repo: repoName,
    repoRoot: request.repoRoot,
    request,
    slug: request.repo,
    termsAcknowledgement,
  });
}

/**
 * Perform one administrator-bypass squash merge, with every edge injected.
 *
 * The caller runs this ONLY after its own report came back clean — a merge behind an unacknowledged finding
 * is the exact thing the guard exists to stop, so this function is never reached with one standing.
 *
 * @param request the pull request, refs, remote, repository root and state home for this merge
 * @param deps the injectable edges — credential, GitHub client, Git measurement and output sink
 * @returns the process exit code
 */
export async function performAdminMerge({
  request,
  deps,
}: {
  request: AdminMergeRequest;
  deps: GithubAdminMergeDeps;
}): Promise<number> {
  const address = repoAddressOf({ repo: request.repo });
  if (address === undefined) {
    return refuse({ deps, lines: [`--repo must be owner/name to merge; "${request.repo}" is not`] });
  }
  const { owner, repo: repoName } = address;
  const headSha = deps.localSha({ cwd: request.repoRoot, ref: request.head });
  if (headSha.isErr()) {
    return refuse({ deps, lines: githubVerbErrorLines({ error: headSha.error }) });
  }
  const baseBranch = remoteBaseBranchOf({ base: request.base, remote: request.remote });
  const measurement = deps.measureBaseFreshness({
    baseBranch,
    cwd: request.repoRoot,
    headSha: headSha.value,
    remote: request.remote,
  });
  const stale = printBaseFreshnessPermit({ acknowledgement: request.acknowledgement, measurement, out: deps.out });
  if (stale) {
    return EXIT_ERROR;
  }
  const terms = privateTermsPermit({
    acknowledgement: request.acknowledgement,
    verdict: deps.sweepPrivateTerms({
      base: landingBaseOf({ measurement }),
      headSha: headSha.value,
      home: request.home,
      repoRoot: request.repoRoot,
    }),
  });
  for (const line of terms.lines) {
    deps.out({ line });
  }
  if (terms.refused) {
    return EXIT_ERROR;
  }
  const token = deps.token({ home: request.home });
  if (token === undefined) {
    return refuse({ deps, lines: ["no GitHub token configured; run `slopweaver connect github`"] });
  }
  const api = deps.makeApi({ home: request.home, token });
  return proceedToMerge({
    api,
    baseBranch,
    deps,
    headSha: headSha.value,
    owner,
    repoName,
    request,
    termsAcknowledgement: terms.acknowledgement,
  });
}
