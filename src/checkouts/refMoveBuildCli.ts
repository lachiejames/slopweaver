/**
 * `lefthook.yml`'s second `post-merge` / `post-checkout` command — nothing but the top-level invocation,
 * the same shape `./refMoveInstallCli.ts` uses and for the same reasons: the exit code is pure signalling
 * (git ignores what these hooks return, lefthook renders a non-zero one red), and the invocation is TOTAL
 * so that every throw becomes the `failed` arm's one line rather than a tsx stack trace.
 */
import { productionInspectDeps } from "./inspect.js";
import { type RefMoveBuildOutcome, refMoveBuildHookFrom, renderRefMoveBuildOutcome } from "./refMoveBuild.js";
import { runRefMoveBuild } from "./refMoveBuildRun.js";
import type { RefMoveHook } from "./refMoveInstall.js";

/** Where git's own arguments start in `process.argv`, after the node binary, this script, and the hook name. */
const HOOK_ARG_OFFSET = 3;

/** The exit code that makes lefthook render this command as failed. */
const EXIT_SIGNAL_FAILURE = 1;

/** Run the hook, turning any throw that escapes it into the `failed` arm rather than a stack trace. */
function outcomeFor({ hook }: { hook: RefMoveHook }): RefMoveBuildOutcome {
  try {
    return runRefMoveBuild({
      args: process.argv.slice(HOOK_ARG_OFFSET),
      cwd: process.cwd(),
      deps: productionInspectDeps(),
      hook,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { detail, did: "failed", why: "the hook itself threw before it could decide anything" };
  }
}

const hook = refMoveBuildHookFrom({ name: process.argv[2] });
if (hook === undefined) {
  process.stderr.write("refMoveBuildCli: first argument must be `post-checkout` or `post-merge`\n");
  process.exit(EXIT_SIGNAL_FAILURE);
} else {
  const outcome = outcomeFor({ hook });
  process.stdout.write(`${renderRefMoveBuildOutcome({ hook, outcome })}\n`);
  process.exit(outcome.did === "failed" ? EXIT_SIGNAL_FAILURE : 0);
}
