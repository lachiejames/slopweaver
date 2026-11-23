/**
 * `github stack push`'s fact read against REAL temporary git repositories: an untracked path the pull request
 * never touched is refused before any remote read, and a staged new file passes.
 *
 * MEASURED: a fresh worktree's `node_modules` SYMLINK once rode into a pull request's amend
 * because `node_modules/` in the ignore file matches a directory only. Whether git lists a symlink under that
 * pattern is a fact about git as actually invoked, so a fake could only prove itself; each case reads through
 * the production Git edges and the production amend pin.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GithubStackPushDeps,
  productionGithubStackPushDeps,
} from "../../../../../cli/commands/github/stackPushDeps.js";
import { resolveStackPushFacts } from "../../../../../cli/commands/github/stackPushGit.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A committed repository whose ignore file names `node_modules/` with the slash, beside a real dependency
 * directory a `node_modules` symlink can point at, and a remote whose URL names an owner/name repository.
 */
function seededRepo(): { dir: string } {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-untracked-"));
  fixtureDirs.push(root);
  const dir = join(root, "repo");
  mkdirSync(join(root, "deps"));
  mkdirSync(dir);
  gitInTemp({ args: ["init", "-q", "-b", "top"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  gitInTemp({ args: ["remote", "add", "origin", "git@github.com:acme/widgets.git"], cwd: dir });
  // The remote read after the check must never reach a network: git refuses the transport locally instead.
  gitInTemp({ args: ["config", "protocol.ssh.allow", "never"], cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "feature.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "feature"], cwd: dir });
  return { dir };
}

/**
 * The fact read over the production edges, with every printed line captured.
 *
 * @param afterPin runs straight after the production pin returns, to move the worktree between pin and check
 */
function readFacts({ dir, afterPin = () => undefined }: { dir: string; afterPin?: () => void }): {
  facts: unknown;
  lines: readonly string[];
} {
  const lines: string[] = [];
  const production = productionGithubStackPushDeps();
  const out = ({ line }: { line: string }): void => {
    lines.push(line);
  };
  const captureAmendTree: GithubStackPushDeps["captureAmendTree"] = (input) => {
    const pinned = production.captureAmendTree(input);
    afterPin();
    return pinned;
  };
  const facts = resolveStackPushFacts({
    args: { cwd: dir, dryRun: false, remote: "origin" },
    deps: { ...production, captureAmendTree, git: { ...production.git, out }, out },
  });
  return { facts, lines };
}

describe("resolveStackPushFacts over a real repository", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("refuses an untracked node_modules symlink the slashed ignore pattern lets through", () => {
    const { dir } = seededRepo();
    symlinkSync(join(dir, "..", "deps"), join(dir, "node_modules"));

    const { facts, lines } = readFacts({ dir });

    expect(facts).toBe(undefined);
    expect(lines).toEqual([
      "refused: the amend would add untracked path the pull request never touched (node_modules) — nothing was " +
        "staged, committed or sent. Stage one you mean to send with `git add -- <path>`; remove or ignore the " +
        "rest, then run stack push again",
    ]);
    expect(gitInTemp({ args: ["diff", "--cached", "--name-only"], cwd: dir })).toBe("");
  });

  it("refuses a path the pin captured even when it is gone from the worktree by the check", () => {
    const { dir } = seededRepo();
    const leak = join(dir, "leak.txt");
    writeFileSync(leak, "captured\n");

    // Deleted straight after the pin: recreated byte-identical before the amend, it would match the pin exactly.
    const { facts, lines } = readFacts({ afterPin: () => rmSync(leak), dir });

    expect(facts).toBe(undefined);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("never touched (leak.txt)");
  });

  it("refuses a tracked path staged for deletion that the worktree still holds", () => {
    const { dir } = seededRepo();
    writeFileSync(join(dir, "victim.txt"), "kept\n");
    gitInTemp({ args: ["add", "--", "victim.txt"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "victim"], cwd: dir });
    writeFileSync(join(dir, "feature.ts"), "export const a = 2;\n");
    gitInTemp({ args: ["commit", "-qam", "change only the feature"], cwd: dir });
    // The index drops victim.txt while the worktree keeps it, byte-identical to HEAD: the whole-worktree add
    // would put back exactly what the session staged out, and the pin matches HEAD there, so nothing was ADDED.
    gitInTemp({ args: ["rm", "-q", "--cached", "--", "victim.txt"], cwd: dir });

    const { facts, lines } = readFacts({ dir });

    expect(facts).toBe(undefined);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("never touched (victim.txt)");
  });

  it("lets the same symlink through untouched once the ignore pattern drops its slash", () => {
    const { dir } = seededRepo();
    symlinkSync(join(dir, "..", "deps"), join(dir, "node_modules"));
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    gitInTemp({ args: ["commit", "-qam", "ignore the symlink form"], cwd: dir });

    expect(gitInTemp({ args: ["ls-files", "--others", "--exclude-standard"], cwd: dir })).toBe("");
  });

  it("passes a new file the session staged on purpose, reaching the remote read", () => {
    const { dir } = seededRepo();
    writeFileSync(join(dir, "added.ts"), "export const b = 2;\n");
    gitInTemp({ args: ["add", "--", "added.ts"], cwd: dir });

    const { facts, lines } = readFacts({ dir });

    // Past the check, the remote read is the next thing to run, and the fixture's transport ban refuses it.
    expect(facts).toBe(undefined);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("transport 'ssh' not allowed");
  });
});
