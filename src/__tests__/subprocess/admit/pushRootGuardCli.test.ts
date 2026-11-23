/**
 * The `pre-push` hook's old-history entry (`src/admit/pushRootGuardCli.ts`), run as the hook runs it: a child
 * process, the remote name and push URL as argv, git's ref lines on stdin, the state home from the environment. The
 * committed `lefthook.yml` row is pinned beside it, so the entry this proves is the one a push actually starts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { writePushRootBinding } from "../../../admit/pushRootStore.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI = join(repoRoot, "src", "admit", "pushRootGuardCli.ts");
const BOUND_URL = "git@github.com:acme/widgets.git";
const ZERO = "0".repeat(40);
/** Resolved here, because the child's cwd is a throwaway repository with no `node_modules` to find `tsx` in. */
const TSX_LOADER = import.meta.resolve("tsx");

describe("the pre-push old-history entry", REAL_GIT_SUITE, () => {
  let repo = "";
  let home = "";
  let freshTip = "";
  let oldTip = "";
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: repo });
  const hook = ({ url, stdin }: { url: string | undefined; stdin: string }) =>
    spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, "origin", ...(url === undefined ? [] : [url])], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH: "", SLOPWEAVER_HOME: home },
      input: stdin,
      timeout: 60_000,
    });
  const refLine = ({ sha }: { sha: string }): string => `refs/heads/main ${sha} refs/heads/main ${ZERO}\n`;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "push-root-hook-"));
    home = mkdtempSync(join(tmpdir(), "push-root-hook-home-"));
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("commit", "--allow-empty", "-m", "fresh root");
    const freshRoot = git("rev-parse", "HEAD");
    git("commit", "--allow-empty", "-m", "fresh work");
    freshTip = git("rev-parse", "HEAD");
    git("checkout", "--orphan", "old");
    git("commit", "--allow-empty", "-m", "old root");
    oldTip = git("rev-parse", "HEAD");
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-01-02T03:04:05.000Z", repository: "acme/widgets", rootSha: freshRoot },
        home,
      }),
    );
  });

  afterAll(() => {
    for (const dir of [repo, home]) rmSync(dir, { force: true, recursive: true });
  });

  it("exits 0 for a push of the fresh history", () => {
    expect(hook({ stdin: refLine({ sha: freshTip }), url: BOUND_URL }).status).toBe(0);
  });

  it("exits 1 for a push of the old history, naming the hatch on stderr", () => {
    const ran = hook({ stdin: refLine({ sha: oldTip }), url: BOUND_URL });

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("pre-push refused: nothing was sent:");
    expect(ran.stderr).toContain("SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH=1");
  });

  it("exits 0 for the old history pushed to a repository that was never re-cut", () => {
    expect(hook({ stdin: refLine({ sha: oldTip }), url: "git@github.com:acme/gadgets.git" }).status).toBe(0);
  });

  it("exits 1 when git handed it no push URL", () => {
    const ran = hook({ stdin: refLine({ sha: freshTip }), url: undefined });

    expect([ran.status, ran.stderr.startsWith("pre-push refused:")]).toEqual([1, true]);
  });

  it("exits 1 on a stdin line that is not a ref line, rather than skipping it", () => {
    const ran = hook({ stdin: "not a ref line\n", url: BOUND_URL });

    expect([ran.status, ran.stderr.startsWith("pre-push refused:")]).toEqual([1, true]);
  });

  it("is the committed pre-push row, first, with git's stdin and both hook arguments", () => {
    const lefthook = readFileSync(join(repoRoot, "lefthook.yml"), "utf8");

    expect(lefthook).toContain(
      "    old-history-push:\n      priority: 1\n      use_stdin: true\n      run: node_modules/.bin/tsx src/admit/pushRootGuardCli.ts {1} {2}\n",
    );
  });
});
