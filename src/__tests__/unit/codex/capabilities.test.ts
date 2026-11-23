/**
 * The one capability module both Codex runtimes project from (`codex/capabilities.ts`), asserted as data, and
 * the two runtimes asserted to READ it rather than restate it — the review passes' `LOCKED_POLICY` and the
 * console voice's `thread/start` params and app-server argv.
 */
import { describe, expect, it } from "vitest";

import { codexBrowserOffOverrides } from "../../../codex/browserSurface.js";
import {
  CODEX_CAPABILITIES,
  codexCapabilityOverrides,
  PASS_THREAD_CAPABILITIES,
  VOICE_THREAD_CAPABILITIES,
} from "../../../codex/capabilities.js";
import { LOCKED_POLICY } from "../../../codex/client.js";
import { planAppServerArgv, planOfferComposition } from "../../../talk/planSession.js";

/** The `-c` values of an argv, in order. */
function configValues({ argv }: { argv: readonly string[] }): readonly string[] {
  return argv.flatMap((word, index) => (argv[index - 1] === "-c" ? [word] : []));
}

describe("CODEX_CAPABILITIES", () => {
  it("is never-approving, live-searching, and sandboxes each runtime on purpose", () => {
    expect(CODEX_CAPABILITIES).toEqual({
      approvalPolicy: "never",
      sandbox: { pass: "workspace-write", voice: "read-only" },
      webSearch: "live",
    });
  });
});

describe("the pass projection", () => {
  it("is the SDK spelling of the capabilities, with web search on because the mode is live", () => {
    expect(PASS_THREAD_CAPABILITIES).toEqual({
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      webSearchEnabled: true,
      webSearchMode: "live",
    });
  });

  it("is what LOCKED_POLICY carries, field for field", () => {
    expect(LOCKED_POLICY.approvalPolicy).toBe(PASS_THREAD_CAPABILITIES.approvalPolicy);
    expect(LOCKED_POLICY.sandboxMode).toBe(PASS_THREAD_CAPABILITIES.sandboxMode);
    expect(LOCKED_POLICY.webSearchEnabled).toBe(PASS_THREAD_CAPABILITIES.webSearchEnabled);
    expect(LOCKED_POLICY.webSearchMode).toBe(PASS_THREAD_CAPABILITIES.webSearchMode);
  });

  it("carries the browser-off overrides then Electron-as-Node, and no web_search, which the SDK emits itself", () => {
    expect(codexCapabilityOverrides({ runtime: "pass" })).toEqual([
      ...codexBrowserOffOverrides(),
      'shell_environment_policy.set.ELECTRON_RUN_AS_NODE="1"',
    ]);
  });
});

describe("the voice projection", () => {
  it("is the thread/start spelling of the capabilities", () => {
    expect(VOICE_THREAD_CAPABILITIES).toEqual({ approvalPolicy: "never", sandbox: "read-only" });
  });

  it("is what a plan call's thread is started with", () => {
    const { thread } = planOfferComposition({
      codexHome: "/stores/codex-one",
      context: undefined,
      executable: "/vendored/codex",
      mcpServers: [],
      opener: undefined,
      planAlias: "codex-one",
      surface: "voice",
      unsetEnv: [],
      voice: "sol",
    });
    expect(thread.approvalPolicy).toBe(VOICE_THREAD_CAPABILITIES.approvalPolicy);
    expect(thread.sandbox).toBe(VOICE_THREAD_CAPABILITIES.sandbox);
  });

  it("carries live web search, then the browser-off overrides", () => {
    expect(codexCapabilityOverrides({ runtime: "voice" })).toEqual([
      'web_search="live"',
      ...codexBrowserOffOverrides(),
    ]);
  });

  it("leaves the shell environment policy alone, since the voice's launch disables its shell tools", () => {
    const values = configValues({ argv: planAppServerArgv({ mcpServers: [] }) });
    expect(values.filter((value) => value.startsWith("shell_environment_policy."))).toEqual([]);
    expect(values.length).toBeGreaterThan(0);
  });

  it("puts exactly one web_search override on the app-server argv", () => {
    const values = configValues({ argv: planAppServerArgv({ mcpServers: ["node_repl"] }) });
    expect(values.filter((value) => value.startsWith("web_search="))).toEqual(['web_search="live"']);
  });

  it("switches the browser off before any per-server stub, the order measured under --strict-config", () => {
    const values = configValues({ argv: planAppServerArgv({ mcpServers: ["node_repl"] }) });
    const firstStub = values.indexOf('mcp_servers.node_repl={command="true",enabled=false}');
    expect(codexBrowserOffOverrides().length).toBeGreaterThan(0);
    expect(firstStub).toBeGreaterThan(-1);
    expect(codexBrowserOffOverrides().map((override) => values.indexOf(override) < firstStub)).toEqual(
      codexBrowserOffOverrides().map(() => true),
    );
  });
});
