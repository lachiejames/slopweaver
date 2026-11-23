/**
 * The filesystem edge, over a genuine temp directory.
 *
 * The symlink case at the bottom is a regression test for a defect the unit suite could not have caught, because
 * every other test hands the checker text rather than a path. It was found by running the verb against a real
 * corpus twice, spelled two ways.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { checkMemoryCorpus } from "../../../memory/check.js";
import { millisSinceLastChange, readMemoryCorpus, readMemoryLeafFile } from "../../../memory/store.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A corpus on disk, in a fresh temp directory. Returns the directory. */
function corpusOnDisk({ files }: { files: Readonly<Record<string, string>> }): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-store-"));
  fixtureDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

const LEAF = "---\nname: thing\ndescription: a thing\nmetadata:\n  type: reference\n---\n\nBody.\n";

describe("reading a corpus off disk", () => {
  it("classifies the root index, a topic index and a leaf", () => {
    const dir = corpusOnDisk({
      files: {
        "INDEX-topic.md": "# Topic\n",
        "MEMORY.md": "# Index\n",
        "thing.md": LEAF,
      },
    });

    const read = readMemoryCorpus({ dir });

    expect(read.isOk()).toBe(true);
    expect(read._unsafeUnwrap().root?.file).toBe("MEMORY.md");
    expect(read._unsafeUnwrap().topicIndexes.map((i) => i.file)).toEqual(["INDEX-topic.md"]);
    expect(read._unsafeUnwrap().leaves.map((l) => l.file)).toEqual(["thing.md"]);
  });

  it("ignores files that are not markdown", () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n", "notes.txt": "not a memory" } });

    expect(readMemoryCorpus({ dir })._unsafeUnwrap().leaves).toEqual([]);
  });

  it("ignores a nested directory rather than descending into it", () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n" } });
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "buried.md"), LEAF, "utf8");

    expect(readMemoryCorpus({ dir })._unsafeUnwrap().leaves).toEqual([]);
  });

  it("FAILS on a directory that does not exist, rather than calling it an empty clean corpus", () => {
    const dir = join(tmpdir(), "memory-store-definitely-absent-9f3a");
    const read = readMemoryCorpus({ dir });

    const error = unwrapErr(read);
    expect(error.kind).toBe("io");
    expect(error.code).toBe("ENOENT");
  });

  it("reads one leaf on its own", () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n", "thing.md": LEAF } });

    const read = readMemoryLeafFile({ basename: "thing.md", dir });

    expect(read.isOk()).toBe(true);
    expect(read._unsafeUnwrap().declaredName).toBe("thing");
  });

  it("fails on a leaf that is not there", () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n" } });

    const error = unwrapErr(readMemoryLeafFile({ basename: "absent.md", dir }));
    expect(error.kind).toBe("io");
    expect(error.code).toBe("ENOENT");
  });
});

describe("measuring how recently the corpus changed", () => {
  it("reports the age of the newest file against the supplied clock", () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n" } });

    const age = millisSinceLastChange({ dir, now: Date.now() + 10_000 });

    expect(age.isOk()).toBe(true);
    expect(age._unsafeUnwrap()!).toBeGreaterThan(0);
  });

  it("reports null for a directory with no markdown, so an empty corpus is not treated as fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-store-empty-"));
    fixtureDirs.push(dir);

    expect(millisSinceLastChange({ dir, now: Date.now() })._unsafeUnwrap()).toBeNull();
  });
});

describe("a corpus reached through a symlink", () => {
  it("resolves an outside link identically whichever spelling of the directory is given", () => {
    // A sibling file the corpus points at with `../outside.md`, plus the corpus itself one level down.
    const root = mkdtempSync(join(tmpdir(), "memory-symlink-"));
    fixtureDirs.push(root);
    writeFileSync(join(root, "outside.md"), "the real target\n", "utf8");
    const real = join(root, "real-corpus");
    mkdirSync(real);
    writeFileSync(join(real, "MEMORY.md"), "# Index\n\n- [Outside](../outside.md) — exists\n", "utf8");

    // A second, longer path to the SAME directory. Resolving `../outside.md` from here without following the
    // symlink lands beside the link instead of beside the real corpus, and reports a dead pointer.
    const nest = join(root, "a", "b", "c");
    mkdirSync(nest, { recursive: true });
    const via = join(nest, "link");
    symlinkSync(real, via);

    const direct = checkMemoryCorpus({ corpus: readMemoryCorpus({ dir: real })._unsafeUnwrap() });
    const throughLink = checkMemoryCorpus({ corpus: readMemoryCorpus({ dir: via })._unsafeUnwrap() });

    expect(direct).toEqual([]);
    expect(throughLink).toEqual([]);
  });

  it("still reports an outside link that genuinely leads nowhere, through the symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "memory-symlink-dead-"));
    fixtureDirs.push(root);
    const real = join(root, "real-corpus");
    mkdirSync(real);
    writeFileSync(join(real, "MEMORY.md"), "# Index\n\n- [Gone](../never-written.md) — absent\n", "utf8");
    const via = join(root, "link");
    symlinkSync(real, via);

    const throughLink = checkMemoryCorpus({ corpus: readMemoryCorpus({ dir: via })._unsafeUnwrap() });

    expect(throughLink).toEqual([
      {
        check: "dead-pointer",
        file: "MEMORY.md",
        line: 3,
        message: "points at `../never-written.md`, which does not exist",
      },
    ]);
  });
});
