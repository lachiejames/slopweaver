/**
 * The helpers every `scripts/docs-site.sh` cache-root suite in this directory shares: the repository root and the
 * script, the throwaway directories each file drains in its own `afterEach`, the environment one run sees, and the
 * script runner and its `--print-cache-paths` reader.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");

export const made: string[] = [];

/**
 * A throwaway directory the file removes.
 *
 * @returns the new directory, registered in `made` for the file's `afterEach` to remove
 */
export function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-cache-root-"));
  made.push(dir);
  return dir;
}

/**
 * The environment one run sees: a user home of its own, and only the cache variables a case names.
 *
 * @returns this process's environment with `HOME` and `SLOPWEAVER_HOME` under `user`, both cache variables cleared,
 *   then `over` applied
 */
export function envOf({
  user,
  over,
}: {
  user: string;
  over: Readonly<Record<string, string>>;
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: user, SLOPWEAVER_HOME: join(user, "home") };
  delete env["SLOPWEAVER_CACHE_HOME"];
  delete env["XDG_CACHE_HOME"];
  return { ...env, ...over };
}

/**
 * Run the script with one flag, answering its exit code and both streams.
 *
 * @returns the script's exit status, stdout and stderr
 */
export function run({ args, env, cwd = repoRoot }: { args: readonly string[]; env: NodeJS.ProcessEnv; cwd?: string }): {
  code: number | null;
  stdout: string;
  stderr: string;
} {
  const done = spawnSync("bash", [SCRIPT, ...args], { cwd, encoding: "utf8", env });
  return { code: done.status, stderr: done.stderr, stdout: done.stdout };
}

/**
 * `--print-cache-paths`'s three lines, keyed.
 *
 * @returns each printed `key=value` line as one entry, after asserting the script exited 0
 */
export function printed({ env, cwd }: { env: NodeJS.ProcessEnv; cwd?: string }): Readonly<Record<string, string>> {
  const out = run({ args: ["--print-cache-paths"], env, ...(cwd === undefined ? {} : { cwd }) });
  expect(out.code).toBe(0);
  return Object.fromEntries(
    out.stdout
      .trim()
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}
