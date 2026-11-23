/**
 * Where THIS BUILD lives on disk — the directory carrying its plugin manifest, found by walking up from a
 * module's own file. No git, deliberately.
 *
 * ## Why this is not a git question
 *
 * Two roots get confused constantly in this codebase, and they answer different questions:
 *
 * - **The checkout the process is STANDING in** — `process.cwd()`'s repository. That is
 *   `./gitRepo.ts`'s `runningCheckoutRoot`, and it is what a spawn plan or a branch report wants.
 * - **The tree this build's own files live in** — this module. It is what "which `skills/` ship with the
 *   code that is running" means, and it must keep working under a marketplace install, where the installer
 *   copies the tree into `~/.claude/plugins/data/<plugin>/mirror/…` with no `.git` anywhere above it.
 *
 * Resolving the second with git is what destroyed a composed and reviewed bot answer
 * (`./gitRepo.ts`'s `runningCheckoutRoot` header carries that incident). Resolving it with `cwd` is the
 * opposite mistake and just as wrong: run the CLI while standing in an unrelated repository and the skills
 * catalogue reads that repository's `skills/` instead of its own.
 *
 * A manifest walk is immune to both, because `.claude-plugin/plugin.json` sits at the top of this tree
 * whether that tree is a git checkout, a worktree, or a plain mirrored directory.
 */
import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/** The manifest whose presence identifies a directory as a Claude Code plugin checkout. */
export const PLUGIN_MANIFEST_RELATIVE_PATH = join(".claude-plugin", "plugin.json");

/**
 * Whether a directory is a plugin checkout `claude --plugin-dir` could actually load.
 *
 * @param root the directory to test
 * @returns true when it carries a plugin manifest
 */
export function isPluginCheckout({ root }: { readonly root: string }): boolean {
  return existsSync(join(root, PLUGIN_MANIFEST_RELATIVE_PATH));
}

/**
 * The root of the tree a module's own file lives in — its nearest ancestor carrying a plugin manifest.
 *
 * Walks up from the module rather than from `cwd`, so it answers "where does the code that is RUNNING keep
 * its `skills/`, its `docs/`, its manifest" — the question `../live/turn/skillCatalogue.ts` asks when it
 * says _"this build's own `skills/`, from the repository root the process is running out of"_.
 *
 * Falls back to `cwd` when no ancestor carries a manifest, and never throws. That fallback is reached by a
 * test fixture or a partial copy rather than by any real install, and handing back a directory that simply
 * has no `skills/` in it is what keeps a soft-failing reader soft-failing.
 *
 * @param importMetaUrl the calling module's `import.meta.url`
 * @param cwd the fallback when no manifest is found above the module; defaults to `process.cwd()`
 * @returns the absolute path of the tree this build lives in
 */
export function installedTreeRoot({
  importMetaUrl,
  cwd = process.cwd(),
}: {
  importMetaUrl: string;
  cwd?: string;
}): string {
  let dir = dirname(fileURLToPath(importMetaUrl));
  const stop = parse(dir).root;
  // Bounded by the filesystem root rather than by a depth guess: `dirname("/")` is `"/"`, so `dir === stop`
  // is the exact moment the walk has nowhere left to go.
  for (;;) {
    if (isPluginCheckout({ root: dir })) {
      return dir;
    }
    if (dir === stop) {
      return cwd;
    }
    dir = dirname(dir);
  }
}

/** The launcher's path inside the tree that carries it — the `bin/slopweaver` shell entry point. */
export const LAUNCHER_RELATIVE_PATH = join("bin", "slopweaver");

/**
 * The absolute path of the `bin/slopweaver` launcher belonging to THIS BUILD.
 *
 * The one name for a value four modules used to spell for themselves as
 * `fileURLToPath(new URL("../../../../bin/slopweaver", import.meta.url))` — a fixed four-level walk that is
 * correct only while every caller sits exactly four directories below the tree root, and that resolves to a
 * plausible-looking path with no type error the moment one of them moves. The manifest walk in
 * {@link installedTreeRoot} is immune to depth for the same reason it is immune to a missing `.git`.
 *
 * ## Use this wherever a launcher path is PRINTED, and never `${CLAUDE_PLUGIN_ROOT}`
 *
 * `CLAUDE_PLUGIN_ROOT` is substituted by the Claude Code harness when it reads a `SKILL.md`, so the
 * `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` form every skill uses is correct THERE and must stay. It is not
 * exported into any shell, and a command this code prints is read by a shell.
 *
 * MEASURED: `turn resume`'s worker
 * brief step 0a and `turn sweepCard`'s `card-stale:` remedy both emitted that literal. A worker pasted step
 * 0a verbatim, the empty variable left `/bin/slopweaver`, and because the line ends in `&` the shell
 * backgrounded the failure and reported exit 0 — so the automated remedy was silently inert in exactly the
 * case it was built for, a card whose clock nobody had started. `echo "$CLAUDE_PLUGIN_ROOT"` is empty in
 * both the worker's shell and the loop's. `docs/install-stays-current/running-sessions-and-cli.md` had already drawn the
 * agent-reads-it / shell-reads-it distinction without anyone applying it to those two lines; the
 * `unexpanded-plugin-root` gate (`../devLint/unexpandedPluginRoot.ts`) is what applies it now.
 *
 * @param importMetaUrl the calling module's `import.meta.url`, the anchor the walk starts from
 * @returns the absolute path of this build's launcher
 */
export function bundledLauncherPath({ importMetaUrl }: { importMetaUrl: string }): string {
  return join(installedTreeRoot({ importMetaUrl }), LAUNCHER_RELATIVE_PATH);
}
