/*
 * The check before the native Claude Code process starts: the SDK may ask only for the packaged binary in the
 * session's own directory, and the plan carries the token's file, never its contents, on a setup-token seat.
 */
import { describe, expect, it } from "vitest";

import { claudeSpawnPlanOf } from "../../src/sessionWorker/claudeProcessLaunch";
import type { ClaudeWorkerLaunchConfig } from "../../src/sessionWorker/workerWire";

const CONFIG: ClaudeWorkerLaunchConfig = {
  claudeMdExcludes: [],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: "a0000107-0000-4000-8000-000000000118",
};

const REQUEST = {
  args: ["--output-format", "stream-json"],
  command: "/app/claude",
  cwd: "/work/acme",
  env: { ANTHROPIC_API_KEY: "sk-FIXTURE", PATH: "/usr/bin" },
};

describe("claudeSpawnPlanOf", () => {
  it("clears the packaged binary in the session's directory, under the scrubbed and routed environment", () => {
    const plan = claudeSpawnPlanOf({ config: CONFIG, request: REQUEST })._unsafeUnwrap();
    expect(plan).toEqual({
      args: ["--output-format", "stream-json"],
      claudePath: "/app/claude",
      cwd: "/work/acme",
      environment: {
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/claude-two",
        PATH: "/usr/bin",
        SLOPWEAVER_APP_SESSION_ID: "0b5e",
      },
    });
  });

  it("names the token's file on a setup-token seat", () => {
    const config: ClaudeWorkerLaunchConfig = {
      ...CONFIG,
      credential: { kind: "setup-token", secureStorageDir: "/h/claude-three", tokenFilePath: "/h/three.token" },
    };
    const plan = claudeSpawnPlanOf({ config, request: REQUEST })._unsafeUnwrap();
    expect(plan.tokenFilePath).toBe("/h/three.token");
    expect(plan.environment["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"]).toBe("3");
  });

  it("refuses another program", () => {
    const refused = claudeSpawnPlanOf({ config: CONFIG, request: { ...REQUEST, command: "node" } })._unsafeUnwrapErr();
    expect(refused.code).toBe("EXECUTABLE_MISMATCH");
  });

  it("refuses another directory, and none at all", () => {
    expect(
      claudeSpawnPlanOf({ config: CONFIG, request: { ...REQUEST, cwd: "/work/other" } })._unsafeUnwrapErr().code,
    ).toBe("DIRECTORY_MISMATCH");
    const { cwd: _dropped, ...homeless } = REQUEST;
    expect(claudeSpawnPlanOf({ config: CONFIG, request: homeless })._unsafeUnwrapErr().code).toBe("DIRECTORY_MISMATCH");
  });
});
