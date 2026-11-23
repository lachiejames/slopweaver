/**
 * One platform's atlas paths, resolved from the platform NAME a generic verb was given.
 *
 * The home's atlas sub-tree is keyed in each resolver's own camel case (`geminiAiStudio`) while the registry
 * is keyed by platform name (`gemini-ai-studio`), and the one thing both agree on is the DIRECTORY — which
 * `atlasHome.ts` builds from the platform name itself. Matching on it keeps a generic verb from needing a
 * second name table to drift against, and there is no place to derive a home path here: `stateHome.ts`
 * stays the only contract, and this reads what it already built.
 *
 * Shared rather than private because two generic verbs now need it — `atlas doctor` repairs by it and
 * `atlas freshness` reads a manifest clock by it — and the clone ratchet is right that the second copy is
 * where a name table starts.
 */
import { basename } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/** The paths a generic verb needs out of one platform's atlas sub-tree. */
export interface AtlasPlatformDirectories {
  readonly root: string;
  readonly kinds: Readonly<Record<string, string>>;
  readonly manifest: string;
  readonly superseded: string;
}

/**
 * Find one platform's atlas directory and the paths hanging off it.
 *
 * @param platform the registry's own platform name, which is also the directory name
 * @param home the state home to resolve against, or `undefined` for the ambient one
 * @returns that platform's paths, or `null` when no resolver names that directory
 */
export function atlasPathsFor({
  platform,
  home,
}: {
  platform: string;
  home: string | undefined;
}): AtlasPlatformDirectories | null {
  const tree = stateHomePaths(home === undefined ? {} : { home }).atlas;
  for (const value of Object.values(tree)) {
    if (typeof value === "string") {
      continue;
    }
    if (basename(value.root) === platform) {
      return value;
    }
  }
  return null;
}
