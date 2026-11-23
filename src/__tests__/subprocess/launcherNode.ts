/**
 * What a fake CLI tree needs for `bin/slopweaver` to reach its subject: the launcher resolves Node against the
 * tree's own `package.json` `engines.node` floor before it starts anything (`hooks/lib/node-resolve.sh`), and
 * refuses as `[node-contract]` over a tree with none. A test whose subject is NOT Node resolution gives its tree
 * this repository's real floor and pins the Node this test process runs on, so which Node the launcher picks
 * never depends on the host's PATH or version managers.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Write a minimal `package.json` carrying this repository's own `engines.node` into a fake CLI tree.
 *
 * @param dir the fake tree's root, the launcher's `DIR`
 */
export function writeLauncherManifest({ dir }: { dir: string }): void {
  const own = z
    .object({ engines: z.object({ node: z.string() }) })
    .parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")));
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ engines: { node: own.engines.node }, name: "fake-cli" }, null, 2)}\n`,
  );
}

/**
 * The environment entry that pins the launcher to the Node running this test.
 *
 * @returns `SLOPWEAVER_NODE` set to this process's own binary
 */
export function launcherNodeEnv(): { readonly SLOPWEAVER_NODE: string } {
  return { SLOPWEAVER_NODE: process.execPath };
}
