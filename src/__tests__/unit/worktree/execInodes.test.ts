/**
 * The exec-inode discipline, both halves: the pure decisions, and a real hardlink round-trip in a temp dir.
 *
 * The measurement these tests exist for, reproduced with a two-link fixture over a copy of the
 * real 10,573,778-byte esbuild binary: while one link was rewritten in place six times with BYTE-IDENTICAL
 * content, 98 of 300 execs of the OTHER link died `rc=137` (SIGKILL), and laps 204 through 300 died every
 * single time. Same size, same bytes, permanently unexecutable — so `stat` cannot see the damage, and the
 * only cure is a fresh inode. That is what `privatiseExecInodes` buys, and the round-trip below asserts the
 * inode actually moves.
 */
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../cacheHome.js";
import {
  couldBeNativeImage,
  type ExecInodeReport,
  execInodesNeedAttention,
  execInodeVerdict,
  execStoreEntryName,
  inodeKey,
  isMachO,
  renderExecInodeReport,
  tallyExecInodes,
} from "../../../worktree/execInodes.js";
import { esbuildInodeVerdict, privatiseExecInodes } from "../../../worktree/execInodesApply.js";

/** A 64-bit little-endian Mach-O header, as the bytes are read off disk. */
const MACH_O_64 = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);

/** Every scratch directory a test minted, removed in `afterEach` rather than left for the OS. */
const scratch: string[] = [];

/** A throwaway directory that `afterEach` removes. */
function mkScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-exec-inodes-"));
  scratch.push(dir);
  return dir;
}

/** Write a fake native image at `path`, creating its parents. */
function writeImage({ path, body }: { path: string; body: string }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const bytes = new Uint8Array([...MACH_O_64, ...Buffer.from(body, "utf8")]);
  writeFileSync(path, bytes, { mode: 0o755 });
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("isMachO", () => {
  it("matches a 64-bit little-endian image", () => {
    expect(isMachO({ header: MACH_O_64 })).toBe(true);
  });

  it("matches both byte orders of a universal archive", () => {
    expect(isMachO({ header: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]) })).toBe(true);
    expect(isMachO({ header: new Uint8Array([0xbe, 0xba, 0xfe, 0xca]) })).toBe(true);
  });

  it("rejects a shell script and a short read", () => {
    expect(isMachO({ header: new Uint8Array([0x23, 0x21, 0x2f, 0x62]) })).toBe(false);
    expect(isMachO({ header: new Uint8Array([0xcf, 0xfa]) })).toBe(false);
    expect(isMachO({ header: new Uint8Array(0) })).toBe(false);
  });
});

describe("couldBeNativeImage", () => {
  it("takes anything with an exec bit", () => {
    expect(couldBeNativeImage({ mode: 0o755, path: "/x/bin/esbuild" })).toBe(true);
    expect(couldBeNativeImage({ mode: 0o711, path: "/x/whatever" })).toBe(true);
  });

  it("takes a loadable native image with no exec bit", () => {
    expect(couldBeNativeImage({ mode: 0o644, path: "/x/fsevents.node" })).toBe(true);
    expect(couldBeNativeImage({ mode: 0o644, path: "/x/libonnxruntime.1.14.0.dylib" })).toBe(true);
    expect(couldBeNativeImage({ mode: 0o644, path: "/x/thing.so" })).toBe(true);
  });

  it("skips an ordinary non-executable file", () => {
    expect(couldBeNativeImage({ mode: 0o644, path: "/x/index.js" })).toBe(false);
  });
});

describe("execInodeVerdict", () => {
  it("calls a file the exec store already owns private", () => {
    const store = new Set([inodeKey({ identity: { dev: 1, ino: 2 } })]);
    expect(execInodeVerdict({ file: { dev: 1, ino: 2 }, storeInodes: store })).toBe("private");
  });

  it("calls every other inode shared, including a same-inode-different-device collision", () => {
    const store = new Set([inodeKey({ identity: { dev: 1, ino: 2 } })]);
    expect(execInodeVerdict({ file: { dev: 1, ino: 3 }, storeInodes: store })).toBe("shared");
    expect(execInodeVerdict({ file: { dev: 9, ino: 2 }, storeInodes: store })).toBe("shared");
  });

  it("calls everything shared when the store is empty", () => {
    expect(execInodeVerdict({ file: { dev: 1, ino: 2 }, storeInodes: new Set() })).toBe("shared");
  });
});

