/**
 * The bounded source scanner: real filesystem fixtures (a genuine round-trip, allowed by testing.md), never
 * a mocked `fs`.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { JudgementSourceScanErrors } from "../../../judgement/sourceScan.errors.js";
import { scanJudgementSource } from "../../../judgement/sourceScan.js";
import { JUDGEMENT_FILE_MAX_CHARS, JUDGEMENT_SOURCE_MAX_CHARS } from "../../../judgement/sourceSelection.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-judgement-scan-"));
  fixtureDirs.push(root);
  return root;
}

describe("scanJudgementSource", () => {
  it("answers undefined for a root that does not exist", () => {
    expect(unwrap(scanJudgementSource({ label: "test", root: "/does/not/exist" }))).toBeUndefined();
  });

  it("answers undefined for an empty, existing directory", () => {
    expect(unwrap(scanJudgementSource({ label: "test", root: freshRoot() }))).toBeUndefined();
  });

  it("reads a plain text file and reports it with its receipt", () => {
    const root = freshRoot();
    writeFileSync(join(root, "note.md"), "some first-person writing", "utf8");
    const sample = unwrap(scanJudgementSource({ label: "test", root }))!;
    expect(sample.fileCount).toBe(1);
    expect(sample.text).toBe("some first-person writing");
    expect(sample.label).toBe("test");
    expect(sample.selected.map((file) => file.relativePath)).toEqual(["note.md"]);
  });

  it("walks nested directories and reports each top-level directory as a stratum", () => {
    const root = freshRoot();
    mkdirSync(join(root, "b"));
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "b", "second.md"), "second", "utf8");
    writeFileSync(join(root, "a", "first.md"), "first", "utf8");
    const sample = unwrap(scanJudgementSource({ label: "test", root }))!;
    expect(sample.coverage.strata.toSorted((left, right) => (left.stratum < right.stratum ? -1 : 1))).toEqual([
      { candidateFiles: 1, selectedFiles: 1, stratum: "a" },
      { candidateFiles: 1, selectedFiles: 1, stratum: "b" },
    ]);
    expect(sample.selected.map((file) => file.relativePath).toSorted()).toEqual(["a/first.md", "b/second.md"]);
  });

  it("computes the same content hash for the same tree, and a different one for different content", () => {
    const rootOne = freshRoot();
    writeFileSync(join(rootOne, "note.md"), "identical content", "utf8");
    const rootTwo = freshRoot();
    writeFileSync(join(rootTwo, "note.md"), "identical content", "utf8");
    const rootThree = freshRoot();
    writeFileSync(join(rootThree, "note.md"), "different content", "utf8");
    const hashOne = unwrap(scanJudgementSource({ label: "test", root: rootOne }))!.contentHash;
    const hashTwo = unwrap(scanJudgementSource({ label: "test", root: rootTwo }))!.contentHash;
    const hashThree = unwrap(scanJudgementSource({ label: "test", root: rootThree }))!.contentHash;
    expect(hashOne).toBe(hashTwo);
    expect(hashOne).not.toBe(hashThree);
  });

  it("skips a binary-looking file rather than including garbage text", () => {
    const root = freshRoot();
    writeFileSync(join(root, "prose.md"), "readable text", "utf8");
    writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 0, 0, 5, 0, 0]));
    const sample = unwrap(scanJudgementSource({ label: "test", root }))!;
    expect(sample.coverage.candidateFiles).toBe(1);
    expect(sample.text).toBe("readable text");
  });

  it("never follows a symlink out of the root, nor walks a skipped directory", () => {
    const root = freshRoot();
    const outside = freshRoot();
    writeFileSync(join(outside, "secret.md"), "outside content", "utf8");
    symlinkSync(outside, join(root, "linked"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "dep.md"), "dependency text", "utf8");
    writeFileSync(join(root, "inside.md"), "inside content", "utf8");
    const sample = unwrap(scanJudgementSource({ label: "test", root }))!;
    expect(sample.text).toBe("inside content");
    expect(sample.coverage.candidateFiles).toBe(1);
  });

  it("shows a file larger than the whole budget as a declared excerpt, and measures what it left out", () => {
    const root = freshRoot();
    writeFileSync(join(root, "huge.md"), "x".repeat(JUDGEMENT_SOURCE_MAX_CHARS + 1000), "utf8");
    const sample = unwrap(scanJudgementSource({ label: "test", root }))!;
    expect(sample.text.length).toBe(JUDGEMENT_FILE_MAX_CHARS);
    expect(sample.coverage.truncatedFiles).toBe(1);
    expect(sample.coverage.candidateChars).toBe(JUDGEMENT_SOURCE_MAX_CHARS + 1000);
  });

  it("refuses an unreadable directory by name instead of dropping it", () => {
    const root = freshRoot();
    const locked = join(root, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "private.md"), "unreachable", "utf8");
    chmodSync(locked, 0o000);
    // Unlocked and removed before its parent, so the parent's recursive removal can read it.
    fixtureDirs.unshift(locked);
    const error = unwrapErr(scanJudgementSource({ label: "test", root }));
    expect(error.code).toBe("JUDGEMENT_SOURCE_UNREADABLE");
    expect(error.path).toBe(locked);
  });

  it("names the source, the path and the fix in the unreadable message", () => {
    expect(JudgementSourceScanErrors.unreadable({ detail: "EACCES", label: "notes", path: "/x/locked" })).toEqual({
      code: "JUDGEMENT_SOURCE_UNREADABLE",
      label: "notes",
      message:
        "source notes: could not read /x/locked (EACCES) — fix its permissions or drop it from the sources manifest",
      path: "/x/locked",
    });
  });
});
