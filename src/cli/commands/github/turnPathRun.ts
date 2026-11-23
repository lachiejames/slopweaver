/**
 * The effectful shell for `slopweaver github turn-path` — fetches a pull request's head into a private,
 * per-invocation ref, diffs it against a base ref, and always cleans that ref up.
 *
 * Every private-ref primitive here is `gitAncestry.ts`'s, unchanged: `newPrivateFetchRef()` already mints a
 * fresh `refs/slopweaver/fetch/<uuid>` per call, which is namespacing stronger than the per-session scheme
 * the loop chain's own handover docs proposed — a `randomUUID()` cannot collide across concurrent
 * invocations the way a `<slug>` reused within one session's own re-runs could. `fetchBranchIntoPrivateRef`
 * already turns a failed fetch into a genuine `Err` rather than a silently stale ref. What this module adds
 * is the two guards that survive a fetch that GENUINELY succeeds: refusing an empty `--head` before it ever
 * reaches a refspec ({@link validatedHeadRefName}), and refusing a head that resolves equal to the base —
 * the empty-refspec fail-open's own witness, where `git fetch origin ":<ref>"` exits 0 and resolves the
 * destination to the remote's own HEAD.
 */

import { parseRepositorySlug, type Repository, resolveRepository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { deletePrivateRef, fetchBranchIntoPrivateRef, newPrivateFetchRef } from "./gitAncestry.js";
import type { GithubPushDeps } from "./pushRun.js";
import { productionGithubPushDeps } from "./pushRun.js";
import { githubTurnPathUsage } from "./reportUsage.js";
import { classifyTurnPathPaths, parseGithubTurnPathArgs, validatedHeadRefName } from "./turnPathCore.js";

const VERB_ARG_OFFSET = 4;

/** One turn-path measurement's outcome. */
export interface TurnPathVerdict {
  readonly turnPath: boolean;
  readonly matched: readonly string[];
  readonly headSha: string;
  readonly baseSha: string;
}

/** The injectable Git edges this classification needs — the same shape every other private-ref caller uses. */
export interface GithubTurnPathDeps {
  readonly git: GithubPushDeps;
  readonly newPrivateRef: () => string;
}

/**
 * Production edges: the real Git primitives `github push` already ships, and a fresh private ref per call.
 *
 * @returns the real argv-array Git readers/writers and a `randomUUID()`-backed private-ref minter
 */
export function productionGithubTurnPathDeps(): GithubTurnPathDeps {
  return { git: productionGithubPushDeps(), newPrivateRef: newPrivateFetchRef };
}

/**
 * Resolve a ref to its commit sha through the injected Git edges, as a `Result` rather than a throw — the
 * seam that keeps this classification pure-fake-testable rather than shelling real git the way
 * `gitAncestry.ts`'s own `resolveCommitSha` deliberately does for its own callers.
 *
 * @param ref the ref to resolve
 * @param cwd the repository to resolve in
 * @param git the injected Git read/write edges
 * @returns the commit sha, or why it did not resolve
 */
function resolveRefSha({ ref, cwd, git }: { ref: string; cwd: string; git: GithubPushDeps }): GithubVerbResult<string> {
  try {
    return ok(git.readGit({ args: ["rev-parse", "--verify", `${ref}^{commit}`], cwd }));
  } catch (error: unknown) {
    return err(
      GithubVerbErrors.refUnresolved({ cause: error instanceof Error ? error.message : String(error), cwd, ref }),
    );
  }
}

/**
 * Classify one pull request's head against a base ref as turn-path or clean.
 *
 * @param headRefName the pull request's reported head branch name — validated before any refspec is built
 * @param base the ref to diff against (typically `origin/main`)
 * @param cwd the repository to fetch and diff in
 * @param remote the configured Git remote to fetch from
 * @param deps the injected Git primitives and private-ref minter
 * @returns the verdict, or why it could not be measured
 */
export function classifyPullRequestTurnPath({
  headRefName,
  base,
  cwd,
  remote,
  deps,
}: {
  headRefName: string;
  base: string;
  cwd: string;
  remote: string;
  deps: GithubTurnPathDeps;
}): GithubVerbResult<TurnPathVerdict> {
  const validated = validatedHeadRefName({ headRefName });
  if (!validated.isOk()) {
    return err(validated.error);
  }
  const baseResolved = resolveRefSha({ cwd, git: deps.git, ref: base });
  if (!baseResolved.isOk()) {
    return err(baseResolved.error);
  }
  const ref = deps.newPrivateRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: validated.value, cwd, git: deps.git, ref, remote });
    if (!fetched.isOk()) {
      return err(fetched.error);
    }
    if (fetched.value.sha === baseResolved.value) {
      return err(GithubVerbErrors.emptyRefspecSignature({ base, ref, sha: fetched.value.sha }));
    }
    const diff = deps.git.readGit({
      args: ["diff", "--name-only", `${baseResolved.value}...${fetched.value.sha}`],
      cwd,
    });
    const paths = diff.split("\n").filter((line) => line.length > 0);
    const classification = classifyTurnPathPaths({ paths });
    return ok({ ...classification, baseSha: baseResolved.value, headSha: fetched.value.sha });
  } finally {
    const deleted = deletePrivateRef({ cwd, git: deps.git, ref });
    if (!deleted.isOk()) {
      deps.git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}

/** Write every line of a multi-problem `Result` error to the diagnostic channel. */
function printProblems({
  problems,
  writeDiagnostic,
}: {
  problems: readonly string[];
  writeDiagnostic: (line: string) => void;
}): void {
  for (const problem of problems) {
    writeDiagnostic(problem);
  }
}

/**
 * Render one turn-path verdict as either a JSON document or a single status line.
 *
 * @param verdict the classification result
 * @param json whether to emit the machine-readable form
 * @param number the pull-request number, report label only
 * @param repo the repository slug, report label only
 * @returns the one line to print
 */
function formatTurnPathReport({
  verdict,
  json,
  number,
  repo,
}: {
  verdict: TurnPathVerdict;
  json: boolean;
  number: number | undefined;
  repo: string | undefined;
}): string {
  if (json) {
    return JSON.stringify({ number, repo, ...verdict }, undefined, 2);
  }
  return verdict.turnPath
    ? `turn-path (${String(verdict.matched.length)} file(s)): ${verdict.matched.join(", ")}`
    : "clean — no changed path falls under a turn-path prefix";
}

/** The checkout to classify: `--cwd` when given, else the process's own working directory. */
function checkoutOf({ args, cwd }: { args: { readonly cwd: string | undefined }; cwd: () => string }): string {
  if (args.cwd === undefined) {
    return cwd();
  }
  return args.cwd;
}

/**
 * Run one `github turn-path` invocation against injected edges.
 *
 * @param rest argv after `github turn-path`
 * @param deps the Git primitives, private-ref minter, repo resolution and output edges
 * @returns the process exit code
 */
export function runGithubTurnPath({
  rest,
  deps,
  resolveRepo,
  writeOut,
  writeDiagnostic,
  cwd,
}: {
  rest: readonly string[];
  deps: GithubTurnPathDeps;
  resolveRepo: (args: { explicit: string | undefined }) => Result<Repository>;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
  cwd: () => string;
}): number {
  const parsed = parseGithubTurnPathArgs({ rest });
  if (!parsed.isOk()) {
    printProblems({ problems: parsed.error, writeDiagnostic });
    writeDiagnostic(githubTurnPathUsage());
    return EXIT_USAGE;
  }
  if (parsed.value.repo !== undefined) {
    const repoResolved = resolveRepo({ explicit: parsed.value.repo });
    if (!repoResolved.isOk()) {
      printProblems({ problems: repoResolved.error, writeDiagnostic });
      return EXIT_ERROR;
    }
  }
  const verdict = classifyPullRequestTurnPath({
    base: parsed.value.base,
    cwd: checkoutOf({ args: parsed.value, cwd }),
    deps,
    headRefName: parsed.value.head,
    remote: parsed.value.remote,
  });
  if (!verdict.isOk()) {
    printProblems({ problems: githubVerbErrorLines({ error: verdict.error }), writeDiagnostic });
    return EXIT_ERROR;
  }
  writeOut(
    formatTurnPathReport({
      json: parsed.value.json,
      number: parsed.value.number,
      repo: parsed.value.repo,
      verdict: verdict.value,
    }),
  );
  return verdict.value.turnPath ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** `slopweaver github turn-path`. */
export const githubTurnPathCommand = defineCommand({
  run: (argv) =>
    runGithubTurnPath({
      cwd: () => process.cwd(),
      deps: productionGithubTurnPathDeps(),
      resolveRepo: ({ explicit }) =>
        explicit !== undefined ? parseRepositorySlug({ slug: explicit }) : resolveRepository(),
      rest: argv.slice(VERB_ARG_OFFSET),
      writeDiagnostic: (line) => {
        logger.warn({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
