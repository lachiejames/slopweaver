/**
 * The loud recurring run: the `pre-push` hook that makes a standing memory defect impossible to ignore, and
 * the decisions about installing it. The two filesystem edges are at the bottom.
 *
 * ## What this gates, and what it deliberately does NOT
 *
 * The aim is to run `memory check` on a pre-push hook in the state repository, so a defect cannot be committed
 * to the state repo and sit there. MEASURED, the second half of
 * that aim is not true of this machine and the hook must not pretend otherwise:
 *
 * ```bash
 * git -C ~/.claude rev-parse --show-toplevel       # fatal: not a git repository
 * git -C ~/.slopweaver ls-files | grep -i memor    # artifacts and handover docs only
 * ```
 *
 * The auto-memory corpus lives at `~/.claude/projects/<project>/memory`, which is not a git repository at
 * all and is tracked by no other one. So this hook gates NOTHING about what is being pushed. What it is, and
 * all it is, is a loud run riding the one repository this fleet pushes often — the true half of the aim
 * is that nothing fails loudly between reviews, and that is what this closes. A
 * reader who infers a coupling between the push and the corpus has been misled, so the installed script says
 * so in its own first comment.
 *
 * ## Why the binary path is BAKED IN at install time
 *
 * Every `PreToolUse` shim in `scripts/` reaches the CLI through
 * `$PLUGIN_DATA/mirror/current/bin/slopweaver`, because a gate is fleet policy and must not depend on which
 * worktree happens to be current (`hooks/lib/guard-root.sh`). A git hook cannot do the same thing, and
 * writing one that did was the first attempt here: MEASURED, this machine has no
 * `~/.claude/plugins/data/slopweaver/mirror` at all, so the installed hook resolved nothing, took its own
 * fail-open branch and exited 0 on every push — installed, and completely inert. An inert gate that reports
 * success is worse than no gate.
 *
 * So `--install` RESOLVES the binary once, at install time, and writes the resolved absolute path into the
 * script. The ORDER it resolves in is the second thing that was wrong here: the running tree is the LAST
 * candidate rather than the first, because this verb is ordinarily run from a throwaway worktree and baking
 * that path in installs a hook that stops working the day the worktree is pruned. The mirror comes first,
 * the DECLARED main checkouts come second (`profile.json`, the same register `checkout status` and `doctor`
 * read), and only then whatever tree is running — and every one of them must ANSWER the verb, not merely
 * exist ({@link launcherAnswersGate}). Re-running `--install` is how the path is corrected after a
 * reinstall, which is why a refresh is a normal outcome rather than a refusal.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";

/**
 * The line that marks a hook as this verb's own. Presence is what makes re-installing safe and clobbering
 * somebody else's hook impossible — a hook file without it was written by something else, and overwriting it
 * silently is exactly the "cheap instance fix that hides the class problem" this whole change refuses.
 */
export const PRE_PUSH_MARKER = "# slopweaver-memory-gate";

/**
 * The hook script, for one already-resolved CLI path.
 *
 * It still exits 0 when that path has since disappeared, so a machine mid-reinstall cannot have every push
 * wedged by a gate it cannot run — the same fail-open shape as every `PreToolUse` shim in `scripts/`. The
 * difference from the first draft is that the path is one this installer PROVED both existed and answered
 * the verb, so the fail-open branch is now a genuine edge case rather than the only branch.
 *
 * @param binary the absolute path of the `slopweaver` launcher this hook should run
 * @returns the whole script, ready to write
 */
