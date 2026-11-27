/**
 * `machine free-disk`'s path reads over a real throwaway tree: a link is reported as a link and never followed,
 * a hardlinked file counts as held but never as freeable, and an absent path is absent rather than an error.
 * Plus the pure `ps` reader that finds a process running from inside a bundle.
 */
import { linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { observePath, pidsInsideBundle } from "../../../../../live/machine/freeDisk/observePath.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "free-disk-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The allocation a file holds, as the read computes it. */
function allocated({ path }: { path: string }): number {
  return lstatSync(path).blocks * 512;
}

describe("observePath", () => {
  it("walks a directory, counting a hardlinked pair as held but not freeable, and never following a link", () => {
    const cache = join(root, "cache");
    const outside = join(root, "outside");
    mkdirSync(join(cache, "nested"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(cache, "single.bin"), Buffer.alloc(64 * 1024, 1));
    writeFileSync(join(cache, "nested", "linked.bin"), Buffer.alloc(32 * 1024, 2));
    linkSync(join(cache, "nested", "linked.bin"), join(cache, "nested", "linked-twin.bin"));
    writeFileSync(join(outside, "big.bin"), Buffer.alloc(256 * 1024, 3));
    symlinkSync(outside, join(cache, "to-outside"));

    const observed = unwrap(observePath({ path: cache, walk: true }));

    const single = allocated({ path: join(cache, "single.bin") });
    const linked = allocated({ path: join(cache, "nested", "linked.bin") });
    expect(observed.state).toBe("present");
    expect(observed).toMatchObject({
      kind: "directory",
      path: cache,
      usage: { allocatedBytes: single + 2 * linked, freeableBytes: single, multiLinkFiles: 2, singleLinkFiles: 1 },
    });
  });

  it("reports a link as a link with its own target and no usage", () => {
    const target = join(root, "real");
    mkdirSync(target);
    writeFileSync(join(target, "f.bin"), Buffer.alloc(8 * 1024, 1));
    const link = join(root, "link");
    symlinkSync(target, link);

    expect(unwrap(observePath({ path: link, walk: true }))).toMatchObject({
      kind: "symlink",
      realPath: target,
      usage: { allocatedBytes: 0, freeableBytes: 0, multiLinkFiles: 0, singleLinkFiles: 0 },
    });
  });

  it("skips the walk when asked, keeping the identity a recheck compares", () => {
    const cache = join(root, "cache");
    mkdirSync(cache);
    writeFileSync(join(cache, "f.bin"), Buffer.alloc(8 * 1024, 1));
    const stats = lstatSync(cache);

    expect(unwrap(observePath({ path: cache, walk: false }))).toMatchObject({
      identity: { dev: stats.dev, ino: stats.ino },
      usage: { allocatedBytes: 0, freeableBytes: 0 },
    });
  });

  it("reads an absent path as absent", () => {
    const missing = join(root, "missing");
    expect(unwrap(observePath({ path: missing, walk: true }))).toEqual({ path: missing, state: "absent" });
  });
});

describe("pidsInsideBundle", () => {
  it("finds the processes whose executable sits inside the bundle, and no sibling bundle's", () => {
    const text = [
      "  101 /Applications/Acme Scanner Edition.app/Contents/MacOS/JavaApplicationStub",
      "  202 /Applications/Acme Scanner Edition.app/Contents/Resources/jre.bundle/Contents/Home/bin/java",
      "  303 /Applications/Acme Scanner Edition.app.old/Contents/MacOS/stub",
      "  404 /bin/zsh",
      "x505 /Applications/Acme Scanner Edition.app/Contents/MacOS/stub",
      "606",
      "",
    ].join("\n");

    expect(pidsInsideBundle({ bundlePath: "/Applications/Acme Scanner Edition.app", text })).toEqual([101, 202]);
  });
});
