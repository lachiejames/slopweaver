/**
 * The production seams behind `slopweaver github lap` — git, child processes and files. Kept apart from
 * `./lapRun.ts` so the orchestration can be unit-tested with plain fakes and this file holds nothing but edges;
 * the machine's lap lock is `./lapLock.ts`'s and the compile lease taken after it `./lapCompileLease.ts`'s, the detached checkout `./lapTree.ts`'s, the throwaway store `./lapStore.ts`'s, how the lap's own short
 * commands run `./lapProcess.ts`'s, and the plan-source and hold reads the preflight makes `./lapPreflightReads.ts`'s.
 *
 * A LANE's environment is decided in `lapCore.ts` (`lapEnvironment`, an allowlist) and passed in whole. Every
 * lane runs in its own process group, so a step past its ceiling is killed with everything it spawned.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { ownProcessStart } from "../../../admit/lockHolder.js";
import { cachePaths } from "../../../cacheHome.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { installedTreeRoot, isPluginCheckout } from "../../../lib/pluginRoot.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeGithubLapApi } from "../../../outbound/github/lapApi.js";
import {
  LAP_GITHUB_CALL_TIMEOUT_MS,
  realLapDeadlineTimer,
  withLapDeadline,
} from "../../../outbound/github/lapApiDeadline.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { isAncestor, resolveCommitSha } from "./gitAncestry.js";
import { lapBatchSeams } from "./lapBatchShell.js";
import { acquireLapMachine } from "./lapCompileLease.js";
import type { GithubLapDeps, LapRefs, LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { planSourcesDiffering, readStandingHold } from "./lapPreflightReads.js";
import { runLapCommand } from "./lapProcess.js";
import { lapRunsDirectory, readLapReceipts } from "./lapReceipts.js";
import { lapSeatFacts } from "./lapSeatStore.js";
import { runLapStep } from "./lapStepProcess.js";
import { startLapStore } from "./lapStore.js";
import { checkoutLapTree } from "./lapTree.js";
import { runLapVerb } from "./lapVerb.js";

/**
 * The download caches under the seat's home a lane may reuse while its own `HOME` is throwaway: proto's
 * toolchains (the `node` its shims on `PATH` resolve to), Yarn's global package cache, Playwright's browsers and
 * Electron's binaries. Downloads, never credentials — the lane's `HOME` is moved precisely so it cannot reach
 * those. Each is named here, never inherited from the seat's environment, so this list is the whole of what a lane
 * is pointed at under the real home. macOS paths: the lap runs on this machine.
 */
const TOOL_CACHES: readonly { readonly variable: string; readonly under: string }[] = [
  { under: ".proto", variable: "PROTO_HOME" },
  { under: ".yarn/berry", variable: "YARN_GLOBAL_FOLDER" },
  { under: "Library/Caches/ms-playwright", variable: "PLAYWRIGHT_BROWSERS_PATH" },
  { under: "Library/Caches/electron", variable: "electron_config_cache" },
];

/**
 * Each tool cache that exists under `osHome`, keyed by the variable its tool reads.
 *
 * @param osHome the seat's real home directory (`os.homedir()`), never `$SLOPWEAVER_HOME`
 * @param exists whether a directory is there, injected so the choice stays pure
 * @returns the cache variables a lane is given, only for a cache present
 */
export function toolCachesUnder({
  osHome,
  exists,
}: {
  osHome: string;
  exists: (path: string) => boolean;
}): Readonly<Record<string, string>> {
  const caches: Record<string, string> = {};
  for (const { variable, under } of TOOL_CACHES) {
    const path = join(osHome, under);
    if (exists(path)) {
      caches[variable] = path;
    }
  }
  return caches;
}

