/**
 * `slopweaver github stack adopt` — the effectful shell.
 *
 * Reuses, unchanged: `stackSquash.ts`'s safe single-commit rebase primitive (the exact one `stack sync`
 * trusts), `pushCore.ts`'s exact-lease push-plan builder, `stackRegistration.ts`'s `registerStackEntry` (native
 * registration, shared verbatim between push and adopt), and `updateCore.ts`'s `authorisationFor` (the same
 * foreign-author gate `pr update` uses, generalised for this purpose).
 *
 * The order is the contract: parse → read git + live PR facts → authorise → plan → [dry-run stops here] →
 * [operation lock] → door → re-confirm freshness → rebase → push → register (local ledger, then native) →
 * warn on lower unregistered entries → report. Everything from re-confirming freshness to the lower-entry warning
 * runs inside the door and lives in `./stackAdoptPerform.ts`; this file keeps the deciding, the lock and the report.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi, type WrittenPr } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { registerStackMember } from "../../../outbound/github/stackLedger.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { githubVerbErrorLines } from "./errors.js";
import { invocationDir } from "./pushCore.js";
import { type GithubPushDeps, productionGithubPushDeps } from "./pushRun.js";
import {
  ALLOW_DIRTY_TREE,
  type GithubStackAdoptArgs,
  type GithubStackAdoptPlan,
  githubStackAdoptDoorRequest,
  githubStackAdoptPlan,
  parseGithubStackAdoptArgs,
  patchEquivalentNotice,
} from "./stackAdoptCore.js";
import { effectiveCommitsFor } from "./stackAdoptEffectiveCommits.js";
import { type LocalAdoptFacts, localAdoptFacts } from "./stackAdoptGit.js";
import { reconfirmAndPerform } from "./stackAdoptPerform.js";
import { runGithubStackAdoptRegistration } from "./stackAdoptRegistrationRun.js";
import { stackRegistrationFailed, stackRegistrationLines } from "./stackRegistration.js";
import { ALLOW_FOREIGN_PR, authorisationFor } from "./updateCore.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "adopt"

/** The injectable edges — Git through `pushRun.ts`'s deps, plus the write API, env reader and output sink. */
export interface GithubStackAdoptDeps {
  readonly git: GithubPushDeps;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly env: (input: { readonly name: string }) => string | undefined;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
  /**
   * The local ledger write, injectable so a test can drive `--register-only`'s partial-completion path
   * through the public entrypoint without a mock. Ordinary adopt keeps its own direct call.
   */
  readonly registerMember?: typeof registerStackMember;
}

/**
 * The production edges.
 *
 * @returns the real Git primitives, API factory, environment reader, clock and output sink
 */