describe("execStoreEntryName", () => {
  it("names an entry by its content hash", () => {
    expect(execStoreEntryName({ sha256: "abc123" })).toBe("abc123.bin");
  });
});

describe("tallyExecInodes and renderExecInodeReport", () => {
  const report: ExecInodeReport = {
    applied: false,
    execStore: "scratch-exec-store",
    outcomes: [
      { action: "already-private", detail: undefined, path: "a/one", size: 1048576 },
      { action: "shared", detail: undefined, path: "b/two", size: 2097152 },
      { action: "failed", detail: "EXDEV", path: "c/three", size: 4194304 },
    ],
    root: "/repo",
  };

  it("totals every action, with an untouched action present at zero", () => {
    const tally = tallyExecInodes({ report });
    expect(tally["already-private"]).toEqual({ bytes: 1048576, count: 1 });
    expect(tally.shared).toEqual({ bytes: 2097152, count: 1 });
    expect(tally.failed).toEqual({ bytes: 4194304, count: 1 });
    expect(tally.relinked).toEqual({ bytes: 0, count: 0 });
  });

  it("renders the root, the totals and one line per problem", () => {
    const lines = renderExecInodeReport({ report });
    expect(lines[0]).toBe("/repo");
    expect(lines[1]).toBe(
      "  3 native image(s), 7.0 MiB — 1 already private · 1 SHARED with yarn's store (2.0 MiB) · 1 FAILED",
    );
    expect(lines[2]).toBe("  shared b/two");
    expect(lines[3]).toBe("  FAILED c/three — EXDEV");
    expect(lines).toHaveLength(4);
  });

  it("calls a report with a shared or failed image one that needs attention", () => {
    expect(execInodesNeedAttention({ report })).toBe(true);
    expect(
      execInodesNeedAttention({
        report: { ...report, outcomes: [{ action: "already-private", detail: undefined, path: "a", size: 1 }] },
      }),
    ).toBe(false);
  });
});

