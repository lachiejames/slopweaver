import { describe, expect, it } from "vitest";

import { withoutSeatEnv } from "../../../cmux/outsideEnv.js";

describe("withoutSeatEnv", () => {
  it("drops every CMUX_ key a seat exports and keeps the rest", () => {
    expect(
      withoutSeatEnv({
        env: {
          CMUX_SOCKET_CAPABILITY: "token",
          CMUX_SURFACE_ID: "BBD27E0C",
          CMUX_WORKSPACE_ID: "6038BFD6",
          HOME: "/Users/h",
          PATH: "/usr/bin",
          XCMUX_KEEP: "kept",
        },
      }),
    ).toEqual({ HOME: "/Users/h", PATH: "/usr/bin", XCMUX_KEEP: "kept" });
  });

  it("drops a Claude Code seat's session, messaging channel and routed plan, as the installed app carried them", () => {
    expect(
      withoutSeatEnv({
        env: {
          AI_AGENT: "claude-code_2-1-319_agent",
          CLAUDECODE: "1",
          CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
          CLAUDE_CODE_MESSAGING_TOKEN: "FIXTURE-TOKEN",
          CLAUDE_CODE_SESSION_ID: "7aa118e1",
          CLAUDE_PID: "4242",
          CLAUDE_HOOK_SPOOL_DIR: "/var/folders/x/cmux-claude-hooks",
          CLAUDE_SECURESTORAGE_CONFIG_DIR: "/Users/h/.slopweaver/claude-accounts/plan-three",
          CLAUDE_WRAPPER_SHIM: "/Users/h/.cmuxterm/shims/claude",
          GIT_EDITOR: "true",
          SLOPWEAVER_HOME: "/Users/h/.slopweaver",
          TRACEPARENT: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
      }),
    ).toEqual({ GIT_EDITOR: "true", SLOPWEAVER_HOME: "/Users/h/.slopweaver" });
  });

  it("keeps only the owner's Claude configuration the app reads, and drops a Claude key no list named", () => {
    expect(
      withoutSeatEnv({
        env: {
          CLAUDE_CODE_ENABLE_TELEMETRY: "1",
          CLAUDE_CODE_SESSION_ACCESS_TOKEN: "FIXTURE-ACCESS-TOKEN",
          CLAUDE_CODE_SESSION_ID: "7aa118e1",
          CLAUDE_CONFIG_DIR: "/Users/h/.claude-owner",
        },
      }),
    ).toEqual({ CLAUDE_CONFIG_DIR: "/Users/h/.claude-owner" });
  });

  it("drops everything a Codex process exported, its routed home included, and every vendor credential", () => {
    expect(
      withoutSeatEnv({
        env: {
          ANTHROPIC_API_KEY: "FIXTURE-KEY",
          CODEX_API_KEY: "FIXTURE-KEY",
          CODEX_CI: "1",
          CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex_sdk_ts",
          CODEX_VERSION: "0.162.1",
          CODEX_HOME: "/Users/h/.codex-three",
          CODEX_SANDBOX: "seatbelt",
          CODEX_SESSION_ID: "01a1c045",
          CODEX_THREAD_ID: "01a1c045",
          OPENAI_API_KEY: "FIXTURE-KEY",
          OPENAI_BASE_URL: "https://example.invalid",
          USER: "h",
        },
      }),
    ).toEqual({ OPENAI_BASE_URL: "https://example.invalid", USER: "h" });
  });

  it("drops the nx switch a fleet worktree seat's boot line exports", () => {
    expect(withoutSeatEnv({ env: { NX_DAEMON: "false", NX_VERBOSE_LOGGING: "true" } })).toEqual({
      NX_VERBOSE_LOGGING: "true",
    });
  });

  it("drops the switch a Codex pass's shell sets, under which the opened app would start as Node", () => {
    expect(withoutSeatEnv({ env: { ELECTRON_ENABLE_LOGGING: "1", ELECTRON_RUN_AS_NODE: "1" } })).toEqual({
      ELECTRON_ENABLE_LOGGING: "1",
    });
  });

  it("returns an empty environment unchanged", () => {
    expect(withoutSeatEnv({ env: {} })).toEqual({});
  });
});
