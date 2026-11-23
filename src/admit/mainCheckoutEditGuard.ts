/**
 * Blocks an `Edit`/`Write` or Codex `apply_patch` target that would touch a file inside THIS repository's
 * own main checkout — the half of the incident `mainCheckoutDirtyGuard.ts`'s `Bash`-only coverage cannot
 * see: a driving session can edit a file directly with its own file-edit tool, never going through a Bash
 * command at all. Shares
 * {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV} with the Bash dirty guard — both represent the same "a write in
 * the main checkout" decision, just observed through a different tool.
 *
 * Deliberately narrow, same residual-gap class as its siblings: it resolves the target file's nearest
 * existing parent directory against {@link isProtectedMainCheckout}, never against a git-status check — a file write
 * can target a path this repository doesn't track at all, and the predicate here is "does this path live in
 * the main checkout", not "is this specific file already known to git". Walking to the nearest existing
 * parent is required for a brand-new nested directory: `git rev-parse` cannot run from a directory that does
 * not exist yet, but its existing parent still establishes the target's checkout unambiguously.
 */
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import { isProtectedMainCheckout } from "./declaredMainCheckouts.js";
import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "./mainCheckoutDirtyGuard.js";
import type { isMainWorktreeForRepository } from "./mainWorktree.js";

/**
 * Find the nearest existing directory containing a target path.
 *
 * @param filePath the target file path, absolute or relative to `cwd`
 * @param cwd the session's reported working directory
 * @returns the target directory or its nearest existing ancestor
 */
function nearestExistingTargetDirectory({ filePath, cwd }: { filePath: string; cwd: string }): string {
  let candidate = dirname(resolvePath(cwd, filePath));
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      return candidate;
    }
    candidate = parent;
  }
  return candidate;
}

/**
 * Decide whether to block one file-edit target as touching the main checkout.
 *
 * @param filePath the tool call's target file path, absolute or relative to `cwd`
 * @param cwd the session's reported working directory
 * @param allowOverride whether {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV} is set
 * @param checkMainWorktree the protected-checkout check (defaults to {@link isProtectedMainCheckout}, which
 *   is both the topology key and `profile.json`'s declared set; overridable so a caller can inject a fixture
 *   result)
 * @returns the block/allow decision
 */
export function evaluateMainCheckoutEditGuard({
  filePath,
  cwd,
  allowOverride,
  checkMainWorktree = isProtectedMainCheckout,
}: {
  filePath: string;
  cwd: string;
  allowOverride: boolean;
  checkMainWorktree?: typeof isMainWorktreeForRepository;
}): { readonly block: true; readonly message: string } | { readonly block: false } {
  if (allowOverride) {
    return { block: false };
  }
  const targetDir = nearestExistingTargetDirectory({ cwd, filePath });
  if (!checkMainWorktree({ cwd: targetDir, repositoryCwd: cwd })) {
    return { block: false };
  }
  return {
    block: true,
    message: `Slopweaver blocks editing a file in this repository's main checkout: every other worktree and session reads from it, so leaving it dirty disrupts all of them. Use a dedicated worktree instead (\`cmux spawn\`), or set ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 for this one run.`,
  };
}
