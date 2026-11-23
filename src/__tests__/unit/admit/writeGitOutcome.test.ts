/**
 * `writeGitOutcome` — what one finished push or fetch child means. The timeout branch is the reason it is its
 * own function: a push sat on an ssh passphrase prompt, or a transport that stopped moving, used to hold the
 * session forever, and now ends at its bound as a named line rather than Node's bare `spawnSync git ETIMEDOUT`.
 *
 * The result values are the shapes Node reports, measured on Node 24.21 against a `sleep` past its bound
 * under the call's `killSignal: "SIGKILL"`: `error.code` is `ETIMEDOUT`, `signal` `SIGKILL`, `status` null.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { writeGitFailure, writeGitOutcome } from "../../../admit/gitTransport.js";
import { GitWriteErrors } from "../../../admit/gitTransportErrors.js";

/** The result Node hands back for a child its `timeout` killed. */
const timedOut = {
  error: Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" }),
  signal: "SIGKILL",
  status: null,
} as const;

describe("writeGitOutcome names a push stopped at its bound", () => {
  it("says the push was stopped after its twenty-minute bound, not Node's bare ETIMEDOUT", () => {
    expect(unwrapErr(writeGitOutcome({ result: timedOut }))).toContain("still running after 50 minutes");
  });

  it("says a timed-out push is not a rejection by the remote, so nobody re-reads it as one", () => {
    expect(unwrapErr(writeGitOutcome({ result: timedOut }))).toContain("not a rejection by the remote");
  });

  it("does not report the timeout as the SIGKILL that delivered it", () => {
    expect(unwrapErr(writeGitOutcome({ result: timedOut }))).not.toContain("killed by SIGKILL");
  });

  it("types the timeout by its own code, never as the kill or the exit it is not", () => {
    expect(writeGitFailure({ result: timedOut })).toEqual(GitWriteErrors.timedOut({ timeoutMs: 50 * 60_000 }));
    expect(writeGitFailure({ result: { signal: "SIGPIPE", status: null } })!.code).toBe("GIT_WRITE_KILLED");
  });
});

describe("writeGitOutcome keeps every other ending as it was", () => {
  it("answers ok when git exited 0", () => {
    expect(unwrap(writeGitOutcome({ result: { signal: null, status: 0 } }))).toBe(undefined);
  });

  it("names a non-zero exit by its status", () => {
    expect(unwrapErr(writeGitOutcome({ result: { signal: null, status: 1 } }))).toBe("git exited 1");
  });

  it("names a signal that was not a timeout", () => {
    expect(unwrapErr(writeGitOutcome({ result: { signal: "SIGPIPE", status: null } }))).toContain(
      "git was killed by SIGPIPE",
    );
  });

  it("passes any other spawn failure through as its own message", () => {
    const missing = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
    expect(unwrapErr(writeGitOutcome({ result: { error: missing, signal: null, status: null } }))).toBe(
      "spawnSync git ENOENT",
    );
  });
});
