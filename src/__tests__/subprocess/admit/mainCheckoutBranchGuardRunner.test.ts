import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runMainCheckoutBranchGuard } from "../../../admit/mainCheckoutBranchGuardRunner.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repo's main checkout, in a fresh temp dir, still on its default branch. */
function realMainCheckout(): string {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-guard-runner-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  writeFileSync(join(main, "package.json"), '{"name":"slopweaver"}\n');
  gitInTemp({ args: ["add", "package.json"], cwd: main });
  gitInTemp({ args: ["commit", "-q", "-m", "root"], cwd: main });
  return main;
}

/** A separate real repository with its own linked worktree. */
function realRepoWithWorktree(): { readonly linked: string; readonly main: string } {
  const main = realMainCheckout();
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-guard-runner-separate-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

/** Run the guard with an injected stdin string + capture the written diagnostics. */
async function run({
  stdin,
  allowOverride = false,
}: {
  stdin: string;
  allowOverride?: boolean;
}): Promise<{ code: number; errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runMainCheckoutBranchGuard({
    env: allowOverride ? { SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH: "1" } : {},
    readStdin: () => Promise.resolve(stdin),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

describe("runMainCheckoutBranchGuard", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("blocks an off-trunk checkout with exit 2 + a message, using a fake main-worktree check", async () => {
    const errors: string[] = [];
    const code = await runMainCheckoutBranchGuard({
      env: {},
      evaluate: () => ({ block: true, message: "blocked for the test" }),
      readStdin: () =>
        Promise.resolve(
          JSON.stringify({ cwd: "/repo", tool_input: { command: "git checkout stray" }, tool_name: "Bash" }),
        ),
      writeError: (line) => {
        errors.push(line);
      },
    });
    expect(code).toBe(2);
    expect(errors.join("")).toBe("blocked for the test\n");
  });

  it("allows a non-Bash tool call", async () => {
    expect(await run({ stdin: JSON.stringify({ cwd: "/repo", tool_input: {}, tool_name: "Read" }) })).toEqual({
      code: 0,
      errors: [],
    });
  });

  it("allows on malformed JSON — this guard fails OPEN, unlike the raw-tool door", async () => {
    expect(await run({ stdin: "not-json" })).toEqual({ code: 0, errors: [] });
  });

  it("allows a Bash payload missing cwd — fails open on state it cannot use", async () => {
    expect(
      await run({ stdin: JSON.stringify({ tool_input: { command: "git checkout stray" }, tool_name: "Bash" }) }),
    ).toEqual({ code: 0, errors: [] });
  });

  it("allows a real read-only Bash command end to end (no fake evaluate)", async () => {
    expect(
      await run({ stdin: JSON.stringify({ cwd: "/repo", tool_input: { command: "git status" }, tool_name: "Bash" }) }),
    ).toEqual({ code: 0, errors: [] });
  });

  it("blocks a real off-trunk checkout in a real main checkout, end to end", async () => {
    const cwd = realMainCheckout();
    const { code, errors } = await run({
      stdin: JSON.stringify({ cwd, tool_input: { command: "git checkout stray" }, tool_name: "Bash" }),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH");
  });

  it("allows that same real checkout under the override env var, end to end", async () => {
    const cwd = realMainCheckout();
    expect(
      await run({
        allowOverride: true,
        stdin: JSON.stringify({ cwd, tool_input: { command: "git checkout stray" }, tool_name: "Bash" }),
      }),
    ).toEqual({ code: 0, errors: [] });
  });

  it("allows an off-trunk checkout targeted at a separate repository worktree", async () => {
    const sessionRepository = realRepoWithWorktree();
    const targetRepository = realRepoWithWorktree();
    expect(
      await run({
        stdin: JSON.stringify({
          cwd: sessionRepository.main,
          tool_input: { command: `cd ${targetRepository.linked} && git checkout stray` },
          tool_name: "Bash",
        }),
      }),
    ).toEqual({ code: 0, errors: [] });
  });
});
