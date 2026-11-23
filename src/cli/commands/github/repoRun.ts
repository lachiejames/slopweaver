/**
 * Effectful shell for `github repo`: the dispatch to the governed description write in `./repoDescriptionRun.ts`, to
 * the three irreversible administration writes (rename, transfer, archive) in `./repoAdministrationRun.ts`, and to
 * the create, visibility change and Actions policy, each planned by its own module and run by `./repoApprovedWrite.ts`.
 */

import { readFileSync } from "node:fs";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { readGit, writeGit } from "../../../admit/gitTransport.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type GithubRepoActionsPolicyApi,
  makeGithubRepoActionsPolicyApi,
} from "../../../outbound/github/repoActionsPolicy.js";
import {
  type GithubRepoAdministrationApi,
  makeGithubRepoAdministrationApi,
} from "../../../outbound/github/repoAdministration.js";
import {
  type GithubRepoDescriptionApi,
  makeGithubRepoDescriptionApi,
} from "../../../outbound/github/repoDescription.js";
import { type GithubRepoLifecycleApi, makeGithubRepoLifecycleApi } from "../../../outbound/github/repoLifecycle.js";
import { type GithubRepoManifestApi, makeGithubRepoManifestApi } from "../../../outbound/github/repoManifest.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import type { GithubVerbResult } from "./errors.js";
import { planRepoEnableActions } from "./repoActionsPolicyRun.js";
import { runRepoAdministration } from "./repoAdministrationRun.js";
import {
  type ApprovedRepoWrite,
  type ApprovedWriteSeams,
  diagnoseRepoWrite,
  runApprovedRepoWrite,
} from "./repoApprovedWrite.js";
import { type GithubRepoInvocation, parseGithubRepoArgs } from "./repoCore.js";
import { planRepoCreate } from "./repoCreateRun.js";
import { runRepoDescription } from "./repoDescriptionRun.js";
import { loadRepoApplyManifest, planRepoManifestWrite } from "./repoManifestRun.js";
import type { RepoSettingsApplyManifest } from "./repoManifestSchema.js";
import { type FreshCutPushGit, planRepoPushFreshCut } from "./repoPushFreshCutRun.js";
import type { GithubRepoTransferWait } from "./repoReadBack.js";
import { GITHUB_REPO_USAGE } from "./repoUsage.js";
import { planRepoSetPublic } from "./repoVisibilityRun.js";
import type { GithubRepoApprovedArgs } from "./repoWriteArgs.js";

const VERB_ARG_OFFSET = 4;

/**
 * How long a transfer's read-back polls the destination in production: ten reads two seconds apart. A transfer
 * to an account the token's owner controls lands within seconds; one waiting on another owner's acceptance never
 * will, and is reported as accepted but unconfirmed rather than waited on.
 */
const TRANSFER_READ_ATTEMPTS = 10;
const TRANSFER_READ_INTERVAL_MS = 2000;

/** Injectable edges for a no-network unit test. */
export interface GithubRepoDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRepoDescriptionApi;
  readonly makeAdministrationApi: (args: { home: string; token: string }) => GithubRepoAdministrationApi;
  readonly makeLifecycleApi: (args: { home: string; token: string }) => GithubRepoLifecycleApi;
  readonly makeActionsPolicyApi: (args: { home: string; token: string }) => GithubRepoActionsPolicyApi;
  readonly makeManifestApi: (args: { home: string; token: string }) => GithubRepoManifestApi;
  /** The Git edges `--push-fresh-cut` reads the cut and the remote through, and pushes through. */
  readonly freshCutGit: FreshCutPushGit;
  /** Read an apply artifact's text; a failure is one line per problem. */
  readonly readText: (args: { path: string }) => Result<string>;
  readonly transferWait: GithubRepoTransferWait;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ explicit, deps }: { explicit: string | undefined; deps: GithubRepoDeps }): string {
  if (explicit === undefined) {
    return deps.home();
  }
  return explicit;
}

/**
 * Load the apply artifact an `--apply-manifest` invocation names, printing why a bad one cannot be used.
 *
 * @returns the artifact, undefined for every other write, or the exit code a bad artifact ends on
 */
function invocationManifest({
  invocation,
  deps,
}: {
  invocation: GithubRepoInvocation;
  deps: GithubRepoDeps;
}): Result<RepoSettingsApplyManifest | undefined, number> {
  if (invocation.kind !== "approved" || invocation.args.manifestPath === undefined) {
    return ok(undefined);
  }
  const address = { owner: invocation.args.owner, repo: invocation.args.repo };
  const loaded = loadRepoApplyManifest({ address, path: invocation.args.manifestPath, readText: deps.readText });
  if (loaded.isErr()) {
    for (const line of loaded.error.lines) {
      deps.writeDiagnostic(line);
    }
    return err(loaded.error.kind === "unreadable" ? EXIT_ERROR : EXIT_USAGE);
  }
  return ok(loaded.value);
}

