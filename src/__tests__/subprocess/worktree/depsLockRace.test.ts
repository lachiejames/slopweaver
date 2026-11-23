/**
 * The own-versus-shared race on one worktree, run with real processes under DIFFERENT state homes: an own-tree
 * provision (`holdOwnTree` around a recycle claim and a stand-in install) and a shared-deps link
 * (`linkSharedUnderLock`) released at one instant on the same path. The schedule is built three ways — with
 * no lock, with a lock under `SLOPWEAVER_HOME` that two homes walk straight past, and with a lock released between
 * the claim and the install, where the link lands while yarn is running.
 *
 * The properties: nothing replaces `node_modules` while an install is running; whichever lands first, a link that
 * reported success is what stands there afterwards; and no pool entry is lost. Timing is a witness, not a schedule
 * — a green run shows the invariants held under whatever contention this machine produced, and the lock is what
 * makes them hold under every other.
 */
import { spawn } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { safeJsonParse } from "../../../lib/safeJson.js";
import { depositRecycled, recyclePoolDir } from "../../../worktree/recyclePool.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "worktree", "depsLockContender.entry.ts");

/** One own provision and one link per worktree; four worktrees fill the pool's four slots. */
const WORKTREES = 4;
/** Long enough for eight `tsx` processes to boot before the barrier opens; a slower one is late, not excluded. */
const BARRIER_LEAD_MS = 3000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A linked worktree of the package `repo`: its manifest, and a `.git` file naming its own git directory. */
function seedWorktree({ root, name }: { root: string; name: string }): string {
  const worktree = join(root, name);
  const gitDir = join(root, "repo", ".git", "worktrees", name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  mkdirSync(worktree);
  writeFileSync(join(worktree, "package.json"), '{"name":"repo"}');
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  return worktree;
}

/** Run one contender under its own state home, resolving once it has written its outcome. */
function contend({ args, home }: { args: readonly string[]; home: string }): Promise<void> {
  const child = spawn(TSX, [CONTENDER, ...args], {
    env: { ...process.env, SLOPWEAVER_HOME: home },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveExit();
      } else {
        rejectExit(new Error(`contender exited ${String(code)}`));
      }
    });
  });
}

/** One contender's recorded outcome. */
function outcomeOf({ file }: { file: string }): Record<string, unknown> {
  return Object(safeJsonParse({ label: "deps lock race outcome", text: readFileSync(file, "utf8") }));
}

describe("an own provision and a shared link of one worktree, under two state homes", () => {
  it("never swaps the tree under an install, leaves every successful link standing and loses no pool entry", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "deps-race-")));
    fixtureDirs.push(root);
    const repo = join(root, "repo");
    const pool = recyclePoolDir({ repoRoot: repo });
    const shared = join(root, "shared");
    mkdirSync(shared);
    for (let index = 0; index < WORKTREES; index += 1) {
      const source = join(root, `src-${String(index)}`);
      mkdirSync(source);
      writeFileSync(join(source, ".yarn-state.yml"), '"repo@workspace:.":\n  locations:\n    - ""\n');
      expect(depositRecycled({ entryName: `e${String(index)}`, pool, source }).kind).toBe("deposited");
    }
    const worktrees = Array.from({ length: WORKTREES }, (_, index) =>
      seedWorktree({ name: `w${String(index)}`, root }),
    );
    const outcomes = join(root, "outcomes");
    mkdirSync(outcomes);
    const startAt = String(Date.now() + BARRIER_LEAD_MS);

    await Promise.all(
      worktrees.flatMap((worktree, index) => [
        contend({
          args: ["own", worktree, repo, join(outcomes, `own-${String(index)}.json`), startAt],
          home: join(root, `home-own-${String(index)}`),
        }),
        contend({
          args: ["link", worktree, shared, join(outcomes, `link-${String(index)}.json`), startAt],
          home: join(root, `home-link-${String(index)}`),
        }),
      ]),
    );

    const links = worktrees.map((_, index) => outcomeOf({ file: join(outcomes, `link-${String(index)}.json`) }));
    const owns = worktrees.map((_, index) => outcomeOf({ file: join(outcomes, `own-${String(index)}.json`) }));
    expect(links.map((link) => link["kind"])).toEqual(["linked", "linked", "linked", "linked"]);
    expect(owns.filter((own) => own["kind"] === "own-failed")).toEqual([]);
    // What stood at node_modules when the stand-in install began is what stood there when it ended.
    const seen = owns.map((own) => own["seen"] as readonly string[]);
    expect(seen.map((pair) => pair[1])).toEqual(seen.map((pair) => pair[0]));
    expect(seen.map((pair) => pair.length)).toEqual([2, 2, 2, 2]);
    expect(worktrees.map((worktree) => lstatSync(join(worktree, "node_modules")).isSymbolicLink())).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(worktrees.map((worktree) => readlinkSync(join(worktree, "node_modules")))).toEqual(
      worktrees.map(() => shared),
    );
    const claimed = owns.filter((own) => own["kind"] === "claimed").length;
    const left = readdirSync(pool).flatMap((slot) => readdirSync(join(pool, slot))).length;
    expect(claimed + left).toBe(WORKTREES);
  });
});
