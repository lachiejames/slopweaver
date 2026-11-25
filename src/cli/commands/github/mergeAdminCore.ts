/**
 * Every DECISION the `--admin` half of `slopweaver github merge` makes, as pure functions. The effectful
 * shell in `./mergeAdminRun.ts` resolves the token, reads GitHub, fetches the base branch and routes the
 * merge through the door; nothing here touches the network, the clock or the filesystem.
 *
 * ## `--admin` is an explicit option, never a silent default
 *
 * Without it the verb is exactly what it always was: a report. With it, and only with it, a clean report is
 * followed by a real squash merge that relies on the repository administrator's branch-protection bypass.
 * The flag is the whole consent — a caller reading the command line can see that this invocation merges,
 * and a caller who did not type it cannot be surprised by one.
 *
 * ## Two facts, two refusals, each naming what is actually wrong
 *
 * The bypass exists only when BOTH hold: the viewer holds admin permission, and the branch's protection
 * carries `enforce_admins: false`. When either fails the merge is refused with the reason that failed —
 * never a generic "cannot merge", because the two have completely different remedies (get admin, versus
 * change the protection or get a review) and a session that cannot tell them apart parks on the wrong one.
 *
 * An UNPROTECTED base is not a refusal BY ITSELF. There is no CLASSIC gate to bypass, so the merge is
 * ordinary and the report says so rather than implying an override happened — but only once the review gate
 * below has agreed the branch really is ungated, because `unprotected` here means "GitHub answered 404 for
 * classic protection" and a ruleset-governed branch answers exactly that.
 *
 * ## The third refusal: a required context that never ran
 *
 * The bypass merges past branch protection, so nothing on GitHub's side is left to notice that a REQUIRED
 * status-check context holds no verdict. `statusCheckRollup` cannot notice it either — it summarises the
 * runs PRESENT on the head, so a context that never registered is absent rather than red and the rollup
 * reads `SUCCESS` over whatever else did run. That is the one false green nothing else here refuses, and it
 * is refused rather than warned about because the head it describes is exactly as unmergeable as one with a
 * failing check.
 *
 * A check that FAILED is deliberately NOT a refusal here, and that is a boundary rather than an oversight:
 * a red check is visible in `github checks`, in the rollup and in GitHub's own UI, so judging it is the
 * operator's own lap. A required context that never ran is visible in none of those.
 *
 * ## The fourth refusal: a base that requires a REVIEW
 *
 * A branch whose rules require a pull-request review is refused outright, and `--admin` is never offered as a
 * route past one. Owner ruling: the owner is never asked whether to admin-merge into the work
 * repository's customer-facing branch with CODEOWNERS unsatisfied, because the answer is always no. MEASURED,
 * that branch's requirement comes from a repository RULESET with an empty `bypass_actors`, which
 * neither `enforce_admins` nor admin permission can waive — so the offer would name a merge GitHub refuses.
 * Without this refusal the 404 above reads as `unprotected` and the
 * preflight would PERMIT it. This repository's own `main` requires no review at all, so the slopweaver half of
 * the ruling is untouched: `--admin` remains its sole-CODEOWNER landing path. See
 * `../../../live/github/reviewRules.ts`.
 */
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import type { DoorAcknowledgement, DoorRequest } from "../../../admit/types.js";
import { budgetOverruns } from "../../../canon/alwaysOnDocs.js";
import type { PullRequestHead } from "../../../codex/landingGate.js";
import type { BranchProtection } from "../../../corpus/github/write.js";
import { type RequiredContextGate, requiredContextRefusal } from "../../../live/github/requiredContexts.js";
import { type ReviewGate, reviewGateRefusal } from "../../../live/github/reviewRules.js";
import type { AdminMergePr } from "../../../outbound/github/adminMerge.js";
import type { MergeDocsBudgetSweep } from "../../../outbound/github/docsBudgetSweep.js";
import { bypassOutcome, type PreflightHalf } from "./mergeAdminBypass.js";
import type { AdminMergeExecution } from "./mergeAdminTypes.js";