/** Fetch the base branch and the pull request's head into refs this lap owns, and resolve both. */
function fetchRefs({
  cwd,
  baseRef,
  number,
}: {
  cwd: string;
  baseRef: string;
  number: number;
}): Result<LapRefs, LapError> {
  const headRef = `refs/slopweaver/lap/${String(number)}/head`;
  const fetched = runLapCommand({
    args: [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`,
      `+refs/pull/${String(number)}/head:${headRef}`,
    ],
    cwd,
    file: "git",
  });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const baseTip = resolveCommitSha({ cwd, ref: `refs/remotes/origin/${baseRef}` });
  const headSha = resolveCommitSha({ cwd, ref: headRef });
  if (baseTip.isErr() || headSha.isErr()) {
    return err(
      LapErrors.commandFailed({
        cause: "the fetched base or head did not resolve to a commit",
        command: "git rev-parse",
      }),
    );
  }
  return ok({ baseTip: baseTip.value, headSha: headSha.value });
}

/**
 * `git clean -d --force` over the lap's tree, sparing `keep`: untracked files only, never an ignored one, so an
 * install's `node_modules` and a build's output stay while one job's leftovers do not reach the next. Each kept
 * path is anchored at the tree's root (`/<path>`), because a slashless exclude matches that name at any depth.
 * `--force` is given twice because once leaves an untracked nested repository standing at exit 0; measured on a
 * throwaway repo holding `nested/.git`, an ignored `node_modules/` and a kept `.vitest-reports/`, only the nested
 * repository and a loose file went: `git init` one, then `git clean -d --force --force --quiet --exclude /.vitest-reports`.
 */
function cleanTree({ tree, keep }: { tree: string; keep: readonly string[] }): Result<void, LapError> {
  const spared = keep.flatMap((path) => ["--exclude", `/${path}`]);
  const args = ["clean", "-d", "--force", "--force", "--quiet", ...spared];
  return runLapCommand({ args, cwd: tree, file: "git" }).map(() => undefined);
}

/** Mint the throwaway directory the lanes run against as `HOME` and `SLOPWEAVER_HOME`, removed with the lap. */
function laneHome(): LapResource<string> {
  const dir = mkdtempSync(join(tmpdir(), "sw-lap-home-"));
  const dispose = async (): Promise<void> => {
    rmSync(dir, { force: true, recursive: true });
  };
  return { dispose, value: dir };
}

/** Check `sha` out under the cache's lap-trees directory, its marker naming this process as the minter. */
function checkoutMarkedTree({ cwd, sha }: { cwd: string; sha: string }): ReturnType<typeof checkoutLapTree> {
  return checkoutLapTree({
    cwd,
    minter: { pid: process.pid, processStart: ownProcessStart() },
    resolveParent: () => cachePaths().lapTrees,
    sha,
  });
}

/** Land through `github merge --admin`, pinned to the lapped head, with the pull request's own body, in `tree`. */
async function merge(landing: Parameters<GithubLapDeps["merge"]>[0]): Promise<number> {
  return runLandingMerge({ ...landing, dryRun: false });
}

/**
 * Ask the SAME `github merge --admin` invocation the landing will make — the same argv, body and acknowledgements —
 * with `--dry-run` appended, so it runs every check and writes nothing. One runner builds both, so the preflight
 * cannot judge a different landing from the one the lap later performs.
 */
async function landingPreconditions(landing: Parameters<GithubLapDeps["landingPreconditions"]>[0]): Promise<number> {
  return runLandingMerge({ ...landing, dryRun: true });
}

/** The nested `github merge --admin` both seams run, `--dry-run` appended for the preflight. */
async function runLandingMerge({
  args,
  home,
  baseRef,
  dryRun,
  tree,
}: Parameters<GithubLapDeps["merge"]>[0] & { readonly dryRun: boolean }): Promise<number> {
  const token = githubToken({ home });
  if (token === undefined) {
    return 1;
  }
  const writeApi = makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token });
  const pr = await withLapDeadline({
    call: () => writeApi.getPr({ number: args.number, owner: args.owner, repo: args.repo }),
    ms: LAP_GITHUB_CALL_TIMEOUT_MS,
    operation: "github.lap.mergeBody",
    timer: realLapDeadlineTimer,
  });
  if (pr.isErr()) {
    logger.warn({ msg: `github lap: not landing — could not read the pull request body: ${pr.error.message}` });
    return 1;
  }
  const body = pr.value.body;
  if (body === undefined) {
    logger.warn({ msg: "github lap: not landing — the pull request has no body for the merge guard to read" });
    return 1;
  }
  const number = String(args.number);
  const acknowledged =
    args.acknowledge === undefined
      ? []
      : ["--acknowledge", args.acknowledge.subjects, "--reason", args.acknowledge.reason];
  return runLapVerb({
    args: [
      "github",
      "merge",
      "--admin",
      "--number",
      number,
      "--repo",
      `${args.owner}/${args.repo}`,
      "--base",
      `origin/${baseRef}`,
      "--head",
      `refs/slopweaver/lap/${number}/head`,
      "--cwd",
      tree,
      "--description",
      "-",
      "--home",
      home,
      ...acknowledged,
      ...(dryRun ? ["--dry-run"] : []),
    ],
    input: body,
  });
}

/**
 * The plan-source comparison rooted at the tree THIS code lives in, which is where the plan it runs comes from.
 * `installedTreeRoot` falls back to `cwd` when no manifest is found, so the manifest is checked again: that
 * fallback is the very bug this replaces, and with no manifest the seam refuses.
 *
 * @param cwd the checkout whose git reads the head's side
 * @returns the seam the lap calls with the head to compare
 */
function cliPlanSourcesSeam({ cwd }: { cwd: string }): GithubLapDeps["planSourcesDiffering"] {
  const walked = installedTreeRoot({ importMetaUrl: import.meta.url });
  const cliTree = isPluginCheckout({ root: walked }) ? walked : undefined;
  return ({ headSha }) =>
    cliTree === undefined
      ? err(
          LapErrors.refused({
            reason:
              "no plugin manifest sits above the running CLI's own code, so its plan sources cannot be read; run the lap from a slopweaver checkout's bin/slopweaver",
          }),
        )
      : planSourcesDiffering({ cliTree, cwd, headSha });
}

// The pull request a hold or release names, as `github hold` and `github release` read it.
function holdArgs({ args, home }: Parameters<GithubLapDeps["hold"]>[0]): readonly string[] {
  return ["--pr", String(args.number), "--repo", `${args.owner}/${args.repo}`, "--home", home];
}

/**
 * Production seams for the lap.
 *
 * @returns every process, file and network edge the lap uses, rooted at the checkout the seat stands in, bar the
 * plan sources' local side, which is the running CLI's own tree
 */
export function productionGithubLapDeps(): GithubLapDeps {
  const cwd = process.cwd();
  return {
    acquireLock: ({ home, lock }) =>
      acquireLapMachine({
        home,
        lock,
        out: ({ line }) => {
          logger.out({ line });
        },
      }),
    ambientEnv: process.env,
    ...lapBatchSeams({ cwd }),
    checkout: ({ sha }) => Promise.resolve(checkoutMarkedTree({ cwd, sha })),
    cleanTree,
    doorLedger: doorLedgerPort(),
    fetchRefs: ({ baseRef, number }) => Promise.resolve(fetchRefs({ baseRef, cwd, number })),
    hold: (at) =>
      runLapVerb({ args: ["github", "hold", ...holdArgs(at), "--why", "a local lap is landing it"], input: "" }),
    home: slopweaverHome,
    isAncestor: ({ ancestor, descendant }) =>
      isAncestor({ ancestor, cwd, descendant }).mapErr((error) =>
        LapErrors.commandFailed({ cause: error.message, command: "git merge-base --is-ancestor" }),
      ),
    landingPreconditions,
    laneHome,
    lapSeatFacts: ({ home }) => lapSeatFacts({ cwd, env: process.env, home }),
    logDir: ({ home, args, startedIso }) => {
      const dir = join(lapRunsDirectory({ args, home }), startedIso.replaceAll(":", "-"));
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    makeApi: ({ home, token }) => makeGithubLapApi({ privacy: githubWritePrivacy({ home }), token }),
    merge,
    now: () => new Date(),
    out: (line) => {
      logger.out({ line });
    },
    pid: process.pid,
    readReceipts: readLapReceipts,
    planSourcesDiffering: cliPlanSourcesSeam({ cwd }),
    release: (at) => runLapVerb({ args: ["github", "release", ...holdArgs(at)], input: "" }),
    runStep: runLapStep,
    standingHold: ({ args, home }) => readStandingHold({ home, slug: `${args.owner}/${args.repo}` }),
    startStore: ({ register }) => startLapStore({ cwd, register }),
    token: ({ home }) => githubToken({ home }),
    toolCaches: toolCachesUnder({ exists: existsSync, osHome: homedir() }),
    wait: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeReceipt: ({ logDir, receipt }) => {
      writeFileSync(join(logDir, "lap.json"), `${JSON.stringify(receipt, undefined, 2)}\n`);
    },
  };
}
