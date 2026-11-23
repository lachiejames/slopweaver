/**
 * The Knock atlas's own paths, in a module of their own rather than in `atlasHome.ts`, which the
 * `file-size-ratchet` freezes at its recorded code-line count. `atlasHomeGoogle.ts` is the precedent.
 */
import { KNOCK_ATLAS_KINDS } from "./atlas/knock/kinds.js";
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the Knock atlas's paths.
 *
 * Thirty-two kind files, and the shape of the list is the atlas's own argument: two map the SURFACE — the
 * operations both published APIs declare, and the routes the dashboard's own client declares — and the
 * other thirty are entities, because `docs/atlas-intent/06-holdings.md`'s test comes out "everything reachable"
 * here. `src/atlas/knock/model.ts` carries why.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function knockAtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    // COMPUTED from the kind list rather than written out, the same way the Braze and Datadog
    // rows are: thirty-two hand-written entries would be the largest single thing in `atlasHome.ts`, and a
    // file name that IS the kind cannot drift from it.
    files: Object.fromEntries(KNOCK_ATLAS_KINDS.map((kind) => [kind, `${kind}.jsonl`])),
    platform: "knock",
  });
}
