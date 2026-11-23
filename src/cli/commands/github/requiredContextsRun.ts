/** Effectful shell for the governed required-status-check read and write. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, type Repository, slopweaverHome } from "../../../config.js";
import type { MergeGroupObservation } from "../../../corpus/github/protection.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type GithubRequiredContextsApi,
  makeGithubRequiredContextsApi,
  type RequiredContextsWriteError,
  RequiredContextsWriteErrors,
  readFailure,
  setAndConfirmContexts,
} from "../../../outbound/github/requiredContextsWrite.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GITHUB_REQUIRED_CONTEXTS_USAGE } from "./prUsage.js";
import { resolveRepoEdge } from "./repoEdge.js";
import {
  composeRequiredContexts,
  type GithubRequiredContextsArgs,
  judgeQueueSafety,
  parseGithubRequiredContextsArgs,
  requiredContextsDoorRequest,
  unobservedContextRefusal,
  unobservedHatchOpen,
} from "./requiredContextsCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubRequiredContextsDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRequiredContextsApi;
  readonly env: () => Record<string, string | undefined>;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/* Everything below the parse is expressed as a `Setting` — the branch's own rule plus the window that
   decides whether adding to it is safe — so the command body reads as one sequence of small decisions
   rather than a ladder of unwrapped reads. */
interface Setting {
  readonly api: GithubRequiredContextsApi;
  readonly repo: Repository;
  readonly home: string;
  readonly current: readonly string[];
  readonly strict: boolean;
  readonly observation: MergeGroupObservation;
}

/** Resolve the repository, the credential and the client, or say which one is missing. */
function openClient({
  args,
  deps,
}: {
  args: GithubRequiredContextsArgs;
  deps: GithubRequiredContextsDeps;
}): Result<{ api: GithubRequiredContextsApi; repo: Repository; home: string }, RequiredContextsWriteError> {
  const resolved = deps.resolveRepo({ explicit: args.repo, home: args.home });
  if (resolved.isErr()) {
    return err(RequiredContextsWriteErrors.accessUnavailable({ problems: resolved.error }));
  }
  const { home = deps.home() } = args;
  const token = deps.token({ home });
  if (token === undefined) {
    return err(
      RequiredContextsWriteErrors.accessUnavailable({
        problems: ["no GitHub token configured; run `slopweaver connect github`"],
      }),
    );
  }
  return ok({ api: deps.makeApi({ home, token }), home, repo: resolved.value });
}

/** Read the branch's rule and the merge-group window that judges an addition to it. */
async function readSetting({
  args,
  deps,
}: {
  args: GithubRequiredContextsArgs;
  deps: GithubRequiredContextsDeps;
}): Promise<Result<Setting, RequiredContextsWriteError>> {
  const opened = openClient({ args, deps });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const { api, repo, home } = opened.value;
  const identity = `${repo.owner}/${repo.repo}`;
  const rule = await api.read({ branch: args.branch, owner: repo.owner, repo: repo.repo });
  if (rule.isErr()) {
    return err(readFailure({ branch: args.branch, failure: rule.error, identity }));
  }
  if (rule.value.kind === "unprotected") {
    return err(RequiredContextsWriteErrors.unprotectedBranch({ branch: args.branch, identity }));
  }
  if (rule.value.kind === "plan-unavailable") {
    return err(RequiredContextsWriteErrors.planCannotProtect({ branch: args.branch, identity }));
  }
  const window = await api.mergeGroupContexts({ entries: args.entries, owner: repo.owner, repo: repo.repo });
  if (window.isErr()) {
    return err(RequiredContextsWriteErrors.callFailed({ cause: window.error }));
  }
  return ok({
    api,
    current: rule.value.contexts.toSorted(),
    home,
    observation: window.value,
    repo,
    strict: rule.value.strict,
  });
}

/** Print one outcome in the selected output mode. */
function report({
  deps,
  args,
  repo,
  outcome,
  current,
  next,
  observation,
}: {
  deps: GithubRequiredContextsDeps;
  args: GithubRequiredContextsArgs;
  repo: Repository;
  outcome: string;
  current: readonly string[];
  next: readonly string[];
  observation: MergeGroupObservation;
}): void {
  const observed = [...new Set(observation.contexts.map((context) => context.name))].toSorted();
  if (args.json) {
    deps.out(
      JSON.stringify(
        {
          branch: args.branch,
          current,
          mergeGroup: { entries: observation.entries, observed, queueRefSuites: observation.queueRefSuites },
          next,
          outcome,
          repo: `${repo.owner}/${repo.repo}`,
        },
        undefined,
        2,
      ),
    );
    return;
  }
  deps.out(`${outcome} ${repo.owner}/${repo.repo}@${args.branch}`);
  deps.out(`  required now:  ${current.length === 0 ? "(none)" : current.join(", ")}`);
  deps.out(`  required next: ${next.length === 0 ? "(none)" : next.join(", ")}`);
  deps.out(
    `  seen on ${String(observation.entries)} merge-group entr${observation.entries === 1 ? "y" : "ies"}: ` +
      `${observed.length === 0 ? "(none)" : observed.join(", ")}`,
  );
}

