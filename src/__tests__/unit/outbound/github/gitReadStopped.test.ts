/**
 * `throwIfStopped` — a merge sweep's git read killed at its bound must stop the sweep with a named reason, never
 * come back as "absent", "no files" or "unknown". The thrown value is what each
 * sweep's entry catches, so its class and message are the contract.
 */
import { describe, expect, it } from "vitest";

import { GitReadStoppedError, throwIfStopped } from "../../../../outbound/github/gitReadStopped.js";

/** What Node throws for an `execFileSync` child its `timeout` killed. */
const killedAtBound = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT", signal: "SIGKILL" });

/** Run `throwIfStopped` and answer what it threw, or `undefined` when it returned. */
function thrownBy({ error }: { error: unknown }): unknown {
  try {
    throwIfStopped({ command: "show main:AGENTS.md", error, timeoutMs: 120_000 });
  } catch (thrown: unknown) {
    return thrown;
  }
  return undefined;
}

describe("throwIfStopped", () => {
  it("throws the one error a sweep catches, naming the command and its bound", () => {
    const thrown = thrownBy({ error: killedAtBound });
    expect(thrown).toBeInstanceOf(GitReadStoppedError);
    expect((thrown as GitReadStoppedError).message).toBe(
      "git show main:AGENTS.md was still running after 2 minutes, so it was stopped",
    );
    expect((thrown as GitReadStoppedError).code).toBe("GIT_READ_TIMED_OUT");
  });

  it("returns on an ordinary non-zero exit, which the caller still reads as before", () => {
    const exited = Object.assign(new Error("Command failed: git show"), { status: 128 });
    expect(thrownBy({ error: exited })).toBe(undefined);
  });
});
