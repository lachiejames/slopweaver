/*
 * The two environments a session's processes start under: the worker's (no API credential, no Node preload, the
 * routed CODEX_HOME) and the adapter's (the same scrub again, the native codex named, the worker's own config never
 * passed on). The credential list must stay the CLI's own (`src/codex/client.ts`), because neither tree can import
 * the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADAPTER_AGENT_MODE, adapterEnvironment } from "../../src/sessionWorker/adapterEnvironment";
import { codexBrowserOffConfig } from "../../src/sessionWorker/codexBrowserOff";
import { CODEX_CREDENTIAL_KEYS, codexSessionEnvironment } from "../../src/sessionWorker/codexEnvironmentPolicy";
import { type CodexWorkerLaunchConfig, WORKER_CONFIG_ENV } from "../../src/sessionWorker/workerWire";

const REPO = join(__dirname, "..", "..", "..");

/** The session config every adapter is handed with no model named: the browser-off overrides alone. */
const BROWSER_OFF_ONLY = JSON.stringify(codexBrowserOffConfig());

const CONFIG: CodexWorkerLaunchConfig = {
  adapterEntry: "/a.js",
  codexHome: "/home/codex-plan-1",
  codexPath: "/bin/codex",
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "codex",
};

describe("codexSessionEnvironment", () => {
  it("drops every API credential and the Node preload, and routes CODEX_HOME", () => {
    const environment = codexSessionEnvironment({
      codexHome: "/home/codex-plan-1",
      inherited: {
        CODEX_API_KEY: "k",
        CODEX_HOME: "/elsewhere",
        NODE_OPTIONS: "--require /tmp/inject.cjs",
        OPENAI_API_KEY: "k",
        PATH: "/usr/bin",
      },
    });
    expect(environment).toEqual({ CODEX_HOME: "/home/codex-plan-1", PATH: "/usr/bin" });
  });

  it("drops the same credential keys the CLI's Codex client drops", () => {
    const client = readFileSync(join(REPO, "src", "codex", "client.ts"), "utf8");
    expect(CODEX_CREDENTIAL_KEYS.length).toBeGreaterThan(0);
    for (const key of CODEX_CREDENTIAL_KEYS) {
      expect(client).toContain(`"${key}"`);
    }
  });

  it("cannot have a credential key removed by an importer", () => {
    expect(() => (CODEX_CREDENTIAL_KEYS as string[]).splice(0, 1)).toThrow(TypeError);
    expect(
      codexSessionEnvironment({ codexHome: "/home/codex-plan-1", inherited: { OPENAI_API_KEY: "wrong-account" } }),
    ).toEqual({ CODEX_HOME: "/home/codex-plan-1" });
  });

  it("drops a name carrying '=' or a NUL, which the child would read back as a credential", () => {
    const inherited = { "": "e", "OPENAI_API_KEY=shadow": "secret", "CODEX_API_KEY\0x": "secret", PATH: "/usr/bin" };
    expect(codexSessionEnvironment({ codexHome: "/routed", inherited })).toEqual({
      CODEX_HOME: "/routed",
      PATH: "/usr/bin",
    });
    expect(Object.keys(adapterEnvironment({ config: CONFIG, inherited })).toSorted()).toEqual([
      "CODEX_CONFIG",
      "CODEX_HOME",
      "CODEX_PATH",
      "ELECTRON_RUN_AS_NODE",
      "INITIAL_AGENT_MODE",
      "PATH",
    ]);
  });

  it("inherits nothing, so a key set on Object.prototype never reaches a spawned child", () => {
    const environment = codexSessionEnvironment({ codexHome: "/home/codex-plan-1", inherited: {} });
    expect(Object.getPrototypeOf(environment)).toBe(null);
    expect(Object.getPrototypeOf(adapterEnvironment({ config: CONFIG, inherited: {} }))).toBe(null);
  });
});

describe("adapterEnvironment", () => {
  it("names the native codex, the agent mode and the model, and never passes the worker's config on", () => {
    const environment = adapterEnvironment({
      config: { ...CONFIG, model: "gpt-5" },
      inherited: { HOME: "/home", [WORKER_CONFIG_ENV]: "{}" },
    });
    expect(environment).toEqual({
      CODEX_CONFIG: JSON.stringify({ ...codexBrowserOffConfig(), model: "gpt-5" }),
      CODEX_HOME: "/home/codex-plan-1",
      CODEX_PATH: "/bin/codex",
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/home",
      INITIAL_AGENT_MODE: ADAPTER_AGENT_MODE,
    });
  });

  it("scrubs a credential and a changed CODEX_HOME the worker's own environment gained after launch", () => {
    const environment = adapterEnvironment({
      config: CONFIG,
      inherited: {
        CODEX_ACCESS_TOKEN: "t",
        CODEX_HOME: "/elsewhere",
        NODE_OPTIONS: "--require /tmp/inject.cjs",
        OPENAI_API_KEY: "wrong-account",
      },
    });
    expect(environment).toEqual({
      CODEX_CONFIG: BROWSER_OFF_ONLY,
      CODEX_HOME: "/home/codex-plan-1",
      CODEX_PATH: "/bin/codex",
      ELECTRON_RUN_AS_NODE: "1",
      INITIAL_AGENT_MODE: ADAPTER_AGENT_MODE,
    });
  });

  it("sets no model when the session names none, yet still switches every browser surface off", () => {
    expect(adapterEnvironment({ config: CONFIG, inherited: {} })["CODEX_CONFIG"]).toBe(BROWSER_OFF_ONLY);
  });

  it("switches the browser surfaces off over an inherited CODEX_CONFIG that would have turned them on", () => {
    const inherited = { CODEX_CONFIG: '{"mcp_servers.node_repl.enabled":true}' };
    expect(adapterEnvironment({ config: CONFIG, inherited })["CODEX_CONFIG"]).toBe(BROWSER_OFF_ONLY);
  });
});
