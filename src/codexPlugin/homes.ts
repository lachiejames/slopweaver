/**
 * Which Codex homes `codex plugin-sync` keeps: every home the plan register names, paused rows included, then
 * the ambient one. Pure.
 *
 * A paused row is still a home a later seat boots on once the pause lifts, so it is kept current like any
 * other. The ambient home (`$CODEX_HOME`, else `~/.codex`) is added here rather than in
 * `../codex/destinations.ts`, which deliberately never returns it: the register names where seats run, the
 * ambient home is where a hand-started `codex` runs, and both load the plugin.
 */
import { resolve } from "node:path";

import type { CodexDestination } from "../codex/destinations.js";

/** One Codex home to keep, and whether the plan register names it. */
export interface CodexPluginHome {
  readonly codexHome: string;
  /** True for a register row, false for the ambient home alone. */
  readonly registered: boolean;
}

/**
 * The homes to keep, in register order then ambient, each resolved path once.
 *
 * Deduplicated by `path.resolve` rather than `realpath`, because a registered home may not exist and is
 * reported as missing rather than skipped. The first spelling is kept, since it is the one `CODEX_HOME` is set to.
 *
 * @param destinations the register's Codex destinations, paused ones included
 * @param ambientCodexHome `$CODEX_HOME` when set, else Codex's own default
 * @returns every home to keep, once each
 */
export function codexPluginHomes({
  ambientCodexHome,
  destinations,
}: {
  ambientCodexHome: string;
  destinations: readonly CodexDestination[];
}): readonly CodexPluginHome[] {
  const seen = new Set<string>();
  const homes: CodexPluginHome[] = [];
  const keep = ({ codexHome, registered }: CodexPluginHome): void => {
    const key = resolve(codexHome);
    if (!seen.has(key)) {
      seen.add(key);
      homes.push({ codexHome, registered });
    }
  };
  for (const destination of destinations) {
    keep({ codexHome: destination.codexHome, registered: true });
  }
  keep({ codexHome: ambientCodexHome, registered: false });
  return homes;
}
