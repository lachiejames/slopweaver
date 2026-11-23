/**
 * `lefthook.yml`'s `pre-commit` entry point — nothing but the top-level invocation. `lefthook` runs this
 * directly (`node_modules/.bin/tsx src/admit/mainCheckoutCommitGuardCli.ts`) before every commit, in every
 * worktree of this repository; the logic lives in `mainCheckoutCommitGuard.ts`, which is unit-tested. This
 * file existing IS the invocation, so there is no `isDirectInvocation` guard.
 */

import { evaluateMainCheckoutCommitGuard } from "./mainCheckoutCommitGuard.js";
import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "./mainCheckoutDirtyGuard.js";

const decision = evaluateMainCheckoutCommitGuard({
  allowOverride: process.env[MAIN_CHECKOUT_WRITE_OVERRIDE_ENV] === "1",
  cwd: process.cwd(),
});
if (decision.block) {
  process.stderr.write(`${decision.message}\n`);
  process.exit(1);
} else {
  process.exit(0);
}
