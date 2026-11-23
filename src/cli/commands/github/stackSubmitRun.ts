/**
 * `slopweaver github stack submit` — the effectful half of the Graphite pair.
 *
 * It pushes what the last `github stack restack` prepared, in tree order, and it decides EVERYTHING before
 * it opens a transport: the whole forest passes or not one branch is sent. See `./stackSubmitCore.ts` for
 * why all-or-nothing ADMISSION is the honest name for that guarantee, and for the one issue `--force`
 * waives.
 *
 * After a fully confirmed run it advances the snapshot in place — every pushed row's `remoteHeadSha` becomes
 * what it just put there — so an immediately repeated submit is a no-op rather than a second push. After a
 * FAILED one it leaves the snapshot exactly as it was, which is what makes the next ordinary submit see the
 * pushed prefix as a moved remote and refuse. That refusal is the record of a partial push, and `--force` is
 * how an author says they have looked at it.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { submitProofPathRefusal } from "../../../admit/pushProofPathGate.js";
import { pushUrlsOf, refuseOldHistoryPush } from "../../../admit/pushRootGate.js";
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PrState } from "../../../outbound/github/prStateCore.js";
import { readPrState, writePrState } from "../../../outbound/github/prStateStore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import type { GithubVerbResult } from "./errors.js";
import { stackSubmitCommitMessageRefusal } from "./pushCommitMessages.js";
import { parseStackCommonArgs, type StackCommonArgs } from "./stackCommonArgs.js";
import { stackRemoteTip } from "./stackFacts.js";
import {
  advancedState,
  planStackSubmit,
  type SubmitFact,
  type SubmitPlan,
  submitOutcomeLines,
  submitRefusalLines,
} from "./stackSubmitCore.js";
import { sendStackSubmit } from "./stackSubmitSend.js";
import { productionStackVerbDeps, type StackVerbDeps } from "./stackVerbDeps.js";
import { runWholeRepoStackVerb } from "./stackVerbShell.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "submit"

/**
 * The flags this verb accepts.
 *
 * @internal the flag-name list below and this verb's own parser are its only readers.
 */
export const GITHUB_STACK_SUBMIT_FLAGS: FlagSpec = { boolean: ["dry-run", "force"], string: ["cwd", "remote", "home"] };

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_STACK_SUBMIT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_SUBMIT_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_SUBMIT_FLAGS }),
].map((name) => `--${name}`);

/**
 * One parsed invocation: the four every whole-repository stack verb takes, plus this one's `--force`.
 *
 * @internal named by this verb's own parser, shell and tests.
 */
export interface GithubStackSubmitArgs extends StackCommonArgs {
  readonly force: boolean;
}

/**
 * Parse a submit invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after `github stack submit`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackSubmitArgs({
  argv,
}: {
  argv: readonly string[];
}): GithubVerbResult<GithubStackSubmitArgs> {
  return parseStackCommonArgs({ argv, spec: GITHUB_STACK_SUBMIT_FLAGS }).map((parsed) => ({
    ...parsed.args,
    force: parsed.values["force"] === true,
  }));
}

/** One local ref's commit, or `undefined` when this checkout does not have it. */
function localRef({ deps, ref, repoRoot }: { deps: StackVerbDeps; ref: string; repoRoot: string }): string | undefined {
  try {
    return deps.git.readGit({ args: ["rev-parse", ref], cwd: repoRoot });
  } catch {
    return undefined;
  }
}