describe("privatiseExecInodes", () => {
  it("moves a shared image off the shared inode and leaves the content identical", () => {
    const cacheRoot = mkScratch();
    const repo = mkScratch();
    const yarnStore = join(mkScratch(), "store.dat");
    writeImage({ body: "esbuild-bytes", path: yarnStore });
    const image = join(repo, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild");
    mkdirSync(join(image, ".."), { recursive: true });
    linkSync(yarnStore, image);
    expect(statSync(image).ino).toBe(statSync(yarnStore).ino);

    const report = privatiseExecInodes({
      apply: true,
      execStore: cachePaths({ root: cacheRoot }).execStore,
      root: repo,
    });

    expect(report.outcomes).toEqual([
      {
        action: "relinked",
        detail: undefined,
        path: "node_modules/@esbuild/darwin-arm64/bin/esbuild",
        size: statSync(yarnStore).size,
      },
    ]);
    expect(statSync(image).ino).not.toBe(statSync(yarnStore).ino);
    expect(statSync(image).size).toBe(statSync(yarnStore).size);
    expect(readdirSync(cachePaths({ root: cacheRoot }).execStore)).toHaveLength(1);
  });

  it("is idempotent — a second pass hashes nothing and relinks nothing", () => {
    const cacheRoot = mkScratch();
    const repo = mkScratch();
    const yarnStore = join(mkScratch(), "store.dat");
    writeImage({ body: "esbuild-bytes", path: yarnStore });
    const image = join(repo, "node_modules", "pkg", "bin", "tool");
    mkdirSync(join(image, ".."), { recursive: true });
    linkSync(yarnStore, image);

    privatiseExecInodes({ apply: true, execStore: cachePaths({ root: cacheRoot }).execStore, root: repo });
    const inoAfterFirst = statSync(image).ino;
    const second = privatiseExecInodes({
      apply: true,
      execStore: cachePaths({ root: cacheRoot }).execStore,
      root: repo,
    });

    expect(second.outcomes.map((outcome) => outcome.action)).toEqual(["already-private"]);
    expect(statSync(image).ino).toBe(inoAfterFirst);
    expect(readdirSync(cachePaths({ root: cacheRoot }).execStore)).toHaveLength(1);
  });

  it("shares ONE store entry between two roots holding identical content", () => {
    const cacheRoot = mkScratch();
    const repoA = mkScratch();
    const repoB = mkScratch();
    for (const repo of [repoA, repoB]) {
      const image = join(repo, "node_modules", "pkg", "bin", "tool");
      writeImage({ body: "same-bytes", path: image });
    }

    privatiseExecInodes({ apply: true, execStore: cachePaths({ root: cacheRoot }).execStore, root: repoA });
    privatiseExecInodes({ apply: true, execStore: cachePaths({ root: cacheRoot }).execStore, root: repoB });

    expect(readdirSync(cachePaths({ root: cacheRoot }).execStore)).toHaveLength(1);
    expect(statSync(join(repoA, "node_modules", "pkg", "bin", "tool")).ino).toBe(
      statSync(join(repoB, "node_modules", "pkg", "bin", "tool")).ino,
    );
  });

  it("reports without writing when apply is false", () => {
    const cacheRoot = mkScratch();
    const repo = mkScratch();
    const image = join(repo, "node_modules", "pkg", "bin", "tool");
    writeImage({ body: "bytes", path: image });
    const before = statSync(image).ino;

    const report = privatiseExecInodes({
      apply: false,
      execStore: cachePaths({ root: cacheRoot }).execStore,
      root: repo,
    });

    expect(report.applied).toBe(false);
    expect(report.outcomes.map((outcome) => outcome.action)).toEqual(["shared"]);
    expect(statSync(image).ino).toBe(before);
    expect(existsSync(cachePaths({ root: cacheRoot }).execStore)).toBe(false);
  });

  it("ignores a non-Mach-O executable and a missing node_modules", () => {
    const cacheRoot = mkScratch();
    const repo = mkScratch();
    const script = join(repo, "node_modules", "pkg", "bin", "run.sh");
    mkdirSync(join(script, ".."), { recursive: true });
    writeFileSync(script, "#!/bin/sh\necho hi\n", { mode: 0o755 });

    expect(
      privatiseExecInodes({ apply: true, execStore: cachePaths({ root: cacheRoot }).execStore, root: repo }).outcomes,
    ).toEqual([]);
    expect(
      privatiseExecInodes({ apply: true, execStore: cachePaths({ root: cacheRoot }).execStore, root: mkScratch() })
        .outcomes,
    ).toEqual([]);
  });
});

describe("esbuildInodeVerdict", () => {
  it("reports shared before the pass and private after it", () => {
    const cacheRoot = mkScratch();
    const repo = mkScratch();
    const yarnStore = join(mkScratch(), "store.dat");
    writeImage({ body: "esbuild-bytes", path: yarnStore });
    const image = join(repo, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild");
    mkdirSync(join(image, ".."), { recursive: true });
    linkSync(yarnStore, image);

    const execStore = cachePaths({ root: cacheRoot }).execStore;
    const otherStore = cachePaths({ root: mkScratch() }).execStore;
    expect(esbuildInodeVerdict({ execStores: [otherStore, execStore], root: repo })).toBe("shared");
    privatiseExecInodes({ apply: true, execStore, root: repo });
    expect(esbuildInodeVerdict({ execStores: [otherStore, execStore], root: repo })).toBe("private");
    expect(esbuildInodeVerdict({ execStores: [otherStore], root: repo })).toBe("shared");
  });

  it("says nothing about a checkout with no esbuild", () => {
    expect(
      esbuildInodeVerdict({ execStores: [cachePaths({ root: mkScratch() }).execStore], root: mkScratch() }),
    ).toBeUndefined();
  });
});
