/**
 * Which route a spawned session LOADS Slopweaver by — the marketplace install, or `claude --plugin-dir`
 * pointed at a checkout. Pure, plus two existence seams.
 *
 * ## The route, and the rule that sets it
 *
 * The marketplace plugin loads by default, and dogfooding stays allowed. So the flag is passed for exactly one case, a worktree cut from a
 * repository that carries a plugin manifest, and every other spawn loads the installed plugin.
 *
 * What that ruling was answering, measured the same day across the 50 live workspaces: Slopweaver was
 * installed as a plugin nowhere on this machine and every session ran from the flag, 30 of those 50 trees
 * were ten or more commits behind `origin/main`, the worst 130 behind, and two loaded no skills at all.
 * A flag pins a session to whichever tree the hand that spawned it happened to be standing in; an install
 * is one tree the whole fleet shares.
 *
 * ## What went, and why the fallback was the defect rather than a safety net
 *
 * This module used to hand a NON-Slopweaver target the SPAWNER's own repository root, so a session opened
 * into a worktree of another repository followed the skill prose of whichever Slopweaver checkout typed the
 * command. That is the failure this file exists for, kept alive in a smaller form: a
 * freshly-respawned Slack loop ran its CLI out of that day's own worktree while FOLLOWING
 * skill prose from a two-day-old one, sixty-three commits older. Under the marketplace route
 * there is nothing to inherit, so the fallback is gone rather than narrowed.
 *
 * Its removal takes a `git rev-parse` off the spawn path with it. The lookup used to be the reason this
 * decision had to be made BEFORE `cmux spawn` printed `reusing worktree` — resolving a module's own
 * directory throws under a marketplace install, where the installer copies source files into
 * `~/.claude/plugins/data/<plugin>/mirror/…` as a plain directory tree with no `.git` at all. Nothing here
 * shells out any more, so {@link pluginDirForSpawn} is a predicate and a string.
 *
 * ## The install is state, not code, so the spawn PROBES it
 *
 * The marketplace half of this ruling lives outside the repository, in `~/.claude/plugins`. A session
 * spawned with no flag and no install has no Slopweaver at all, which is a failure nothing downstream can
 * report intelligibly, so {@link installedPluginNames} reads that state and `cmux spawn` refuses up front
 * and names the install command. The probe is deliberately narrow — it answers whether the plugin is
 * INSTALLED, never whether the host has it enabled for the session about to open.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPluginCheckout } from "../lib/pluginRoot.js";

/** The plugin name a marketplace install of this repository registers itself under. */
const SLOPWEAVER_PLUGIN_NAME = "slopweaver";

/** Where Claude Code records which plugins are installed, relative to its own config directory. */
const INSTALLED_PLUGINS_RELATIVE_PATH = join("plugins", "installed_plugins.json");

/**
 * Which directory a spawn should pass to `claude --plugin-dir`, or `undefined` to load the marketplace
 * install instead.
 *
 * The test is made against the REPOSITORY the worktree is cut from, never against the worktree itself: a
 * spawn decides this before `ensureWorktree` has run, so a brand-new worktree carries no manifest yet and
 * testing it directly would answer `undefined` on every first spawn of a Slopweaver branch. A worktree of a
 * plugin checkout is a plugin checkout.
 *
 * @param cwd the working directory the session is being opened in — its own worktree
 * @param targetRepoIsPluginCheckout whether the repository `cwd` is a worktree OF carries a plugin manifest
 *   (see {@link isPluginCheckout}); passed in rather than tested here so the decision stays pure
 * @returns the directory to pass to `claude --plugin-dir`, or `undefined` for the marketplace route
 */
export function pluginDirForSpawn({
  cwd,
  targetRepoIsPluginCheckout,
}: {
  readonly cwd: string;
  readonly targetRepoIsPluginCheckout: boolean;
}): string | undefined {
  return targetRepoIsPluginCheckout ? cwd : undefined;
}

