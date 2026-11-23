/**
 * The scanner, against a real temp-directory fixture — a genuine round-trip, not a shared service, which is
 * what the testing rules allow the filesystem for. The pure predicates are checked directly beside it.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isInsideHome,
  isSelfCorpusFile,
  isSkippedDirectory,
  scanSelfCorpus,
  selfRootName,
} from "../../../../corpus/self/scan.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp root with a small tree standing in for the real corpus. */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-self-scan-"));
  fixtureDirs.push(root);
  mkdirSync(join(root, "daily"), { recursive: true });
  mkdirSync(join(root, "junkyard", "deep"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "README.md"), "top level");
  writeFileSync(join(root, "daily", "monday.md"), "daily note");
  writeFileSync(join(root, "daily", "transcript.txt"), "a dump");
  writeFileSync(join(root, "junkyard", "deep", "old-idea.md"), "an old idea");
  writeFileSync(join(root, "notes.pdf"), "not prose");
  writeFileSync(join(root, ".git", "COMMIT_EDITMSG"), "not writing");
  writeFileSync(join(root, "node_modules", "readme.md"), "not the owner's");
  return root;
}

describe("isSelfCorpusFile", () => {
  it("accepts markdown and plain text", () => {
    expect(isSelfCorpusFile({ name: "plan.md" })).toBe(true);
    expect(isSelfCorpusFile({ name: "transcript.txt" })).toBe(true);
  });

  it("accepts an upper-cased extension", () => {
    expect(isSelfCorpusFile({ name: "PLAN.MD" })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isSelfCorpusFile({ name: "notes.pdf" })).toBe(false);
    expect(isSelfCorpusFile({ name: "profile.json" })).toBe(false);
    expect(isSelfCorpusFile({ name: "md" })).toBe(false);
  });
});

describe("isSkippedDirectory", () => {
  it("skips history and dependencies, which are not the owner's writing", () => {
    expect(isSkippedDirectory({ name: ".git" })).toBe(true);
    expect(isSkippedDirectory({ name: "node_modules" })).toBe(true);
  });

  it("walks an ordinary directory, including the big one", () => {
    expect(isSkippedDirectory({ name: "junkyard" })).toBe(false);
    expect(isSkippedDirectory({ name: "daily" })).toBe(false);
  });
});

/**
 * A root name reaches `container` and every `sourceId`, so an empty one is not cosmetic. A review pass supplied
 * the chain: `basename("/")` is `""` → `container: ""` → the bronze reader rejects the row → the dedup index
 * never sees it → every re-scan appends the same record again, forever, each run reporting a clean write.
 */
describe("selfRootName", () => {
  it("uses the directory name", () => {
    expect(selfRootName({ root: "/dev/state-repo" })).toBe("state-repo");
  });

  it("never returns empty for a filesystem root, which has no basename", () => {
    expect(selfRootName({ root: "/" })).toBe("root");
  });

  it("tolerates a trailing separator", () => {
    expect(selfRootName({ root: "/dev/notes/" })).toBe("notes");
  });
});

describe("isInsideHome", () => {
  it("recognises the home itself and anything beneath it", () => {
    expect(isInsideHome({ home: "/state/wm", path: "/state/wm" })).toBe(true);
    expect(isInsideHome({ home: "/state/wm", path: "/state/wm/corpus/bronze/a.jsonl" })).toBe(true);
  });

  it("does not catch a sibling whose name merely starts the same way", () => {
    expect(isInsideHome({ home: "/state/wm", path: "/state/wm-backup/notes.md" })).toBe(false);
  });

  it("does not catch an unrelated path", () => {
    expect(isInsideHome({ home: "/state/wm", path: "/dev/notes/plan.md" })).toBe(false);
  });
});

