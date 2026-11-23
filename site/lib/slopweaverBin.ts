/**
 * Which `slopweaver` the console runs: the one belonging to the checkout that is SERVING this page.
 *
 * ## The defect this closes
 *
 * `spawnVerb` used to launch the bare name `slopweaver` with `shell: false`, which resolves the child off
 * the inherited `PATH` and nothing else. Three facts compound there, and together they decided which
 * checkout's CLI answered every tile on the console:
 *
 *  - The interactive `slopweaver` on the owner's machine is a shell FUNCTION that runs
 *    `git rev-parse --show-toplevel` and prefers `$root/bin/slopweaver`. A `spawn` with no shell never
 *    sees a function.
 *  - `next dev` is long-lived, so the `PATH` it captured can be months old — and it belongs to whatever
 *    shell happened to start it, which is nothing the reader of the page can see.
 *  - MEASURED: the server answering `localhost:3000` was serving out of the main checkout
 *    while the work on the console stood in a worktree. Same page, different code, no label.
 *
 * A number on the console is only as trustworthy as the knowledge of which tree produced it, so the
 * resolution is a property of WHERE THE SERVER IS, never of the environment it inherited.
 *
 * ## The rule
 *
 * Walk up from the server's working directory and take the first ancestor holding `bin/slopweaver`. Both
 * `next dev` and `next start` run with the working directory at the package root, `site/`, so the first hop
 * up is the checkout — and the walk rather than a fixed `..` is what survives a server launched from a
 * subdirectory of it.
 *
 * The search is REPORTED when it fails. A console that says "not on PATH" after this would be describing a
 * mechanism it no longer uses; what a reader needs is the list of directories that were actually looked in.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where `bin/slopweaver` sits inside a checkout. */
const BIN_RELATIVE = join("bin", "slopweaver");

/**
 * What the walk came to: the checkout's own binary, or every directory that was looked in.
 *
 * The failure arm carries the searched list rather than a sentence, so the caller words the refusal in its
 * own voice and a test can assert on the SEARCH rather than on prose.
 */
export type BinResolution =
  | { readonly found: true; readonly bin: string; readonly root: string }
  | { readonly found: false; readonly searched: readonly string[] };

/**
 * Resolve the serving checkout's `bin/slopweaver` by walking up from a directory.
 *
 * Pure: `exists` is injected, so this is a plain function of its two inputs and carries no filesystem of its
 * own. {@link slopweaverBin} is the one caller that supplies the real one.
 *
 * @param from the directory to start at — the server's own working directory
 * @param exists whether a path is present on disk
 * @returns the resolved binary and the checkout that owns it, or every directory the walk looked in
 */
export function resolveSlopweaverBin({
  from,
  exists,
}: {
  from: string;
  exists: (args: { path: string }) => boolean;
}): BinResolution {
  const searched: string[] = [];
  let dir = from;
  for (;;) {
    searched.push(dir);
    const candidate = join(dir, BIN_RELATIVE);
    if (exists({ path: candidate })) {
      return { bin: candidate, found: true, root: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return { found: false, searched };
    }
    dir = parent;
  }
}

/**
 * The serving checkout's `slopweaver`, resolved against the real filesystem from the server's cwd.
 *
 * @returns the resolution — the caller decides what a failure reads like
 */
export function slopweaverBin(): BinResolution {
  return resolveSlopweaverBin({ exists: ({ path }) => existsSync(path), from: process.cwd() });
}
