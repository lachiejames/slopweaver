/**
 * The WorkOS atlas's own paths, in a module of their own rather than in `atlasHome.ts`, so that file sits
 * under the `file-size-ratchet` cap. `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the WorkOS atlas's paths.
 *
 * ONE artifact directory, `artifacts/pages`, and it is the only one this atlas needs: what it holds beyond
 * names is a dashboard screenshot, and the API half's own evidence is a status code and a body shape rather
 * than bytes worth keeping. `sensitive` resolves like every other platform's and is expected to stay empty —
 * this atlas stores route names, parameter names, page addresses and verdicts, and never a key, a secret or
 * a token value.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function workosAtlasPaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      connection: "connections.jsonl",
      directory: "directories.jsonl",
      operation: "operations.jsonl",
      organization: "organizations.jsonl",
      page: "pages.jsonl",
      user: "users.jsonl",
    },
    platform: "workos",
  });
}
