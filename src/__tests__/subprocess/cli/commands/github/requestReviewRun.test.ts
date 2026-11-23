/**
 * Proves the SHIPPED `bin/slopweaver github pr request-review` binary — not just the injected-fake unit
 * tests — actually dispatches through the real manifest and reaches the real roster port with no token and
 * no network, in an isolated environment carrying none of this machine's real config, so no store either.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-request-review-subprocess-home-"));
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment — never the real machine's config/tokens. */
function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: isolatedHome,
      encoding: "utf8",
      env: { HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("the shipped `github pr request-review` binary", () => {
  it("advertises request-review under `github pr --help`", () => {
    const result = run({ args: ["github", "pr", "--help"] });

    expect(result.stdout.toLowerCase()).toContain("request-review");
  });

  it("refuses with a usage error when required flags are missing, without touching a token", () => {
    const result = run({ args: ["github", "pr", "request-review", "--home", isolatedHome] });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--repo owner/name is required");
    expect(result.stderr).toContain("give at least one of --reviewer");
  });

  // The roster check over a REAL store, answering `no exact match`, is `subprocess/identity/identityRosterCli.test.ts`.
  it("dry-run refuses on a store it cannot open rather than guessing from a file, resolving no token at all", () => {
    const result = run({
      args: [
        "github",
        "pr",
        "request-review",
        "--repo",
        "o/r",
        "--number",
        "1",
        "--reviewer",
        "nobody-the-empty-roster-has-ever-seen",
        "--dry-run",
        "--home",
        isolatedHome,
      ],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "this install keeps its identity roster in the store, and the store could not be opened, so who a handle names is UNKNOWN",
    );
    expect(result.stderr).not.toContain("no GitHub token configured");
  });
});
