/** Effectful shell for the governed push-restriction read and write. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, type Repository, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type PushRestrictionError, PushRestrictionErrors } from "../../../outbound/github/pushRestrictionErrors.js";
import { type BranchPushRule, parseBranchPushRule } from "../../../outbound/github/pushRestrictionParse.js";
import {
  describeRestriction,
  type GithubPushRestrictionApi,
  makeGithubPushRestrictionApi,
  type PushRestrictionTarget,
  ruleHoldsTarget,
  setAndConfirmPushRestriction,
} from "../../../outbound/github/pushRestrictionWrite.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GITHUB_PUSH_RESTRICTION_USAGE } from "./prUsage.js";
import {
  type GithubPushRestrictionArgs,
  parseGithubPushRestrictionArgs,
  pushRestrictionDoorRequest,
} from "./pushRestrictionCore.js";
import { resolveRepoEdge } from "./repoEdge.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubPushRestrictionDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubPushRestrictionApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The rule as read, and everything a write against it needs. */
interface Setting {
  readonly api: GithubPushRestrictionApi;
  readonly repo: Repository;
  readonly identity: string;
  readonly home: string;
  readonly rule: BranchPushRule;
}

/** Resolve the repository, the credential and the client, then read the branch's rule. */
async function readSetting({
  args,
  deps,
}: {
  args: GithubPushRestrictionArgs;
  deps: GithubPushRestrictionDeps;
}): Promise<Result<Setting, PushRestrictionError>> {
  const resolved = deps.resolveRepo({ explicit: args.repo, home: args.home });
  if (resolved.isErr()) {
    return err(PushRestrictionErrors.accessUnavailable({ problems: resolved.error }));
  }
  const { home = deps.home() } = args;
  const token = deps.token({ home });
  if (token === undefined) {
    return err(
      PushRestrictionErrors.accessUnavailable({
        problems: ["no GitHub token configured; run `slopweaver connect github`"],
      }),
    );
  }
  const api = deps.makeApi({ home, token });
  const repo = resolved.value;
  const identity = `${repo.owner}/${repo.repo}`;
  const data = await api.readRules({ owner: repo.owner, repo: repo.repo });
  if (data.isErr()) {
    return err(PushRestrictionErrors.callFailed({ cause: data.error }));
  }
  const rule = parseBranchPushRule({ branch: args.branch, data: data.value, identity });
  if (rule.isErr()) {
    return err(rule.error);
  }
  return ok({ api, home, identity, repo, rule: rule.value });
}

/** Print one outcome in the selected output mode. */
function report({
  deps,
  args,
  identity,
  outcome,
  rule,
  target,
}: {
  deps: GithubPushRestrictionDeps;
  args: GithubPushRestrictionArgs;
  identity: string;
  outcome: string;
  rule: BranchPushRule;
  target: PushRestrictionTarget | null;
}): void {
  if (args.json) {
    deps.out(
      JSON.stringify(
        {
          allowances: rule.allowances,
          branch: args.branch,
          isAdminEnforced: rule.isAdminEnforced,
          outcome,
          pattern: rule.pattern,
          repo: identity,
          requiresApprovingReviews: rule.requiresApprovingReviews,
          requiresCodeOwnerReviews: rule.requiresCodeOwnerReviews,
          restrictsPushes: rule.restrictsPushes,
          target,
        },
        undefined,
        2,
      ),
    );
    return;
  }
  deps.out(`${outcome} ${identity}@${args.branch}`);
  deps.out(`  push:    ${describeRestriction({ rule })}`);
  deps.out(`  admins:  ${rule.isAdminEnforced ? "bound by the rule" : "bypass the rule"}`);
  deps.out(
    `  reviews: ${rule.requiresApprovingReviews ? "approval required" : "no approval required"}` +
      `${rule.requiresCodeOwnerReviews ? ", code owner required" : ""}`,
  );
  if (target !== null) {
    const wanted =
      target.kind === "restrict"
        ? describeRestriction({
            rule: { allowances: target.logins.map((name) => ({ kind: "user", name })), restrictsPushes: true },
          })
        : "unrestricted";
    deps.out(`  asked:   ${wanted}`);
  }
}

/** Perform the door-routed write and print the rule as read back. */
async function writeSetting({
  args,
  deps,
  setting,
  target,
}: {
  args: GithubPushRestrictionArgs;
  deps: GithubPushRestrictionDeps;
  setting: Setting;
  target: PushRestrictionTarget;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home: setting.home,
    ledger: deps.doorLedger,
    perform: () =>
      setAndConfirmPushRestriction({
        api: setting.api,
        branch: args.branch,
        identity: setting.identity,
        owner: setting.repo.owner,
        repo: setting.repo.repo,
        rule: setting.rule,
        target,
      }),
    request: pushRestrictionDoorRequest({ branch: args.branch, home: setting.home, identity: setting.identity }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({ command: "slopweaver github push-restriction", through });
    for (const line of refusal) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    deps.writeDiagnostic(through.result.error.message);
    return EXIT_ERROR;
  }
  report({ args, deps, identity: setting.identity, outcome: "set", rule: through.result.value, target });
  return EXIT_OK;
}

/**
 * Run the push-restriction read or write.
 *
 * @param rest argv after `github push-restriction`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubPushRestriction({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubPushRestrictionDeps;
}): Promise<number> {
  const parsed = parseGithubPushRestrictionArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_PUSH_RESTRICTION_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await readSetting({ args, deps });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  const setting = read.value;
  const shared = { args, deps, identity: setting.identity, rule: setting.rule, target: args.target };
  if (args.target === null) {
    report({ ...shared, outcome: "read" });
    return EXIT_OK;
  }
  if (ruleHoldsTarget({ rule: setting.rule, target: args.target })) {
    report({ ...shared, outcome: "already set" });
    return EXIT_OK;
  }
  if (args.dryRun) {
    report({ ...shared, outcome: "would set" });
    return EXIT_OK;
  }
  return writeSetting({ args, deps, setting, target: args.target });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-lane client and output edges for the push-restriction command
 */
export function productionGithubPushRestrictionDeps(): GithubPushRestrictionDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubPushRestrictionApi({ privacy: githubWritePrivacy({ home }), token }),
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

/** `slopweaver github push-restriction`. */
export const githubPushRestrictionCommand = defineCommand({
  run: (argv) =>
    runGithubPushRestriction({ deps: productionGithubPushRestrictionDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
