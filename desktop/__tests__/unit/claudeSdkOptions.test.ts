/*
 * The Agent SDK options an app Claude session opens with: every setting source, the helper and every credential
 * blanked above them with the routing pinned, the template's exclusions, no prompt anyone answers, and only the optional fields the launch decided.
 */
import { describe, expect, it } from "vitest";

import { claudeSdkOptions, type SpawnedProcess } from "../../src/sessionWorker/claudeSdkOptions";
import type { ClaudeWorkerLaunchConfig } from "../../src/sessionWorker/workerWire";

const CONFIG: ClaudeWorkerLaunchConfig = {
  claudeMdExcludes: ["/work/acme/AGENTS.md"],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: "a0000107-0000-4000-8000-000000000118",
};

/** Every credential, provider switch and model endpoint the claude binary reads, each blanked in the flag tier. */
const BLANKED = {
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_CUSTOM_HEADERS: "",
  ANTHROPIC_ENVIRONMENT_KEY: "",
  CLAUDE_CODE_CLIENT_KEY: "",
  CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: "",
  CLAUDE_CODE_GATEWAY_HINT_HEADERS: "",
  ANTHROPIC_AWS_API_KEY: "",
  ANTHROPIC_FOUNDRY_API_KEY: "",
  ANTHROPIC_FOUNDRY_AUTH_TOKEN: "",
  ANTHROPIC_IDENTITY_TOKEN: "",
  ANTHROPIC_IDENTITY_TOKEN_FILE: "",
  CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: "",
  CLAUDE_CODE_CUSTOM_OAUTH_URL: "",
  CLAUDE_CODE_GATEWAY_TOKEN: "",
  CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR: "",
  CLAUDE_CODE_HFI_BEARER_TOKEN: "",
  CLAUDE_CODE_HOST_AUTH_ENV_VAR: "",
  CLAUDE_CODE_HOST_CREDS_FILE: "",
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "",
  CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "",
  CLAUDE_CODE_OAUTH_TOKEN: "",
  CLAUDE_CODE_SESSION_ACCESS_TOKEN: "",
  CLAUDE_CODE_SESSIONS_OAUTH_TOKEN: "",
  CLAUDE_CODE_USE_ANTHROPIC_AWS: "",
  CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD: "",
  CLAUDE_CODE_USE_BEDROCK: "",
  CLAUDE_CODE_USE_FOUNDRY: "",
  CLAUDE_CODE_USE_GATEWAY: "",
  CLAUDE_CODE_USE_MANTLE: "",
  CLAUDE_CODE_USE_VERTEX: "",
  CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR: "",
  ANTHROPIC_API_HOST: "",
  ANTHROPIC_AWS_BASE_URL: "",
  ANTHROPIC_BASE_URL: "",
  ANTHROPIC_BEDROCK_BASE_URL: "",
  ANTHROPIC_BEDROCK_MANTLE_BASE_URL: "",
  ANTHROPIC_FOUNDRY_BASE_URL: "",
  ANTHROPIC_GOOGLE_CLOUD_BASE_URL: "",
  ANTHROPIC_VERTEX_BASE_URL: "",
  CLAUDE_CODE_API_BASE_URL: "",
};

/** A plain seam standing in for the worker's spawner; never called here. */
const spawner = (): SpawnedProcess => {
  throw new Error("not spawned in a unit test");
};

describe("claudeSdkOptions", () => {
  it("opens on every setting source with the helper blanked and the template's exclusions, and nothing optional", () => {
    expect(claudeSdkOptions({ config: CONFIG, spawnClaudeCodeProcess: spawner })).toEqual({
      cwd: "/work/acme",
      pathToClaudeCodeExecutable: "/app/claude",
      permissionPrompts: "none",
      sessionId: "a0000107-0000-4000-8000-000000000118",
      settingSources: ["user", "project", "local"],
      settings: {
        apiKeyHelper: "",
        claudeMdExcludes: ["/work/acme/AGENTS.md"],
        env: {
          ...BLANKED,
          CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "",
          CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/claude-two",
          SLOPWEAVER_APP_SESSION_ID: "0b5e",
        },
      },
      spawnClaudeCodeProcess: spawner,
    });
  });

  it("pins a setup-token seat's descriptor in the flag tier, above any settings file's env", () => {
    const options = claudeSdkOptions({
      config: {
        ...CONFIG,
        credential: { kind: "setup-token", secureStorageDir: "/h/claude-token", tokenFilePath: "/h/t" },
      },
      spawnClaudeCodeProcess: spawner,
    });
    expect(options.settings).toEqual({
      apiKeyHelper: "",
      claudeMdExcludes: ["/work/acme/AGENTS.md"],
      env: {
        ...BLANKED,
        CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "/h/claude-token",
        SLOPWEAVER_APP_SESSION_ID: "0b5e",
      },
    });
  });

  it("carries the model, effort and plugin directory the launch named", () => {
    const options = claudeSdkOptions({
      config: { ...CONFIG, effort: "high", model: "opus", pluginDir: "/work/acme" },
      spawnClaudeCodeProcess: spawner,
    });
    expect(options.model).toBe("opus");
    expect(options.effort).toBe("high");
    expect(options.plugins).toEqual([{ path: "/work/acme", type: "local" }]);
  });

  it("names a new transcript by its minted id, and a resumed one only through `resume`", () => {
    const fresh = claudeSdkOptions({ config: CONFIG, spawnClaudeCodeProcess: spawner });
    const resumed = claudeSdkOptions({
      config: { ...CONFIG, resumeVendorSessionId: CONFIG.vendorSessionId },
      spawnClaudeCodeProcess: spawner,
    });
    expect([fresh.sessionId, fresh.resume]).toEqual([CONFIG.vendorSessionId, undefined]);
    expect([resumed.sessionId, resumed.resume]).toEqual([undefined, CONFIG.vendorSessionId]);
  });
});
