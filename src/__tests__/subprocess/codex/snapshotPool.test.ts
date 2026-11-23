/**
 * The snapshot pool against REAL temporary git repositories and real process liveness.
 *
 * The properties under test are git's and the kernel's: whether `reset --hard` + `clean -ffdx` in a reused
 * worktree reproduces what a fresh checkout would, and whether a `rename` lease is held by exactly one process.
 * A fake of either would only prove the fake agrees with itself.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { listWorktrees } from "../../../cmux/worktree.js";
import { freezeWithProvenance } from "../../../codex/orchestrate.js";
import { captureContentTree, type TreeSnapshot } from "../../../codex/snapshot.js";
import { checkoutFingerprint } from "../../../codex/snapshotCheckout.js";
import { busyMarkerFor } from "../../../codex/snapshotLease.js";
import { acquirePooledSnapshot } from "../../../codex/snapshotPool.js";
import { refuseUnpoolableTree } from "../../../codex/snapshotSync.js";
import { unwrapErr } from "../../../lib/result.js";
import { SNAPSHOT_POOL_SLOTS, snapshotPoolRoot } from "../../../worktree/snapshotPoolPath.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** Every directory this file minted, and every lease it took, undone after each test. */
const fixtureDirs: string[] = [];
const leases: TreeSnapshot[] = [];

