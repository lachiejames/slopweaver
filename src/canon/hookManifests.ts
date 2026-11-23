/**
 * The hook manifests this plugin ships, and which host reads each.
 *
 * Claude Code reads `hooks/hooks.json` and nothing else. Codex reads whatever `.codex-plugin/plugin.json`'s
 * `hooks` names, which REPLACES its default of `hooks/hooks.json` — so that list must name the shared file
 * first, or every guard silently stops running in Codex. `hooks/codex-hooks.json` holds what only Codex may
 * run: its `SessionStart` rules injection would load every rule a second time in Claude, whose own docs warn
 * against a `SessionStart` hook that prints instruction files. Codex sets `CLAUDE_PLUGIN_ROOT` too, so a hook
 * cannot tell the hosts apart at run time and the file boundary is the only one there is.
 *
 * MEASURED (codex-cli 0.157.1) in a throwaway `CODEX_HOME`: naming both files in the manifest left
 * every `hooks/hooks.json` trust key and `currentHash` byte-identical to the manifest-less install, so the
 * split costs one new `/hooks` approval and re-opens none of the old ones.
 */

/** The manifest both hosts read. */
export const SHARED_HOOK_MANIFEST = "hooks/hooks.json";

/** The manifest only Codex reads, named from `.codex-plugin/plugin.json`. */
export const CODEX_ONLY_HOOK_MANIFEST = "hooks/codex-hooks.json";

/** Every hook manifest the plugin ships — what a gate over registered hook commands must read. */
export const HOOK_MANIFESTS: readonly string[] = [SHARED_HOOK_MANIFEST, CODEX_ONLY_HOOK_MANIFEST];

/** What `.codex-plugin/plugin.json`'s `hooks` field must say, in order: the shared file first. */
export const CODEX_PLUGIN_HOOKS: readonly string[] = HOOK_MANIFESTS.map((path) => `./${path}`);