function productionGithubStackAdoptDeps(): GithubStackAdoptDeps {
  return {
    env: ({ name }) => process.env[name],
    git: productionGithubPushDeps(),
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}

/** Turn an unknown Git failure into one bounded refusal line. */
function gitFailure({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** What resolving args, live facts and the plan produced. */
type ResolvedStackAdopt = Result<
  {
    readonly plan: GithubStackAdoptPlan;
    readonly api: GithubWriteApi;
    readonly dryRun: boolean;
    readonly home: string;
    readonly remote: string;
    readonly previewedPr: WrittenPr;
  },
  number
>;

/**
 * Authorise, measure the effective commit count, plan, and print every notice the plan produced.
 *
 * Split from {@link resolveStackAdoptPlan} to keep that function inside the length gate; it is also the whole
 * of the DECIDING, so what remains above it is argument, credential and fact resolution and nothing else.
 *
 * @param api the GitHub write surface
 * @param args the parsed invocation
 * @param deps the injectable Git, environment and output edges
 * @param local the local Git facts already read
 * @param pr the pull request GitHub reports now
 * @returns the plan, or the exit code its refusal has already been printed for
 */
async function planAdopt({
  api,
  args,
  deps,
  local,
  pr,
}: {
  api: GithubWriteApi;
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptDeps;
  local: LocalAdoptFacts;
  pr: WrittenPr;
}): Promise<Result<GithubStackAdoptPlan, number>> {
  const identity = await api.authenticatedUserId();
  const authorised = authorisationFor({
    allowForeign: deps.env({ name: ALLOW_FOREIGN_PR }) === "1",
    authedUserId: identity.isOk() ? identity.value : undefined,
    prAuthorId: pr.authorId,
    purpose: "stack-adopt",
  });
  const effectiveCommits = effectiveCommitsFor({ deps, pr, remote: args.remote, repoRoot: local.repoRoot });
  const planned = githubStackAdoptPlan({
    allowDirty: deps.env({ name: ALLOW_DIRTY_TREE }) === "1",
    authorisation: authorised,
    facts: { ...local, effectiveCommits, pr },
  });
  if (planned.isErr()) {
    deps.out({ line: `refused: ${planned.error}` });
    return err(EXIT_ERROR);
  }
  if (effectiveCommits?.measured === true) {
    deps.out({ line: patchEquivalentNotice({ commits: pr.commits }) });
  }
  for (const notice of planned.value.overrideNotices) {
    deps.out({ line: notice });
  }
  return ok(planned.value);
}

/** Read local + live PR facts → authorise → plan, reporting any refusal as it goes. */
async function resolveStackAdoptPlan({
  args,
  deps,
}: {
  args: GithubStackAdoptArgs;
  deps: GithubStackAdoptDeps;
}): Promise<ResolvedStackAdopt> {
  const home = resolveHome({ named: args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(EXIT_ERROR);
  }
  const api = deps.makeApi({ home, token });
  let local: LocalAdoptFacts;
  try {
    local = localAdoptFacts({ cwd: invocationDir({ cwd: args.cwd }), git: deps.git, remote: args.remote });
  } catch (error: unknown) {
    deps.out({ line: `refused: ${gitFailure({ error })}` });
    return err(EXIT_ERROR);
  }
  const pr = await api.getPr({ number: args.prNumber, owner: local.owner, repo: local.repo });
  if (pr.isErr()) {
    deps.out({ line: `refused: could not read PR #${String(args.prNumber)}: ${pr.error.message}` });
    return err(EXIT_ERROR);
  }
  const planned = await planAdopt({ api, args, deps, local, pr: pr.value });
  if (planned.isErr()) {
    return err(planned.error);
  }
  return ok({ api, dryRun: args.dryRun, home, plan: planned.value, previewedPr: pr.value, remote: args.remote });
}

/** The stack-ledger writer a register-only run uses: the injected one when a test supplies it, else the real one. */
function memberRegistrar({ deps }: { deps: GithubStackAdoptDeps }): typeof registerStackMember {
  const supplied = deps.registerMember;
  if (supplied === undefined) {
    return registerStackMember;
  }
  return supplied;
}

/**
 * Run one governed stack adopt.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun, "stack" and "adopt"
 * @param deps injectable Git, API, environment and output edges
 * @returns the process exit code
 */
export async function runGithubStackAdopt({
  argv,
  deps = productionGithubStackAdoptDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackAdoptDeps;
}): Promise<number> {
  const parsed = parseGithubStackAdoptArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) deps.out({ line });
    return EXIT_USAGE;
  }
  const args: GithubStackAdoptArgs = parsed.value;
  // Dispatched BEFORE `resolveStackAdoptPlan`, which reads symbolic HEAD, the local HEAD SHA, `git status`
  // and — through `planAdopt` — the effective-commit measurement. Every one of those is a replay fact, and
  // a register-only run that reached them would still refuse exactly the drifted pull requests this mode
  // exists to repair. `stackAdoptRegistrationRun/register.test.ts` proves it, through the `harness.ts` beside
  // it that throws on each of those reads.
  if (args.registerOnly) {
    return runGithubStackAdoptRegistration({
      args,
      deps: { ...deps, registerMember: memberRegistrar({ deps }) },
      home: resolveHome({ named: args.home }),
    });
  }
  const resolved = await resolveStackAdoptPlan({ args, deps });
  if (!resolved.isOk()) {
    return resolved.error;
  }
  const { api, dryRun, home, plan, remote, previewedPr } = resolved.value;
  deps.out({
    line: `would adopt PR #${String(plan.prNumber)} (${plan.branch} onto ${plan.baseBranch}) into stack state`,
  });
  if (dryRun) {
    deps.out({ line: "dry run: no rebase, no door record, no push, no network write." });
    return EXIT_OK;
  }
  return runAdoptWrite({ api, deps, home, plan, previewedPr, remote });
}

/**
 * Take the operation lock, go through the door, and report — split from the entrypoint so both stay inside
 * the function-length gate, and because everything above it is decision and everything here is effect.
 *
 * @param api the GitHub write surface
 * @param deps the injectable Git, environment, clock and output edges
 * @param home the state home whose door ledger records the write
 * @param plan the adopt decided outside the lock
 * @param previewedPr the pull request as read while building that plan
 * @param remote the configured Git remote
 * @returns the process exit code
 */
async function runAdoptWrite({
  api,
  deps,
  home,
  plan,
  previewedPr,
  remote,
}: {
  api: GithubWriteApi;
  deps: GithubStackAdoptDeps;
  home: string;
  plan: GithubStackAdoptPlan;
  previewedPr: WrittenPr;
  remote: string;
}): Promise<number> {
  // Lower-cased: GitHub owner/repo names are case-insensitive, but the lock hashes this key verbatim, so a
  // differently-cased remote for the SAME repository would otherwise contend on a different lock entirely.
  const lockKey = `${plan.owner}/${plan.repo}`.toLowerCase();
  const lock = acquireOperationLock({ home, key: lockKey, nowIso: deps.now().toISOString() });
  if (!lock.isOk()) {
    deps.out({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return EXIT_ERROR;
  }
  try {
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      home,
      ledger: deps.git.doorLedger,
      perform: () => reconfirmAndPerform({ api, git: deps.git, home, now: deps.now, plan, previewedPr, remote }),
      request: githubStackAdoptDoorRequest({ home, plan }),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "slopweaver github stack adopt", through: routed })) {
        deps.out({ line });
      }
      return EXIT_ERROR;
    }
    if (routed.result.kind !== "adopted") {
      deps.out({ line: `${routed.result.kind}: ${routed.result.reason}` });
      return EXIT_ERROR;
    }
    deps.out({ line: `adopted PR #${String(plan.prNumber)}` });
    for (const line of stackRegistrationLines({ registration: routed.result.registration })) {
      deps.out({ line });
    }
    if (routed.result.warning !== undefined) {
      deps.out({ line: routed.result.warning });
    }
    // An adopt whose whole purpose was to register a native stack, and which did not, must not exit 0 —
    // `stack audit --check` would then disagree with the verb that just reported success.
    return stackRegistrationFailed({ registration: routed.result.registration }) ? EXIT_ERROR : EXIT_OK;
  } finally {
    lock.value.release();
  }
}
