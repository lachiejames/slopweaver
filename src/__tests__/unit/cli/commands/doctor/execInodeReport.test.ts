/**
 * `doctor`'s exec-inode line and JSON status, over a real hardlink in a temp dir: a checkout whose esbuild still
 * shares yarn's inode, the same checkout after the cache root's exec store took it private, one privatised into the
 * home's pre-move store before the store moved, and a checkout with no esbuild.
 */
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../../../cacheHome.js";
import { execInodeLine, execInodeStatus } from "../../../../../cli/commands/doctor/execInodeReport.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { privatiseExecInodes } from "../../../../../worktree/execInodesApply.js";

/** A 64-bit little-endian Mach-O header, so the exec store recognises the fake binary as a native image. */
const MACH_O_64 = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);

const SHARED_LINE =
  "exec inodes: SHARED with yarn's content store — a sibling checkout's install can leave every native binary here PERMANENTLY unexecutable; run `slopweaver worktree unshare`";
const PRIVATE_LINE = "exec inodes: private — native binaries are on Slopweaver's exec store, not yarn's";

const scratch: string[] = [];

/** A throwaway directory that `afterEach` removes. */
function mkScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-doctor-exec-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A checkout whose esbuild is a hardlink to a yarn-store file, beside an empty cache root and an empty home. */
function sharedCheckout(): { repo: string; execStore: string; homeExecStore: string } {
  const repo = mkScratch();
  const yarnStore = join(mkScratch(), "store.dat");
  writeFileSync(yarnStore, new Uint8Array([...MACH_O_64, ...Buffer.from("esbuild-bytes", "utf8")]), { mode: 0o755 });
  const image = join(repo, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild");
  mkdirSync(join(image, ".."), { recursive: true });
  linkSync(yarnStore, image);
  return {
    execStore: cachePaths({ root: mkScratch() }).execStore,
    homeExecStore: stateHomePaths({ home: mkScratch() }).homeExecStore,
    repo,
  };
}

describe("execInodeLine and execInodeStatus", () => {
  it("names a shared inode, then a private one once the cache root's exec store holds it", () => {
    const { repo, execStore, homeExecStore } = sharedCheckout();
    expect(execInodeStatus({ cwd: repo, execStore, homeExecStore })).toBe("shared");
    expect(execInodeLine({ cwd: repo, execStore, homeExecStore })).toBe(SHARED_LINE);

    privatiseExecInodes({ apply: true, execStore, root: repo });
    expect(execInodeStatus({ cwd: repo, execStore, homeExecStore })).toBe("private");
    expect(execInodeLine({ cwd: repo, execStore, homeExecStore })).toBe(PRIVATE_LINE);
  });

  it("reads a checkout privatised into the home's pre-move store as private, with the cache root's store empty", () => {
    const { repo, execStore, homeExecStore } = sharedCheckout();
    privatiseExecInodes({ apply: true, execStore: homeExecStore, root: repo });
    expect(execInodeStatus({ cwd: repo, execStore, homeExecStore })).toBe("private");
    expect(execInodeLine({ cwd: repo, execStore, homeExecStore })).toBe(PRIVATE_LINE);
  });

  it("says nothing in the line and unknown in the status with no cwd, or no esbuild there", () => {
    const stores = {
      execStore: cachePaths({ root: mkScratch() }).execStore,
      homeExecStore: stateHomePaths({ home: mkScratch() }).homeExecStore,
    };
    const bare = mkScratch();
    expect([execInodeLine({ cwd: undefined, ...stores }), execInodeLine({ cwd: bare, ...stores })]).toEqual([
      undefined,
      undefined,
    ]);
    expect([execInodeStatus({ cwd: undefined, ...stores }), execInodeStatus({ cwd: bare, ...stores })]).toEqual([
      "unknown",
      "unknown",
    ]);
  });
});
