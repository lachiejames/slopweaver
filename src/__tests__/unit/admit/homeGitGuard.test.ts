/**
 * The state-home git guard: a bare remote-facing `git` that resolves to the state home's own repository is
 * refused, and everything that names its repository, reads locally, or lands in a nested checkout passes.
 *
 * The filesystem is a real fixture — a temp "home" holding a `.git`, a scratch directory under it, a checkout
 * nested under it with its own `.git`, and an unrelated checkout outside it — because the criterion IS where
 * git would discover a repository, and a faked walk would test the fake.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { bareRemoteGit, discoveredRepositoryRoot, evaluateHomeGitGuard } from "../../../admit/homeGitGuard.js";
import { runHomeGitGuard } from "../../../admit/homeGitGuardRunner.js";

const ROOT = mkdtempSync(join(tmpdir(), "home-git-"));
const HOME = join(ROOT, "state-home");
const SCRATCH = join(HOME, "supervisor-scratch", "handoff-9226");
const NESTED = join(HOME, "codex", "pass-1", "checkout");
const WORKTREE = join(ROOT, "slopweaver");
mkdirSync(join(HOME, ".git"), { recursive: true });
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(join(NESTED, ".git"), { recursive: true });
mkdirSync(join(WORKTREE, ".git"), { recursive: true });

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

/** Evaluate one command from one directory against the fixture home. */
function hit({ command, cwd }: { command: string; cwd: string }): ReturnType<typeof evaluateHomeGitGuard> {
  return evaluateHomeGitGuard({ command, cwd, stateHome: HOME });
}