/**
 * Run one `github repo` invocation: the description write, or a rename, transfer or archive.
 *
 * @param rest argv after `github repo`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubRepo({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubRepoDeps;
}): Promise<number> {
  const parsed = parseGithubRepoArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_REPO_USAGE);
    return EXIT_USAGE;
  }
  // Read and validated before any credential is resolved, so a bad artifact never reaches GitHub.
  const loaded = invocationManifest({ deps, invocation: parsed.value });
  if (loaded.isErr()) {
    return loaded.error;
  }
  const manifest = loaded.value;
  const home = stateHomeOf({ deps, explicit: parsed.value.args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  if (parsed.value.kind === "administration") {
    return runRepoAdministration({
      args: parsed.value.args,
      seams: {
        api: deps.makeAdministrationApi({ home, token }),
        home,
        ledger: deps.doorLedger,
        out: deps.out,
        wait: deps.transferWait,
        writeDiagnostic: deps.writeDiagnostic,
      },
    });
  }
  if (parsed.value.kind === "approved") {
    return runApproved({ args: parsed.value.args, deps, home, manifest, token });
  }
  return runRepoDescription({
    args: parsed.value.args,
    seams: {
      api: deps.makeApi({ home, token }),
      home,
      ledger: deps.doorLedger,
      out: deps.out,
      writeDiagnostic: deps.writeDiagnostic,
    },
  });
}

/**
 * A create, visibility change, settings apply or Actions policy: read live state into one previewed write, then the
 * shared shell.
 */
async function runApproved({
  args,
  deps,
  home,
  manifest,
  token,
}: {
  args: GithubRepoApprovedArgs;
  deps: GithubRepoDeps;
  home: string;
  /** The validated apply artifact; present exactly when `args.write` is `apply-manifest`. */
  manifest: RepoSettingsApplyManifest | undefined;
  token: string;
}): Promise<number> {
  const seams: ApprovedWriteSeams = {
    home,
    ledger: deps.doorLedger,
    out: deps.out,
    writeDiagnostic: deps.writeDiagnostic,
  };
  const { owner, repo } = args;
  let planned: GithubVerbResult<ApprovedRepoWrite>;
  if (args.write === "create") {
    const request = { owner, private: !args.public, repo };
    planned = await planRepoCreate({ api: deps.makeLifecycleApi({ home, token }), request });
  } else if (args.write === "set-public") {
    planned = await planRepoSetPublic({ api: deps.makeLifecycleApi({ home, token }), home, owner, repo });
  } else if (args.write === "push-fresh-cut") {
    planned = await planRepoPushFreshCut({
      api: deps.makeLifecycleApi({ home, token }),
      git: deps.freshCutGit,
      home,
      owner,
      recordId: args.freshCutRecordId!,
      repo,
    });
  } else if (args.write === "apply-manifest") {
    const api = deps.makeManifestApi({ home, token });
    planned = await planRepoManifestWrite({ api, manifest: manifest!, manifestPath: args.manifestPath!, owner, repo });
  } else {
    planned = await planRepoEnableActions({ api: deps.makeActionsPolicyApi({ home, token }), owner, repo });
  }
  if (planned.isErr()) {
    return diagnoseRepoWrite({ error: planned.error, seams });
  }
  return runApprovedRepoWrite({ approve: args.approve, json: args.json, seams, write: planned.value });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the repo command
 */
export function productionGithubRepoDeps(): GithubRepoDeps {
  return {
    doorLedger: doorLedgerPort(),
    freshCutGit: { readGit, writeGit },
    home: slopweaverHome,
    makeActionsPolicyApi: ({ home, token }) =>
      makeGithubRepoActionsPolicyApi({ privacy: githubWritePrivacy({ home }), token }),
    makeAdministrationApi: ({ home, token }) =>
      makeGithubRepoAdministrationApi({ privacy: githubWritePrivacy({ home }), token }),
    makeLifecycleApi: ({ home, token }) => makeGithubRepoLifecycleApi({ privacy: githubWritePrivacy({ home }), token }),
    makeManifestApi: ({ home, token }) => makeGithubRepoManifestApi({ privacy: githubWritePrivacy({ home }), token }),
    makeApi: ({ home, token }) => makeGithubRepoDescriptionApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    readText: ({ path }) => {
      try {
        return ok(readFileSync(path, "utf8"));
      } catch (error) {
        return err([error instanceof Error ? error.message : String(error)]);
      }
    },
    token: ({ home }) => githubToken({ home }),
    transferWait: {
      attempts: TRANSFER_READ_ATTEMPTS,
      intervalMs: TRANSFER_READ_INTERVAL_MS,
      sleep: ({ ms }) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github repo`. */
export const githubRepoCommand = defineCommand({
  run: (argv) => runGithubRepo({ deps: productionGithubRepoDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
