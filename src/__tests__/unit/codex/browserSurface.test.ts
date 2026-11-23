/**
 * The ChatGPT app's browser surface, switched off for every Codex this repository starts
 * (`codex/browserSurface.ts`), and the listing parse the browser door reads it back through
 * (`codex/browserProbe.ts`).
 *
 * The rows below are the shapes `codex mcp list --json` printed (codex-cli 0.155.1) for the
 * ambient home the ChatGPT app configured, with paths kept and environment VALUES dropped — the listing
 * masks them anyway, and the classifier reads keys.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCodexMcpList, resolvedCommandPaths } from "../../../codex/browserProbe.js";
import {
  browserCapableServers,
  type CodexMcpServerRow,
  codexBrowserOffFlags,
  codexBrowserOffOverrides,
} from "../../../codex/browserSurface.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CUA_REPL: CodexMcpServerRow = {
  args: ["/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs"],
  command: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
  enabled: true,
  resolvedCommands: ["/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"],
  envKeys: ["BROWSER_USE_AVAILABLE_BACKENDS", "CUA_REPL_ENABLED_SURFACES", "CODEX_HOME"],
  name: "cua_repl",
};

const TRAJECTORY: CodexMcpServerRow = {
  args: ["mcp"],
  command: "/Users/someone/.trajectory/bin/trajectory",
  enabled: true,
  resolvedCommands: ["/Users/someone/.trajectory/bin/trajectory"],
  envKeys: ["TRAJECTORY_HOME"],
  name: "trajectory",
};

describe("the browser-off overrides", () => {
  it("spells every plugin and server in the unquoted dotted form the CLI actually honours", () => {
    expect(codexBrowserOffOverrides()).toEqual([
      "plugins.browser@openai-bundled.enabled=false",
      "plugins.computer-use@openai-bundled.enabled=false",
      "plugins.unified-computer-use@openai-bundled.enabled=false",
      "mcp_servers.node_repl.command=/usr/bin/false",
      "mcp_servers.node_repl.enabled=false",
    ]);
  });

  it("renders the boot-line suffix as one -c pair per override, starting with a space", () => {
    expect(codexBrowserOffFlags()).toBe(
      " -c plugins.browser@openai-bundled.enabled=false -c plugins.computer-use@openai-bundled.enabled=false" +
        " -c plugins.unified-computer-use@openai-bundled.enabled=false -c mcp_servers.node_repl.command=/usr/bin/false" +
        " -c mcp_servers.node_repl.enabled=false",
    );
  });
});

describe("browserCapableServers", () => {
  it("names the app's cua_repl and leaves an unrelated server alone", () => {
    expect(browserCapableServers({ servers: [CUA_REPL, TRAJECTORY] })).toEqual(["cua_repl"]);
  });

  it("never names a DISABLED server, which is the state the overrides produce", () => {
    expect(browserCapableServers({ servers: [{ ...CUA_REPL, enabled: false }, TRAJECTORY] })).toEqual([]);
  });

  // The case the check exists for: the app shipping the same runtime under a name the override list lacks.
  it("catches a renamed server by the runtime it runs", () => {
    const renamed = { ...CUA_REPL, envKeys: [], name: "shiny_new_agent" };

    expect(browserCapableServers({ servers: [renamed] })).toEqual(["shiny_new_agent"]);
  });

  it("catches a server that runs elsewhere but is handed a browser backend", () => {
    const byEnv = { ...TRAJECTORY, envKeys: ["BROWSER_USE_AVAILABLE_BACKENDS"], name: "elsewhere" };

    expect(browserCapableServers({ servers: [byEnv] })).toEqual(["elsewhere"]);
  });

  // macOS's default volume is case-insensitive: an upper-cased bundle path runs the same file (Codex review r6).
  it("matches the runtime and the environment keys whatever their case", () => {
    const shouted = {
      ...TRAJECTORY,
      command: "/APPLICATIONS/CHATGPT.APP/CONTENTS/RESOURCES/CUA_NODE/BIN/NODE_REPL",
      name: "project_browser",
    };
    const lowerEnv = { ...TRAJECTORY, envKeys: ["browser_use_available_backends"], name: "lower_env" };

    expect(browserCapableServers({ servers: [shouted, lowerEnv, TRAJECTORY] })).toEqual([
      "project_browser",
      "lower_env",
    ]);
  });

  it("judges a command at the path its symlinks resolve to, not only as written", () => {
    const linked = {
      ...TRAJECTORY,
      command: "/usr/local/bin/innocent",
      name: "linked",
      resolvedCommands: ["/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"],
    };

    expect(browserCapableServers({ servers: [linked] })).toEqual(["linked"]);
  });

  // A marker anywhere in a part counts, a bare name or a path ENDING in it included (Codex review r8).
  it("catches a runtime marker with no path separator around it", () => {
    const bare = { ...TRAJECTORY, command: "cua_node", name: "future_browser", resolvedCommands: ["/opt/x/cua_node"] };

    expect(browserCapableServers({ servers: [bare] })).toEqual(["future_browser"]);
  });

  it("answers an empty list for no servers", () => {
    expect(browserCapableServers({ servers: [] })).toEqual([]);
  });
});

describe("parseCodexMcpList", () => {
  it("reads command, args and both kinds of environment key off a stdio row", () => {
    const stdout = JSON.stringify([
      {
        enabled: true,
        name: "node_repl",
        transport: {
          args: [],
          command: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl",
          env: { BROWSER_USE_TINYSKY_ENABLED: "*****" },
          env_vars: ["CODEX_CLI_PATH"],
          type: "stdio",
        },
      },
    ]);

    expect(unwrap(parseCodexMcpList({ stdout }))).toEqual([
      {
        args: [],
        command: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl",
        enabled: true,
        envKeys: ["BROWSER_USE_TINYSKY_ENABLED", "CODEX_CLI_PATH"],
        name: "node_repl",
        resolvedCommands: [],
      },
    ]);
  });

  // A listing's size is its data's, so no key list is ever spread into one call's arguments (Codex review).
  it("reads an environment-key list far past the engine's argument limit", () => {
    const envVars = Array.from({ length: 200_000 }, (_, index) => `K${String(index)}`);
    const stdout = JSON.stringify([
      { enabled: true, name: "wide", transport: { command: "x", env: { A: "*" }, env_vars: envVars, type: "stdio" } },
    ]);

    const envKeys = unwrap(parseCodexMcpList({ stdout }))[0]!.envKeys;

    expect(envKeys).toHaveLength(200_001);
    expect(envKeys[0]).toBe("A");
    expect(envKeys[200_000]).toBe("K199999");
  });

  it("reads a remote server's URL where a stdio one has a command", () => {
    const stdout = JSON.stringify([
      { enabled: true, name: "remote", transport: { type: "streamable_http", url: "https://example.test/mcp" } },
    ]);

    expect(unwrap(parseCodexMcpList({ stdout }))[0]!.command).toBe("https://example.test/mcp");
  });

  it("refuses text that is not JSON, naming the listing", () => {
    const parsed = parseCodexMcpList({ stdout: "Error: bootstrap" });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("codex mcp list printed no JSON");
  });

  it("refuses JSON of the wrong shape", () => {
    const parsed = parseCodexMcpList({ stdout: JSON.stringify({ servers: [] }) });

    expect(unwrapErr(parsed)[0]).toContain("unexpected shape");
  });
});

describe("resolvedCommandPaths", () => {
  const roots: string[] = [];
  afterEach(() => {
    roots.splice(0).forEach((root) => {
      rmSync(root, { force: true, recursive: true });
    });
  });

  it("follows a symlink to where the command really lives, every match of a bare name on PATH included", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-resolve-")));
    roots.push(root);
    const bundled = join(root, "cua_node", "bin", "node");
    mkdirSync(join(root, "cua_node", "bin"), { recursive: true });
    writeFileSync(bundled, "");
    symlinkSync(bundled, join(root, "innocent"));

    expect(resolvedCommandPaths({ command: join(root, "innocent"), cwd: "/", searchPath: "", extensions: [] })).toEqual(
      [bundled],
    );
    expect(resolvedCommandPaths({ command: "./innocent", cwd: root, searchPath: "", extensions: [] })).toEqual([
      bundled,
    ]);
    expect(
      resolvedCommandPaths({ command: "innocent", cwd: "/", searchPath: `/nowhere:${root}`, extensions: [] }),
    ).toEqual([bundled]);
    // A relative PATH entry is the launch's, so it resolves from the launch's directory (Codex review r9).
    expect(
      resolvedCommandPaths({ command: "innocent", cwd: dirname(root), searchPath: basename(root), extensions: [] }),
    ).toEqual([bundled]);
    // An empty PATH entry is the launch's directory itself, as a shell reads it (Codex review r11).
    expect(resolvedCommandPaths({ command: "innocent", cwd: root, searchPath: ":/nowhere", extensions: [] })).toEqual([
      bundled,
    ]);
    expect(resolvedCommandPaths({ command: "innocent", cwd: "/", searchPath: "/nowhere", extensions: [] })).toEqual([]);
    // An empty PATH is one empty entry, the launch's directory (Codex review r13).
    expect(resolvedCommandPaths({ command: "innocent", cwd: root, searchPath: "", extensions: [] })).toEqual([bundled]);
    expect(resolvedCommandPaths({ command: join(root, "absent"), cwd: "/", searchPath: root, extensions: [] })).toEqual(
      [],
    );
  });

  // A command is tried as a path AND on PATH, with each executable extension, whatever it looks like (r17).
  it("tries every command both from the launch directory and on PATH, with each executable extension", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-resolve-")));
    roots.push(root);
    const bundled = join(root, "cua_node", "bin", "server");
    mkdirSync(join(root, "cua_node", "bin"), { recursive: true });
    mkdirSync(join(root, "work"));
    writeFileSync(bundled, "");
    symlinkSync(bundled, join(root, "work", "innocent.EXE"));

    expect(
      resolvedCommandPaths({
        command: "innocent",
        cwd: join(root, "work"),
        searchPath: "/nowhere",
        extensions: [".EXE"],
      }),
    ).toEqual([bundled]);
    expect(resolvedCommandPaths({ command: "work/innocent.EXE", cwd: "/", searchPath: root, extensions: [] })).toEqual([
      bundled,
    ]);
    expect(
      resolvedCommandPaths({ command: "innocent", cwd: join(root, "work"), searchPath: "/nowhere", extensions: [] }),
    ).toEqual([]);
  });

  // Which match a launch runs turns on an execute bit the door need not mirror: it judges them all (Codex review r12).
  it("answers a later PATH match behind an earlier one, so a shadowed bundle link is still judged", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-resolve-")));
    roots.push(root);
    const bundled = join(root, "cua_node", "bin", "helper");
    mkdirSync(join(root, "cua_node", "bin"), { recursive: true });
    mkdirSync(join(root, "first"));
    mkdirSync(join(root, "second"));
    writeFileSync(bundled, "");
    writeFileSync(join(root, "first", "helper"), "");
    symlinkSync(bundled, join(root, "second", "helper"));

    const paths = resolvedCommandPaths({
      command: "helper",
      cwd: "/",
      searchPath: `${join(root, "first")}:${join(root, "second")}`,
      extensions: [],
    });

    expect(paths).toEqual([join(root, "first", "helper"), bundled]);
    expect(browserCapableServers({ servers: [{ ...TRAJECTORY, command: "helper", resolvedCommands: paths }] })).toEqual(
      ["trajectory"],
    );
  });
});
