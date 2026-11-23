/**
 * Refuses a `git commit` inside THIS repository's own main checkout, from ANY driving tool. The
 * `PreToolUse` guards in this same directory cover Claude Code and current Codex tool calls, but a bare
 * `git commit` typed by a human goes through neither. Every commit still runs through git's own hook
 * mechanism, so this is wired via `lefthook.yml`'s `pre-commit` block, which `lefthook install` (run
 * automatically by this repository's own `prepare` script) installs into `.git/hooks/pre-commit`.
 *
 * That installed hook is SHARED across every worktree of this repository — confirmed empirically:
 * committing in a LINKED worktree fires the identical `.git/hooks/pre-commit` file, since `.git/hooks` lives
 * in the common git directory, not per-worktree. So this predicate, not the hook's mere existence, is what
 * scopes the refusal to the one main checkout; {@link isMainWorktree} runs at the actual commit's cwd every
 * time, exactly the way the `PreToolUse` guards already do.
 *
 * Deliberately commit-time only, not edit-time: nothing at the git-hook layer can see a raw file write
 * before it happens, only a commit being made. An uncommitted edit made outside an agent hook remains visible
 * through `slopweaver doctor`'s surfacing check rather than being blocked here.
 */
import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "./mainCheckoutDirtyGuard.js";
import { isMainWorktree } from "./mainWorktree.js";

/**
 * Decide whether to refuse a `git commit` running at `cwd`.
 *
 * @param cwd the directory `git commit` is running in
 * @param allowOverride whether {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV} is set
 * @param checkMainWorktree the main-worktree check (defaults to {@link isMainWorktree}; overridable so a
 *   caller can inject a real fixture repo's result instead of paying a subprocess call per test)
 * @returns the refuse/allow decision
 */
export function evaluateMainCheckoutCommitGuard({
  cwd,
  allowOverride,
  checkMainWorktree = isMainWorktree,
}: {
  cwd: string;
  allowOverride: boolean;
  checkMainWorktree?: typeof isMainWorktree;
}): { readonly block: true; readonly message: string } | { readonly block: false } {
  if (allowOverride || !checkMainWorktree({ cwd })) {
    return { block: false };
  }
  return {
    block: true,
    message: `Slopweaver blocks committing in this repository's main checkout, from any driving tool: every other worktree and session reads from it, so a direct commit here disrupts all of them. Use a dedicated worktree instead (\`cmux spawn\`), or set ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 for this one commit.`,
  };
}