/** Describe the external write to the admit door. */
function submitDoorRequest({ home, plan }: { home: string; plan: SubmitPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack submit" },
    artifact: { branches: plan.pushes.map((push) => push.branch) },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/** Everything the shell measured before it planned. */
interface SubmitContext {
  readonly facts: readonly SubmitFact[];
  readonly gitCommonDir: string;
  readonly state: PrState;
}

/** Read the snapshot, fetch, and measure each recorded row against the remote. */
async function gatherSubmitContext({
  args,
  deps,
  home,
  repo,
  repoRoot,
}: {
  args: GithubStackSubmitArgs;
  deps: StackVerbDeps;
  home: string;
  repo: string;
  repoRoot: string;
}): Promise<Result<SubmitContext, number>> {
  const gitCommonDir = deps.git.readGit({
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: repoRoot,
  });
  const read = readPrState({ gitCommonDir, home, repo });
  if (read.isErr()) {
    deps.out({ line: `refused: ${read.error.message}` });
    return err(EXIT_ERROR);
  }
  if (read.value === undefined) {
    deps.out({
      line: "refused: no local state for this repository yet — run `slopweaver github stack restack` first.",
    });
    return err(EXIT_ERROR);
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(EXIT_ERROR);
  }
  const [owner, name] = repo.split("/");
  const listed = await deps.makeApi({ home, token }).listOpenPrsAuthoredByMe({ owner: owner!, repo: name! });
  if (listed.isErr()) {
    deps.out({ line: `refused: could not read your open pull requests: ${listed.error.message}` });
    return err(EXIT_ERROR);
  }
  if (listed.value.truncated) {
    deps.out({
      line:
        "refused: this repository has more open pull requests than one walk returns, so the set your local " +
        "state claims to cover cannot be confirmed",
    });
    return err(EXIT_ERROR);
  }
  const recorded = new Map(read.value.entries.map((entry) => [entry.number, entry]));
  const facts: SubmitFact[] = listed.value.prs
    .filter((pr) => pr.head.repoFullName === repo)
    .map((pr) => ({
      baseRef: pr.baseRef,
      headRef: pr.head.ref,
      liveHeadSha: stackRemoteTip({ branch: pr.head.ref, git: deps.git, remote: args.remote, repoRoot }),
      number: pr.number,
      stagedSha: stagedShaOf({ deps, entry: recorded.get(pr.number), repoRoot }),
    }));
  return ok({ facts, gitCommonDir, state: read.value });
}

/** What one row's staged ref holds now, or `undefined` when it prepared nothing or the ref is gone. */
function stagedShaOf({
  deps,
  entry,
  repoRoot,
}: {
  deps: StackVerbDeps;
  entry: PrState["entries"][number] | undefined;
  repoRoot: string;
}): string | undefined {
  if (entry?.preparation.kind !== "ready") {
    return undefined;
  }
  return localRef({ deps, ref: entry.preparation.preparedRef, repoRoot });
}

/**
 * Run one governed submit.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github", "stack", "submit"
 * @param deps injectable Git, API, clock, token and output edges
 * @returns the process exit code
 */
export async function runGithubStackSubmit({
  argv,
  deps = productionStackVerbDeps(),
}: {
  argv: readonly string[];
  deps?: StackVerbDeps;
}): Promise<number> {
  return runWholeRepoStackVerb({
    argv,
    body: ({ args, home, repo, repoRoot }) => submitUnderLock({ args, deps, home, repo, repoRoot }),
    deps,
    offset: VERB_ARG_OFFSET,
    parse: parseGithubStackSubmitArgs,
    refusedExitCode: EXIT_ERROR,
    usageExitCode: EXIT_USAGE,
  });
}

/**
 * Every refusal a submit meets before its dry-run stop: a proof path in a head, a commit message, and a head of the
 * history a re-cut left behind. All three are judged, so one run names every problem at once.
 *
 * @param args the parsed invocation, for its remote
 * @param deps the verb's edges
 * @param home the state home
 * @param plan the submit plan, every head it would send
 * @param repo the repository's `owner/name`
 * @param repoRoot the checkout pushing
 * @returns the refusal lines, empty when the submit may go
 */
function submitPreSendRefusals({
  args,
  deps,
  home,
  plan,
  repo,
  repoRoot,
}: {
  args: GithubStackSubmitArgs;
  deps: StackVerbDeps;
  home: string;
  plan: SubmitPlan;
  repo: string;
  repoRoot: string;
}): readonly string[] {
  const proofRefusal = submitProofPathRefusal({ env: process.env, plan, readGit: deps.git.readGit, repoRoot });
  const messageRefusal = stackSubmitCommitMessageRefusal({
    home,
    plan,
    readGit: deps.git.readGit,
    remote: args.remote,
    repo,
    repoRoot,
  });
  // `stack submit` sends through its own `git push`, never `pushAndVerify`, so the old-history guard is asked
  // here, over every head it would send, and before the dry-run stop so a preview discloses the refusal too.
  const history = refuseOldHistoryPush({
    env: process.env,
    home,
    localShas: plan.pushes.map((push) => push.toSha),
    pushUrls: () => pushUrlsOf({ readGit: deps.git.readGit, remote: args.remote, repoRoot }),
    readGit: deps.git.readGit,
    repoRoot,
  });
  const historyRefusal = history.isErr() ? history.error.lines : [];
  return [...proofRefusal, ...messageRefusal, ...historyRefusal];
}

/** Everything the lock protects: the read, the measurement, the admission, every push and the state advance. */
async function submitUnderLock({
  args,
  deps,
  home,
  repo,
  repoRoot,
}: {
  args: GithubStackSubmitArgs;
  deps: StackVerbDeps;
  home: string;
  repo: string;
  repoRoot: string;
}): Promise<number> {
  const gathered = await gatherSubmitContext({ args, deps, home, repo, repoRoot });
  if (gathered.isErr()) {
    return gathered.error;
  }
  const { facts, gitCommonDir, state } = gathered.value;
  const { issues, plan } = planStackSubmit({ facts, force: args.force, state });
  if (plan === undefined) {
    for (const line of submitRefusalLines({ issues })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const waived of plan.waived) {
    deps.out({ line: `--force accepted: ${waived.message}` });
  }
  if (plan.pushes.length === 0) {
    deps.out({ line: "nothing to submit: every open pull request of yours already carries what you restacked." });
    return EXIT_OK;
  }
  const refusals = submitPreSendRefusals({ args, deps, home, plan, repo, repoRoot });
  if (refusals.length > 0) {
    for (const line of refusals) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const push of plan.pushes) {
    deps.out({ line: `would push ${push.branch} (PR #${String(push.pullRequestNumber)}) -> ${push.toSha}` });
  }
  if (args.dryRun) {
    deps.out({ line: "dry run: every check above passed and NOTHING was sent." });
    return EXIT_OK;
  }
  return performSubmit({ args, deps, gitCommonDir, home, plan, repoRoot, state });
}

/** Push the admitted plan through the door, then advance the snapshot only if every ref confirmed. */
async function performSubmit({
  args,
  deps,
  gitCommonDir,
  home,
  plan,
  repoRoot,
  state,
}: {
  args: GithubStackSubmitArgs;
  deps: StackVerbDeps;
  gitCommonDir: string;
  home: string;
  plan: SubmitPlan;
  repoRoot: string;
  state: PrState;
}): Promise<number> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.git.doorLedger,
    perform: () => Promise.resolve(sendStackSubmit({ deps, plan, remote: args.remote, repoRoot })),
    request: submitDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github stack submit", through: routed })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const line of submitOutcomeLines({ outcomes: routed.result, plan })) deps.out({ line });
  const pushed = routed.result.filter((outcome) => outcome.kind === "pushed").map((outcome) => outcome.push);
  if (pushed.length !== plan.pushes.length) {
    return EXIT_ERROR;
  }
  const advanced = writePrState({
    gitCommonDir,
    home,
    state: advancedState({ nowIso: deps.now().toISOString(), pushed, state }),
  });
  if (advanced.isErr()) {
    deps.out({ line: `pushed, but could not advance your local state: ${advanced.error.message}` });
    return EXIT_ERROR;
  }
  deps.out({ line: `submitted ${String(pushed.length)} branch(es); your local state now matches the remote.` });
  return EXIT_OK;
}