export function prePushScript({ binary }: { binary: string }): string {
  return `#!/usr/bin/env bash
${PRE_PUSH_MARKER} — installed by \`slopweaver memory gate --install\`; re-run it to update this file.
#
# This gates NOTHING about what is being pushed. The Claude auto-memory corpus lives under
# ~/.claude/projects/<project>/memory, which is not a git repository and is tracked by no other one. This
# hook rides the repository the fleet pushes often, so a standing memory defect cannot sit unnoticed between
# corpus reviews. Bypass one push with \`git push --no-verify\`; run \`slopweaver memory gate\` yourself to see
# the findings and the escape hatch that names the legitimate exceptions.
#
# The CLI path below was resolved and checked when this file was written. Re-run the installer to correct it.
set -uo pipefail

SLOPWEAVER=${JSON.stringify(binary)}
[ -x "$SLOPWEAVER" ] || exit 0

exec "$SLOPWEAVER" memory gate
`;
}

/** What installing would do to whatever is already at the hook path. */
export type PrePushInstallVerdict =
  /** Nothing is there — write it. */
  | { readonly action: "install" }
  /** This verb's own hook is there — rewrite it, so a corrected CLI path reaches an installed machine. */
  | { readonly action: "refresh" }
  /** Something else's hook is there. Never overwritten; the operator is told what stands. */
  | { readonly action: "refuse"; readonly reason: string };

/**
 * Decide what to do about whatever currently occupies the hook path.
 *
 * @param existing the current file's contents, or `null` when there is no file
 * @returns the verdict, which is `refuse` for any hook this verb did not write
 */
export function prePushInstallVerdict({ existing }: { existing: string | null }): PrePushInstallVerdict {
  if (existing === null) {
    return { action: "install" };
  }
  if (existing.includes(PRE_PUSH_MARKER)) {
    return { action: "refresh" };
  }
  return {
    action: "refuse",
    reason:
      "a pre-push hook is already installed there and it is not this one — merge the two by hand rather than losing whatever it does",
  };
}

/**
 * Where the plugin keeps its installed mirror, read from the environment the shims read.
 *
 * @internal — `gateBinaryCandidates` is the only caller; exported nowhere because the ORDER of the candidates
 * is the contract, not any one of them.
 *
 * Spelled as explicit branches rather than a `??` chain: `no-silent-fallback` refuses one, and here the
 * reason bites — which of the three answered is exactly what a wrong path later needs to be traceable to.
 *
 * @param env the environment
 * @param userHome the current user's home directory
 * @returns the plugin-data directory
 */
export function pluginDataDir({
  env,
  userHome,
}: {
  env: Readonly<Record<string, string | undefined>>;
  userHome: string;
}): string {
  const explicit = env["PLUGIN_DATA"];
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const claudeSide = env["CLAUDE_PLUGIN_DATA"];
  if (claudeSide !== undefined && claudeSide !== "") {
    return claudeSide;
  }
  return join(userHome, ".claude", "plugins", "data", "slopweaver");
}

/**
 * The launcher paths to try, best first.
 *
 * The mirror comes first because a gate is fleet policy and should run the installed plugin rather than
 * whichever worktree happened to install it. A DECLARED main checkout comes next: it is the durable checkout
 * this install already promises to keep current. The running tree is LAST, because this verb is ordinarily
 * run from a throwaway worktree and a hook baked against one stops working the day it is pruned.
 *
 * @param env the environment
 * @param userHome the current user's home directory
 * @param treeRoot the root of the tree this module was loaded from
 * @param declaredCheckouts the declared main checkouts, injected so this stays pure
 * @returns the candidate launcher paths, in preference order
 */
export function gateBinaryCandidates({
  env,
  userHome,
  treeRoot,
  declaredCheckouts,
}: {
  env: Readonly<Record<string, string | undefined>>;
  userHome: string;
  treeRoot: string;
  declaredCheckouts: readonly string[];
}): readonly string[] {
  return [
    join(pluginDataDir({ env, userHome }), "mirror", "current", "bin", "slopweaver"),
    ...declaredCheckouts.map((checkout) => join(checkout, "bin", "slopweaver")),
    join(treeRoot, "bin", "slopweaver"),
  ];
}