/**
 * What the preflight concluded: the lines to print, and every reason this invocation must not merge.
 *
 * @internal the return shape of `adminMergePreflight`; no caller outside this verb names it.
 */
export interface AdminMergePreflight {
  /** Printed whether or not the merge proceeds — the bypass is never silent. */
  readonly notes: readonly string[];
  /** Empty means permitted. Non-empty means refuse, and these are the reasons. */
  readonly refusals: readonly string[];
}

/**
 * Why this pull request cannot be merged at all, independent of any bypass.
 *
 * @param pr the pull request as GitHub currently reports it
 * @returns one refusal line per blocking state
 */
function stateRefusals({ pr }: { pr: AdminMergePr }): readonly string[] {
  const refusals: string[] = [];
  if (pr.state !== "open") {
    refusals.push(
      `#${String(pr.number)} is ${pr.state}, not open — nothing to merge. If it merged already, pull the base branch.`,
    );
  }
  if (pr.draft) {
    refusals.push(
      `#${String(pr.number)} is still a DRAFT. Undraft it with \`slopweaver github ready\` once CI is green, then merge.`,
    );
  }
  const stack = stackRefusal({ pr });
  if (stack !== undefined) {
    refusals.push(stack);
  }
  return refusals;
}

/**
 * Why a NATIVE-stack member cannot land through this verb: GitHub's merge endpoint answers a stack member's admin
 * squash "Merging stacked PRs via this endpoint is not supported" (relayed from a lap's console; its merge output
 * was not logged), however green its laps were. The answer names the ENDPOINT, not the base, so every member is refused;
 * the queue read only picks the way out — `github enqueue`'s asynchronous stack route where the stack's base has a
 * queue, `github stack remove` where it has none.
 *
 * @param pr the pull request with its stack membership and that stack's queue
 * @returns the refusal line, or `undefined` when the pull request is in no stack
 */
function stackRefusal({ pr }: { pr: AdminMergePr }): string | undefined {
  if (pr.stack === undefined) {
    return undefined;
  }
  const { baseRefName, number, position, size } = pr.stack;
  const member =
    `#${String(pr.number)} is position ${String(position)} of ${String(size)} in native stack #${String(number)}, ` +
    `which lands on ${baseRefName}. GitHub's merge endpoint does not merge a stack member, so ` +
    "`github merge --admin` cannot land it. ";
  if (pr.stackQueue !== undefined) {
    return (
      `${member}${baseRefName} has a merge queue: land it with \`slopweaver github enqueue\`, which takes the ` +
      "asynchronous route a stack member needs (skills/github/reference/stack-merge.md)."
    );
  }
  return (
    `${member}${baseRefName} has no merge queue, so take it out of the stack with \`slopweaver github stack ` +
    "remove` (which retargets it) and land it alone (skills/github/reference/stack-merge.md)."
  );
}

/**
 * Whether the administrator bypass is available, and the exact reason when it is not.
 *
 * @param pr the pull request being merged
 * @param repo the `owner/name` slug, named in the refusal so a wrong-repository invocation is obvious
 * @param isAdmin whether the authenticated viewer holds admin permission on that repository
 * @param protection the base branch's classic protection state
 * @param gate what the head's checks look like against the contexts the base actually requires
 * @param reviews what the base branch's classic protection and rulesets require by way of a REVIEW
 * @param execution `dry-run` turns the ONE refusal a local lap is about to satisfy — a required context with no
 *   verdict on the head yet — into a note; every other refusal stands in both modes
 * @returns the notes to print and every reason to refuse
 */
export function adminMergePreflight({
  execution,
  pr,
  repo,
  isAdmin,
  protection,
  gate,
  reviews,
}: {
  execution: AdminMergeExecution;
  pr: AdminMergePr;
  repo: string;
  isAdmin: boolean;
  protection: BranchProtection;
  gate: RequiredContextGate;
  reviews: ReviewGate;
}): AdminMergePreflight {
  const review = reviewOutcome({ baseRef: pr.baseRef, reviews });
  const bypass = bypassOutcome({ baseRef: pr.baseRef, isAdmin, protection, repo, ruleGoverned: review.ruleGoverned });
  const contexts = dryRunContexts({
    execution,
    half: requiredContextOutcome({ baseRef: pr.baseRef, gate }),
  });
  return {
    notes: [...review.notes, ...bypass.notes, ...contexts.notes],
    refusals: [...stateRefusals({ pr }), ...review.refusals, ...bypass.refusals, ...contexts.refusals],
  };
}