/** Run the guard's runner over one Bash payload, collecting stderr. */
async function judge({
  command,
  cwd,
  env = {},
}: {
  command: string;
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runHomeGitGuard({
    env,
    readStdin: () => Promise.resolve(JSON.stringify({ cwd, tool_input: { command }, tool_name: "Bash" })),
    stateHome: HOME,
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

describe("bareRemoteGit", () => {
  it("names a remote-facing subcommand", () => {
    expect(bareRemoteGit({ segment: "git fetch -q origin main" })).toEqual({ sub: "fetch", trigger: "git fetch" });
    expect(bareRemoteGit({ segment: "git pull --ff-only" })).toEqual({ sub: "pull", trigger: "git pull" });
    expect(bareRemoteGit({ segment: "git ls-remote origin" })).toEqual({ sub: "ls-remote", trigger: "git ls-remote" });
  });

  it("names a remote-tracking ref argument on any subcommand", () => {
    expect(bareRemoteGit({ segment: "git rev-parse --short origin/main" })).toEqual({
      sub: "rev-parse",
      trigger: "origin/main",
    });
    expect(bareRemoteGit({ segment: "git log --oneline origin/main..HEAD" })).toEqual({
      sub: "log",
      trigger: "origin/main..HEAD",
    });
    expect(bareRemoteGit({ segment: "git rev-parse HEAD@{u}" })).toEqual({ sub: "rev-parse", trigger: "HEAD@{u}" });
  });

  it("passes a local read, a non-git command and a git that names its repository", () => {
    expect(bareRemoteGit({ segment: "git ls-files supervisor-scratch" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "git status" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "grep origin/main notes.md" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "git -C /repo fetch origin main" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "git -C/repo rev-parse origin/main" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "git --git-dir=/repo/.git fetch" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "git --work-tree /repo fetch" })).toBe(undefined);
    expect(bareRemoteGit({ segment: "GIT_DIR=/repo/.git git fetch" })).toBe(undefined);
  });

  it("does not read a ref whose remote merely ends in origin as origin's", () => {
    expect(bareRemoteGit({ segment: "git rev-parse myorigin/main" })).toBe(undefined);
  });
});

describe("discoveredRepositoryRoot", () => {
  it("walks up to the nearest .git, stopping at a nested checkout", () => {
    expect(discoveredRepositoryRoot({ cwd: SCRATCH })).toBe(HOME);
    expect(discoveredRepositoryRoot({ cwd: HOME })).toBe(HOME);
    expect(discoveredRepositoryRoot({ cwd: NESTED })).toBe(NESTED);
    expect(discoveredRepositoryRoot({ cwd: WORKTREE })).toBe(WORKTREE);
  });
});

describe("evaluateHomeGitGuard", () => {
  it("refuses the handoff-9226 command, both halves, from a scratch directory under the home", () => {
    expect(hit({ command: `cd ${SCRATCH} && git fetch -q origin main`, cwd: WORKTREE })).toEqual({
      cwd: SCRATCH,
      segment: "git fetch -q origin main",
      trigger: "git fetch",
    });
    expect(hit({ command: "git rev-parse --short origin/main", cwd: SCRATCH })).toEqual({
      cwd: SCRATCH,
      segment: "git rev-parse --short origin/main",
      trigger: "origin/main",
    });
  });

  it("refuses at the home root itself", () => {
    expect(hit({ command: "git pull", cwd: HOME })!.trigger).toBe("git pull");
  });

  it("passes the same read from the checkout it was meant for", () => {
    expect(hit({ command: "git fetch -q origin main", cwd: WORKTREE })).toBe(undefined);
  });

  it("passes a -C naming another repository from inside the home", () => {
    expect(hit({ command: `git -C ${WORKTREE} rev-parse --short origin/main`, cwd: SCRATCH })).toBe(undefined);
  });

  it("passes a -C naming the home itself, which is deliberate", () => {
    expect(hit({ command: `git -C ${HOME} fetch origin main`, cwd: WORKTREE })).toBe(undefined);
  });

  it("passes a checkout nested under the home", () => {
    expect(hit({ command: "git fetch origin main", cwd: NESTED })).toBe(undefined);
  });

  it("passes a local read of the state repository", () => {
    expect(hit({ command: "git ls-files supervisor-scratch", cwd: HOME })).toBe(undefined);
  });

  it("fails open on a directory it cannot resolve statically", () => {
    expect(hit({ command: 'cd "$SLOPWEAVER_HOME" && git fetch origin main', cwd: WORKTREE })).toBe(undefined);
  });

  it("fails open once a pushd or popd moves the directory the resolver does not follow", () => {
    expect(hit({ command: `pushd ${WORKTREE} && git fetch origin main`, cwd: HOME })).toBe(undefined);
    expect(hit({ command: "popd && git fetch origin main", cwd: HOME })).toBe(undefined);
  });

  it("fails open when a GIT_DIR exported earlier in the command aims git elsewhere", () => {
    expect(hit({ command: `export GIT_DIR=${WORKTREE}/.git; git fetch origin main`, cwd: HOME })).toBe(undefined);
  });

  it("still refuses a pushd that comes only after the refused segment", () => {
    expect(hit({ command: `git fetch origin main && pushd ${WORKTREE}`, cwd: HOME })!.trigger).toBe("git fetch");
  });

  it("is opened by an inline hatch on the refused segment", () => {
    expect(hit({ command: "SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT=1 git fetch origin main", cwd: HOME })).toBe(undefined);
  });
});

describe("runHomeGitGuard", () => {
  it("refuses with exit 2 and a four-line refusal naming the segment, the home, the remedy and the hatch", async () => {
    const { code, errors } = await judge({ command: "git rev-parse --short origin/main", cwd: SCRATCH });
    expect(code).toBe(2);
    expect(errors.length).toBe(1);
    const refusal = errors[0]!;
    expect(refusal).toContain("`git rev-parse --short origin/main` (origin/main) would run in");
    expect(refusal).toContain(`would run in ${SCRATCH}, inside the state repository at ${HOME}`);
    expect(refusal).toContain("git -C <the checkout you mean>");
    expect(refusal).toContain("SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT=1");
    expect(refusal).toContain("Use good judgement");
  });

  it("allows an unrelated command and writes nothing", async () => {
    expect(await judge({ command: "ls", cwd: SCRATCH })).toEqual({ code: 0, errors: [] });
  });

  it("is opened by the hatch in the hook's environment", async () => {
    const opened = await judge({
      command: "git fetch origin main",
      cwd: HOME,
      env: { SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT: "1" },
    });
    expect(opened).toEqual({ code: 0, errors: [] });
  });

  it("fails OPEN on a payload it cannot read", async () => {
    const errors: string[] = [];
    const code = await runHomeGitGuard({
      env: {},
      readStdin: () => Promise.resolve("not json"),
      stateHome: HOME,
      writeError: (line) => {
        errors.push(line);
      },
    });
    expect({ code, errors }).toEqual({ code: 0, errors: [] });
  });
});
