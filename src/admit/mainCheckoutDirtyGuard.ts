/**
 * Blocks a Bash command that would leave THIS repository's own main checkout dirty — anything
 * `git status --porcelain` would show (staged, unstaged, or untracked) — not just a branch switch.
 * `mainCheckoutBranchGuard.ts` already blocks the branch-identity failure; this extends alongside it for the
 * broader incident: an ad-hoc session editing or committing directly in the shared main checkout. Never
 * rewrites the branch guard's own logic.
 *
 * Deliberately a BLOCKLIST of known write shapes, not a default-deny-unless-recognised-read allowlist. The
 * owner's own explicit constraint the same evening this was requested was "watch out for ramifications of
 * heavy-handedness" — a default-deny would block every ordinary read command this module hasn't enumerated
 * (an arbitrary `node -e`, a test runner, whatever a session reaches for) rather than only the shapes that
 * actually dirty the tree. This mirrors `rawTools.ts`'s own blocklist shape rather than inventing a new one.
 *
 * Unlike the branch guard, which fails OPEN on anything ambiguous, this fails CLOSED on a RECOGNISED write —
 * a false positive costs the escape hatch below, a false negative repeats the incident this exists for. It
 * still fails open on cwd resolution (an unresolvable or non-main-worktree `cwd` is always allowed) and on
 * genuinely unrecognised command shapes, for the same "not heavy-handed" reason above.
 *
 * KNOWN, ACCEPTED RESIDUAL GAP, same class as `rawTools.ts`'s own documented ones: this recognises well-known
 * git mutations, a fixed set of file-mutating shell verbs, and bare file redirection — it is not, and cannot
 * be, an exhaustive static classifier of "does this arbitrary shell command write a file" (a build script, a
 * package-manager postinstall hook, a headless editor, or any binary this list doesn't name can all still
 * dirty the tree undetected). Literal `cd`/`git -C` targets are resolved by `mainCheckoutCommandTarget.ts`;
 * grouped commands, shell-expanded paths and separators inside quoted strings remain outside this narrow
 * static classifier. This is a workflow safety net over the ORDINARY shapes a driving session reaches for,
 * not a security boundary against a deliberately evasive one.
 *
 * A second, narrower residual gap this module DOES resolve deliberately rather than leaving open: a naive
 * split on `;`/`&&`/`||`/`|`/newline (to see each command in a chain) also splits inside a quoted string —
 * `git commit -m "a; b"` sees two segments. That is accepted here specifically because misreading a chain can
 * only make this classifier MORE eager to block, never less; the failure direction is the safe one, unlike a
 * raw-bypass classifier where the same imprecision could let a real mutation through unrecognised.
 */
import { gitSubcommand, stripEnvPrefix, toolName } from "./commandTokens.js";
import { isProtectedMainCheckout } from "./declaredMainCheckouts.js";
import { hasSegmentInlineEnvironmentOverride, resolveMainCheckoutCommandTargets } from "./mainCheckoutCommandTarget.js";
import type { isMainWorktreeForRepository } from "./mainWorktree.js";

/**
 * The escape hatch, quoted verbatim in the block message so the path forward is never hidden. Deliberately a
 * SEPARATE env var from `mainCheckoutBranchGuard.ts`'s own `SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH`: a
 * legitimate one-off edit and a legitimate branch switch are different, deliberate calls, and conflating them
 * into one flag would make the escape hatch broader than either individual case needs.
 */
export const MAIN_CHECKOUT_WRITE_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE";

/**
 * `git` subcommands that mutate tracked or untracked state in the working tree or index, keyed to the
 * sub-predicate (if any) that exempts a specific, sanctioned invocation shape. `undefined` means "always
 * mutating, no exemption".
 */
const ALWAYS_MUTATING_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "cherry-pick",
  "clean",
  "commit",
  "mv",
  "rebase",
  "restore",
  "revert",
  "rm",
]);

/** File-mutating shell binaries — blocked as their FIRST token in a command segment, cwd-relative or not. */
const FILE_MUTATING_BINARIES = new Set(["rm", "mv", "cp", "touch", "mkdir", "truncate", "tee", "dd", "patch"]);

/** Binaries whose `-i`/`-i<suffix>` flag edits a file in place rather than writing to stdout. */
const IN_PLACE_EDIT_BINARIES = new Set(["sed", "perl", "ruby"]);

/** `git stash` subcommands that write INTO the working tree (`push` also removes from it — still a mutation). */
const MUTATING_STASH_SUBS = new Set(["push", "pop", "apply", "branch"]);

/**
 * A bare, unquoted file-redirection operator (`>`, `>>`, or a numbered form like `2>`) whose target is a real
 * path — deliberately excludes `>&`/fd-duplication (`2>&1`), which redirects a stream to another stream, never
 * to a file, and `/dev/null`, which discards the stream and can never leave a file behind either.
 *
 * @param segment one command segment
 * @returns whether it contains a file-redirection operator targeting a real path
 */
function hasFileRedirection({ segment }: { segment: string }): boolean {
  for (const match of segment.matchAll(/(?:^|\s)\d*>{1,2}(?!&)\s*(\S*)/g)) {
    if (match[1] !== "/dev/null") {
      return true;
    }
  }
  return false;
}

