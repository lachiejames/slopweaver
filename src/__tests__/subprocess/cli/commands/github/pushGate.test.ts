/**
 * `prePushGateRun.ts`'s production pre-push gate — real-git proof that the verb runs a repository's own `pre-push`
 * hook the way git would (argv `<remote> <url>`, git's stdin line, cwd at the root, `GIT_*` stripped) and
 * skips it exactly when git would (absent, or not executable), all BEFORE any transport exists. The
 * ordering itself is asserted in the unit lane; this lane proves the hook edge against a real hook.
 * `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { runPrePushGate } from "../../../../../cli/commands/github/prePushGateRun.js";
import { productionGithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { stripGitEnv } from "../../../../../codex/gitRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

/** This checkout's root, which holds the committed rc file and the lefthook binary `yarn install` provides. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");

/** The committed rc file, as `lefthook.yml`'s `rc:` names it. */
const RC_FILE = "scripts/lefthook-rc.sh";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const STDIN_LINE =
  "1111111111111111111111111111111111111111^{commit} 1111111111111111111111111111111111111111 refs/heads/feature 0000000000000000000000000000000000000000\n";

/** A repository with one remote configured, and its hooks directory known. */
function initRepo(): { readonly dir: string; readonly hooks: string } {
  const dir = mkdtempSync(join(tmpdir(), "push-gate-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["remote", "add", "origin", "git@example.test:owner/repo.git"], cwd: dir });
  const hooks = join(dir, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  return { dir, hooks };
}

/** Install a hook that records what it was given, then exits as told. */
function installHook({ hooks, exitCode, record }: { hooks: string; exitCode: number; record: string }): string {
  const hook = join(hooks, "pre-push");
  writeFileSync(
    hook,
    `#!/bin/sh\n{ echo "argv: $*"; echo "cwd: $(pwd)"; echo "stdin: $(cat)"; env | grep '^GIT_' | sort; } > "${record}"\nexit ${String(exitCode)}\n`,
  );
  chmodSync(hook, 0o755);
  return hook;
}

/** Install a hook that prints one line to stdout and exits 0, as lefthook's shim does with no runner. */
function installPrintingHook({ hooks, stdout }: { hooks: string; stdout: string }): string {
  const hook = join(hooks, "pre-push");
  writeFileSync(hook, `#!/bin/sh\ncat > /dev/null\necho "${stdout}"\n`);
  chmodSync(hook, 0o755);
  return hook;
}

/**
 * Install lefthook's REAL generated shims into a fresh repository — lefthook's own binary, run over a config
 * carrying the committed `rc:` line and a copy of the committed rc file — so a case exercises lefthook's own
 * template rather than a hand-written imitation of it. The shim bakes in the absolute path of the binary that
 * installed it, so that binary is a COPY removed straight after: the baked path is dead, exactly as it was in the
 * shared hook this reproduces, and a runner the shim finds is one the case put there.
 */
function installLefthookShims(): { readonly dir: string; readonly hooks: string } {
  const { dir, hooks } = initRepo();
  const committedRc = readFileSync(join(repoRoot, "lefthook.yml"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("rc: "))!;
  writeFileSync(
    join(dir, "lefthook.yml"),
    [
      committedRc,
      ...["pre-push", "pre-commit", "post-merge", "post-checkout"].map(
        (hook) => `${hook}:\n  commands:\n    ok:\n      run: "true"`,
      ),
    ].join("\n") + "\n",
  );
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(repoRoot, RC_FILE), join(dir, RC_FILE));
  const installer = mkdtempSync(join(tmpdir(), "lefthook-installer-"));
  fixtureDirs.push(installer);
  const binary = join(installer, "lefthook");
  copyFileSync(
    join(repoRoot, "node_modules", `lefthook-${process.platform}-${process.arch}`, "bin", "lefthook"),
    binary,
  );
  chmodSync(binary, 0o755);
  execFileSync(binary, ["install"], { cwd: dir, env: stripGitEnv({ env: process.env }) });
  rmSync(installer, { force: true, recursive: true });
  // lefthook's own pre-push run diffs against HEAD, and exits 1 in a repository that has no commit at all.
  gitInTemp({
    args: ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "--allow-empty", "-m", "x"],
    cwd: dir,
  });
  return { dir, hooks };
}

/**
 * An environment in which the shim can find no lefthook runner but one the checkout itself holds: PATH carries
 * only `node` (which the package's `bin/index.js` runs under) and the system directories, never this
 * repository's `node_modules/.bin`, which the test runner puts on PATH.
 */
function runnerlessEnv(): NodeJS.ProcessEnv {
  const nodeOnly = mkdtempSync(join(tmpdir(), "node-only-"));
  fixtureDirs.push(nodeOnly);
  symlinkSync(process.execPath, join(nodeOnly, "node"));
  return { ...stripGitEnv({ env: process.env }), PATH: `${nodeOnly}:/usr/bin:/bin` };
}

/** Run a generated shim directly, the way git would, in an environment with no runner of its own. */
function runShim({ args, dir, hook }: { args: readonly string[]; dir: string; hook: string }): {
  readonly status: number | null;
  readonly stdout: string;
} {
  const run = spawnSync(join(dir, ".git", "hooks", hook), args, {
    cwd: dir,
    encoding: "utf8",
    env: runnerlessEnv(),
    input: "",
  });
  return { status: run.status, stdout: run.stdout };
}

/** The gate edge of the production driver, which is the thing under test. */
function gate(): NonNullable<ReturnType<typeof productionGithubPushDeps>["prePushGate"]> {
  return productionGithubPushDeps().prePushGate!;
}

describe("the production pre-push gate", () => {
  // Every case below drives the production edge, so this pins that edge to `runPrePushGate` itself.
  it("is runPrePushGate, unwrapped", () => {
    expect(productionGithubPushDeps().prePushGate).toBe(runPrePushGate);
  });

  it(
    "runs the hook with git's argv, stdin and working directory, and no inherited GIT_* selector",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const { dir, hooks } = initRepo();
      const record = join(dir, "record.txt");
      const hook = installHook({ exitCode: 0, hooks, record });
      const outcome = unwrap(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }));
      expect(outcome).toEqual({ hook, kind: "ran" });
      expect(readFileSync(record, "utf8")).toBe(
        `argv: origin git@example.test:owner/repo.git\ncwd: ${gitInTemp({ args: ["rev-parse", "--show-toplevel"], cwd: dir })}\nstdin: ${STDIN_LINE.trimEnd()}\n`,
      );
    },
  );

  it("names the hook and its exit code when it refuses", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    const hook = installHook({ exitCode: 3, hooks, record: join(dir, "record.txt") });
    expect(unwrapErr(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual(
      GithubVerbErrors.hookExited({ hook, status: 3 }),
    );
  });

  // lefthook's generated shim prints this and exits 0 when no lefthook binary resolves (a worktree with no
  // node_modules), having run no gate; reproduced through `github push`, which pushed `--no-verify` behind it.
  it("refuses a hook that exits 0 after reporting lefthook missing", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    const hook = installPrintingHook({ hooks, stdout: "Can't find lefthook in PATH" });
    expect(unwrapErr(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual(
      GithubVerbErrors.hookRunnerMissing({ hook }),
    );
  });

  it("passes a hook whose output only quotes the runner-missing sentence", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    const hook = installPrintingHook({ hooks, stdout: "note: Can't find lefthook in PATH is handled" });
    expect(unwrap(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual({
      hook,
      kind: "ran",
    });
  });

  // The rc file `lefthook.yml` names closes the same hole at the shim itself, so a route that pushes through git —
  // a plain `git push`, `github stack submit` — is refused too. The first case is the witness that the fixture
  // reproduces the hole: with the rc file gone, the real shim reports no runner and exits 0.
  it(
    "reproduces the hole: with no rc file the real shim runs nothing and exits 0",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const { dir } = installLefthookShims();
      rmSync(join(dir, RC_FILE));
      expect(runShim({ args: ["origin", "git@example.test:owner/repo.git"], dir, hook: "pre-push" })).toEqual({
        status: 0,
        stdout: "Can't find lefthook in PATH\n",
      });
    },
  );

  it(
    "refuses through lefthook's real shim when the checkout has no node_modules",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const { dir, hooks } = installLefthookShims();
      expect(unwrapErr(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual(
        GithubVerbErrors.hookExited({ hook: join(hooks, "pre-push"), status: 1 }),
      );
    },
  );

  // The rc file's criterion is the path the shim itself tests, so passing it means the shim finds that runner even
  // with nothing on PATH and a dead baked path — and runs lefthook, whose own summary line says so.
  it(
    "passes through lefthook's real shim when the checkout holds its own lefthook",
    { timeout: REAL_GIT_TIMEOUT_MS },
    () => {
      const { dir } = installLefthookShims();
      mkdirSync(join(dir, "node_modules"));
      symlinkSync(join(repoRoot, "node_modules", "lefthook"), join(dir, "node_modules", "lefthook"));
      const run = runShim({ args: ["origin", "git@example.test:owner/repo.git"], dir, hook: "pre-push" });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("no matching push files");
      expect(run.stdout).not.toContain("Can't find lefthook in PATH");
    },
  );

  it("refuses a plain git push, naming why, and sends nothing", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir } = installLefthookShims();
    const bare = join(dir, "remote.git");
    gitInTemp({ args: ["init", "--bare", "-b", "main", bare], cwd: dir });
    expect(() => gitInTemp({ args: ["push", bare, "main"], cwd: dir })).toThrow(
      "has no node_modules/lefthook, so no pre-push gate can run and nothing was sent",
    );
    expect(gitInTemp({ args: ["for-each-ref"], cwd: bare })).toBe("");
  });

  // post-checkout fires on every `git worktree add`, before anything is installed, and git hands its status back
  // as the command's own, so the rc file must leave every hook but pre-push exactly as lefthook would run it.
  it("leaves every other hook alone in a checkout with no node_modules", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir } = installLefthookShims();
    const zero = "0".repeat(40);
    const others = [
      { args: [zero, zero, "1"], hook: "post-checkout" },
      { args: ["0"], hook: "post-merge" },
      { args: [], hook: "pre-commit" },
    ];
    expect(others.map(({ args, hook }) => ({ hook, ...runShim({ args, dir, hook }) }))).toEqual(
      others.map(({ hook }) => ({ hook, status: 0, stdout: "Can't find lefthook in PATH\n" })),
    );
  });

  it("reports no hook when none is installed, naming where it looked", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    expect(unwrap(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual({
      hook: join(hooks, "pre-push"),
      kind: "no-hook",
    });
  });

  // git skips a hook that is not executable rather than failing on it; the gate does the same, so a
  // half-installed hook produces git's own behaviour instead of a refusal git would never have raised.
  it("treats a hook git would not run as absent", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    const hook = installHook({ exitCode: 0, hooks, record: join(dir, "record.txt") });
    chmodSync(hook, 0o644);
    expect(unwrap(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual({ hook, kind: "no-hook" });
  });

  // lefthook and husky both point `core.hooksPath` elsewhere; the gate finds the hook where git would.
  it("honours core.hooksPath", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir } = initRepo();
    const elsewhere = join(dir, "custom-hooks");
    mkdirSync(elsewhere);
    gitInTemp({ args: ["config", "core.hooksPath", elsewhere], cwd: dir });
    const hook = installHook({ exitCode: 0, hooks: elsewhere, record: join(dir, "record.txt") });
    expect(unwrap(gate()({ cwd: dir, remote: "origin", stdin: STDIN_LINE }))).toEqual({ hook, kind: "ran" });
  });

  it("refuses, naming the remote, when the remote is not configured", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { dir, hooks } = initRepo();
    installHook({ exitCode: 0, hooks, record: join(dir, "record.txt") });
    const reason = unwrapErr(gate()({ cwd: dir, remote: "nowhere", stdin: STDIN_LINE }));
    expect(reason.code).toBe("PRE_PUSH_FAILED");
    expect(reason.message.startsWith("could not locate the pre-push hook: ")).toBe(true);
  });
});