/**
 * The whole load-route decision for a spawn against a specific target repo — what `cmux spawn`, the
 * recipe scheduler and every fresh-session dispatch reach through, wired once so none of them restates it.
 *
 * @param cwd the worktree the session is being opened in — its own worktree
 * @param repoRoot the repository the worktree was cut from — tested for a plugin manifest
 * @returns the directory to pass to `claude --plugin-dir`, or `undefined` for the marketplace route
 */
export function pluginDirForSpawnTarget({
  cwd,
  repoRoot,
}: {
  readonly cwd: string;
  readonly repoRoot: string;
}): string | undefined {
  return pluginDirForSpawn({ cwd, targetRepoIsPluginCheckout: isPluginCheckout({ root: repoRoot }) });
}

/**
 * The plugin names one `installed_plugins.json` document records, with the marketplace suffix stripped.
 *
 * Reads only what it needs from a shape this repository does not own, so an unrecognised document answers
 * with an empty list rather than throwing. A missing key, a `plugins` value that is not an object and a
 * malformed entry are all the same answer to the one question being asked, which is whether a NAME is
 * present.
 *
 * @param document the parsed contents of Claude Code's `installed_plugins.json`
 * @returns every installed plugin's bare name, in document order
 */
export function installedPluginNames({ document }: { readonly document: unknown }): readonly string[] {
  if (typeof document !== "object" || document === null) {
    return [];
  }
  const plugins = (document as { readonly plugins?: unknown }).plugins;
  if (typeof plugins !== "object" || plugins === null) {
    return [];
  }
  // `split` with a separator always answers at least one piece, so the bare name is always there to read.
  return Object.keys(plugins).map((key) => key.split("@")[0]!);
}

/**
 * Whether this machine carries a marketplace install of Slopweaver — the route a spawn takes when
 * {@link pluginDirForSpawnTarget} answers `undefined`.
 *
 * Answers `false` for an unreadable or absent record rather than throwing, because the caller's next move
 * is the same either way: say the install is missing and name the command that makes one.
 *
 * @param claudeDir Claude Code's own config directory, normally `~/.claude`
 * @returns whether an installed plugin named `slopweaver` is recorded there
 */
export function slopweaverPluginInstalled({ claudeDir }: { readonly claudeDir: string }): boolean {
  const path = join(claudeDir, INSTALLED_PLUGINS_RELATIVE_PATH);
  if (!existsSync(path)) {
    return false;
  }
  const document = ((): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return undefined;
    }
  })();
  return installedPluginNames({ document }).includes(SLOPWEAVER_PLUGIN_NAME);
}

/**
 * The refusal a spawn owes when this plan has NO route to Slopweaver at all, or `undefined` when it has one.
 *
 * A worktree of a repository that is not a Slopweaver checkout carries no `--plugin-dir` and loads the
 * marketplace install instead. That install is machine state rather than code, so it can simply be absent —
 * and a session opened without it boots a `claude` with no skills, no commands and no hooks, which is a
 * failure nothing downstream can describe. `cmux spawn` calls this BEFORE it creates a worktree or a tab,
 * for the same reason its Codex quota check is there.
 *
 * Pure, so the two probes stay at the caller: which route the plan takes is a manifest question and whether
 * the install exists is a machine-state one, and neither is a decision this sentence should make twice.
 *
 * @param pluginDir what {@link pluginDirForSpawnTarget} answered for this plan
 * @param installed whether {@link slopweaverPluginInstalled} found a marketplace install
 * @param repoRoot the repository the worktree is cut from, named in the refusal so a reader can check it
 * @returns the refusal reason, or `undefined` when the spawn may proceed
 */
export function spawnLoadRouteRefusal({
  pluginDir,
  installed,
  repoRoot,
}: {
  readonly pluginDir: string | undefined;
  readonly installed: boolean;
  readonly repoRoot: string;
}): string | undefined {
  if (pluginDir !== undefined || installed) {
    return undefined;
  }
  return (
    `${repoRoot} is not a Slopweaver checkout, so this session would load the marketplace install, and no ` +
    `plugin named ${SLOPWEAVER_PLUGIN_NAME} is installed on this machine. Install it with ` +
    `\`claude plugin install ${SLOPWEAVER_PLUGIN_NAME}@slopweaver-dev\` and spawn again`
  );
}
