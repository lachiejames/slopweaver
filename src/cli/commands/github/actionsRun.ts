/** Effectful shell for the governed GitHub Actions read and one-way switch-off. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type GithubRepoActionsApi,
  makeGithubRepoActionsApi,
  type RepoActionsState,
} from "../../../outbound/github/repoActions.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  type ActionsOutcome,
  appliedOutcome,
  type GithubActionsApplyArgs,
  type GithubActionsArgs,
  parseGithubActionsArgs,
  repoActionsDoorRequest,
  stateJson,
  stateLine,
  switchedOff,
} from "./actionsCore.js";
import { type GithubVerbError, GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { GITHUB_ACTIONS_USAGE } from "./prUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubActionsDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRepoActionsApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Read the switch once, carrying GitHub's status and operation into the error rather than only its message. */
async function readState({
  api,
  args,
}: {
  api: GithubRepoActionsApi;
  args: GithubActionsArgs;
}): Promise<GithubVerbResult<RepoActionsState>> {
  const read = await api.read({ owner: args.owner, repo: args.repo });
  if (read.isErr()) {
    return err(
      GithubVerbErrors.upstreamRefused({
        operation: "read actions permissions",
        reasons: [formatIngestError({ error: read.error })],
      }),
    );
  }
  return ok(read.value);
}

/** Print every line of one GitHub verb error. */
function writeErrorLines({ deps, error }: { deps: GithubActionsDeps; error: GithubVerbError }): void {
  githubVerbErrorLines({ error }).forEach((line) => {
    deps.writeDiagnostic(line);
  });
}

/** Print a bare read. */
function reportRead({
  deps,
  args,
  state,
}: {
  deps: GithubActionsDeps;
  args: GithubActionsArgs;
  state: RepoActionsState;
}): void {
  const repo = `${args.owner}/${args.repo}`;
  if (args.json) {
    deps.out(JSON.stringify({ outcome: "read", repo, state: stateJson({ state }) }, undefined, 2));
    return;
  }
  deps.out(`read ${repo}`);
  deps.out(`  ${stateLine({ state })}`);
}

/** Print a transition: the outcome, and the state before and after it. */
function reportTransition({
  deps,
  args,
  outcome,
  before,
  after,
}: {
  deps: GithubActionsDeps;
  args: GithubActionsArgs;
  outcome: ActionsOutcome;
  before: RepoActionsState;
  after: RepoActionsState;
}): void {
  const repo = `${args.owner}/${args.repo}`;
  if (args.json) {
    deps.out(
      JSON.stringify(
        { after: stateJson({ state: after }), before: stateJson({ state: before }), outcome, repo },
        undefined,
        2,
      ),
    );
    return;
  }
  deps.out(`${outcome} ${repo}`);
  deps.out(`  before: ${stateLine({ state: before })}`);
  deps.out(`  after:  ${stateLine({ state: after })}`);
}

/** Send the switch-off once through the door, then judge it by a separate read-back whatever GitHub answered. */
async function applyDisable({
  deps,
  args,
  home,
  api,
  before,
}: {
  deps: GithubActionsDeps;
  args: GithubActionsApplyArgs;
  home: string;
  api: GithubRepoActionsApi;
  before: RepoActionsState;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async (): Promise<Result<void, IngestError>> => api.disable({ owner: args.owner, repo: args.repo }),
    request: repoActionsDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github actions --disable --apply", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const wrote = through.result.isOk();
  if (through.result.isErr()) {
    deps.writeDiagnostic(formatIngestError({ error: through.result.error }));
  }
  const after = await readState({ api, args });
  if (after.isErr()) {
    writeErrorLines({ deps, error: after.error });
    deps.writeDiagnostic(
      "the read-back failed, so whether Actions is off is UNKNOWN — run `slopweaver github actions --repo " +
        `${args.owner}/${args.repo}\` before retrying`,
    );
    return EXIT_ERROR;
  }
  const judged = appliedOutcome({ after: after.value, wrote });
  reportTransition({ after: after.value, args, before, deps, outcome: judged.outcome });
  if (judged.outcome === "NOT confirmed") {
    writeErrorLines({
      deps,
      error: GithubVerbErrors.actionsDisableUnconfirmed({ owner: args.owner, repo: args.repo }),
    });
  }
  return judged.succeeded ? EXIT_OK : EXIT_ERROR;
}

/** The `--home` the caller named, else the configured state home. */
function stateHome({ args, deps }: { args: GithubActionsArgs; deps: GithubActionsDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/**
 * Run the Actions read, preview or switch-off.
 *
 * @param rest argv after `github actions`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubActions({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubActionsDeps;
}): Promise<number> {
  const parsed = parseGithubActionsArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_ACTIONS_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHome({ args, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    writeErrorLines({ deps, error: GithubVerbErrors.githubTokenMissing() });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const before = await readState({ api, args });
  if (before.isErr()) {
    writeErrorLines({ deps, error: before.error });
    return EXIT_ERROR;
  }
  if (!args.disable) {
    reportRead({ args, deps, state: before.value });
    return EXIT_OK;
  }
  if (before.value.enabled === false) {
    reportTransition({ after: before.value, args, before: before.value, deps, outcome: "already off" });
    return EXIT_OK;
  }
  if (!args.apply) {
    reportTransition({
      after: switchedOff(),
      args,
      before: before.value,
      deps,
      outcome: "would disable",
    });
    return EXIT_OK;
  }
  return applyDisable({ api, args, before: before.value, deps, home });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the actions command
 */
export function productionGithubActionsDeps(): GithubActionsDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubRepoActionsApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github actions`. */
export const githubActionsCommand = defineCommand({
  run: (argv) => runGithubActions({ deps: productionGithubActionsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
