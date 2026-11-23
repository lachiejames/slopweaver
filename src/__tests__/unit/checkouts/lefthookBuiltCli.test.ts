/**
 * The committed `lefthook.yml`, read as the artifact it is, against the two TypeScript constants that decide
 * where a built tree's manifest lands. The hook's own `run` line carries the whole skip condition — a
 * `test -f` on the manifest — because the skip used to live inside the verb, and a checkout that had never
 * built anything still paid a tsx boot on every ref move to reach it. A rename of `DEFAULT_OUT` or of
 * `BUILD_MANIFEST_FILE` would leave that shell string pointing at nothing, silently restoring the boot on
 * every checkout; these assertions are what reddens instead.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_OUT } from "../../../builtCli/layout.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const lefthook = readFileSync(join(root, "lefthook.yml"), "utf8");

/** Every `run:` line in the committed hook file that invokes the built-CLI ref-move entrypoint. */
const buildRunLines = lefthook
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("run:") && line.includes("refMoveBuildCli.ts"));

describe("lefthook's built-cli hooks", () => {
  it("registers the built-CLI entrypoint on both ref-move hooks", () => {
    expect(buildRunLines.length).toBe(2);
    expect(buildRunLines.filter((line) => line.includes("post-merge")).length).toBe(1);
    expect(buildRunLines.filter((line) => line.includes("post-checkout")).length).toBe(1);
  });

  it("guards each invocation on the manifest path the build verb actually writes", () => {
    const guard = `if test -f ${join(DEFAULT_OUT, BUILD_MANIFEST_FILE)}; then `;
    expect(guard).toBe("if test -f dist-cli/.slopweaver-build.json; then ");
    expect(buildRunLines.filter((line) => line.includes(guard)).length).toBe(2);
  });

  it("closes each guard, so the hook is a complete shell command", () => {
    expect(buildRunLines.filter((line) => line.endsWith("; fi")).length).toBe(2);
  });
});
