/**
 * A declared checkout for a throwaway home, and the `profile.json` declaring it. Two ways to give it an `origin`: a real
 * `git init` with a remote (`checkoutWithOrigin`), which one witness keeps so the real read is still proven, or a plain
 * directory with a fake `originOf` (`plainCheckout`, `originsAt`), which every other case uses. A git spawn per read
 * under a loaded run is what made these files flake, and the `originOf` seam is what `ownRepository.ts` threads.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { gitInTemp } from "./tempGitRepo.js";

/**
 * A fresh git checkout whose `origin` is one repository, or no remote at all.
 *
 * @param slug the `owner/name` its origin names; `null` adds no remote
 * @returns the checkout's path, inside this test file's temp sandbox
 */
export function checkoutWithOrigin({ slug }: { readonly slug: string | null }): string {
  const checkout = mkdtempSync(join(tmpdir(), "own-repository-checkout-"));
  gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
  if (slug !== null) {
    gitInTemp({ args: ["remote", "add", "origin", `https://github.com/${slug}.git`], cwd: checkout });
  }
  return checkout;
}

/**
 * A plain directory to declare as a checkout, with no git in it — its `origin` comes from {@link originsAt}.
 *
 * @returns the directory's path, inside this test file's temp sandbox
 */
export function plainCheckout(): string {
  return mkdtempSync(join(tmpdir(), "own-repository-checkout-"));
}

/**
 * A fake `originOf` answering each listed checkout's slug, keyed by REAL path so a declared path the profile reader
 * canonicalises (macOS's `/var` is `/private/var`) still matches. Any other directory has no `origin`.
 *
 * @param origins each checkout and the `owner/name` its origin names
 * @returns the reader to pass as `originOf`
 */
export function originsAt({
  origins,
}: {
  readonly origins: readonly { readonly path: string; readonly slug: string }[];
}): (args: { cwd: string }) => string | undefined {
  const slugs = new Map(origins.map(({ path, slug }) => [realpathSync(path), slug] as const));
  return ({ cwd }) => slugs.get(realpathSync(cwd));
}

/**
 * Write the home's profile declaring exactly these main checkouts, replacing any earlier one.
 *
 * @param home the throwaway home
 * @param paths the checkouts it declares
 */
export function declareMainCheckouts({
  home,
  paths,
}: {
  readonly home: string;
  readonly paths: readonly string[];
}): void {
  const value = {
    displayName: "",
    gitNamespace: "",
    id: "me",
    mainCheckouts: paths.map((path) => ({ path })),
    schemaVersion: 1,
    sources: [],
  };
  writeFileAtomic({
    contents: safeJsonStringify({ label: "fixture profile", value }),
    path: stateHomePaths({ home }).profileJson,
  });
}
