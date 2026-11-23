/**
 * Blocks a `git checkout`/`git switch` that would leave a protected main checkout off ITS OWN pinned trunk
 * branch — the mechanism behind failure mode (5) in `worktree-base-resolution-fix.md`: every other worktree
 * and session reads the main checkout's ref, so a stray branch switch there disrupts all of them.
 *
 * "Its own" is load-bearing and was once a module constant reading `"main"`. Each protected checkout's trunk
 * comes from that checkout's own `profile.json` entry ({@link protectedTrunkBranch}), because this install
 * declares more than one and they are not all pinned to the same branch: a literal comparison refused the
 * CORRECT move on a checkout pinned to `staging` while never once refusing a wrong one there.
 *
 * It also refuses a `git branch -m/-M` RENAME there, which is the same failure wearing a different verb.
 * Measured (`child-must-not-touch-the-main-checkout`): a spawned child renamed a shared
 * checkout's own long-lived branch to its feature name and committed on top, so its pull request rendered
 * that whole branch instead of a one-file change. A rename looks harmless — nothing is lost and one command
 * undoes it — which is exactly why it slipped past a guard that only watched for a switch: it does not move
 * `HEAD`, it moves the branch out from under it, and every other worktree reading that ref follows.
 *
 * Deliberately narrow, mirroring `hookPayload.ts`'s own predicate rather than extending it: this fires only
 * for EXACT, always-wrong cases (leaving the ONE main checkout's trunk, by switch or by rename), never for a
 * branch switch inside any worktree, and never for `git reset --hard` — a reset moves the current branch's
 * tip but never changes WHICH branch is checked out, so it is out of this guard's scope by construction, not
 * an oversight. A bare `git branch <name>` that only CREATES a ref is out of scope for the same reason: it
 * leaves both `HEAD` and every existing ref exactly where they were.
 *
 * Fails OPEN, unlike the raw-tool door: this is a workflow safety net, not a security boundary, so ambiguity
 * (a target this can't statically resolve, a `rev-parse` that errors because `cwd` isn't a git repo at all)
 * allows rather than blocks. "May only block on state it can resolve unambiguously."
 * Literal inline `cd` and Git `-C` targets are resolved before the protected checkout's identity is checked.
 */
import { usesShellExpansion } from "./argumentValue.js";
import { gitSubcommand, stripEnvPrefix, toolName } from "./commandTokens.js";
import { isProtectedMainCheckout, protectedTrunkBranch } from "./declaredMainCheckouts.js";
import { hasSegmentInlineEnvironmentOverride, resolveMainCheckoutCommandTargets } from "./mainCheckoutCommandTarget.js";
import type { isMainWorktreeForRepository } from "./mainWorktree.js";

/** The escape hatch, quoted verbatim in the block message so the path forward is never hidden. */
export const MAIN_CHECKOUT_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH";

/**
 * The branch a `git checkout`/`git switch` invocation would leave `HEAD` on, when this can be determined
 * statically — `undefined` for anything ambiguous (a file-restore `--` form, the `switch -`/`checkout -`
 * previous-branch shorthand, or a value built from shell expansion) rather than a guess. Covers both an
 * existing-branch switch and a new-branch creation (`-b`/`-B`/`-c`/`-C`, spaced or short form): either way
 * the new branch name is the first non-flag token, since a start-point argument only ever follows it.
 *
 * KNOWN, ACCEPTED RESIDUAL GAP: a `--create=name`/`--force-create=name` long `=`-joined form is not
 * recognised (it looks like a flag, so the scan for "first non-flag token" skips past it) — narrow rather
 * than a full argument parser, same trade this repository's own raw-tool classifier already documents.
 *
 * @param command the raw shell command line
 * @returns the branch name it switches to, or `undefined` when this cannot determine one
 */
export function branchSwitchTarget({ command }: { command: string }): string | undefined {
  const tokens = stripEnvPrefix({
    tokens: command
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0),
  });
  const first = tokens[0];
  if (first === undefined || toolName({ first }) !== "git") {
    return undefined;
  }
  const { sub, flags } = gitSubcommand({ tokens });
  if (sub !== "checkout" && sub !== "switch") {
    return undefined;
  }
  if (flags.includes("--")) {
    return undefined; // a file-restore form, e.g. `checkout <ref> -- <path>` — never a branch switch
  }
  const target = flags.find((token) => !token.startsWith("-"));
  if (target === undefined || target === "-" || usesShellExpansion({ text: target })) {
    return undefined; // no target, the previous-branch shorthand, or a value this can't statically resolve
  }
  return target;
}

/** `git branch` flags that rename an existing branch, in every spelling git accepts. */
const BRANCH_RENAME_FLAGS: ReadonlySet<string> = new Set(["-m", "-M", "--move", "--force-move"]);

/**
 * Whether one command segment renames a branch with `git branch -m/-M` (or their long forms).
 *
 * Matches on EXACT flag tokens rather than a `-m` prefix, so `git branch --merged` — a read — is untouched.
 * Both argument forms are the same decision: `branch -m <new>` renames the checked-out branch, and
 * `branch -m <old> <new>` renames another one, and in a shared checkout each rewrites a ref every other
 * worktree and session resolves through.
 *
 * @param command the raw shell command line
 * @returns whether it renames a branch
 */