afterEach(() => {
  for (const held of leases.splice(0)) {
    held.release();
  }
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory this file owns. */
function ownDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** A repository with two committed files and an ignored directory. */
function seededRepo(): string {
  const dir = ownDir({ prefix: "slopweaver-pool-src-" });
  git({ args: ["init", "-q"], dir });
  git({ args: ["config", "user.email", "test@example.com"], dir });
  git({ args: ["config", "user.name", "Test"], dir });
  writeFileSync(join(dir, "changing.txt"), "one\n");
  writeFileSync(join(dir, "steady.txt"), "never changes\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  git({ args: ["add", "-A"], dir });
  git({ args: ["commit", "-qm", "seed"], dir });
  return dir;
}

function git({ dir, args }: { dir: string; args: readonly string[] }): string {
  return gitInTemp({ args: [...args], cwd: dir });
}

/** Lease a slot, recorded so `afterEach` returns it whatever the test asserted. */
function lease({ repoRoot, poolParent }: { repoRoot: string; poolParent: string }): TreeSnapshot {
  const snapshot = acquirePooledSnapshot({ poolParent, repoRoot })._unsafeUnwrap();
  leases.push(snapshot);
  return snapshot;
}

/** The state markers in the slot holding a snapshot's tree. */
function markersOf({ snapshot }: { snapshot: TreeSnapshot }): readonly string[] {
  return readdirSync(dirname(snapshot.path)).filter((entry) => entry.startsWith("state."));
}

/** A pid no process holds: a child that has already exited. */
function deadPid(): number {
  const child = spawnSync("true");
  return child.pid;
}

describe("acquirePooledSnapshot", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * The old `steady.txt` is held open across the second lease, so a rebuild could not hand its inode number to
   * the new file and pass the equality by reuse — see the conditional-config test below. Stats are read as
   * bigints: a 64-bit inode past 2^53 rounds as a number, and two neighbours would then compare equal.
   */
  it("reuses one slot and leaves an unchanged file's inode alone — only the diff is written", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    const held = openSync(join(first.path, "steady.txt"), "r");
    try {
      const steadyBefore = fstatSync(held, { bigint: true });
      first.release();

      writeFileSync(join(repoRoot, "changing.txt"), "two\n");
      const second = lease({ poolParent, repoRoot });
      const steadyAfter = statSync(join(second.path, "steady.txt"), { bigint: true });

      expect(second.path).toBe(first.path);
      expect(steadyAfter.ino).toBe(steadyBefore.ino);
      expect(steadyAfter.mtimeNs).toBe(steadyBefore.mtimeNs);
      expect(readFileSync(join(second.path, "changing.txt"), "utf8")).toBe("two\n");
      expect(second.contentTree).toBe(captureContentTree({ repoRoot })._unsafeUnwrap());
    } finally {
      closeSync(held);
    }
  });

  it("reflects a deleted, a modified and an added file, and carries nothing ignored", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    lease({ poolParent, repoRoot }).release();

    unlinkSync(join(repoRoot, "steady.txt"));
    appendFileSync(join(repoRoot, "changing.txt"), "MODIFIED\n");
    writeFileSync(join(repoRoot, "added.ts"), "export const added = 1;\n");
    mkdirSync(join(repoRoot, "ignored"));
    writeFileSync(join(repoRoot, "ignored", "build.log"), "noise\n");
    const second = lease({ poolParent, repoRoot });

    expect(existsSync(join(second.path, "ignored"))).toBe(false);
    expect(existsSync(join(second.path, "steady.txt"))).toBe(false);
    expect(readFileSync(join(second.path, "changing.txt"), "utf8")).toBe("one\nMODIFIED\n");
    expect(readFileSync(join(second.path, "added.ts"), "utf8")).toBe("export const added = 1;\n");
    expect(git({ args: ["status", "--porcelain", "--ignored"], dir: second.path })).toBe("");
  });

  it("removes a file a previous reader left in the slot, ignored or not", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    writeFileSync(join(first.path, "stray.txt"), "left by a reader\n");
    mkdirSync(join(first.path, "ignored"));
    writeFileSync(join(first.path, "ignored", "build.log"), "noise\n");
    first.release();

    const second = lease({ poolParent, repoRoot });

    expect(second.path).toBe(first.path);
    expect(readdirSync(second.path).toSorted()).toEqual([".git", ".gitignore", "changing.txt", "steady.txt"]);
  });

  it("follows a file through executable and symlink states", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    chmodSync(join(repoRoot, "changing.txt"), 0o755);
    const executable = lease({ poolParent, repoRoot });
    const executableMode = statSync(join(executable.path, "changing.txt")).mode & 0o111;
    executable.release();

    unlinkSync(join(repoRoot, "changing.txt"));
    symlinkSync("steady.txt", join(repoRoot, "changing.txt"));
    const linked = lease({ poolParent, repoRoot });

    expect(linked.path).toBe(executable.path);
    expect(executableMode).toBe(0o111);
    expect(lstatSync(join(linked.path, "changing.txt")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(linked.path, "changing.txt"))).toBe("steady.txt");
  });

  /**
   * The gap in `reset --hard`: a commit that changes only `.gitattributes` leaves an
   * unchanged blob's OLD checkout bytes in place, where a fresh checkout applies the new attributes. So the
   * pool rebuilds the slot on any attributes change. Without that rule the bytes below would stay LF.
   */
  it("rebuilds the slot when .gitattributes changes, so checkout bytes follow the new attributes", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    writeFileSync(join(repoRoot, ".gitattributes"), "*.txt text eol=lf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "lf"], dir: repoRoot });
    const lf = lease({ poolParent, repoRoot });
    const lfBytes = readFileSync(join(lf.path, "steady.txt"), "utf8");
    lf.release();

    writeFileSync(join(repoRoot, ".gitattributes"), "*.txt text eol=crlf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "crlf"], dir: repoRoot });
    const crlf = lease({ poolParent, repoRoot });

    expect(crlf.path).toBe(lf.path);
    expect(lfBytes).toBe("never changes\n");
    expect(readFileSync(join(crlf.path, "steady.txt"), "utf8")).toBe("never changes\r\n");
  });

  /** A reader that moves the slot's HEAD without its bytes must not hide an attributes change. */
  it("judges an attributes change from the commit it last wrote, not a HEAD a reader moved", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    writeFileSync(join(repoRoot, ".gitattributes"), "*.txt text eol=lf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "lf"], dir: repoRoot });
    const lf = lease({ poolParent, repoRoot });
    writeFileSync(join(repoRoot, ".gitattributes"), "*.txt text eol=crlf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "crlf"], dir: repoRoot });
    git({ args: ["reset", "--soft", git({ args: ["rev-parse", "HEAD"], dir: repoRoot }).trim()], dir: lf.path });
    const lfBytes = readFileSync(join(lf.path, "steady.txt"), "utf8");
    lf.release();

    const crlf = lease({ poolParent, repoRoot });

    expect(crlf.path).toBe(lf.path);
    expect(lfBytes).toBe("never changes\n");
    expect(readFileSync(join(crlf.path, "steady.txt"), "utf8")).toBe("never changes\r\n");
  });

  it("rebuilds on a .gitattributes change under a directory git would quote", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const odd = join(repoRoot, "odd\nname");
    mkdirSync(odd);
    writeFileSync(join(odd, "data.txt"), "unchanged\n");
    writeFileSync(join(odd, ".gitattributes"), "*.txt text eol=lf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "lf"], dir: repoRoot });
    const lf = lease({ poolParent, repoRoot });
    lf.release();

    writeFileSync(join(odd, ".gitattributes"), "*.txt text eol=crlf\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "crlf"], dir: repoRoot });
    const crlf = lease({ poolParent, repoRoot });

    expect(crlf.path).toBe(lf.path);
    expect(readFileSync(join(crlf.path, "odd\nname", "data.txt"), "utf8")).toBe("unchanged\r\n");
  });

  /**
   * Counterexample: `core.autocrlf` flipped between two leases, with no commit in between. A reset
   * leaves the unchanged file's LF bytes where a fresh checkout writes CRLF, so the slot's recorded checkout
   * fingerprint must force a rebuild. Without that rule the bytes below would stay LF.
   */
  it("rebuilds the slot when a checkout rule outside the commit changes", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    git({ args: ["config", "core.autocrlf", "false"], dir: repoRoot });
    const lf = lease({ poolParent, repoRoot });
    const lfBytes = readFileSync(join(lf.path, "steady.txt"), "utf8");
    lf.release();

    git({ args: ["config", "core.autocrlf", "true"], dir: repoRoot });
    const crlf = lease({ poolParent, repoRoot });

    expect(crlf.path).toBe(lf.path);
    expect(lfBytes).toBe("never changes\n");
    expect(readFileSync(join(crlf.path, "steady.txt"), "utf8")).toBe("never changes\r\n");
  });

  /** Counterexample: a sparse checkout left in a slot, which reset honours and leaves a file absent. */
  it("rebuilds a slot a reader left sparse, so every tracked file is back", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    first.release();
    git({ args: ["sparse-checkout", "set", "--no-cone", "changing.txt"], dir: first.path });
    const sparse = existsSync(join(first.path, "steady.txt"));

    const second = lease({ poolParent, repoRoot });

    expect(second.path).toBe(first.path);
    expect(sparse).toBe(false);
    expect(readFileSync(join(second.path, "steady.txt"), "utf8")).toBe("never changes\n");
  });

  /** Config set in the slot's own `config.worktree`, which the fingerprint read at the source never sees. */
  it("rebuilds a slot that gained a worktree-specific config", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    git({ args: ["config", "extensions.worktreeConfig", "true"], dir: repoRoot });
    git({ args: ["config", "core.autocrlf", "false"], dir: repoRoot });
    const first = lease({ poolParent, repoRoot });
    first.release();
    git({ args: ["config", "--worktree", "core.autocrlf", "true"], dir: first.path });

    writeFileSync(join(repoRoot, "changing.txt"), "two\n");
    const second = lease({ poolParent, repoRoot });

    expect(second.path).toBe(first.path);
    expect(readFileSync(join(second.path, "changing.txt"), "utf8")).toBe("two\n");
  });

  it("restores a tampered file the slot's index marks assume-unchanged", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    first.release();
    git({ args: ["update-index", "--assume-unchanged", "steady.txt"], dir: first.path });
    writeFileSync(join(first.path, "steady.txt"), "tampered\n");

    const second = lease({ poolParent, repoRoot });

    expect(second.path).toBe(first.path);
    expect(readFileSync(join(second.path, "steady.txt"), "utf8")).toBe("never changes\n");
  });

  it("rebuilds a slot whose tree lost its .git, discarding what the damaged tree held", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    first.release();
    rmSync(join(first.path, ".git"), { force: true });
    writeFileSync(join(first.path, "debris.txt"), "from the damaged tree\n");

    const second = lease({ poolParent, repoRoot });

    expect(second.path).toBe(first.path);
    expect(existsSync(join(second.path, "debris.txt"))).toBe(false);
    expect(git({ args: ["status", "--porcelain", "--ignored"], dir: second.path })).toBe("");
    expect(git({ args: ["rev-parse", "HEAD"], dir: second.path }).trim()).toBe(second.commit);
  });

  it("gives two live leases two slots, and a released one back to the next caller", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const one = lease({ poolParent, repoRoot });
    const two = lease({ poolParent, repoRoot });

    expect(one.path === two.path).toBe(false);
    expect(markersOf({ snapshot: one })[0]!).toMatch(/^state\.busy\.\d+\.[0-9a-f]{12}\.[0-9a-f-]{36}$/);

    one.release();
    one.release();
    const three = lease({ poolParent, repoRoot });

    expect(three.path).toBe(one.path);
    expect(existsSync(two.path)).toBe(true);
  });

  it("keeps the tree on release and leaves exactly one free marker, however often it is called", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const snapshot = lease({ poolParent, repoRoot });

    snapshot.release();
    snapshot.release();

    expect(existsSync(join(snapshot.path, "steady.txt"))).toBe(true);
    expect(markersOf({ snapshot })).toEqual(["state.free"]);
  });

  it("reclaims a slot whose holder has exited, and never one a live process holds", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const dead = lease({ poolParent, repoRoot });
    const live = lease({ poolParent, repoRoot });
    const deadSlot = dirname(dead.path);
    const liveSlot = dirname(live.path);
    renameSync(
      join(deadSlot, markersOf({ snapshot: dead })[0]!),
      join(deadSlot, `state.busy.${String(deadPid())}.000000000000.${randomUUID()}`),
    );
    // A live process that is not this one, stamped with its real start time: the test runner's parent.
    renameSync(
      join(liveSlot, markersOf({ snapshot: live })[0]!),
      join(liveSlot, busyMarkerFor({ pid: process.ppid })!),
    );

    const next = lease({ poolParent, repoRoot });

    expect(next.path).toBe(dead.path);
    expect(markersOf({ snapshot: next })[0]!).toMatch(new RegExp(`^state\\.busy\\.${String(process.pid)}\\.`));
    expect(markersOf({ snapshot: live })[0]!).toMatch(new RegExp(`^state\\.busy\\.${String(process.ppid)}\\.`));
  });

  /**
   * Counterexample: a holder that exited but whose parent never reaped it. The zombie answers
   * `kill(pid, 0)` and `ps` still prints its start time, so only its `Z` state says it is gone. `exec sleep`
   * replaces the shell, and sleep never waits, so the child stays a zombie until the sleep is killed.
   *
   * The child is `sleep 1`, not `true`: a `true` can exit before the shell execs, and a shell that reaps it
   * there leaves no zombie at all. Waiting for one in a synchronous loop then blocked the test's own timeout
   * and hung CI's subprocess job until its 20-minute limit (run 38035732901). So the wait is async and bounded.
   */
  it("reclaims a slot whose holder is a zombie", async () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const parent = spawn("sh", ["-c", "sleep 1 & echo $!; exec sleep 60"], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const [line] = (await once(parent.stdout, "data")) as [Buffer];
      const zombie = Number(line.toString().trim());
      // Stamped while it still runs: the shared probe reads a zombie as not running, so it mints it no lease.
      const marker = busyMarkerFor({ pid: zombie })!;
      const state = (): string => spawnSync("ps", ["-o", "stat=", "-p", String(zombie)], { encoding: "utf8" }).stdout;
      const deadline = Date.now() + 15_000;
      while (!state().startsWith("Z") && Date.now() < deadline) {
        await delay(50);
      }
      expect(state()).toMatch(/^Z/);
      const held = lease({ poolParent, repoRoot });
      const slot = dirname(held.path);
      renameSync(join(slot, markersOf({ snapshot: held })[0]!), join(slot, marker));

      const next = lease({ poolParent, repoRoot });

      expect(next.path).toBe(held.path);
      expect(markersOf({ snapshot: next })[0]!).toMatch(new RegExp(`^state\\.busy\\.${String(process.pid)}\\.`));
    } finally {
      parent.kill();
    }
  });

  it("shares one pool across every linked worktree of a repository", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const linked = join(ownDir({ prefix: "slopweaver-pool-linked-" }), "wt");
    git({ args: ["worktree", "add", "-q", "--detach", linked, "HEAD"], dir: repoRoot });

    const fromMain = lease({ poolParent, repoRoot });
    const fromLinked = lease({ poolParent, repoRoot: linked });
    const poolRoot = snapshotPoolRoot({ commonGitDir: realpathSync(join(repoRoot, ".git")), poolParent });

    expect(dirname(dirname(fromMain.path))).toBe(poolRoot);
    expect(dirname(dirname(fromLinked.path))).toBe(poolRoot);
    expect(fromMain.path === fromLinked.path).toBe(false);
  });

  it("refuses a tree carrying a gitlink, and returns the slot it had leased", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const head = git({ args: ["rev-parse", "HEAD"], dir: repoRoot }).trim();
    git({ args: ["update-index", "--add", "--cacheinfo", `160000,${head},vendored`], dir: repoRoot });
    git({ args: ["commit", "-qm", "gitlink"], dir: repoRoot });
    // An uninitialised submodule is an empty directory. Without it the scratch index stages the gitlink as
    // deleted and the snapshot would carry none.
    mkdirSync(join(repoRoot, "vendored"));

    const result = acquirePooledSnapshot({ poolParent, repoRoot });
    const poolRoot = snapshotPoolRoot({ commonGitDir: realpathSync(join(repoRoot, ".git")), poolParent });

    expect(unwrapErr(result).message).toContain("gitlink");
    expect(readdirSync(join(poolRoot, "slot-0"))).toEqual(["state.free"]);
  });

  /** With modes ignored, reset keeps an executable bit someone set in a free slot. */
  it("refuses a repository whose core.filemode is false", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const pooled = lease({ poolParent, repoRoot });
    pooled.release();
    git({ args: ["config", "core.filemode", "false"], dir: repoRoot });

    const result = acquirePooledSnapshot({ poolParent, repoRoot });

    expect(existsSync(pooled.path)).toBe(true);
    expect(unwrapErr(result).message).toContain("core.filemode is false");
  });

  /**
   * Config that only a linked worktree sees is read where reset runs, not in the source checkout.
   *
   * The witness of a rebuild is a new inode for an unchanged file, and an inode NUMBER is only a witness while
   * the old file still holds it: a rebuild deletes the old tree before writing the new one, and ext4 handed the
   * freed number straight back (run 41504504039, both attempts). So the old file is held open across the
   * second lease — read-only, which moves neither its mtime nor its ctime, so reset still sees it untouched.
   */
  it("rebuilds rather than resets when conditional config weakens stat checks inside the slot alone", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const first = lease({ poolParent, repoRoot });
    const held = openSync(join(first.path, "steady.txt"), "r");
    try {
      const steadyBefore = fstatSync(held, { bigint: true }).ino;
      first.release();
      const include = join(ownDir({ prefix: "slopweaver-pool-include-" }), "weak.gitconfig");
      writeFileSync(include, "[core]\n\ttrustctime = false\n");
      const linked = `includeIf.gitdir:${realpathSync(join(repoRoot, ".git"))}/worktrees/**.path`;
      git({ args: ["config", linked, include], dir: repoRoot });

      const second = lease({ poolParent, repoRoot });

      expect(second.path).toBe(first.path);
      expect(git({ args: ["config", "--get", "core.trustctime"], dir: second.path }).trim()).toBe("false");
      expect(statSync(join(second.path, "steady.txt"), { bigint: true }).ino).not.toBe(steadyBefore);
    } finally {
      closeSync(held);
    }
  });

  /** Without ctime, a same-size rewrite with its mtime put back reads clean to reset. */
  it("refuses a repository that ignores ctime, by core.trustctime or core.checkstat", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    lease({ poolParent, repoRoot }).release();
    git({ args: ["config", "core.trustctime", "false"], dir: repoRoot });
    const untrusted = acquirePooledSnapshot({ poolParent, repoRoot });
    git({ args: ["config", "--unset", "core.trustctime"], dir: repoRoot });
    git({ args: ["config", "core.checkstat", "minimal"], dir: repoRoot });
    const minimal = acquirePooledSnapshot({ poolParent, repoRoot });

    expect(unwrapErr(untrusted).message).toContain("core.trustctime is false or core.checkstat is minimal");
    expect(unwrapErr(minimal).message).toContain("core.trustctime is false or core.checkstat is minimal");
  });

  /**
   * A second counterexample: a smudge program can change its output while its config line, the
   * attributes and the commit all stay put, so no fingerprint can vouch for a reused slot. A tree routed
   * through one is refused and left to a fresh snapshot; a configured driver nothing routes to still pools.
   */
  it("refuses a tree routed through a smudge filter, and pools one whose configured filter nothing uses", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    git({ args: ["config", "filter.demo.smudge", "cat"], dir: repoRoot });
    git({ args: ["config", "filter.demo.clean", "cat"], dir: repoRoot });
    const unrouted = lease({ poolParent, repoRoot });
    unrouted.release();

    mkdirSync(join(repoRoot, "nested"));
    writeFileSync(join(repoRoot, "nested", ".gitattributes"), "*.txt filter=demo\n");
    git({ args: ["add", "-A"], dir: repoRoot });
    git({ args: ["commit", "-qm", "route through demo"], dir: repoRoot });
    const routed = acquirePooledSnapshot({ poolParent, repoRoot });

    expect(existsSync(join(unrouted.path, "steady.txt"))).toBe(true);
    expect(unwrapErr(routed).message).toContain('"demo" smudge filter');
    expect(markersOf({ snapshot: unrouted })).toEqual(["state.free"]);
  });

  it("keeps its slots out of every operational worktree reader while git still lists them", () => {
    const repoRoot = seededRepo();
    const poolParent = ownDir({ prefix: "slopweaver-pool-" });
    const snapshot = lease({ poolParent, repoRoot });

    expect(git({ args: ["worktree", "list", "--porcelain"], dir: repoRoot })).toContain(
      `worktree ${realpathSync(snapshot.path)}`,
    );
    expect(listWorktrees({ repoRoot }).map((worktree) => worktree.path)).toEqual([realpathSync(repoRoot)]);
  });

  it("falls back to a fresh snapshot once every slot is leased", () => {
    const repoRoot = seededRepo();
    appendFileSync(join(repoRoot, "changing.txt"), "DIRTY\n");
    // The default pool parent, because `freezeWithProvenance` leases from it: the per-file temp sandbox.
    const held = Array.from({ length: SNAPSHOT_POOL_SLOTS }, () => lease({ poolParent: tmpdir(), repoRoot }));

    const refused = acquirePooledSnapshot({ repoRoot });
    const frozen = freezeWithProvenance({ repoRoot });
    const poolRoot = snapshotPoolRoot({ commonGitDir: realpathSync(join(repoRoot, ".git")), poolParent: tmpdir() });

    expect(new Set(held.map((snapshot) => snapshot.path)).size).toBe(SNAPSHOT_POOL_SLOTS);
    expect(unwrapErr(refused).message).toContain("is leased");
    expect(frozen.frozen!.path.startsWith(poolRoot)).toBe(false);
    expect(frozen.frozen!.contentTree).toBe(captureContentTree({ repoRoot })._unsafeUnwrap());
    frozen.frozen!.release();
    expect(existsSync(frozen.frozen!.path)).toBe(false);
  });
});