/**
 * The required-context half under a dry run: a context with no verdict yet is a NOTE, because the dry run is asked
 * before a local lap posts the contexts it supplies. `github lap`'s own preflight already refuses any required
 * context a lap does not post, so the softening cannot wave through one nothing will ever supply.
 *
 * @param half the required-context half as the real merge would judge it
 * @returns the half unchanged for a merge, its refusals moved into notes for a dry run
 */
function dryRunContexts({ execution, half }: { execution: AdminMergeExecution; half: PreflightHalf }): PreflightHalf {
  if (execution === "merge") {
    return half;
  }
  return {
    notes: [
      ...half.notes,
      ...half.refusals.map(
        (refusal) => `dry-run note: ${refusal} The real merge refuses this until the contexts are on the head.`,
      ),
    ],
    refusals: [],
  };
}

/**
 * What the base branch's REVIEW requirement decides — the fourth refusal, and whether the branch is governed
 * by rules the classic protection read cannot see.
 *
 * @param baseRef the branch being merged into
 * @param reviews what the live read established about the reviews it requires
 * @returns the half's notes and refusals, plus whether any rule at all stands
 */
function reviewOutcome({
  baseRef,
  reviews,
}: {
  baseRef: string;
  reviews: ReviewGate;
}): PreflightHalf & { readonly ruleGoverned: boolean } {
  const refusal = reviewGateRefusal({ baseRef, gate: reviews });
  const notes =
    reviews.kind === "unreadable"
      ? [
          `could not read what reviews ${baseRef} requires (${reviews.reason}) — this merge cannot rule out a ` +
            "review requirement no administrator bypass can waive.",
        ]
      : [];
  return {
    notes,
    refusals: refusal === undefined ? [] : [refusal],
    ruleGoverned: reviews.kind === "read" && reviews.rules.length > 0,
  };
}

/**
 * What the head's checks decide against the contexts the base requires — the third refusal, or the note that
 * says why it could not be ruled out.
 *
 * @param baseRef the branch being merged into
 * @param gate what the head's checks look like against the contexts the base actually requires
 * @returns the half's notes and refusals
 */
function requiredContextOutcome({ baseRef, gate }: { baseRef: string; gate: RequiredContextGate }): PreflightHalf {
  const missing = requiredContextRefusal({ gate });
  if (missing !== undefined) {
    return { notes: [], refusals: [missing] };
  }
  if (gate.kind === "unreadable") {
    return {
      notes: [
        `could not read the contexts ${baseRef} requires (${gate.reason}) — this merge cannot rule out a ` +
          "required gate that never ran.",
      ],
      refusals: [],
    };
  }
  const note =
    gate.required.length > 0
      ? `every context ${gate.branch} requires (${gate.required.join(", ")}) is on this head.`
      : `${gate.branch} requires no status-check contexts.`;
  return { notes: [note], refusals: [] };
}

/**
 * The branch name on the REMOTE that a locally-resolvable base ref names.
 *
 * `--base` is a ref this checkout can already resolve, so it is usually `origin/main` — but a fetch, and
 * GitHub's own `base.ref`, both want the bare branch. Stripping the remote prefix (and a `refs/heads/` one)
 * is the whole rule; anything else is passed through untouched, and the caller compares the result against
 * what GitHub actually reports rather than trusting this derivation.
 *
 * @param base the `--base` ref
 * @param remote the Git remote the merge's freshness is measured against
 * @returns the bare branch name on that remote
 */
export function remoteBaseBranchOf({ base, remote }: { base: string; remote: string }): string {
  const withoutRefs = base.startsWith("refs/heads/") ? base.slice("refs/heads/".length) : base;
  return withoutRefs.startsWith(`${remote}/`) ? withoutRefs.slice(remote.length + 1) : withoutRefs;
}

