/**
 * The installed Nextra loader carries no Twoslash: the bytes Yarn actually patched, read after
 * `yarn install --immutable`, so a Nextra bump that drops the patch reddens before `next build` does.
 *
 * Nextra 4.6.1's MDX loader built a Twoslash transformer at module load, and Twoslash imports the classic
 * `typescript` compiler API the TypeScript 7 pin does not ship. `site/.yarn/patches/nextra-npm-4.6.1-*.patch`
 * removes it; docs/docs-site/runtime.md says why. An INTEGRATION test, run by the site CI job with
 * `yarn test:nextra-patch`: it reads `node_modules`, which no unit test may.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// A path joined from this file's directory, never `new URL("../…/node_modules/<pkg>/…", import.meta.url)`:
// knip reads that URL as an import of a package the root manifest does not list. The bytes read are the same.
const LOADER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  "nextra",
  "dist",
  "server",
  "loader.js",
);

describe("the installed Nextra MDX loader", () => {
  const source = readFileSync(LOADER, "utf8");

  it("is the loader Yarn installed, still passing the site's own code transformers through", () => {
    expect(source).toContain("...mdxOptions.rehypePrettyCodeOptions.transformers || []");
  });

  it("names no Twoslash and builds no default transformer", () => {
    expect(source.toLowerCase().includes("twoslash")).toBe(false);
    expect(source.includes("DEFAULT_TRANSFORMERS")).toBe(false);
  });
});
