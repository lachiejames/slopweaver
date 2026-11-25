/**
 * Which Codex homes `codex plugin-sync` keeps: every home the plan register names, paused rows included, then
 * the ambient one, and whether one overlaps the export. `codexPluginHomes` and `pathWithin` are pure;
 * `homeOverlappingExport` reads the filesystem to follow links (`./realPath.ts`).
 *
 * A paused row is still a home a later seat boots on once the pause lifts, so it is kept current like any
 * other. The ambient home (`$CODEX_HOME`, else `~/.codex`) is added here rather than in
 * `../codex/destinations.ts`, which deliberately never returns it: the register names where seats run, the
 * ambient home is where a hand-started `codex` runs, and both load the plugin.
 *
 * {@link pathWithin} compares paths as given. {@link homeOverlappingExport} hands it each side's
 * {@link landingPath}, so a home reached through a link into the export root — a dangling one included — is
 * caught; the residue is `./realPath.ts`'s.
 */
import { resolve, sep } from "node:path";

import type { CodexDestination } from "../codex/destinations.js";

import { landingPath } from "./realPath.js";

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

/**
 * Whether `inner` is `outer` itself or lies anywhere beneath it, by resolved path.
 *
 * @returns true for the path itself or a descendant, false for a sibling that merely shares a prefix
 */
export function pathWithin({ inner, outer }: { inner: string; outer: string }): boolean {
  const resolvedInner = resolve(inner);
  const resolvedOuter = resolve(outer);
  return resolvedInner === resolvedOuter || resolvedInner.startsWith(`${resolvedOuter}${sep}`);
}

/**
 * The first home that is the export root, holds it, or sits inside it, each compared where it really lands.
 * Creating the export root with `mkdir -p` would create such a home, or fill it with Slopweaver's export, so the
 * run refuses before writing.
 *
 * @param homes every Codex home the run keeps
 * @param exportRoot the directory each HEAD export is written under
 * @returns the overlapping home, or undefined when every home is apart from the export
 */
export function homeOverlappingExport({
  homes,
  exportRoot,
}: {
  homes: readonly CodexPluginHome[];
  exportRoot: string;
}): CodexPluginHome | undefined {
  const exportLanding = landingPath({ path: exportRoot });
  return homes.find(({ codexHome }) => {
    const homeLanding = landingPath({ path: codexHome });
    return (
      pathWithin({ inner: exportLanding, outer: homeLanding }) ||
      pathWithin({ inner: homeLanding, outer: exportLanding })
    );
  });
}