/**
 * Every way the pull request GitHub reports disagrees with what this invocation measured locally.
 *
 * The guard's whole verdict was computed from two LOCAL refs. If those refs are not the pull request's real
 * base and head, the report is about a different change than the one about to land — which is precisely the
 * failure this flag exists to make impossible, so it is a refusal rather than a warning.
 *
 * @param pr the pull request as GitHub reports it
 * @param baseBranch the remote branch this invocation measured against
 * @param headSha the local commit this invocation measured
 * @returns one refusal line per disagreement
 */
export function measuredTheSameChange({
  pr,
  baseBranch,
  headSha,
}: {
  pr: AdminMergePr;
  baseBranch: string;
  headSha: string;
}): readonly string[] {
  const refusals: string[] = [];
  if (pr.baseRef !== baseBranch) {
    refusals.push(
      `#${String(pr.number)} targets ${pr.baseRef}, but this invocation measured against ${baseBranch} — ` +
        "the report is about a different merge. Pass --base for the pull request's real base.",
    );
  }
  if (pr.headSha !== headSha) {
    refusals.push(
      `#${String(pr.number)} is at ${pr.headSha}, but --head resolves locally to ${headSha} — the report is ` +
        "about a commit GitHub is not merging. Push the branch, or point --head at what is on GitHub.",
    );
  }
  return refusals;
}

/**
 * The squash commit's subject, matching what GitHub's own squash button writes.
 *
 * Composed here rather than left to GitHub's default because the default is derived from the pull request's
 * COMMITS when there is more than one, and this repository's pull requests are one commit off the base — so
 * letting the server choose would silently change the subject the moment that stopped being true.
 *
 * @param title the pull request's title
 * @param number the pull request's number, appended the way GitHub's squash merge does
 * @returns the commit subject
 */
export function squashCommitTitle({ title, number }: { title: string; number: number }): string {
  return `${title} (#${String(number)})`;
}

/**
 * The external-write door request for one exact merge.
 *
 * @param repo the `owner/name` slug
 * @param number the pull request being merged
 * @param home the Slopweaver state home whose door records the merge
 * @param acknowledgement the pairing floor's waiver, when one was needed and given
 * @returns the exact external-write request admitted by the door
 */
