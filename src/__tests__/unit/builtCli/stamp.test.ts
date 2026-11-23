/**
 * The manifest's own lifecycle, over a real throwaway checkout: cleared before an emit, written only after
 * one that ran.
 *
 * The property worth holding down is the ABSENCE arm. A build that fails half way leaves a tree mixing old
 * and new files, and a manifest left beside them is the one state where the guard reads current over source
 * that describes neither half — so `clearStamp` running first is what makes a failed build fall back to tsx
 * instead of answering from rubble.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { scanSourceStamps } from "../../../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE, parseBuildManifest, stalenessOf } from "../../../builtCli/staleness.js";
import { clearStamp, stampBuild } from "../../../builtCli/stamp.js";
import { gitInTemp } from "../../tempGitRepo.js";

const dirs: string[] = [];

/** A throwaway git checkout with one tracked source file, and an empty built tree beside it. */
function checkout(): { root: string; outDir: string } {
  const root = mkdtempSync(join(tmpdir(), "stamp-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["init", "-q"], cwd: root });
  gitInTemp({ args: ["add", "-A"], cwd: root });
  const outDir = join(root, "dist-cli");
  mkdirSync(outDir, { recursive: true });
  return { outDir, root };
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("clearStamp", () => {
  it("removes the manifest of the tree about to be overwritten", () => {
    const { outDir } = checkout();
    writeFileSync(join(outDir, BUILD_MANIFEST_FILE), "{}");

    clearStamp({ outDir });

    expect(existsSync(join(outDir, BUILD_MANIFEST_FILE))).toBe(false);
  });

  it("is a no-op on a directory that has never been stamped", () => {
    const { outDir } = checkout();

    clearStamp({ outDir });

    expect(existsSync(join(outDir, BUILD_MANIFEST_FILE))).toBe(false);
  });
});

describe("stampBuild", () => {
  it("records the root it read and every tracked source file", () => {
    const { outDir, root } = checkout();

    stampBuild({ outDir, root, stamps: scanSourceStamps({ root }) });

    const manifest = parseBuildManifest({ text: readFileSync(join(outDir, BUILD_MANIFEST_FILE), "utf8") });
    expect(manifest!.root).toBe(root);
    expect(manifest!.stamps.map((stamp) => stamp.path)).toEqual(["src/a.ts"]);
  });

  it("writes a manifest the guard's own parser accepts", () => {
    const { outDir, root } = checkout();

    stampBuild({ outDir, root, stamps: scanSourceStamps({ root }) });
    const text = readFileSync(join(outDir, BUILD_MANIFEST_FILE), "utf8");

    expect(text.endsWith("\n")).toBe(true);
    expect(parseBuildManifest({ text })!.builtAtIso.endsWith("Z")).toBe(true);
  });

  // The r1 counterexample, as a test. `stampBuild` must record what the caller scanned before the emit
  // started, never the tree as it stands when the build is declared good: a file written DURING the emit
  // would otherwise be stamped as built in while the emitted tree held the module from before it.
  it("records the caller's stamps rather than re-scanning the source it is handed", () => {
    const { outDir, root } = checkout();
    const beforeEmit = scanSourceStamps({ root });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n// written during the emit\n");

    stampBuild({ outDir, root, stamps: beforeEmit });

    const manifest = parseBuildManifest({ text: readFileSync(join(outDir, BUILD_MANIFEST_FILE), "utf8") });
    expect(manifest!.stamps[0]!.size).toBe(beforeEmit[0]!.size);
    expect(stalenessOf({ current: scanSourceStamps({ root }), manifest: manifest! }).stale).toBe(true);
  });
});
