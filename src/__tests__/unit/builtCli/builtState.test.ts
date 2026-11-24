/**
 * Where a built tree stands, as a parent launching built-CLI children reads it: the pure judgement of whether a
 * rebuild crossed a child, and the real read over a throwaway git checkout with a manifest written the way
 * `dev build` writes one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type BuiltState, builtRootOfBin, rebuildCrossed } from "../../../builtCli/builtState.js";
import { readBuiltState } from "../../../builtCli/builtStateRead.js";
import { scanSourceStamps } from "../../../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { gitInTemp } from "../../tempGitRepo.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway checkout with one tracked source file and an empty built tree beside it. */
function checkout(): { root: string; builtRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "built-state-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["init", "-q"], cwd: root });
  gitInTemp({ args: ["add", "-A"], cwd: root });
  const builtRoot = join(root, "dist-cli");
  mkdirSync(builtRoot, { recursive: true });
  return { builtRoot, root };
}

/** Write the manifest from the source as it stands — what a finished build leaves. */
function stamp({ builtRoot, root }: { builtRoot: string; root: string }): string {
  const text = JSON.stringify({ builtAtIso: new Date(0).toISOString(), root, stamps: scanSourceStamps({ root }) });
  writeFileSync(join(builtRoot, BUILD_MANIFEST_FILE), text);
  return text;
}

const FRESH_1: BuiltState = { kind: "fresh", manifestText: "one" };
const FRESH_2: BuiltState = { kind: "fresh", manifestText: "two" };
const STALE_1: BuiltState = { evidence: "src/a.ts moved", kind: "stale", manifestText: "one" };
const UNBUILT: BuiltState = { kind: "unbuilt" };
const UNJUDGEABLE: BuiltState = { kind: "unjudgeable" };

describe("builtRootOfBin", () => {
  it("names the dist-cli beside the launcher's checkout", () => {
    expect(builtRootOfBin({ bin: "/dev/slopweaver/bin/slopweaver" })).toBe("/dev/slopweaver/dist-cli");
  });
});

describe("rebuildCrossed", () => {
  it("blames a rebuild when the tree reads stale after the child", () => {
    expect(rebuildCrossed({ after: STALE_1, before: FRESH_1 })).toBe(true);
  });

  it("blames a rebuild when a different fresh build landed while the child ran", () => {
    expect(rebuildCrossed({ after: FRESH_2, before: FRESH_1 })).toBe(true);
  });

  it("blames a rebuild when a fresh build stands after a child launched against a stale one", () => {
    expect(rebuildCrossed({ after: FRESH_1, before: STALE_1 })).toBe(true);
  });

  it("does not blame a rebuild when the same fresh build stood throughout — the failure is the verb's own", () => {
    expect(rebuildCrossed({ after: FRESH_1, before: FRESH_1 })).toBe(false);
  });

  it("does not blame a rebuild over a tree that is unbuilt or unjudgeable after the child", () => {
    expect([UNBUILT, UNJUDGEABLE].map((after) => rebuildCrossed({ after, before: FRESH_1 }))).toEqual([false, false]);
  });
});

describe("readBuiltState", () => {
  it("reads a tree with no manifest as unbuilt — running from source, or mid-emit", () => {
    const { builtRoot } = checkout();
    expect(readBuiltState({ builtRoot })).toEqual(UNBUILT);
  });

  it("reads a manifest over unchanged source as fresh, carrying its text", () => {
    const { builtRoot, root } = checkout();
    const text = stamp({ builtRoot, root });
    expect(readBuiltState({ builtRoot })).toEqual({ kind: "fresh", manifestText: text });
  });

  it("reads a manifest whose source moved as stale, carrying its text and the first file that moved", () => {
    const { builtRoot, root } = checkout();
    const text = stamp({ builtRoot, root });
    writeFileSync(join(root, "src/a.ts"), "export const a = 11;\n");
    expect(readBuiltState({ builtRoot })).toEqual({
      evidence: "src/a.ts is 21 bytes, 20 at build time",
      kind: "stale",
      manifestText: text,
    });
  });

  it("reads a manifest that does not parse as unjudgeable", () => {
    const { builtRoot } = checkout();
    writeFileSync(join(builtRoot, BUILD_MANIFEST_FILE), "not json");
    expect(readBuiltState({ builtRoot })).toEqual(UNJUDGEABLE);
  });

  it("reads a manifest naming a checkout that is gone as unjudgeable", () => {
    const { builtRoot } = checkout();
    writeFileSync(
      join(builtRoot, BUILD_MANIFEST_FILE),
      JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: join(builtRoot, "gone"), stamps: [] }),
    );
    expect(readBuiltState({ builtRoot })).toEqual(UNJUDGEABLE);
  });

  it("reads a manifest whose root is a file, not a checkout, as unjudgeable rather than throwing out of the scan", () => {
    const { builtRoot, root } = checkout();
    writeFileSync(
      join(builtRoot, BUILD_MANIFEST_FILE),
      JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: join(root, "src/a.ts"), stamps: [] }),
    );
    expect(readBuiltState({ builtRoot })).toEqual(UNJUDGEABLE);
  });
});