/**
 * Whether one `git` invocation's tokens (the whole segment, `git` included at index 0) mutate the working
 * tree or index, with the sanctioned exemptions this guard names explicitly.
 *
 * @param tokens the segment's whitespace-split tokens, `git` at index 0
 * @returns whether this git call mutates
 */
function isMutatingGitSegment({ tokens }: { tokens: readonly string[] }): boolean {
  const { sub, flags } = gitSubcommand({ tokens });
  if (sub === undefined) {
    return false;
  }
  if (ALWAYS_MUTATING_GIT_SUBCOMMANDS.has(sub)) {
    return true;
  }
  if (sub === "checkout") {
    return flags.includes("--"); // the file-restore form `checkout <ref> -- <path>` — a branch switch is the branch guard's job, not this one's
  }
  if (sub === "merge" || sub === "pull") {
    return !flags.includes("--ff-only"); // fast-forward-only can never leave the tree dirty: it either fast-forwards cleanly or refuses, unchanged
  }
  if (sub === "reset") {
    return !flags.includes("--hard"); // --hard leaves the tree clean at the new HEAD; mixed/soft leave the old diff showing as unstaged/staged
  }
  if (sub === "stash") {
    const first = flags.find((token) => !token.startsWith("-"));
    return first === undefined || MUTATING_STASH_SUBS.has(first); // a bare `git stash` defaults to `push`
  }
  return false;
}

/**
 * Whether one command segment (already stripped of an `env`/`VAR=VAL` prefix) looks like a write, by its
 * `git` subcommand, its first binary, an in-place-edit flag, or bare file redirection.
 *
 * @param segment one command segment (a slice between top-level `;`/`&&`/`||`/`|`/newline separators)
 * @returns whether this segment looks like a write
 */
function segmentLooksLikeWrite({ segment }: { segment: string }): boolean {
  const tokens = stripEnvPrefix({
    tokens: segment
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0),
  });
  const first = tokens[0];
  if (first === undefined) {
    return false;
  }
  const tool = toolName({ first });
  if (tool === "git") {
    return isMutatingGitSegment({ tokens });
  }
  if (FILE_MUTATING_BINARIES.has(tool)) {
    return true;
  }
  if (IN_PLACE_EDIT_BINARIES.has(tool) && tokens.some((token) => token.startsWith("-i"))) {
    return true;
  }
  return hasFileRedirection({ segment });
}

/**
 * Whether the raw command looks like a write, checking every top-level segment of a compound command
 * independently so `git fetch && git merge --ff-only origin/main` reads each half on its own.
 *
 * @param command the raw shell command line
 * @returns whether any segment looks like a write
 */
export function looksLikeMainCheckoutWrite({ command }: { command: string }): boolean {
  return command.split(/;|\n|&&|\|\|?/).some((segment) => segmentLooksLikeWrite({ segment }));
}

/**
 * Decide whether to block one Bash command as a write in the main checkout.
 *
 * @param command the raw shell command line
 * @param cwd the directory the command runs in
 * @param allowOverride whether {@link MAIN_CHECKOUT_WRITE_OVERRIDE_ENV} is set
 * @param checkMainWorktree the protected-checkout check (defaults to {@link isProtectedMainCheckout}, which
 *   is both the topology key and `profile.json`'s declared set; overridable so a caller can inject a fixture
 *   result)
 * @returns the block/allow decision
 */
export function evaluateMainCheckoutDirtyGuard({
  command,
  cwd,
  allowOverride,
  checkMainWorktree = isProtectedMainCheckout,
}: {
  command: string;
  cwd: string;
  allowOverride: boolean;
  checkMainWorktree?: typeof isMainWorktreeForRepository;
}): { readonly block: true; readonly message: string } | { readonly block: false } {
  if (allowOverride || !looksLikeMainCheckoutWrite({ command })) {
    return { block: false };
  }
  const targets = resolveMainCheckoutCommandTargets({ command, cwd });
  for (const segment of targets) {
    const overridden = hasSegmentInlineEnvironmentOverride({
      command,
      name: MAIN_CHECKOUT_WRITE_OVERRIDE_ENV,
      segmentIndex: segment.segmentIndex,
    });
    if (
      segment.cwd !== undefined &&
      segmentLooksLikeWrite({ segment: segment.command }) &&
      checkMainWorktree({ cwd: segment.cwd, repositoryCwd: cwd }) &&
      !overridden
    ) {
      const overriddenElsewhere = targets.some(
        (other) =>
          other.segmentIndex !== segment.segmentIndex &&
          hasSegmentInlineEnvironmentOverride({
            command,
            name: MAIN_CHECKOUT_WRITE_OVERRIDE_ENV,
            segmentIndex: other.segmentIndex,
          }),
      );
      return {
        block: true,
        message: `Slopweaver blocks a write in this repository's main checkout: every other worktree and session reads from it, so leaving it dirty disrupts all of them. Use a dedicated worktree instead (\`cmux spawn\`), or set ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 for this one run.${overriddenElsewhere ? ` (An inline ${MAIN_CHECKOUT_WRITE_OVERRIDE_ENV}=1 is present elsewhere in this command, but scoped to a different segment — each segment needs its own.)` : ""}`,
      };
    }
  }
  return { block: false };
}
