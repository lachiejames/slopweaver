/*
 * An app-hosted Claude session's two environments: no inherited Anthropic or Claude variable survives either bar the
 * owner's configuration, the native process gets the plan's store and, on a setup-token seat only, the descriptor its
 * token is on. The desktop restates the CLI's namespaces because it cannot import them at run time, so this holds each
 * copy to its authority.
 */
import { describe, expect, it } from "vitest";

import { SETUP_TOKEN_FD, SETUP_TOKEN_FD_ENV } from "../../../src/claude/seatToken.js";
import {
  APP_CLAUDE_DROPPED_PREFIXES,
  APP_CLAUDE_KEPT_VARIABLES,
} from "../../../src/sessionHarness/appCredentialContext.js";
import {
  CLAUDE_DROPPED_PREFIXES,
  CLAUDE_KEPT_KEYS,
  CLAUDE_TOKEN_FD,
  CLAUDE_TOKEN_FD_ENV,
  claudeNativeEnvironment,
  claudeWorkerEnvironment,
} from "../../src/sessionWorker/claudeEnvironmentPolicy";
import { type ClaudeWorkerLaunchConfig, WORKER_CONFIG_ENV } from "../../src/sessionWorker/workerWire";

const STORE: ClaudeWorkerLaunchConfig = {
  claudeMdExcludes: [],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: "a0000107-0000-4000-8000-000000000118",
};

const TOKEN: ClaudeWorkerLaunchConfig = {
  ...STORE,
  credential: { kind: "setup-token", secureStorageDir: "/h/claude-three", tokenFilePath: "/h/three.token" },
};

const INHERITED = {
  ANTHROPIC_API_KEY: "sk-FIXTURE",
  ANTHROPIC_AUTH_TOKEN: "FIXTURE",
  ANTHROPIC_BASE_URL: "https://example.invalid",
  CLAUDECODE: "1",
  CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "FIXTURE",
  CLAUDE_CODE_OAUTH_TOKEN: "FIXTURE",
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "9",
  CLAUDE_CODE_SESSION_ACCESS_TOKEN: "FIXTURE",
  CLAUDE_CONFIG_DIR: "/home/acme/.claude",
  CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/someone-else",
  ELECTRON_RUN_AS_NODE: "1",
  HOME: "/home/acme",
  NODE_OPTIONS: "--require /tmp/x.js",
  PATH: "/usr/bin",
  UNSET: undefined,
  [WORKER_CONFIG_ENV]: "{}",
};

describe("the restated lists", () => {
  it("drop exactly the namespaces the CLI's gate judged the seat without, keeping the same names", () => {
    expect(APP_CLAUDE_DROPPED_PREFIXES.length).toBeGreaterThan(0);
    expect([...CLAUDE_DROPPED_PREFIXES]).toEqual([...APP_CLAUDE_DROPPED_PREFIXES]);
    expect([...CLAUDE_KEPT_KEYS]).toEqual([...APP_CLAUDE_KEPT_VARIABLES]);
  });

  it("name the token descriptor every cmux boot line names", () => {
    expect(CLAUDE_TOKEN_FD).toBe(SETUP_TOKEN_FD);
    expect(CLAUDE_TOKEN_FD_ENV).toBe(SETUP_TOKEN_FD_ENV);
  });
});

describe("claudeWorkerEnvironment", () => {
  it("drops every Anthropic and Claude variable but the owner's configuration, and the Node preload", () => {
    expect(claudeWorkerEnvironment({ inherited: INHERITED })).toEqual({
      CLAUDE_CONFIG_DIR: "/home/acme/.claude",
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/home/acme",
      PATH: "/usr/bin",
      [WORKER_CONFIG_ENV]: "{}",
    });
  });
});

describe("claudeNativeEnvironment", () => {
  it("routes a store seat to the plan's store and names no token descriptor", () => {
    expect(claudeNativeEnvironment({ config: STORE, inherited: INHERITED })).toEqual({
      CLAUDE_CONFIG_DIR: "/home/acme/.claude",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/claude-two",
      HOME: "/home/acme",
      PATH: "/usr/bin",
      SLOPWEAVER_APP_SESSION_ID: "0b5e",
    });
  });

  it("routes a setup-token seat to its store and descriptor 3, never the token itself", () => {
    const environment = claudeNativeEnvironment({ config: TOKEN, inherited: INHERITED });
    expect(environment).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
      CLAUDE_CONFIG_DIR: "/home/acme/.claude",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/claude-three",
      HOME: "/home/acme",
      PATH: "/usr/bin",
      SLOPWEAVER_APP_SESSION_ID: "0b5e",
    });
    expect(Object.values(environment)).not.toContain("/h/three.token");
  });

  it("returns an environment with no prototype, as the shared scrub builds it", () => {
    expect(Object.getPrototypeOf(claudeNativeEnvironment({ config: STORE, inherited: INHERITED }))).toBe(null);
  });
});
