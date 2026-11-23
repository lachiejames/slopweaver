/**
 * `slopweaver github push` — push the checked-out pull-request branch through the admit door.
 *
 * Reads establish the repository, current branch, commit, remote identity, remote default branch and exact
 * pre-write target SHA. A dry run stops there. A real run, inside `throughDoor`, streams the repository's
 * `pre-push` hook to the visible session BEFORE any transport opens, then executes one argv-array `git push`
 * with the hook satisfied, then reads the remote branch back and reports success only when its SHA exactly
 * matches the local commit. `../../../admit/githubPush.ts`'s `pushAndVerify` is that ordering, and every stack
 * verb pushes through it too. Before the dry-run stop, every commit message the push would publish crosses the
 * publication scan (`./pushCommitMessages.ts`), and the head crosses the old-history guard
 * (`../../../admit/pushRootGate.ts`), so a preview discloses either refusal too.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type GithubPushPlan, pushAndVerify } from "../../../admit/githubPush.js";
import { pushUrlsOf, refuseOldHistoryPush } from "../../../admit/pushRootGate.js";
import type { SelfReviewForm } from "../../../outbound/github/selfReview.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { pushBaseFreshness } from "./pushBaseFreshness.js";
import { pushChainGateRefused } from "./pushChainGate.js";
import { pushCommitMessagesRefused } from "./pushCommitMessages.js";
import { type GithubPushArgs, githubPushDoorRequest, parseGithubPushArgs, pushStandingDir } from "./pushCore.js";
import { printGoldAnchor } from "./pushGoldAnchor.js";
import {
  DEFAULT_DEPS,
  type GithubPushDeps,
  inspectGithubPushPlan,
  productionGithubPushDeps,
} from "./pushPrimitives.js";
import {
  type PreparedPushSelfReview,
  postPushSelfReview,
  preparePushSelfReview,
  resolvePushSelfReview,
} from "./pushSelfReview.js";
import { runStackCarry, runStackCarryGate, type StackCarryGate } from "./stackCarryRun.js";

const VERB_ARG_OFFSET = 4;

/** Compact mode label shown before either a dry run or a write. */
function modeLine({ plan }: { plan: GithubPushPlan }): string {
  if (!plan.forceWithLease) {
    return "mode: fast-forward push only";
  }
  const remoteSha = plan.remoteBranchSha;
  if (remoteSha === undefined) {
    return "mode: exact force-with-lease against an absent remote branch";
  }
  return `mode: exact force-with-lease against ${remoteSha}`;
}

/** Route the push, report its exact readback, and return whether it was confirmed. */
async function sendPush({
  deps,
  home,
  plan,
}: {
  deps: GithubPushDeps;
  home: string;
  plan: GithubPushPlan;
}): Promise<number> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => pushAndVerify({ deps, home, plan }),
    request: githubPushDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github push", through: routed })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  if (routed.result.kind !== "pushed") {
    deps.out({ line: `${routed.result.kind}: ${routed.result.reason}` });
    return EXIT_ERROR;
  }
  deps.out({ line: `pushed and verified ${plan.localSha} at ${plan.repo}:${plan.branch}` });
  return EXIT_OK;
}

/** What a dry run says after the freshness verdict: what a real run would post, and what was and was not left behind. */
function printDryRun({ deps, form }: { deps: GithubPushDeps; form: SelfReviewForm | undefined }): number {
  if (form !== undefined) {
    deps.out({ line: `would replace the inline self-review with ${String(form.comments.length)} comment(s)` });
  }
  deps.out({
    line:
      "dry run: the remote was read, and its default branch was fetched into a temporary private ref " +
      "(deleted immediately after) to measure base freshness; no lasting ref, door record or push remains.",
  });
  return EXIT_OK;
}

/**
 * Ask the shared carry gate what this push owes the entries stacked above it.
 *
 * Runs BEFORE the push, including under `--dry-run`, so a preview discloses the same refusal a real run
 * would hit. A driver with no `stackCarry` edge cannot see a stack at all, so it treats the push as clear —
 * that is a driver without stacks, never a silent exemption; the shipped verb always has one.
 *
 * @param plan the safe push plan already built, naming the branch and repository to ask about
 * @returns the gate's verdict
 */
async function pushStackCarryGate({
  args,
  deps,
  home,
  plan,
}: {
  args: GithubPushArgs;
  deps: GithubPushDeps;
  home: string;
  plan: GithubPushPlan;
}): Promise<StackCarryGate> {
  const carry = deps.stackCarry;
  if (carry === undefined) {
    return { kind: "clear" };
  }
  return runStackCarryGate({
    out: deps.out,
    request: {
      branch: plan.branch,
      carry,
      defaultBranch: plan.defaultBranch,
      git: deps,
      home,
      orphanAbove: args.orphanAbove,
      remote: plan.remote,
      repo: plan.repo,
      repoRoot: plan.repoRoot,
    },
  });
}

/**
 * Both gates that read this branch's own native-stack state, in the one order they run in.
 *
 * Both run BEFORE the dry-run stop, so a preview discloses exactly the refusals a real run would hit. The
 * carry gate asks what sits ABOVE this branch and would be orphaned; the chain gate asks whether this branch
 * is itself chained onto another open pull request GitHub does not know is a stack. Neither answers the
 * other's question.
 *
 * @param args the parsed invocation, whose `--orphan-above` the carry gate reads
 * @param deps the push edges
 * @param home the state home both gates resolve a token from
 * @param plan the safe push plan, naming the branch, repository and default branch
 * @returns the carry verdict to act on later, or `undefined` when either gate refused
 */