/** Which names this write would newly require that the merge-group window has never seen report. */
function unobservedAdditions({ setting, next }: { setting: Setting; next: readonly string[] }): readonly string[] {
  const observed = setting.observation.contexts.map((context) => context.name);
  const adding = next.filter((name) => !setting.current.includes(name));
  return judgeQueueSafety({ adding, observed })
    .filter((verdict) => !verdict.observed)
    .map((verdict) => verdict.name);
}

/** Perform the door-routed write and print what the branch requires afterwards. */
async function writeSetting({
  args,
  deps,
  setting,
  next,
}: {
  args: GithubRequiredContextsArgs;
  deps: GithubRequiredContextsDeps;
  setting: Setting;
  next: readonly string[];
}): Promise<number> {
  const identity = `${setting.repo.owner}/${setting.repo.repo}`;
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home: setting.home,
    ledger: deps.doorLedger,
    perform: () =>
      setAndConfirmContexts({
        api: setting.api,
        branch: args.branch,
        contexts: next,
        identity,
        owner: setting.repo.owner,
        repo: setting.repo.repo,
        strict: setting.strict,
      }),
    request: requiredContextsDoorRequest({ branch: args.branch, home: setting.home, identity }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({ command: "slopweaver github required-contexts", through });
    for (const line of refusal) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    deps.writeDiagnostic(through.result.error.message);
    return EXIT_ERROR;
  }
  report({
    args,
    current: setting.current,
    deps,
    next: through.result.value,
    observation: setting.observation,
    outcome: "set",
    repo: setting.repo,
  });
  return EXIT_OK;
}

/** Decide what to do with a composed list that differs from what the branch requires today. */
async function applyChange({
  args,
  deps,
  setting,
  next,
}: {
  args: GithubRequiredContextsArgs;
  deps: GithubRequiredContextsDeps;
  setting: Setting;
  next: readonly string[];
}): Promise<number> {
  const shared = { args, current: setting.current, deps, next, observation: setting.observation, repo: setting.repo };
  if (next.length === 0) {
    deps.writeDiagnostic(
      `refusing to leave ${args.branch} requiring no context at all — a merge queue with an empty required ` +
        "set merges every entry without testing the merged result",
    );
    return EXIT_ERROR;
  }
  const unobserved = unobservedAdditions({ next, setting });
  if (unobserved.length > 0 && !unobservedHatchOpen({ env: deps.env() })) {
    report({ ...shared, outcome: "refused" });
    const observed = [...new Set(setting.observation.contexts.map((context) => context.name))];
    for (const line of unobservedContextRefusal({ entries: setting.observation.entries, observed, unobserved })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    report({ ...shared, outcome: "would set" });
    return EXIT_OK;
  }
  return writeSetting({ args, deps, next, setting });
}

/**
 * Run the required-status-check read or write.
 *
 * @param rest argv after `github required-contexts`
 * @param deps credential, client, environment and output seams
 * @returns the process exit code
 */
export async function runGithubRequiredContexts({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubRequiredContextsDeps;
}): Promise<number> {
  const parsed = parseGithubRequiredContextsArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_REQUIRED_CONTEXTS_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await readSetting({ args, deps });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  const setting = read.value;
  const shared = { args, current: setting.current, deps, observation: setting.observation, repo: setting.repo };
  if (args.require.length === 0 && args.drop.length === 0) {
    report({ ...shared, next: setting.current, outcome: "read" });
    return EXIT_OK;
  }
  const next = composeRequiredContexts({ args, current: setting.current });
  if (next.join("\n") === setting.current.join("\n")) {
    report({ ...shared, next, outcome: "already set" });
    return EXIT_OK;
  }
  return applyChange({ args, deps, next, setting });
}

/**
 * Production GitHub, environment and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the required-contexts command
 */
export function productionGithubRequiredContextsDeps(): GithubRequiredContextsDeps {
  return {
    doorLedger: doorLedgerPort(),
    env: () => process.env,
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubRequiredContextsApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    resolveRepo: resolveRepoEdge,
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github required-contexts`. */
export const githubRequiredContextsCommand = defineCommand({
  run: (argv) =>
    runGithubRequiredContexts({ deps: productionGithubRequiredContextsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
