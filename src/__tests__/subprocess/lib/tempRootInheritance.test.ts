/**
 * The half of the temp-root sandbox (`src/__tests__/setup-temp-root.ts`) that a unit test cannot observe:
 * a SPAWNED process resolves the sandbox too.
 *
 * This is the half that matters for the incident. The three tests that blocked `slopweaver github push` on
 * a push leaked from spawned work, not from the test process — `github/stackSquash.test.ts` shells a
 * real `git init` into a temp repository, and `cli/commands/connect/fixture.test.ts` spawns the shipped
 * `bin/slopweaver` binary, each of which mints its own directories under whatever `os.tmpdir()` answers
 * inside the CHILD. A redirect that only moved this process's own `tmpdir()` would leave that untouched and
 * the backlog would keep growing with a green suite.
 *
 * It works because `TMPDIR` is an environment variable and a child inherits the environment, so the
 * assertion is on the mechanism rather than on a coincidence: a child that resolves the same root is a child
 * whose fixtures this file's `afterAll` removes.
 */
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMP_ROOT_PREFIX } from "../../setup-temp-root.js";

// register-class: test-fixture-mints-a-temp-dir-with-no-cleanup (docs/recurring-failure-register/bindings.md)

/** What a spawned Node reports for `os.tmpdir()`, given the environment it inherits from this process. */
function childTmpdir({ env }: { env: NodeJS.ProcessEnv }): string {
  return execFileSync(process.execPath, ["-p", "require('node:os').tmpdir()"], { encoding: "utf8", env }).trim();
}

describe("a spawned child resolves the temp-root sandbox", () => {
  it("answers this test file's own root, not the machine's shared temp directory", () => {
    expect(childTmpdir({ env: process.env })).toBe(tmpdir());
    expect(basename(tmpdir()).startsWith(TEMP_ROOT_PREFIX)).toBe(true);
  });

  // The falsifiable half: strip the variable back out and the same child answers somewhere else. Without
  // this, a green case above would also be green on a machine whose shared temp directory happened to be
  // the sandbox, and would prove nothing about the redirect.
  it("falls back to the shared temp directory once TMPDIR is stripped from the child's environment", () => {
    const { TMPDIR: _stripped, ...withoutTmpdir } = process.env;

    expect(childTmpdir({ env: withoutTmpdir })).not.toBe(tmpdir());
  });
});
