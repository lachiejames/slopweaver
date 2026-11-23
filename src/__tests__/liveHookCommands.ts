/**
 * The plugin-relative paths a LIVE seat's `hooks.json` can name, and the parser that reads them out of one.
 *
 * A seat reads `hooks.json` ONCE, at boot, and then re-resolves those command paths against the mirror for
 * the rest of its life. So the set a mirror has to carry is not "what the checked-out `hooks.json` names"
 * but "what any hooks.json a live seat booted from names", and the two diverge every time the hook surface
 * is reshaped. MEASURED once: ten `scripts/pretooluse-*.sh` entries were folded
 * into one, and a seat booted before that fold keeps naming all ten forever. They ship as
 * compatibility shims for exactly that reason; nothing checked that they stay.
 */

import { z } from "zod";

/**
 * The ten PreToolUse command paths a seat booted before the fold still names.
 *
 * These are the shims `scripts/pretooluse-<id>.sh`, each `exec`ing `pretooluse.sh --only <id>`. They are
 * scaffolding for ONE migration: delete the roster and the files together, the moment no live seat can
 * still be holding a pre-fold `hooks.json` — never one without the other, which is the drop this list
 * exists to make loud.
 */
export const PRE_FOLD_PRETOOLUSE_COMMANDS: readonly string[] = [
  "scripts/pretooluse-admit.sh",
  "scripts/pretooluse-agent-tool-ban.sh",
  "scripts/pretooluse-browser-door-guard.sh",
  "scripts/pretooluse-cmux-send-supervisor-guard.sh",
  "scripts/pretooluse-main-checkout-dirty-guard.sh",
  "scripts/pretooluse-main-checkout-edit-guard.sh",
  "scripts/pretooluse-main-checkout-guard.sh",
  "scripts/pretooluse-memory-write-guard.sh",
  "scripts/pretooluse-poll-gate.sh",
  "scripts/pretooluse-session-depth-warning.sh",
];

/*
 * One quoted mirror path, captured back to the part a mirror has to carry.
 *
 * GLOBAL, because a command names TWO of them:`scripts/hook.sh` and the target it
 * wraps. A non-global match read the entry point and stopped, so the mirror could have dropped every
 * target a hook actually runs and this check would still have reported itself complete.
 */
const MIRRORED_COMMAND = /\/mirror\/[^"]*\/current\/([^"]+)"/gu;

/**
 * The shape Claude Code's own `hooks.json` has: event name to matcher groups to the commands each runs.
 *
 * Parsed rather than asserted, because an assertion over `JSON.parse`'s `unknown` would read a RESHAPED
 * hooks.json as an empty command set — and an empty set passes every assertion the mirror test makes.
 * A file this cannot parse throws here, naming the field, instead of reporting a mirror that carries
 * nothing as complete.
 */
const hooksFileSchema = z.object({
  hooks: z.record(z.string(), z.array(z.object({ hooks: z.array(z.object({ command: z.string() })) }))),
});

/**
 * Every plugin-relative path the given `hooks.json` reaches for inside the mirror.
 *
 * SessionStart's own `plugin-mirror-sync.sh` and `plugin-install-deps.sh` entries are deliberately absent:
 * they run from `$PLUGIN_ROOT` directly, because they are what BUILDS the mirror. Only a command naming
 * `/mirror/…/current/` is one the mirror is responsible for.
 *
 * Every other command names TWO such paths —`scripts/hook.sh`, the one entry point, and
 * the target it wraps — and both are returned.
 *
 * @param hooksJson the file's text, read from the shipped tree rather than a copy
 * @returns each distinct path, sorted, relative to a plugin root
 */
export function mirroredHookCommands({ hooksJson }: { hooksJson: string }): readonly string[] {
  const parsed: unknown = JSON.parse(hooksJson);
  const { hooks } = hooksFileSchema.parse(parsed);
  const commands = Object.values(hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
  const paths: string[] = [];
  for (const { command } of commands) {
    for (const match of command.matchAll(MIRRORED_COMMAND)) {
      paths.push(match[1]!);
    }
  }
  return [...new Set(paths)].toSorted();
}