export function adminMergeDoorRequest({
  repo,
  number,
  home,
  acknowledgement,
  termsAcknowledgement,
}: {
  repo: string;
  number: number;
  home: string;
  acknowledgement: DoorAcknowledgement | undefined;
  /** The `private-terms-unchecked` waiver the landing's change-set sweep stood on, when one did. */
  termsAcknowledgement?: DoorAcknowledgement | undefined;
}): DoorRequest {
  // A LIST at the door: `github merge --admin` waives at most the pairing floor and an unchecked change set, while
  // `github enqueue` judges the CI rollup too. The shape is shared so the ledger records both verbs' waivers alike.
  const acknowledgements = [acknowledgement, termsAcknowledgement].filter(
    (waiver): waiver is DoorAcknowledgement => waiver !== undefined,
  );
  return {
    action: { kind: "verb", noun: "github", verb: "merge" },
    artifact: { id: `${repo}#${String(number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    ...(acknowledgements.length === 0 ? {} : { acknowledgements }),
  };
}

/**
 * Split `--repo` into its two halves: any two non-empty segments either side of one slash.
 *
 * @returns the owner and name, or `undefined` when it is not that shape
 */
export function repoAddressOf({ repo }: { repo: string }): { owner: string; repo: string } | undefined {
  const parts = repo.split("/");
  if (parts.length !== 2 || parts[0]!.length === 0 || parts[1]!.length === 0) {
    return undefined;
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

/**
 * The pull request as the pairing floor and the ratchet-bump witness both see it — one spelling, so the two
 * reads can never disagree about which head or which base they answered for.
 *
 * @param pr the pull request as the authoritative read found it, its base commit included
 * @param repo the `owner/name` slug the merge was asked for
 * @returns the head, branch, base commit and repository
 */
export function adminMergeHeadOf({ pr, repo }: { pr: AdminMergePr; repo: string }): PullRequestHead {
  return { baseSha: pr.baseSha, branch: pr.headRef, headSha: pr.headSha, repository: repo };
}

/**
 * Why the door performed no admin merge, in the one renderer's words — for a policy refusal every finding, its
 * correction and its way through, never the bare verdict; for an unrecordable decision, the store's own reason.
 *
 * @param through the `throughDoor` outcome on {@link adminMergeDoorRequest} that performed nothing
 * @returns the refusal lines, in order
 */
export function adminMergeDoorRefusalLines({ through }: { through: NotPerformed }): readonly string[] {
  return notPerformedLines({ command: "slopweaver github merge --admin", through });
}

/**
 * The report for a merge GitHub accepted — or the refusal when it answered without merging.
 *
 * GitHub answering 200 with `merged: false` is treated as a failure rather than a success, for the same
 * reason `github ready` reads its transition back: a provider-shaped "false success" that nothing checks is
 * how a session reports work it did not do.
 *
 * @param merged GitHub's own account of whether it merged
 * @param sha the squash commit GitHub created
 * @param pr the pull request as it was read before the merge
 * @returns the lines to print, and whether this invocation must exit non-zero
 */
export function mergeOutcomeLines({ merged, sha, pr }: { merged: boolean; sha: string; pr: AdminMergePr }): {
  readonly lines: readonly string[];
  readonly failed: boolean;
} {
  if (!merged) {
    return {
      failed: true,
      lines: [
        `refused: GitHub answered without merging #${String(pr.number)} — nothing landed. Re-read the pull ` +
          "request before retrying; do not assume the merge half-happened.",
      ],
    };
  }
  return {
    failed: false,
    lines: [
      `merged #${String(pr.number)} into ${pr.baseRef} as ${sha} (squash, administrator bypass)  ${pr.url}`,
      `next: pull ${pr.baseRef} in every worktree that will branch off it.`,
    ],
  };
}

/**
 * The post-merge docs-budget probe's outcome, as the lines to print and — only on a real overrun — the
 * supervisor-stream sentence to publish alongside them.
 *
 * A base that merely could not be probed (`not-evaluated`) is printed as a plain warning and never published:
 * this repository's own contract for the stream is "a moment worth acting on" (`docs/supervisor-events.md`),
 * and "the probe itself did not run" is not proof the base is red — publishing an alert for it would teach a
 * supervisor to distrust this source the first time a shallow fetch or a transient git failure fired one.
 *
 * @param sweep the freshly-fetched base branch's own docs budget, measured immediately after this merge landed
 * @param baseBranch the branch just merged into, named in every line so each reads standalone
 * @param repo the `owner/name` slug this merge landed into
 * @returns the lines to print, and the alert to publish when the base actually crossed a cap
 */
export function postMergeDocsBudgetOutcome({
  sweep,
  baseBranch,
  repo,
}: {
  sweep: MergeDocsBudgetSweep;
  baseBranch: string;
  repo: string;
}): { readonly lines: readonly string[]; readonly alertWhy: string | undefined } {
  if (sweep.kind === "not-evaluated") {
    return {
      alertWhy: undefined,
      lines: [`post-merge docs-budget probe: could not measure ${baseBranch} — ${sweep.reason}`],
    };
  }
  const overruns = budgetOverruns({ budgets: sweep.budgets });
  if (overruns.length === 0) {
    return { alertWhy: undefined, lines: [`post-merge docs-budget probe: ${baseBranch} is within every ceiling.`] };
  }
  const alertWhy = `${repo}@${baseBranch} crossed a documentation budget right after this merge landed: ${overruns.join(" ")}`;
  return {
    alertWhy,
    lines: [
      `ALERT: post-merge docs-budget probe: ${baseBranch} crossed a ceiling this merge did not measure against — ` +
        "published to the supervisor stream.",
      ...overruns.map((line) => `  ${line}`),
    ],
  };
}
