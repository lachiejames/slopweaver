/**
 * The whole-tree seat gate's runner: read the `PreToolUse` payload, classify the command, and refuse a run that
 * builds the TypeScript type checker over the whole tree, runs a whole test lane, or re-checks the whole tree's
 * format or dependency graph — CI's lane, never a seat's.
 *
 * FAILS OPEN on anything it cannot read — a malformed payload, a tool it does not judge, a missing command.
 * It is a load guard, not a security boundary, so it starts from `./bashToolCommandPayload.ts`'s fail-open
 * preamble: a bug that failed closed would wedge every `Bash` call in every session on the machine.
 *
 * The decision is entirely in `./wholeTreeCheck.ts`; nothing here judges anything.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { readBashToolCommand } from "./bashToolCommandPayload.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { classifyWholeTreeCheck, WHOLE_TREE_CHECK_HATCH } from "./wholeTreeCheck.js";

/**
 * The refusal, naming what was about to run and where its verdict comes from instead.
 *
 * The replacement clause is the trade the owner chose — slower feedback for a flat,
 * predictable load — spelled as the commands that pay it, so a refused session moves rather than reaching
 * for the hatch.
 *
 * @internal — {@link runWholeTreeCheckGuard} is this module's public surface; exported for its own unit test.
 * @param what the whole-tree run that was about to start
 * @returns the four-line refusal followed by where the verdict comes from
 */
export function wholeTreeCheckRefusal({ what }: { what: string }): string {
  const hatch = hatchFor({ id: "whole-tree-check" });
  return [
    hatchRefusal({ detail: what, hatch }),
    "Push instead and watch CI's `lint`, `typecheck`, `compile`, `unit` and `subprocess` jobs, which run every lane: " +
      "`slopweaver github checks --number <n> --wait`, and `--log` to read a red leg; with no pull request yet, " +
      "`slopweaver github stack push` opens the draft CI runs on. Locally, " +
      "`slopweaver dev lint --only <gate>` re-checks one cheap gate, `yarn oxlint <changed files>` and " +
      "`yarn prettier --check <changed files>` are the lint-staged pass, and " +
      "`yarn vitest run --config config/vitest/unit.ts <test files>` runs the tests you touched.",
  ].join("\n");
}

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for the ambient hatch
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runWholeTreeCheckGuard({
  readStdin,
  writeError,
  env,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<number> {
  if (env[WHOLE_TREE_CHECK_HATCH] === "1") {
    return EXIT_ALLOW;
  }
  const call = await readBashToolCommand({ readStdin });
  if (call === undefined) {
    return EXIT_ALLOW;
  }
  const judged = classifyWholeTreeCheck({ command: call.command, cwd: call.cwd });
  if (judged.kind === "not-whole-tree") {
    return EXIT_ALLOW;
  }
  writeError(`${wholeTreeCheckRefusal({ what: judged.what })}\n`);
  return EXIT_BLOCK;
}