describe("checkoutFingerprint", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("is stable under unchanged rules and moves with core.autocrlf, a filter, info/attributes or global attributes", () => {
    const repoRoot = seededRepo();
    const commonGitDir = realpathSync(join(repoRoot, ".git"));
    const print = (): string => checkoutFingerprint({ commonGitDir, off: [], repoRoot });
    const before = print();
    const again = print();
    git({ args: ["config", "core.autocrlf", "true"], dir: repoRoot });
    const autocrlf = print();
    git({ args: ["config", "filter.upper.smudge", "tr a-z A-Z"], dir: repoRoot });
    const filtered = print();
    mkdirSync(join(commonGitDir, "info"), { recursive: true });
    writeFileSync(join(commonGitDir, "info", "attributes"), "*.txt filter=upper\n");
    const attributed = print();
    // A trailing space in the name: the digest must read the file git names, not a trimmed neighbour.
    const globalFile = join(ownDir({ prefix: "slopweaver-pool-attrs-" }), "attributes ");
    writeFileSync(globalFile, "*.txt text eol=lf\n");
    git({ args: ["config", "core.attributesfile", globalFile], dir: repoRoot });
    const globalLf = print();
    // Only the global file's CONTENT changes here, so the digest must read the file git var names.
    writeFileSync(globalFile, "*.txt text eol=crlf\n");
    const globalCrlf = print();

    expect(again).toBe(before);
    expect(new Set([before, autocrlf, filtered, attributed, globalLf, globalCrlf]).size).toBe(6);
  });
});

describe("refuseUnpoolableTree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("passes a plain tree and names core.checkstat minimal when it refuses one", () => {
    const repoRoot = seededRepo();
    const refuse = (): void =>
      refuseUnpoolableTree({
        commit: git({ args: ["rev-parse", "HEAD"], dir: repoRoot }).trim(),
        commonGitDir: realpathSync(join(repoRoot, ".git")),
        repoRoot,
        staging: ownDir({ prefix: "slopweaver-pool-staging-" }),
      });
    refuse();
    git({ args: ["config", "core.checkstat", "minimal"], dir: repoRoot });

    expect(refuse).toThrow("core.trustctime is false or core.checkstat is minimal");
  });
});
