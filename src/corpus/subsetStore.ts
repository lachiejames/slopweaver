/**
 * Reading and writing the subset manifest — the effectful edge around the pure {@link ./subset} module.
 *
 * Kept deliberately tiny and dependency-light, because the READ side is on the query path: every
 * `store read` and every `store cite` run calls {@link readSubsetManifest} before it answers, so this must cost one small file read
 * on a home that is not a subset and nothing else. An absent file is the full-corpus case and comes back as
 * `undefined` rather than as an error; so does a corrupt one, and the two are deliberately the same answer
 * here — {@link parseSubsetManifest} refuses a half-read manifest, and a banner nobody could verify must not
 * be printed on the strength of a file nobody could parse.
 */
import { readJsonFile, writeJsonFile } from "../lib/jsonFile.js";
import { stateHomePaths } from "../stateHome.js";
import { parseSubsetManifest, type SubsetManifest } from "./subset.js";

/**
 * The subset manifest for a home, or `undefined` when the home is an ordinary full corpus.
 *
 * @param home the Slopweaver home to read (defaults to the resolved home)
 * @returns the manifest, or `undefined` when this home is not a subset
 */
export function readSubsetManifest({ home }: { home?: string } = {}): SubsetManifest | undefined {
  const path = stateHomePaths(home === undefined ? {} : { home }).corpus.subset;
  return parseSubsetManifest({ value: readJsonFile({ path }) });
}

/**
 * Write the subset manifest into a home. Throws on an fs failure, which is correct here: the manifest is
 * what makes every later answer off this home say it is a subset, so a home whose records landed and whose
 * manifest did not is exactly the unlabelled partial corpus this feature exists to prevent.
 *
 * @param home the subset home to stamp
 * @param manifest the manifest to write
 */
export function writeSubsetManifest({ home, manifest }: { home: string; manifest: SubsetManifest }): void {
  writeJsonFile({ path: stateHomePaths({ home }).corpus.subset, value: manifest });
}
