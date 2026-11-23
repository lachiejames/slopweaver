/**
 * `lefthook.yml`'s `post-merge` and `post-checkout` entry point — nothing but the top-level invocation.
 * lefthook runs this directly (`node_modules/.bin/tsx src/checkouts/refMoveInstallCli.ts post-checkout {1}
 * {2} {3}`) in whichever checkout the ref moved in; the decisions live in `./refMoveInstall.ts` and the
 * effects in `./refMoveInstallRun.ts`, both of which are unit-tested. This file existing IS the invocation,
 * so there is no `isDirectInvocation` guard — the same shape `../admit/mainCheckoutCommitGuardCli.ts` uses.
 *
 * The exit code is pure signalling and says so: git IGNORES what `post-merge` and `post-checkout` return,
 * so nothing here can abort anything. A non-zero exit is what makes lefthook render the command red in its
 * own summary block, which is the only thing that reaches somebody who has already moved on.
 *
 * "Exactly one line, always" is the whole point, so the invocation below is TOTAL: every throw that reaches
 * this file — not just the ones `./refMoveInstallRun.ts` already converts — becomes a `failed` outcome and
 * renders through the same one renderer. An uncaught throw here would print a tsx stack trace instead, which
 * is precisely the shape an operator cannot read while moving on to the next thing.
 */
import { productionInspectDeps } from "./inspect.js";
import { type RefMoveHook, type RefMoveOutcome, renderRefMoveOutcome } from "./refMoveInstall.js";
import { runRefMoveInstall } from "./refMoveInstallRun.js";

/** Where git's own arguments start in `process.argv`, after the node binary, this script, and the hook name. */
const HOOK_ARG_OFFSET = 3;

/** The exit code that makes lefthook render this command as failed. */
const EXIT_SIGNAL_FAILURE = 1;

/** The hook name this was invoked as, or undefined when it was called with something else. */
function hookFrom({ name }: { name: string | undefined }): RefMoveHook | undefined {
  if (name === "post-checkout" || name === "post-merge") {
    return name;
  }
  return undefined;
}

/** Run the hook, turning any throw that escapes it into the `failed` arm rather than a stack trace. */
function outcomeFor({ hook }: { hook: RefMoveHook }): RefMoveOutcome {
  try {
    return runRefMoveInstall({
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

const hook = hookFrom({ name: process.argv[2] });
if (hook === undefined) {
  process.stderr.write("refMoveInstallCli: first argument must be `post-checkout` or `post-merge`\n");
  process.exit(EXIT_SIGNAL_FAILURE);
} else {
  const outcome = outcomeFor({ hook });
  process.stdout.write(`${renderRefMoveOutcome({ hook, outcome })}\n`);
  process.exit(outcome.did === "failed" ? EXIT_SIGNAL_FAILURE : 0);
}
