/**
 * The staleness guard over a REAL throwaway git checkout: two tracked source files, a manifest written from
 * them, and the four answers the guard can give.
 *
 * A temp git repository rather than an injected listing seam, because the thing most worth holding down is
 * that the guard stamps what `git ls-files` reports — the same listing the emit reads. A fake listing would
 * pass whatever it was handed and prove nothing about that agreement.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { builtRootOf, guardBuiltTree } from "../../../builtCli/guard.js";
import { scanSourceStamps } from "../../../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { gitInTemp } from "../../tempGitRepo.js";

const dirs: string[] = [];

/** A throwaway git checkout carrying two tracked source files, plus a built tree beside them. */
function builtCheckout(): { root: string; builtRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "guard-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");
  gitInTemp({ args: ["init", "-q"], cwd: root });
  gitInTemp({ args: ["add", "-A"], cwd: root });
  const builtRoot = join(root, "dist-cli");
  mkdirSync(builtRoot, { recursive: true });
  writeManifest({ builtRoot, root });
  return { builtRoot, root };
}

/** Write the manifest the way `dev build` does — from the same scan the guard will take. */
function writeManifest({ builtRoot, root }: { builtRoot: string; root: string }): void {
  writeFileSync(
    join(builtRoot, BUILD_MANIFEST_FILE),
    JSON.stringify({ builtAtIso: "2026-09-21T00:00:00.000Z", root, stamps: scanSourceStamps({ root }) }),
  );
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("guardBuiltTree", () => {
  it("says nothing, and stops nothing, when the built tree still matches its source", () => {
    const { builtRoot } = builtCheckout();

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.ran).toBe(true);
    expect(outcome.refuse).toBe(false);
    expect(outcome.lines).toEqual([]);
  });

  it("does not run at all where there is no manifest — a checkout that never built has no stale build", () => {
    const root = mkdtempSync(join(tmpdir(), "guard-"));
    dirs.push(root);

    const outcome = guardBuiltTree({ builtRoot: root, hatchOpen: false });

    expect(outcome.ran).toBe(false);
    expect(outcome.refuse).toBe(false);
    expect(outcome.lines).toEqual([]);
  });

  it("refuses, naming the file and the rebuild, once one source file changes", () => {
    const { builtRoot, root } = builtCheckout();
    writeFileSync(join(root, "src/b.ts"), "export const b = 22;\n");

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.refuse).toBe(true);
    expect(outcome.lines[0]).toContain("src/b.ts is 21 bytes, 20 at build time");
    expect(outcome.lines[0]).toContain("rebuild with `slopweaver dev build`");
    expect(outcome.lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_STALE_BUILD=1 slopweaver <any verb>.",
    );
  });

  it("refuses a manifest it cannot read, rather than treating an unreadable one as fresh", () => {
    const { builtRoot } = builtCheckout();
    writeFileSync(join(builtRoot, BUILD_MANIFEST_FILE), "{}");

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.refuse).toBe(true);
    expect(outcome.lines[0]).toContain("is not a build manifest");
  });

  it("refuses when the checkout it was built from is gone", () => {
    const { builtRoot, root } = builtCheckout();
    writeFileSync(
      join(builtRoot, BUILD_MANIFEST_FILE),
      JSON.stringify({ builtAtIso: "2026-09-21T00:00:00.000Z", root: `${root}-gone`, stamps: [] }),
    );

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.refuse).toBe(true);
    expect(outcome.lines[0]).toContain("is gone, so nothing can say whether it is current");
  });

  it("runs anyway under the hatch, and names the tree the answer came from", () => {
    const { builtRoot, root } = builtCheckout();
    writeFileSync(join(root, "src/b.ts"), "export const b = 22;\n");

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: true });

    expect(outcome.refuse).toBe(false);
    expect(outcome.lines[0]).toBe(
      "slopweaver: [stale-build] override in force — src/b.ts is 21 bytes, 20 at build time.",
    );
    expect(outcome.lines[1]).toBe(
      `slopweaver:   this answer comes from ${builtRoot}, built at 2026-09-21T00:00:00.000Z, NOT from ${root}/src.`,
    );
  });

  it("sees a tracked file deleted from disk as gone, rather than throwing on the stat", () => {
    const { builtRoot, root } = builtCheckout();
    rmSync(join(root, "src/b.ts"));

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.refuse).toBe(true);
    expect(outcome.lines[0]).toContain("src/b.ts is gone since the build");
  });

  it("reads the manifest one directory above the module that asks — the emit's own layout", () => {
    expect(builtRootOf({ moduleUrl: "file:///repo/dist-cli/cli/main.js" })).toBe("/repo/dist-cli");
  });

  it("stamps what git tracks, so an untracked scratch file cannot stale a build", () => {
    const { builtRoot, root } = builtCheckout();
    writeFileSync(join(root, "src/scratch.ts"), "export const scratch = 3;\n");

    const outcome = guardBuiltTree({ builtRoot, hatchOpen: false });

    expect(outcome.refuse).toBe(false);
    expect(statSync(join(root, "src/scratch.ts")).size).toBe(26);
  });
});
