/** Effectful shell for the governed close-and-reopen that re-runs a pull request's CI on a fresh merge commit. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type CyclePr, type GithubCycleApi, makeGithubCycleApi } from "../../../outbound/github/cycle.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  cycleDoorRequest,
  cycleStateRefusal,
  type GithubCycleArgs,
  type MergeRefFreshness,
  mergeRefFreshness,
  parseGithubCycleArgs,
  shortSha,
} from "./cycleCore.js";
import { GITHUB_CYCLE_USAGE } from "./cycleUsage.js";
import { cycleAndConfirm, upstream } from "./cycleWrite.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubCycleDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubCycleApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What one invocation did, as its report names it. */
type CycleOutcome = "cycled" | "would cycle" | "primed" | "would prime" | "not yet" | "settled";

/** What the reads established before any write: the live pull request, the base tip, and the verdict on them. */
interface Judged {
  readonly pr: CyclePr;
  readonly baseTip: string;
  readonly freshness: MergeRefFreshness;
}

/** Read the pull request, refuse a state the verb must not touch, then read and judge its merge ref. */
async function judge({
  api,
  args,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
}): Promise<Result<Judged, GithubVerbError>> {
  const { owner, repo, number } = args;
  const read = await api.read({ number, owner, repo });
  if (read.isErr()) {
    return err(GithubVerbErrors.prUnread({ cause: read.error.message, number, owner, repo }));
  }
  const pr = read.value;
  const refusal = cycleStateRefusal({ pr });
  if (refusal !== undefined) {
    return err(GithubVerbErrors.cycleRefused({ reason: refusal }));
  }
  const ref = await api.mergeRef({ number, owner, repo });
  if (ref.isErr()) {
    return err(upstream({ message: ref.error.message, operation: "read merge ref" }));
  }
  let parents: readonly string[] | undefined;
  if (ref.value !== undefined) {
    const merge = await api.parents({ owner, repo, sha: ref.value });
    if (merge.isErr()) {
      return err(upstream({ message: merge.error.message, operation: "read merge commit" }));
    }
    parents = merge.value;
  }
  // The base tip is read LAST, so a base that moves while the merge ref is being read judges stale rather
  // than fresh; what remains is the window between this read and the reopen, which the usage names.
  const tip = await api.baseTip({ branch: pr.baseRef, owner, repo });
  if (tip.isErr()) {
    return err(upstream({ message: tip.error.message, operation: "read base branch" }));
  }
  if (tip.value === undefined) {
    return err(GithubVerbErrors.cycleRefused({ reason: `#${String(number)}'s base ${pr.baseRef} no longer exists` }));
  }
  const freshness = mergeRefFreshness({ baseTip: tip.value, mergeRef: ref.value, parents, pr });
  return ok({ baseTip: tip.value, freshness, pr });
}

/** Print one outcome in the selected output mode. */
function report({
  args,
  deps,
  judged,
  outcome,
}: {
  args: GithubCycleArgs;
  deps: GithubCycleDeps;
  judged: Judged;
  outcome: CycleOutcome;
}): void {
  const { pr, baseTip, freshness } = judged;
  if (args.json) {
    deps.out(
      JSON.stringify(
        {
          baseRef: pr.baseRef,
          baseTip,
          headSha: pr.headSha,
          mergeSha: freshness.verdict === "computing" ? null : freshness.mergeSha,
          number: pr.number,
          outcome,
          reason: freshness.verdict === "fresh" ? null : freshness.reason,
          url: pr.url,
        },
        undefined,
        2,
      ),
    );
    return;
  }
  if (freshness.verdict === "fresh") {
    const merge = `merge ${shortSha({ sha: freshness.mergeSha })} onto ${pr.baseRef}@${shortSha({ sha: baseTip })}`;
    deps.out(`${outcome} #${String(pr.number)}  ${merge}  ${pr.url}`);
    return;
  }
  if (freshness.verdict === "settled") {
    deps.out(
      `${outcome} #${String(pr.number)}  CI runs the OLD merge ${shortSha({ sha: freshness.mergeSha })}; run ` +
        `\`github cycle\` without --prime later, and a settled verdict soon after is not a cue to prime again  ${pr.url}`,
    );
  }
}

/** Write every line of one typed failure to the diagnostic channel. */
function diagnose({ deps, error }: { deps: GithubCycleDeps; error: GithubVerbError }): void {
  githubVerbErrorLines({ error }).forEach((line) => {
    deps.writeDiagnostic(line);
  });
}

/**
 * Run the cycle.
 *
 * @param rest argv after `github cycle`
 * @param deps credential, client and output seams
 * @returns the process exit code — 4 while GitHub is still computing the merge, so running it again is
 *   correct, and 1 when it has settled onto an old base and only `--prime` moves it
 */
export async function runGithubCycle({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubCycleDeps;
}): Promise<number> {
  const parsed = parseGithubCycleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(GITHUB_CYCLE_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let home: string;
  if (args.home === undefined) {
    home = deps.home();
  } else {
    home = args.home;
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic(GithubVerbErrors.githubTokenMissing().message);
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const judged = await judge({ api, args });
  if (judged.isErr()) {
    diagnose({ deps, error: judged.error });
    return EXIT_ERROR;
  }
  return act({ api, args, deps, home, judged: judged.value });
}

/** Act on the verdict: defer while GitHub computes, refuse a settled stale merge unless primed, else cycle. */
async function act({
  api,
  args,
  deps,
  home,
  judged,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
  deps: GithubCycleDeps;
  home: string;
  judged: Judged;
}): Promise<number> {
  const { freshness, pr } = judged;
  if (freshness.verdict === "computing") {
    diagnose({ deps, error: GithubVerbErrors.mergeRefComputing({ number: pr.number, reason: freshness.reason }) });
    if (args.json) {
      report({ args, deps, judged, outcome: "not yet" });
    }
    return EXIT_DEFERRED;
  }
  const priming = freshness.verdict === "settled";
  if (priming && !args.prime) {
    diagnose({ deps, error: GithubVerbErrors.mergeRefSettled({ number: pr.number, reason: freshness.reason }) });
    if (args.json) {
      report({ args, deps, judged, outcome: "settled" });
    }
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    report({ args, deps, judged, outcome: priming ? "would prime" : "would cycle" });
    return EXIT_OK;
  }
  return cycleThroughDoor({ api, args, deps, home, judged, outcome: priming ? "primed" : "cycled" });
}

/** Close and reopen through the door, and report what happened. */
async function cycleThroughDoor({
  api,
  args,
  deps,
  home,
  judged,
  outcome,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
  deps: GithubCycleDeps;
  home: string;
  judged: Judged;
  outcome: "cycled" | "primed";
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => cycleAndConfirm({ api, args, judged: judged.pr }),
    request: cycleDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github cycle", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    diagnose({ deps, error: through.result.error });
    // A merge that moved after the judgement wrote nothing and is not yet, exactly as computing is.
    return through.result.error.code === "STATE_CHANGED" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  report({ args, deps, judged, outcome });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the cycle command
 */
export function productionGithubCycleDeps(): GithubCycleDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubCycleApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github cycle`. */
export const githubCycleCommand = defineCommand({
  run: (argv) => runGithubCycle({ deps: productionGithubCycleDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
