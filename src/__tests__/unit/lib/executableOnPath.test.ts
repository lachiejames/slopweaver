/**
 * The shared `PATH` resolver over a throwaway tree: every case builds its own directories and its own `PATH`,
 * so nothing here depends on what this machine has installed. Filesystem use is the genuine-fixture kind.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { danglingLinkOnPath, hostPathEntries, isExecutableFile, resolveOnPath } from "../../../lib/executableOnPath.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test that minted it. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "onpath-"));
  dirs.push(dir);
  return dir;
}

/** Write a file and set its mode. */
function file({ path, mode }: { path: string; mode: number }): string {
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, mode);
  return path;
}

describe("hostPathEntries", () => {
  it("splits PATH on the platform delimiter and drops empty entries", () => {
    expect(hostPathEntries({ env: { PATH: `/a${delimiter}${delimiter}/b` } })).toEqual(["/a", "/b"]);
  });

  it("is empty when PATH is unset", () => {
    expect(hostPathEntries({ env: {} })).toEqual([]);
  });
});

describe("isExecutableFile", () => {
  it("is true for an executable file", () => {
    const dir = tempDir();
    expect(isExecutableFile({ path: file({ mode: 0o755, path: join(dir, "tool") }) })).toBe(true);
  });

  it("is false for a file without the execute bit", () => {
    const dir = tempDir();
    expect(isExecutableFile({ path: file({ mode: 0o644, path: join(dir, "tool") }) })).toBe(false);
  });

  it("is false for a directory, whose execute bit means search", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "tool"));
    expect(isExecutableFile({ path: join(dir, "tool") })).toBe(false);
  });

  it("is false for a path that does not exist", () => {
    expect(isExecutableFile({ path: join(tempDir(), "absent") })).toBe(false);
  });
});

describe("resolveOnPath", () => {
  it("returns the FIRST entry holding an executable, in PATH order", () => {
    const first = tempDir();
    const second = tempDir();
    file({ mode: 0o755, path: join(first, "tool") });
    file({ mode: 0o755, path: join(second, "tool") });
    expect(resolveOnPath({ name: "tool", pathEntries: [first, second] })).toBe(join(first, "tool"));
  });

  it("skips an entry whose file is not executable", () => {
    const first = tempDir();
    const second = tempDir();
    file({ mode: 0o644, path: join(first, "tool") });
    file({ mode: 0o755, path: join(second, "tool") });
    expect(resolveOnPath({ name: "tool", pathEntries: [first, second] })).toBe(join(second, "tool"));
  });

  it("follows a good symlink to an executable", () => {
    const dir = tempDir();
    const target = file({ mode: 0o755, path: join(dir, "real") });
    symlinkSync(target, join(dir, "tool"));
    expect(resolveOnPath({ name: "tool", pathEntries: [dir] })).toBe(join(dir, "tool"));
  });

  it("is null for a dangling symlink", () => {
    const dir = tempDir();
    symlinkSync(join(dir, "gone"), join(dir, "tool"));
    expect(resolveOnPath({ name: "tool", pathEntries: [dir] })).toBe(null);
  });

  it("is null on an empty PATH", () => {
    expect(resolveOnPath({ name: "tool", pathEntries: [] })).toBe(null);
  });
});

describe("danglingLinkOnPath", () => {
  it("names the broken link and the target it points at", () => {
    const dir = tempDir();
    symlinkSync(join(dir, "gone"), join(dir, "tool"));
    expect(danglingLinkOnPath({ name: "tool", pathEntries: [dir] })).toEqual({
      link: join(dir, "tool"),
      target: join(dir, "gone"),
    });
  });

  it("is null when the link resolves to an executable", () => {
    const dir = tempDir();
    symlinkSync(file({ mode: 0o755, path: join(dir, "real") }), join(dir, "tool"));
    expect(danglingLinkOnPath({ name: "tool", pathEntries: [dir] })).toBe(null);
  });

  it("is null for a plain file that is not a link", () => {
    const dir = tempDir();
    file({ mode: 0o644, path: join(dir, "tool") });
    expect(danglingLinkOnPath({ name: "tool", pathEntries: [dir] })).toBe(null);
  });
});
