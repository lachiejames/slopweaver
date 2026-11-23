/**
 * The chained-stack doors, proved through the SHIPPED binary rather than through an imported function — the
 * half of the proof an in-process test cannot give, because it is the wiring that has broken before: a verb
 * whose argv offset is wrong, or a sub-verb the dispatcher never learned, passes every unit test in this
 * repository and fails the first time a person types it.
 *
 * Every case here is OFFLINE by construction. `pr create`'s refusal is printed before the parser, before a
 * token and before any client; `stack audit`'s usage refusal is printed before the token resolver. Nothing in
 * this file reaches GitHub, so it is a real end-to-end witness that costs no network.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/**
 * Run the shipped binary with a deliberately minimal environment.
 *
 * `spawnSync`, not `execFileSync`: every case here expects a non-zero exit, and `execFileSync` throws away
 * the output on one.
 */
function runBin({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, [...args], {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("bin/slopweaver — the chained-stack doors", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("refuses `github pr create` and names the one verb that opens a pull request", () => {
    const result = runBin({ args: ["github", "pr", "create", "--form", "-"] });

    expect(result.status).toBe(2);
    const printed = result.stdout + result.stderr;
    expect(printed).toContain("refused: `github pr create` no longer opens pull requests.");
    expect(printed).toContain("Use `github stack push` instead.");
    expect(printed).toContain("base naming another open pull request's branch joins that pull request's stack");
  });

  it("carries `audit` in its own stack dispatcher, and refuses it without a repository", () => {
    const result = runBin({ args: ["github", "stack", "audit"] });

    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain("--repo owner/name is required");
  });

  it("refuses a repository slug that is not owner/name, before resolving a credential", () => {
    const result = runBin({ args: ["github", "stack", "audit", "--repo", "just-a-name"] });

    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain('--repo must be owner/name; "just-a-name" is not');
  });

  it("still lists `audit` as an unknown sub-verb's alternative, so the dispatcher really knows it", () => {
    const result = runBin({ args: ["github", "stack", "no-such-sub-verb"] });

    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain(
      "usage: slopweaver github stack <push|sync|restack|submit|adopt|audit|remove|dissolve> [...]",
    );
  });

  it("names --adopt in `pr retarget`'s own usage, which is the flag the chain refusal points at", () => {
    const result = runBin({ args: ["github", "pr", "retarget"] });

    expect(result.status).toBe(2);
    const printed = result.stdout + result.stderr;
    expect(printed).toContain("[--adopt]");
    expect(printed).toContain("retarget, then");
  });
});
