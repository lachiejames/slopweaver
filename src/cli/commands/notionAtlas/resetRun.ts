/**
 * `slopweaver atlas notion reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Notion's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetNotionAtlas } from "../../../atlas/notion/reset.js";
import { notionAtlasPaths } from "../../../atlas/notion/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NOTION_RESET_USAGE = "usage: slopweaver atlas notion reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Notion atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function notionAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "notion",
    reset: ({ home, at }) => resetNotionAtlas({ at, paths: notionAtlasPaths({ home }) }),
    usage: NOTION_RESET_USAGE,
  });
}
