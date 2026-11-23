/*
 * What the operation-lock test files share: a throwaway home per case, removed after every case by the
 * `afterEach` that `useTempDirs()` registers, and the two readers that find the one lock directory and the one
 * token file a real acquire left under it. The lock is tested against a real temp directory rather than a mocked
 * filesystem — the thing under test IS the on-disk rename-into-place exclusivity and stale-takeover behaviour, the
 * sanctioned exception in `.claude/rules/testing.md`. The eight-process race that proves the takeover exclusive
 * lives in `src/__tests__/subprocess/admit/operationLockRace.test.ts`, because it needs real processes.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useTempDirs(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A fresh throwaway home, removed after the case.
 *
 * @returns the new directory's absolute path
 */
export function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-operationlock-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * The single lock DIRECTORY under one home — exactly one, so a test that finds two has found a defect.
 *
 * @returns the lock directory's absolute path
 */
export function lockDirIn({ h }: { h: string }): string {
  const dir = join(h, "ledgers", "operation-locks");
  const locks = readdirSync(dir).filter((name) => name.endsWith(".lock"));
  expect(locks).toHaveLength(1);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- toHaveLength(1) above establishes the entry; a fallback would change the old in-file helper's failure behaviour
  return join(dir, locks[0]!);
}

/**
 * The single token file inside a lock directory, so a test can rewrite the pid a real acquire recorded.
 *
 * @returns the token file's absolute path
 */
export function lockFileIn({ h }: { h: string }): string {
  const dir = lockDirIn({ h });
  const tokens = readdirSync(dir);
  expect(tokens).toHaveLength(1);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- toHaveLength(1) above establishes the entry; a fallback would change the old in-file helper's failure behaviour
  return join(dir, tokens[0]!);
}
