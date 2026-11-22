/**
 * Proves the SHIPPED `atlas vanta policy-versions` and `write vanta upload-policy-version` hand their flag
 * parser the tail AFTER their own verb name. Both once sliced the full argv one word short, so the verb's own
 * name reached the parser and every invocation exited 2 with `unexpected argument: <verb>` — as measured,
 * and a `--help` sweep cannot see it because `--help` short-circuits before the parse
 * (`verbTail`, `src/cli/optionParsers.ts`).
 *
 * The witness is the refusal the parser reaches only once the tail is right: with no `--policy`, a verb that
 * parsed its real flags names the missing flag, while one that ate its own name refuses that name first.
 * Neither run reaches a browser, because both refuse before any transport is built.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-vanta-argv-tail-"));
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment — never the real machine's config/tokens. */
function runBin({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, [...args, "--home", join(isolatedHome, "state")], {
      cwd: isolatedHome,
      encoding: "utf8",
      env: { ...accountSandboxChildEnv(), HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    // execFileSync sets these whenever the subprocess actually ran with `encoding` given.
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("Vanta policy verbs parse the argv tail after their own name", () => {
  it("atlas vanta policy-versions names the missing --policy, not its own verb", () => {
    const result = runBin({ args: ["atlas", "vanta", "policy-versions"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--policy <id> is required");
    expect(result.stderr).not.toContain("unexpected argument: policy-versions");
  });

  it("write vanta upload-policy-version names the missing --policy, not its own verb", () => {
    const result = runBin({ args: ["write", "vanta", "upload-policy-version", "--dry-run"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--policy <id> is required");
    expect(result.stderr).not.toContain("unexpected argument: upload-policy-version");
  });
});
