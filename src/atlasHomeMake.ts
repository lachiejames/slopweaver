/**
 * The Make atlas's own paths, in a module of their own rather than in `atlasHome.ts`, which is frozen at its
 * recorded code-line count by the `file-size-ratchet` — `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Make atlas's paths: one kind file per kind `src/atlas/make/model.ts` names, which its store
 * test pins key for key.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function makeAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      connection: "connections.jsonl",
      execution: "executions.jsonl",
      folder: "folders.jsonl",
      hook: "hooks.jsonl",
      organization: "organizations.jsonl",
      scenario: "scenarios.jsonl",
      team: "teams.jsonl",
    },
    platform: "make",
  });
}
