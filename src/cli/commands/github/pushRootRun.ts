/**
 * `slopweaver github push-root` — record and list the one root each re-cut repository accepts.
 *
 * `record` is the only writer of `push-roots.json` (`src/stateHome/identity.ts`). It checks, in the checkout at
 * `--cwd`, that the root is a commit with no parent, so a typo cannot bind a repository to a sha no fresh history
 * has — a binding that would refuse every honest push. The write itself is local state under the register's own
 * lock (`src/admit/pushRootStore.ts`); the guard that reads it is `src/admit/pushRootGate.ts`. Nothing here
 * reaches GitHub.
 */
import { readGit } from "../../../admit/gitTransport.js";
import { type PushRootRegistry, recordPushRoot } from "../../../admit/pushRootRegistry.js";
import { readPushRootState, writePushRootBinding } from "../../../admit/pushRootStore.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { bindingLine, type PushRootArgs, parsePushRootArgs, rootCommitProblem } from "./pushRootCore.js";

const VERB_ARG_OFFSET = 4;

/** The edges the verb touches, injectable so a test drives it with a fake Git and a fixed clock. */
export interface PushRootDeps {
  readonly out: (input: { line: string }) => void;
  readonly readGit: (input: { cwd: string; args: readonly string[] }) => string;
  readonly now: () => Date;
  readonly cwd: string;
}

/** `list`: every binding, or the line saying there is no register. */
function runList({ args, deps }: { args: Extract<PushRootArgs, { kind: "list" }>; deps: PushRootDeps }): number {
  const state = readPushRootState({ home: resolveHome({ named: args.home }) });
  if (state.isErr()) {
    deps.out({ line: `refused: ${state.error.message}` });
    return EXIT_ERROR;
  }
  const bindings = state.value.kind === "absent" ? [] : state.value.registry.bindings;
  if (args.json) {
    deps.out({ line: JSON.stringify({ bindings, registerPresent: state.value.kind === "present" }) });
    return EXIT_OK;
  }
  if (bindings.length === 0) {
    deps.out({ line: "no repository is bound to a root, so no push is guarded" });
    return EXIT_OK;
  }
  for (const binding of bindings) {
    deps.out({ line: bindingLine({ binding }) });
  }
  return EXIT_OK;
}

/** Ask Git for `<sha> <parents…>`, or `undefined` when the sha is no commit this checkout holds. */
function parentsLineOf({
  deps,
  cwd,
  rootSha,
}: {
  deps: PushRootDeps;
  cwd: string;
  rootSha: string;
}): string | undefined {
  try {
    return deps.readGit({ args: ["rev-list", "--parents", "-n", "1", `${rootSha}^{commit}`], cwd });
  } catch {
    return undefined;
  }
}

/** `record`: check the root, then bind it, or under `--dry-run` say what would be bound. */
function runRecord({ args, deps }: { args: Extract<PushRootArgs, { kind: "record" }>; deps: PushRootDeps }): number {
  let cwd = deps.cwd;
  if (args.cwd !== undefined) {
    cwd = args.cwd;
  }
  const problem = rootCommitProblem({
    parentsLine: parentsLineOf({ cwd, deps, rootSha: args.rootSha }),
    rootSha: args.rootSha,
  });
  if (problem !== undefined) {
    deps.out({ line: `refused: ${problem}` });
    return EXIT_ERROR;
  }
  const home = resolveHome({ named: args.home });
  const binding = { recordedAtIso: deps.now().toISOString(), repository: args.repository, rootSha: args.rootSha };
  const state = readPushRootState({ home });
  if (state.isErr()) {
    deps.out({ line: `refused: ${state.error.message}` });
    return EXIT_ERROR;
  }
  const before: PushRootRegistry = state.value.kind === "absent" ? { bindings: [] } : state.value.registry;
  const planned = recordPushRoot({ binding, registry: before });
  if (planned.isErr()) {
    deps.out({ line: `refused: ${planned.error.message}` });
    return EXIT_ERROR;
  }
  const already = planned.value === before;
  if (args.dryRun) {
    const verb = already ? "already bound, nothing would change" : "would bind";
    deps.out({ line: `dry run: ${verb}: ${bindingLine({ binding })}` });
    return EXIT_OK;
  }
  const written = writePushRootBinding({ binding, home });
  if (written.isErr()) {
    deps.out({ line: `refused: ${written.error.message}` });
    return EXIT_ERROR;
  }
  const bound = written.value.bindings.find(
    (entry) => entry.repository.toLowerCase() === args.repository.toLowerCase(),
  )!;
  if (args.json) {
    deps.out({ line: JSON.stringify({ binding: bound, changed: !already }) });
    return EXIT_OK;
  }
  deps.out({ line: `${already ? "already bound" : "bound"}: ${bindingLine({ binding: bound })}` });
  return EXIT_OK;
}

/**
 * Run one `github push-root` invocation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun and verb
 * @param deps the output, Git, clock and working-directory edges
 * @returns the process exit code
 */
export function runGithubPushRoot({ argv, deps }: { argv: readonly string[]; deps: PushRootDeps }): number {
  const parsed = parsePushRootArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error.lines) deps.out({ line });
    return EXIT_USAGE;
  }
  if (parsed.value.kind === "list") {
    return runList({ args: parsed.value, deps });
  }
  return runRecord({ args: parsed.value, deps });
}

/**
 * The production edges: stdout, the transport's bounded Git reader, the wall clock and the process cwd.
 *
 * @returns the edges the shipped verb runs with
 */
export function productionPushRootDeps(): PushRootDeps {
  return {
    cwd: process.cwd(),
    now: () => new Date(),
    out: logger.out,
    readGit,
  };
}

export const githubPushRootCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubPushRoot({ argv, deps: productionPushRootDeps() }),
});