describe("scanSelfCorpus", () => {
  it("collects every markdown and text file, recursively", () => {
    const root = fixtureRoot();
    const scanned = scanSelfCorpus({ home: join(root, "..", "unrelated-home"), roots: [root] });

    expect(scanned.files.map((file) => file.relPath).toSorted()).toEqual([
      "README.md",
      "daily/monday.md",
      "daily/transcript.txt",
      "junkyard/deep/old-idea.md",
    ]);
  });

  it("skips .git and node_modules", () => {
    const root = fixtureRoot();
    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((file) => file.relPath.startsWith(".git"))).toEqual([]);
    expect(scanned.files.filter((file) => file.relPath.startsWith("node_modules"))).toEqual([]);
  });

  it("carries the root name, the absolute path and the mtime for each file", () => {
    const root = fixtureRoot();
    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });
    const readme = scanned.files.find((file) => file.relPath === "README.md")!;

    expect(readme.text).toBe("top level");
    expect(readme.absPath).toBe(join(root, "README.md"));
    expect(readme.root).toBe(root);
    expect(readme.mtimeIso.endsWith("Z")).toBe(true);
  });

  it("refuses to scan anything inside the Slopweaver home, so it never ingests its own output", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "state-home", "corpus"), { recursive: true });
    writeFileSync(join(root, "state-home", "corpus", "derived.md"), "gold output");

    const scanned = scanSelfCorpus({ home: join(root, "state-home"), roots: [root] });

    expect(scanned.files.filter((file) => file.relPath.startsWith("state-home"))).toEqual([]);
  });

  it("does not follow a symlink out of the root", () => {
    const root = fixtureRoot();
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-self-outside-"));
    fixtureDirs.push(outside);
    writeFileSync(join(outside, "elsewhere.md"), "not under the root");
    symlinkSync(outside, join(root, "linked"));

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((file) => file.relPath.includes("linked"))).toEqual([]);
  });

  it("warns and continues when a root does not exist, rather than reporting an empty corpus", () => {
    const root = fixtureRoot();
    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [join(root, "absent"), root] });

    expect(scanned.files.length).toBe(4);
    expect(scanned.warnings.length).toBe(1);
    expect(scanned.warnings[0]!).toContain("root not readable");
  });

  it("warns when a root is a file rather than a directory", () => {
    const root = fixtureRoot();
    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [join(root, "README.md")] });

    expect(scanned.files).toEqual([]);
    expect(scanned.warnings[0]!).toContain("not a directory");
  });

  it("refuses a genuine blob, naming it with a typed reason rather than dropping it silently", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "blob.txt"), String.fromCharCode(0).repeat(400));

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((file) => file.relPath === "blob.txt")).toEqual([]);
    expect(scanned.skips.filter((skip) => skip.relPath === "blob.txt").map((skip) => skip.reason)).toEqual([
      "binary-content",
    ]);
  });

  // The behaviour change: the presence of a control byte used to condemn the whole file, and a real file
  // lost 239 lines of prose that way. Density decides now, so the byte goes and the writing survives.
  it("reads a prose file carrying one stray NUL, stripping the byte and counting it", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "stray.md"), `${"real writing. ".repeat(30)}${String.fromCharCode(0)}and more`);

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });
    const file = scanned.files.find((candidate) => candidate.relPath === "stray.md")!;

    expect(file.controlBytesStripped).toBe(1);
    expect(file.text.endsWith("and more")).toBe(true);
    expect(scanned.skips.filter((skip) => skip.relPath === "stray.md")).toEqual([]);
  });

  // The whole reason this module changed: three files vanished from a root with nothing printed.
  it("declines an unsupported extension with a NAMED reason, never in silence", () => {
    const root = fixtureRoot();

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(scanned.skips.filter((skip) => skip.relPath === "notes.pdf").map((skip) => skip.reason)).toEqual([
      "unsupported-extension",
    ]);
  });

  it("reads a .markdown file, which the two-extension list used to drop unmentioned", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "plan.markdown"), "a real plan");

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((file) => file.relPath === "plan.markdown").length).toBe(1);
  });

  // The corpus was measured to be 17.6% vendored prior-art from another organisation, every record of it
  // attributed to the profile owner, with no way to say no. Excluding that subtree removed exactly the
  // 10,488 records it contributed.
  it("declines an excluded subtree by name, and prunes everything under it", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "vendored", "deep"), { recursive: true });
    writeFileSync(join(root, "vendored", "a.md"), "not the owner's writing");
    writeFileSync(join(root, "vendored", "deep", "b.md"), "also not the owner's");

    const scanned = scanSelfCorpus({ exclude: ["vendored"], home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((f) => f.relPath.startsWith("vendored")).length).toBe(0);
    expect(scanned.skips.filter((s) => s.reason === "excluded-path").map((s) => s.relPath)).toEqual(["vendored"]);
  });

  it("does not exclude a sibling whose name merely starts with the excluded prefix", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "vendored-notes"), { recursive: true });
    writeFileSync(join(root, "vendored-notes", "keep.md"), "the owner's writing");

    const scanned = scanSelfCorpus({ exclude: ["vendored"], home: "/nowhere", roots: [root] });

    expect(scanned.files.filter((f) => f.relPath === "vendored-notes/keep.md").length).toBe(1);
  });

  it("declines an over-large file with a reason that names the escape hatch", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "big.md"), "x".repeat(200));

    const scanned = scanSelfCorpus({ home: "/nowhere", maxBytes: 100, roots: [root] });
    const declined = scanned.skips.find((skip) => skip.relPath === "big.md")!;

    expect(declined.reason).toBe("too-large");
    expect(declined.detail).toContain("SLOPWEAVER_ALLOW_LARGE_FILES=1");
  });

  it("reads nothing and warns nothing for an empty root", () => {
    const empty = mkdtempSync(join(tmpdir(), "slopweaver-self-empty-"));
    fixtureDirs.push(empty);
    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [empty] });

    expect(scanned.files).toEqual([]);
    expect(scanned.warnings).toEqual([]);
  });

  it("scans two roots in order, keeping each file's own root", () => {
    const first = fixtureRoot();
    const second = mkdtempSync(join(tmpdir(), "slopweaver-self-second-"));
    fixtureDirs.push(second);
    writeFileSync(join(second, "programme.md"), "the other pile");

    const scanned = scanSelfCorpus({ home: "/nowhere", roots: [first, second] });
    const programme = scanned.files.find((file) => file.relPath === "programme.md")!;

    expect(scanned.files.length).toBe(5);
    expect(programme.root).toBe(second);
  });

  it("walks in a deterministic order, so a re-scan produces the same records in the same order", () => {
    const root = fixtureRoot();
    const first = scanSelfCorpus({ home: "/nowhere", roots: [root] });
    const second = scanSelfCorpus({ home: "/nowhere", roots: [root] });

    expect(first.files.map((file) => file.relPath)).toEqual(second.files.map((file) => file.relPath));
  });
});
