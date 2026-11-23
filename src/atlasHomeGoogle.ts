/**
 * The three Google atlases' own paths — Google Admin, Google SecOps and Google AI Studio — in a module of
 * their own rather than in `atlasHome.ts`, which grows by one function per atlas with no ceiling and is
 * frozen at its recorded code-line count by the `file-size-ratchet`. `atlasHomeInngest.ts` and
 * `atlasHomeJumpcloud.ts` are the precedent; moving Google Admin's resolver here with the newcomer is what
 * let SecOps land without that file growing, and AI Studio's move is what let Make.
 */
import { GEMINI_AI_STUDIO_KINDS } from "./atlas/geminiAiStudio/model.js";
import { GOOGLE_ADMIN_ATLAS_KINDS } from "./atlas/googleAdmin/model.js";
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Gemini / Google AI Studio atlas's paths.
 *
 * The directory is `gemini-ai-studio`, matching the platform name the catalogue keys on, rather than the
 * camel-case module directory — a reader who ran `slopweaver atlas gemini-ai-studio read` should find the
 * files under the name they typed.
 *
 * The kind map is COMPUTED from `GEMINI_AI_STUDIO_KINDS` rather than written out, the same way the Datadog
 * and Microsoft 365 resolvers compute theirs: a second copy of a kind list is a checked duplicate, and a
 * checked duplicate is still a duplicate.
 *
 * `spec/` holds the published discovery documents this atlas compiles from, cached by the digest of their
 * own bytes (`atlas/geminiAiStudio/specSource.ts`). It sits inside the atlas root rather than beside it
 * because it is this atlas's own input and nothing else reads it, and it needs no key here for the same
 * reason. `sensitive` stays empty: every field this atlas stores is a name.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function geminiAiStudioAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: Object.fromEntries(GEMINI_AI_STUDIO_KINDS.map((kind) => [kind, `${kind}.jsonl`])),
    platform: "gemini-ai-studio",
  });
}

/**
 * Resolve the Google Admin atlas's paths.
 *
 * The file map is COMPUTED from `GOOGLE_ADMIN_ATLAS_KINDS` rather than written out, the way
 * `datadogAtlasPaths` is, and here it is not close: eighty-three lines whose only content is a
 * repetition of the kind list are eighty-three lines that silently drift from it. The kinds are Google's
 * own resource nouns prefixed by the API that declares them, so the directory reads as the Admin console
 * does — `directory-users.json`, `chrome-management-telemetry-devices.json`, `vault-matters-holds.json`.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function googleAdminAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  const files: Record<string, string> = {};
  for (const kind of GOOGLE_ADMIN_ATLAS_KINDS) {
    files[kind] = `${kind}.jsonl`;
  }
  return atlasPlatformPaths({ atlasRoot, files, platform: "google-admin" });
}

/**
 * Resolve the Google SecOps atlas's paths: one kind file per family behind the pinned Chronicle v1 GET rows,
 * which `src/atlas/googleSecops/model.ts` names and its store test pins key for key.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function googleSecopsAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      dashboard: "dashboards.jsonl",
      "data-access": "data-access.jsonl",
      "data-table": "data-tables.jsonl",
      feed: "feeds.jsonl",
      "findings-refinement": "findings-refinements.jsonl",
      instance: "instances.jsonl",
      "reference-list": "reference-lists.jsonl",
      rule: "rules.jsonl",
      watchlist: "watchlists.jsonl",
    },
    platform: "google-secops",
  });
}