/**
 * The root of the tree this module was loaded from — the nearest ancestor holding `bin/slopweaver`.
 *
 * Walked rather than resolved through git, deliberately: a marketplace plugin mirror carries no `.git` at
 * all, so the shared git-root helper in `lib/gitRepo.ts` throws there, and the thing actually being looked
 * for is the launcher rather than a repository.
 *
 * @param moduleUrl this module's `import.meta.url`
 * @returns the tree root, or `null` when no ancestor holds a launcher
 */
export function treeRootHoldingLauncher({ moduleUrl }: { moduleUrl: string }): string | null {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(dir, "bin", "slopweaver"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Whether a launcher actually ANSWERS `memory gate`.
 *
 * Existence is not support, and the difference is not theoretical. MEASURED: resolving the
 * declared main checkout — which is the durable one, and correctly preferred over a throwaway worktree —
 * installed a hook running a launcher whose branch has no `gate` verb, so every push out of the state
 * repository would have been refused by the noun router printing `usage: slopweaver memory <verb>` and
 * exiting 2. An inert gate was the first defect here; a gate that blocks every push with a usage error is
 * the opposite one, and both come from treating a path as a capability.
 *
 * `--help` is the probe because it is the one form of this verb that reads nothing and writes nothing:
 * `gate` itself walks every corpus on the machine, and installing something must not be a way to run it.
 *
 * Reproduce against any checkout:
 *
 * ```bash
 * <checkout>/bin/slopweaver memory gate --help; echo "exit=$?"
 * ```
 *
 * @param binary the launcher path to probe
 * @returns whether it exits 0 and names this verb
 */
export function launcherAnswersGate({ binary }: { binary: string }): boolean {
  const probe = spawnSync(binary, ["memory", "gate", "--help"], {
    encoding: "utf8",
    timeout: GATE_PROBE_TIMEOUT_MS,
  });
  if (probe.status !== 0) {
    return false;
  }
  return probe.stdout.includes("memory gate");
}

/**
 * How long the support probe may take. Generous because the launcher starts `tsx`, which is seconds rather
 * than milliseconds — MEASURED, a WARM one on this machine took 2.203s elapsed, and an install
 * pays that per candidate:
 *
 * ```bash
 * time bin/slopweaver memory gate --help
 * ```
 *
 * The timeout exists so a wedged candidate cannot hang an install, never to judge how fast a launcher is,
 * which is why it sits an order of magnitude above the measurement rather than beside it.
 */
const GATE_PROBE_TIMEOUT_MS = 30_000;

/**
 * The first candidate that both exists and answers `memory gate`.
 *
 * Preference order is honoured strictly: a higher candidate that exists but does not answer the verb is
 * SKIPPED rather than accepted, which is the whole point — see {@link launcherAnswersGate}.
 *
 * @param candidates the launcher paths, in preference order
 * @returns the first usable launcher, or `null` when none of them is
 */
export function firstAnsweringGate({ candidates }: { candidates: readonly string[] }): string | null {
  const found = candidates.find((candidate) => existsSync(candidate) && launcherAnswersGate({ binary: candidate }));
  // An `if` rather than `found ?? null`: `no-silent-fallback` refuses the coalesce and
  // `prefer-nullish-coalescing` refuses the ternary that would replace it, so the shape both gates accept is
  // the one that names the absent case out loud.
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * Read whatever hook file stands at a path.
 *
 * @param path the hook path
 * @returns the contents, or `null` when nothing is there
 */
export function readExistingHook({ path }: { path: string }): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * Write the hook, executable.
 *
 * @param path the hook path
 * @param binary the resolved launcher path to bake in
 * @returns nothing on success, or a typed I/O error
 */
export function writePrePushHook({ path, binary }: { path: string; binary: string }): Result<void, IngestError> {
  return safeFs({
    execute: (): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, prePushScript({ binary }), "utf8");
      chmodSync(path, 0o755);
    },
    operation: "memory.installPrePush",
    path,
  });
}