export function renamesBranch({ command }: { command: string }): boolean {
  const tokens = stripEnvPrefix({
    tokens: command
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0),
  });
  const first = tokens[0];
  if (first === undefined || toolName({ first }) !== "git") {
    return false;
  }
  const { sub, flags } = gitSubcommand({ tokens });
  return sub === "branch" && flags.some((token) => BRANCH_RENAME_FLAGS.has(token));
}

/**
 * Why one command segment must not run in a protected main checkout, or `undefined` when it may.
 *
 * `trunk` is that ONE checkout's own trunk rather than a repository-wide literal, which is the whole point:
 * a comparison against a module constant refuses the correct move for any checkout pinned elsewhere while
 * never refusing a single wrong one.
 *
 * @param command one command segment
 * @param trunk the branch THAT checkout is pinned to, from {@link protectedTrunkBranch}
 * @returns the refusal's own sentence, or `undefined` when the segment leaves the checkout's branch alone
 */
function branchChangeReason({ command, trunk }: { command: string; trunk: string }): string | undefined {
  if (renamesBranch({ command })) {
    return "renaming a branch in a protected main checkout: the rename moves the branch out from under every other worktree and session reading that ref, which is how a one-file change once opened as an entire long-lived branch";
  }
  const target = branchSwitchTarget({ command });
  return target !== undefined && target !== trunk
    ? `switching a protected main checkout off ${trunk}: every other worktree and session reads from it, so a stray branch here disrupts all of them`
    : undefined;
}

/**
 * Decide whether to block one Bash command as a branch change in a protected main checkout.
 *
 * The override is resolved PER SEGMENT as well as from the hook process's own environment, matching
 * `mainCheckoutDirtyGuard.ts`. That is the fix for the second half of that finding: the block
 * message told a reader to "set `SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH=1` for this one run", the
 * reader naturally wrote that as an inline prefix on the refused command, and the runner read only its own
 * environment — where an inline assignment on the command it is JUDGING has never been, because the hook
 * runs before the command does. The refused command and the remediation it printed could not both be true.
 *
 * @param command the raw shell command line
 * @param cwd the directory the command runs in
 * @param allowOverride whether {@link MAIN_CHECKOUT_OVERRIDE_ENV} is set in the hook process's environment
 * @param checkMainWorktree the protected-checkout check (defaults to {@link isProtectedMainCheckout}, which
 *   is both the topology key and `profile.json`'s declared set; overridable so a caller can inject a fixture
 *   result)
 * @param trunkBranch the per-checkout trunk resolver (defaults to {@link protectedTrunkBranch}, which reads
 *   that checkout's own declared `rebaseOnto`; overridable so a caller can inject a fixture trunk)
 * @returns the block/allow decision
 */
export function evaluateMainCheckoutBranchGuard({
  command,
  cwd,
  allowOverride,
  checkMainWorktree = isProtectedMainCheckout,
  trunkBranch = protectedTrunkBranch,
}: {
  command: string;
  cwd: string;
  allowOverride: boolean;
  checkMainWorktree?: typeof isMainWorktreeForRepository;
  trunkBranch?: (args: { cwd: string }) => string;
}): { readonly block: true; readonly message: string } | { readonly block: false } {
  if (allowOverride) {
    return { block: false };
  }
  const targets = resolveMainCheckoutCommandTargets({ command, cwd });
  for (const segment of targets) {
    if (segment.cwd === undefined || !checkMainWorktree({ cwd: segment.cwd, repositoryCwd: cwd })) {
      continue;
    }
    const reason = branchChangeReason({ command: segment.command, trunk: trunkBranch({ cwd: segment.cwd }) });
    if (reason === undefined) {
      continue;
    }
    const overridden = hasSegmentInlineEnvironmentOverride({
      command,
      name: MAIN_CHECKOUT_OVERRIDE_ENV,
      segmentIndex: segment.segmentIndex,
    });
    if (overridden) {
      continue;
    }
    const overriddenElsewhere = targets.some(
      (other) =>
        other.segmentIndex !== segment.segmentIndex &&
        hasSegmentInlineEnvironmentOverride({
          command,
          name: MAIN_CHECKOUT_OVERRIDE_ENV,
          segmentIndex: other.segmentIndex,
        }),
    );
    return {
      block: true,
      message: `Slopweaver blocks ${reason}. Use a dedicated worktree instead (\`cmux spawn\`) — \`slopweaver worktree here\` says whether you are standing in one — or prefix this one command with ${MAIN_CHECKOUT_OVERRIDE_ENV}=1.${overriddenElsewhere ? ` (An inline ${MAIN_CHECKOUT_OVERRIDE_ENV}=1 is present elsewhere in this command, but scoped to a different segment — each segment needs its own.)` : ""}`,
    };
  }
  return { block: false };
}
