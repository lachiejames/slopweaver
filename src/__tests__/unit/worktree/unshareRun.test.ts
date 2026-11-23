/**
 * `slopweaver worktree unshare` end to end over a scratch checkout, with a real hardlink standing in for
 * yarn's content store — the exact shape `worktree/execInodes.ts` measured as a SIGKILL source.
 *
 * The checkout is a `--repo` argument and the exec store sits under the cache root every test lane points at its
 * own temp root (`setup-temp-root.ts`), so nothing here writes the ambient `$SLOPWEAVER_HOME` or the real cache.
 */
import { linkSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../cacheHome.js";
import { runWorktreeUnshare } from "../../../cli/commands/worktree/unshareRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { withDepsLock } from "../../../worktree/depsLock.js";

/** A 64-bit little-endian Mach-O header followed by enough bytes to be a plausible image. */
const IMAGE = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, ...Buffer.from("native-binary-bytes", "utf8")]);

const scratch: string[] = [];

/** A throwaway directory that `afterEach` removes. */
function mkScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-unshare-verb-"));
  scratch.push(dir);
  return dir;
}

/** A checkout whose esbuild is hardlinked to a stand-in for yarn's store entry, exactly as yarn leaves it. */
function checkoutSharingYarnsInode(): { repo: string; image: string; storeInode: number } {
  const repo = mkScratch();
  // A `.git` directory, so the checkout's deps lock has a git directory to live in.
  mkdirSync(join(repo, ".git"));
  const yarnStore = join(mkScratch(), "f6888912.dat");
  writeFileSync(yarnStore, IMAGE, { mode: 0o755 });
  const image = join(repo, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild");
  mkdirSync(join(image, ".."), { recursive: true });
  linkSync(yarnStore, image);
  return { image, repo, storeInode: statSync(yarnStore).ino };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
  rmSync(cachePaths().execStore, { force: true, recursive: true });
});

describe("runWorktreeUnshare", () => {
  it("relinks a shared binary onto the cache root's exec store and exits ok", () => {
    const { image, repo, storeInode } = checkoutSharingYarnsInode();

    const code = runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--repo", repo]);

    expect(code).toBe(EXIT_OK);
    expect(statSync(image).ino).not.toBe(storeInode);
    const [entry] = readdirSync(cachePaths().execStore);
    expect(statSync(join(cachePaths().execStore, entry!)).ino).toBe(statSync(image).ino);
  });

  it("reports a shared binary as a finding without touching it when --report is passed", () => {
    const { image, repo, storeInode } = checkoutSharingYarnsInode();

    const code = runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--repo", repo, "--report"]);

    expect(code).toBe(EXIT_ERROR);
    expect(statSync(image).ino).toBe(storeInode);
  });

  it("exits ok for a checkout with nothing native in it", () => {
    const repo = mkScratch();
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "pkg", "index.js"), "export default 1;\n");

    expect(runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--repo", repo])).toBe(EXIT_OK);
  });

  it("relinks nothing in a checkout whose deps lock a provision holds, and exits with the finding", () => {
    const { image, repo, storeInode } = checkoutSharingYarnsInode();

    const code = unwrap(
      withDepsLock({
        act: () => runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--repo", repo]),
        waitMs: 0,
        worktree: repo,
      }),
    );

    expect(code).toBe(EXIT_ERROR);
    expect(statSync(image).ino).toBe(storeInode);
  });

  it("refuses an unknown flag with a usage exit", () => {
    expect(runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--nope"])).toBe(EXIT_USAGE);
  });

  it("refuses --home, which no longer selects anything: the exec store is the machine's, not a home's", () => {
    expect(runWorktreeUnshare(["node", "cli", "worktree", "unshare", "--home", mkScratch()])).toBe(EXIT_USAGE);
  });
});
