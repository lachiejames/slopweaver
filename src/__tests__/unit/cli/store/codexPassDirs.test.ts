/**
 * Which `orchestration/` entries the `codex` leg reads, and reading a pass's optional artifact — over a real
 * temp directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { codexPassDirs, readIfPresent } from "../../../../cli/commands/store/codexPassDirs.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway orchestration directory. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-pass-dirs-"));
  dirs.push(dir);
  return dir;
}

describe("codexPassDirs", () => {
  it("keeps recorded pass directories in name order, skipping scratch siblings, stray files and unrecorded passes", () => {
    const root = freshDir();
    for (const name of ["b-pass", "a-pass", "a-pass.scratch", "no-record"]) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, "b-pass", "record.json"), "{}");
    writeFileSync(join(root, "a-pass", "record.json"), "{}");
    writeFileSync(join(root, "a-pass.scratch", "record.json"), "{}");
    writeFileSync(join(root, "stray.json"), "{}");

    expect(codexPassDirs({ orchestrationDir: root })).toEqual([join(root, "a-pass"), join(root, "b-pass")]);
  });
});

describe("readIfPresent", () => {
  it("reads a file that is there and answers undefined for one that is not", () => {
    const root = freshDir();
    writeFileSync(join(root, "artifact.md"), "# found\n");

    expect(readIfPresent({ path: join(root, "artifact.md") })).toBe("# found\n");
    expect(readIfPresent({ path: join(root, "missing.md") })).toBe(undefined);
  });
});
