/**
 * The shell every repository-wide stack verb runs before its own work starts: parse, resolve the
 * repository, take its lock.
 *
 * A module of its own rather than part of `./stackCommonArgs.ts` because it needs `./stackFacts.ts`, which
 * reaches back into `./stackSyncCore.ts` — importing it from the flag module would close an import cycle.
 * The flags are a leaf; this is not.
 */
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { resolveHome } from "../../optionParsers.js";
import { type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { invocationDir } from "./pushCore.js";
import type { StackCommonArgs } from "./stackCommonArgs.js";
import { stackLocalFacts } from "./stackFacts.js";
import type { StackVerbDeps } from "./stackVerbDeps.js";

/**
 * The whole preamble every repository-wide stack verb runs: parse, resolve the repository, take its lock,
 * and hand the body what it needs.
 *
 * Extracted because both verbs had it character for character, which is what the `duplicate-windows` gate
 * saw. It is also the sequence that must not drift: a verb that resolved its repository BEFORE parsing, or
 * took the lock after planning, would be a different verb in the ways that matter (`stack restack`'s own
 * history has the second of those as a fixed defect).
 *
 * @param body what runs while the lock is held, given the resolved repository
 * @param offset where this verb's own arguments start in `argv`
 * @param parse this verb's own argument parser
 * @returns the body's exit code, or the usage or refusal code that stopped it before it ran
 */
export async function runWholeRepoStackVerb<TArgs extends StackCommonArgs>({
  argv,
  body,
  deps,
  offset,
  parse,
  usageExitCode,
  refusedExitCode,
}: {
  argv: readonly string[];
  body: (input: { args: TArgs; home: string; repo: string; repoRoot: string }) => Promise<number>;
  deps: StackVerbDeps;
  offset: number;
  parse: (input: { argv: readonly string[] }) => GithubVerbResult<TArgs>;
  usageExitCode: number;
  refusedExitCode: number;
}): Promise<number> {
  const parsed = parse({ argv: argv.slice(offset) });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) deps.out({ line });
    return usageExitCode;
  }
  const args = parsed.value;
  let resolved: { readonly repoRoot: string; readonly repo: string };
  try {
    resolved = stackLocalFacts({ cwd: invocationDir({ cwd: args.cwd }), git: deps.git, remote: args.remote });
  } catch (error: unknown) {
    deps.out({ line: `refused: ${error instanceof Error ? error.message : String(error)}` });
    return refusedExitCode;
  }
  const home = resolveHome({ named: args.home });
  return underStackRepoLock({
    body: () => body({ args, home, repo: resolved.repo, repoRoot: resolved.repoRoot }),
    home,
    key: resolved.repo,
    nowIso: deps.now().toISOString(),
    onRefusal: deps.out,
    refusedExitCode,
  });
}

/**
 * Take the repository lock for one whole-repository stack verb, and run its body inside it.
 *
 * @internal the preamble above is its only caller.
 *
 * Shared because both verbs need the SAME key and the same release discipline: a lock taken under a
 * differently-cased slug is a different lock, and a body that throws must still release.
 *
 * @param body what runs while the lock is held
 * @param key the repository slug, lower-cased by this function rather than by each caller
 * @param nowIso the instant of the attempt, recorded in the lock file
 * @returns the body's own exit code, or the refusal's
 */
export async function underStackRepoLock({
  body,
  home,
  key,
  nowIso,
  onRefusal,
  refusedExitCode,
}: {
  body: () => Promise<number>;
  home: string;
  key: string;
  nowIso: string;
  onRefusal: (input: { line: string }) => void;
  refusedExitCode: number;
}): Promise<number> {
  const lockKey = key.toLowerCase();
  const lock = acquireOperationLock({ home, key: lockKey, nowIso });
  if (!lock.isOk()) {
    onRefusal({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return refusedExitCode;
  }
  try {
    return await body();
  } finally {
    lock.value.release();
  }
}