async function pushStackStateGates({
  args,
  deps,
  home,
  plan,
}: {
  args: GithubPushArgs;
  deps: GithubPushDeps;
  home: string;
  plan: GithubPushPlan;
}): Promise<StackCarryGate | undefined> {
  const carry = await pushStackCarryGate({ args, deps, home, plan });
  if (carry.kind === "refused") {
    return undefined;
  }
  const chained = await pushChainGateRefused({
    branch: plan.branch,
    defaultBranch: plan.defaultBranch,
    deps,
    home,
    repo: plan.repo,
  });
  return chained ? undefined : carry;
}

/**
 * Everything that happens once the branch itself is confirmed on the remote: carry the stack above it, print
 * the gold proof anchor, then post the optional self-review round.
 *
 * A partial carry outranks a green self-review in the exit code — a half-carried stack is a broken stack, and
 * reporting it as success is the exact failure this gate exists to end.
 *
 * @param carry what the carry gate decided before anything was sent
 * @param freshness the base measurement, whose `baseSha` the patch-id anchor is computed against
 * @returns the process exit code
 */
async function afterPush({
  carry,
  deps,
  freshness,
  home,
  plan,
  review,
}: {
  carry: StackCarryGate;
  deps: GithubPushDeps;
  freshness: { readonly baseSha: string | undefined };
  home: string;
  plan: GithubPushPlan;
  review: PreparedPushSelfReview | undefined;
}): Promise<number> {
  const carried = runStackCarry({ gate: carry, git: deps, home, out: deps.out, remote: plan.remote })
    ? EXIT_OK
    : EXIT_ERROR;
  printGoldAnchor({ baseSha: freshness.baseSha, deps, plan });
  const reviewExit = await postPushSelfReview({ deps, home, plan, prepared: review });
  return carried === EXIT_OK ? reviewExit : carried;
}

/** What the verb says it is about to do: the head, the target and the lease mode. */
function planLines({ plan }: { plan: GithubPushPlan }): readonly string[] {
  return [`would push ${plan.localSha} to ${plan.repo}:${plan.branch} via ${plan.remote}`, modeLine({ plan })];
}

/**
 * Every gate a push meets before a dry run stops or anything is sent: the commit messages, the old-history guard,
 * base freshness and the stack-state carry. Each prints its own refusal.
 *
 * @param args the parsed invocation
 * @param deps the verb's edges
 * @param home the state home
 * @param plan the inspected push plan
 * @returns what the later steps need, or undefined when a gate refused
 */
async function pushPreflight({
  args,
  deps,
  home,
  plan,
}: {
  args: GithubPushArgs;
  deps: GithubPushDeps;
  home: string;
  plan: GithubPushPlan;
}): Promise<
  | {
      readonly freshness: Awaited<ReturnType<typeof pushBaseFreshness>>;
      readonly carry: StackCarryGate;
    }
  | undefined
> {
  if (await pushCommitMessagesRefused({ deps, home, plan })) {
    return undefined;
  }
  // Asked here as well as inside `pushAndVerify`, so a `--dry-run` discloses the refusal a real run would meet.
  const history = refuseOldHistoryPush({
    env: process.env,
    home,
    localShas: [plan.localSha],
    pushUrls: () => pushUrlsOf({ readGit: deps.readGit, remote: plan.remote, repoRoot: plan.repoRoot }),
    readGit: deps.readGit,
    repoRoot: plan.repoRoot,
  });
  if (history.isErr()) {
    for (const line of history.error.lines) deps.out({ line });
    return undefined;
  }
  const freshness = await pushBaseFreshness({
    acknowledgement: args.baseFreshnessAcknowledgement,
    deps,
    home,
    plan,
  });
  if (freshness.refused) {
    return undefined;
  }
  const carry = await pushStackStateGates({ args, deps, home, plan });
  if (carry === undefined) {
    return undefined;
  }
  return { carry, freshness };
}

/**
 * Run one governed push.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun and verb
 * @param deps injectable Git and output edges
 * @returns the process exit code
 */
export async function runGithubPush({
  argv,
  deps = DEFAULT_DEPS,
}: {
  argv: readonly string[];
  deps?: GithubPushDeps;
}): Promise<number> {
  const parsed = parseGithubPushArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (!parsed.isOk()) {
    for (const line of parsed.error) deps.out({ line });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const selfReview = resolvePushSelfReview({ args, deps, home });
  if (!selfReview.isOk()) {
    return selfReview.error;
  }
  const plan = inspectGithubPushPlan({
    cwd: pushStandingDir({ args, deps }),
    deps,
    forceWithLease: args.forceWithLease,
    remote: args.remote,
  });
  if (!plan.isOk()) {
    deps.out({ line: `refused: ${plan.error.message}` });
    return EXIT_ERROR;
  }
  for (const line of planLines({ plan: plan.value })) deps.out({ line });
  const gates = await pushPreflight({ args, deps, home, plan: plan.value });
  if (gates === undefined) {
    return EXIT_ERROR;
  }
  const { carry, freshness } = gates;
  if (args.dryRun) {
    return printDryRun({ deps, form: selfReview.value });
  }
  const review = await preparePushSelfReview({ deps, form: selfReview.value, home, plan: plan.value });
  if (!review.isOk()) {
    return EXIT_ERROR;
  }
  const pushExit = await sendPush({ deps, home, plan: plan.value });
  if (pushExit !== EXIT_OK) {
    return pushExit;
  }
  return afterPush({ carry, deps, freshness, home, plan: plan.value, review: review.value });
}

export {
  DEFAULT_DEPS,
  type GithubPushDeps,
  type GithubPushSelfReviewDeps,
  productionGithubPushDeps,
} from "./pushPrimitives.js";

export const githubPushCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubPush({ argv, deps: productionGithubPushDeps() }),
});
