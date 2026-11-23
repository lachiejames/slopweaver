/**
 * The committed `lefthook.yml`'s `desktop-current` hook, read as the artifact it is. Its `run` line is the whole
 * trigger for "the app is rebuilt on every move of main", and it is a shell string no compiler reads: a rename of
 * the verb or of either flag would leave it calling nothing, and the app would silently go stale again — the thing
 * the owner ruled out. These assertions are what reddens instead.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DESKTOP_PREBUILD_FLAG_NAMES } from "../../../cli/commands/desktop/prebuildRun.js";
import { desktopManifest } from "../../../cli/manifests/desktop.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const lefthook = readFileSync(join(root, "lefthook.yml"), "utf8");

/** Every `run:` line in the committed hook file that invokes the desktop prebuild. */
const prebuildRunLines = lefthook
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("run:") && line.includes("desktop prebuild"));

describe("lefthook's desktop-current hook", () => {
  it("runs the prebuild once, on post-merge only", () => {
    expect(prebuildRunLines.length).toBe(1);
    const postMerge = lefthook.slice(lefthook.indexOf("\npost-merge:"), lefthook.indexOf("\npost-checkout:"));
    expect(postMerge).toContain("    desktop-current:\n");
    expect(postMerge).toContain(prebuildRunLines[0]!);
  });

  it("asks --decide in the foreground and backgrounds --log only when a build is due", () => {
    expect(prebuildRunLines[0]).toBe(
      "run: if test -d .git; then if node_modules/.bin/tsx src/cli/index.ts desktop prebuild --decide; then (node_modules/.bin/tsx src/cli/index.ts desktop prebuild --log </dev/null >/dev/null 2>&1 &); fi; fi",
    );
  });

  it("names a verb and two flags the CLI actually declares", () => {
    expect(Object.keys(desktopManifest)).toContain("prebuild");
    expect(DESKTOP_PREBUILD_FLAG_NAMES).toContain("--decide");
    expect(DESKTOP_PREBUILD_FLAG_NAMES).toContain("--log");
  });
});
