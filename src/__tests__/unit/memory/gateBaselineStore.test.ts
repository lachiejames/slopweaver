import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readGateBaseline, writeGateBaseline } from "../../../memory/gateBaselineStore.js";
import { discoverMemoryCorpora } from "../../../memory/store.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gatebase-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readGateBaseline", () => {
  it("is empty when no list has ever been written", () => {
    expect(unwrap(readGateBaseline({ path: join(tempDir(), "absent.txt") }))).toEqual([]);
  });

  it("round-trips the keys it was given", () => {
    const path = join(tempDir(), "baseline.txt");
    unwrap(writeGateBaseline({ keys: ["a\u0000b", "c\u0000d"], path }));
    expect(unwrap(readGateBaseline({ path }))).toEqual(["a\u0000b", "c\u0000d"]);
  });

  it("drops the trailing blank line rather than reporting an empty key", () => {
    const path = join(tempDir(), "baseline.txt");
    writeFileSync(path, "one\ntwo\n", "utf8");
    expect(unwrap(readGateBaseline({ path }))).toEqual(["one", "two"]);
  });

  it("reads an empty file as an empty list", () => {
    const path = join(tempDir(), "baseline.txt");
    writeFileSync(path, "", "utf8");
    expect(unwrap(readGateBaseline({ path }))).toEqual([]);
  });
});

describe("writeGateBaseline", () => {
  it("replaces rather than appends", () => {
    const path = join(tempDir(), "baseline.txt");
    unwrap(writeGateBaseline({ keys: ["a", "b"], path }));
    unwrap(writeGateBaseline({ keys: ["b"], path }));
    expect(unwrap(readGateBaseline({ path }))).toEqual(["b"]);
  });

  it("writes an empty file for an empty list", () => {
    const path = join(tempDir(), "baseline.txt");
    unwrap(writeGateBaseline({ keys: [], path }));
    expect(unwrap(readGateBaseline({ path }))).toEqual([]);
  });
});

describe("discoverMemoryCorpora", () => {
  it("is empty when the projects root is absent", () => {
    expect(unwrap(discoverMemoryCorpora({ userHome: tempDir() }))).toEqual([]);
  });

  it("keeps only a memory directory that actually holds MEMORY.md", () => {
    const home = tempDir();
    const projects = join(home, ".claude", "projects");
    mkdirSync(join(projects, "with", "memory"), { recursive: true });
    mkdirSync(join(projects, "without", "memory"), { recursive: true });
    writeFileSync(join(projects, "with", "memory", "MEMORY.md"), "# index\n", "utf8");
    expect(unwrap(discoverMemoryCorpora({ userHome: home }))).toEqual([join(projects, "with", "memory")]);
  });

  it("is sorted, so a report's corpus order does not depend on the filesystem", () => {
    const home = tempDir();
    const projects = join(home, ".claude", "projects");
    ["b", "a"].forEach((name) => {
      mkdirSync(join(projects, name, "memory"), { recursive: true });
      writeFileSync(join(projects, name, "memory", "MEMORY.md"), "# index\n", "utf8");
    });
    expect(unwrap(discoverMemoryCorpora({ userHome: home }))).toEqual([
      join(projects, "a", "memory"),
      join(projects, "b", "memory"),
    ]);
  });

  it("discovers a symlinked corpus only while its target stands, so retiring one is removing the link", () => {
    const home = tempDir();
    const projects = join(home, ".claude", "projects");
    const target = join(tempDir(), "linked-memory");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "MEMORY.md"), "# index\n", "utf8");
    mkdirSync(join(projects, "linked"), { recursive: true });
    symlinkSync(target, join(projects, "linked", "memory"));
    expect(unwrap(discoverMemoryCorpora({ userHome: home }))).toEqual([join(projects, "linked", "memory")]);
    rmSync(target, { force: true, recursive: true });
    expect(unwrap(discoverMemoryCorpora({ userHome: home }))).toEqual([]);
  });

  it("ignores a plain file sitting where a project directory would be", () => {
    const home = tempDir();
    const projects = join(home, ".claude", "projects");
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, "stray.txt"), "not a project\n", "utf8");
    expect(unwrap(discoverMemoryCorpora({ userHome: home }))).toEqual([]);
  });
});
