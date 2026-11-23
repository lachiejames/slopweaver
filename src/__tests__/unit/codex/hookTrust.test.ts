/**
 * Reading Codex's own `hooks/list` answer into which Slopweaver hooks it skips, and the trust write that has
 * Codex run them (`src/codex/hookTrust.ts`).
 */
import { describe, expect, it } from "vitest";

import { LIVE_MARKER_PREFIX } from "../../../codex/accountLiveParse.js";
import {
  type CodexPluginHook,
  codexRunsHook,
  HOOKS_LIST_REQUEST_ID,
  hookListRequests,
  hooksToTrust,
  parseHookTrust,
  renderHookTrust,
  TRUST_WRITE_REQUEST_ID,
  trustWriteFailure,
  trustWriteRequests,
} from "../../../codex/hookTrust.js";

const SESSION_START_KEY = "slopweaver@inline:hooks/codex-hooks.json:session_start:0:0";
const PRE_TOOL_KEY = "slopweaver@inline:hooks/hooks.json:pre_tool_use:0:0";

const answer = ({ hooks }: { hooks: readonly Record<string, unknown>[] }): string =>
  JSON.stringify({ id: HOOKS_LIST_REQUEST_ID, result: { data: [{ cwd: "/repo", errors: [], hooks, warnings: [] }] } });

const wireHook = (over: Record<string, unknown>): Record<string, unknown> => ({
  command: "hook.sh",
  currentHash: "sha256:abc",
  enabled: true,
  eventName: "sessionStart",
  key: SESSION_START_KEY,
  pluginId: "slopweaver@inline",
  source: "plugin",
  trustStatus: "trusted",
  ...over,
});

const hook = (over: Partial<CodexPluginHook>): CodexPluginHook => ({
  currentHash: "sha256:abc",
  enabled: true,
  eventName: "sessionStart",
  key: SESSION_START_KEY,
  pluginId: "slopweaver@inline",
  source: "plugin",
  trustStatus: "trusted",
  ...over,
});

describe("hookListRequests", () => {
  it("sends the handshake, then one hooks/list for the checkout under the id the reader waits for", () => {
    const lines = hookListRequests({ cwd: "/repo" }).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line["method"])).toEqual(["initialize", "initialized", "hooks/list"]);
    expect(lines[2]).toEqual({ id: HOOKS_LIST_REQUEST_ID, method: "hooks/list", params: { cwds: ["/repo"] } });
  });
});

describe("codexRunsHook", () => {
  it("runs a trusted or managed hook that is enabled", () => {
    expect(codexRunsHook({ hook: hook({ trustStatus: "trusted" }) })).toBe(true);
    expect(codexRunsHook({ hook: hook({ trustStatus: "managed" }) })).toBe(true);
  });

  it("skips an untrusted or modified hook, and a disabled trusted one", () => {
    expect(codexRunsHook({ hook: hook({ trustStatus: "untrusted" }) })).toBe(false);
    expect(codexRunsHook({ hook: hook({ trustStatus: "modified" }) })).toBe(false);
    expect(codexRunsHook({ hook: hook({ enabled: false }) })).toBe(false);
  });
});

describe("parseHookTrust", () => {
  it("keeps only Slopweaver's plugin hooks, whichever marketplace installed it", () => {
    const reading = parseHookTrust({
      lines: [
        answer({
          hooks: [
            wireHook({ key: PRE_TOOL_KEY, pluginId: "slopweaver@personal", trustStatus: "modified" }),
            wireHook({ key: "other@x:hooks/hooks.json:stop:0:0", pluginId: "other@x" }),
            wireHook({ key: "project:.codex/hooks.json:stop:0:0", pluginId: null }),
          ],
        }),
      ],
    });
    expect(reading).toEqual({
      hooks: [hook({ key: PRE_TOOL_KEY, pluginId: "slopweaver@personal", trustStatus: "modified" })],
      kind: "read",
    });
  });

  it("skips a non-JSON line before the answer", () => {
    const reading = parseHookTrust({ lines: ["warming up", answer({ hooks: [wireHook({})] })] });
    expect(reading).toEqual({ hooks: [hook({})], kind: "read" });
  });

  it("passes over the trust write's own answer to read the re-list after it", () => {
    const write = JSON.stringify({ id: TRUST_WRITE_REQUEST_ID, result: { status: "ok", version: "sha256:v" } });
    const reading = parseHookTrust({ lines: [write, answer({ hooks: [wireHook({ currentHash: "sha256:new" })] })] });
    expect(reading).toEqual({ hooks: [hook({ currentHash: "sha256:new" })], kind: "read" });
  });

  it("reports the reader's marker as an unreadable store", () => {
    expect(parseHookTrust({ lines: [`${LIVE_MARKER_PREFIX}deadline`] })).toEqual({
      kind: "unreadable",
      reason: "the app-server gave no hooks/list answer (deadline)",
    });
  });

  it("refuses a trust status it does not know rather than counting it as run", () => {
    const reading = parseHookTrust({ lines: [answer({ hooks: [wireHook({ trustStatus: "blessed" })] })] });
    expect(reading.kind).toBe("unreadable");
    expect(JSON.stringify(reading)).toContain("hooks/list answered in a shape this does not read");
  });

  it("names the silence when no line answered", () => {
    expect(parseHookTrust({ lines: [] })).toEqual({
      kind: "unreadable",
      reason: "the app-server printed no hooks/list answer",
    });
  });
});

describe("hooksToTrust", () => {
  it("picks every untrusted or modified plugin hook of exactly the installed plugin", () => {
    const picked = hooksToTrust({
      hooks: [
        hook({ key: PRE_TOOL_KEY, trustStatus: "modified" }),
        hook({ trustStatus: "untrusted" }),
        hook({ key: "slopweaver@inline:hooks/hooks.json:stop:0:0", trustStatus: "trusted" }),
        hook({ key: "slopweaver@inline:hooks/hooks.json:post_compact:0:0", trustStatus: "managed" }),
      ],
      pluginId: "slopweaver@inline",
    });
    expect(picked.map((h) => h.key)).toEqual([PRE_TOOL_KEY, SESSION_START_KEY]);
  });

  it("never trusts a slopweaver@ from another marketplace, nor a hook Codex does not source from a plugin", () => {
    const picked = hooksToTrust({
      hooks: [
        hook({ pluginId: "slopweaver@elsewhere", trustStatus: "untrusted" }),
        hook({ source: "project", trustStatus: "untrusted" }),
      ],
      pluginId: "slopweaver@inline",
    });
    expect(picked).toEqual([]);
  });

  it("trusts a disabled hook's hash without being what turns it back on", () => {
    const picked = hooksToTrust({
      hooks: [hook({ enabled: false, trustStatus: "modified" })],
      pluginId: "slopweaver@inline",
    });
    expect(picked.map((h) => h.enabled)).toEqual([false]);
  });
});

describe("trustWriteRequests", () => {
  it("upserts trusted_hash per key under hooks.state, then lists again, and never writes enabled", () => {
    const lines = trustWriteRequests({
      cwd: "/repo",
      hooks: [hook({ currentHash: "sha256:one", key: PRE_TOOL_KEY }), hook({ currentHash: "sha256:two" })],
    }).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line["method"])).toEqual([
      "initialize",
      "initialized",
      "config/batchWrite",
      "hooks/list",
    ]);
    expect(lines[2]).toEqual({
      id: TRUST_WRITE_REQUEST_ID,
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "hooks.state",
            mergeStrategy: "upsert",
            value: {
              [PRE_TOOL_KEY]: { trusted_hash: "sha256:one" },
              [SESSION_START_KEY]: { trusted_hash: "sha256:two" },
            },
          },
        ],
      },
    });
    expect(lines[3]).toEqual({ id: HOOKS_LIST_REQUEST_ID, method: "hooks/list", params: { cwds: ["/repo"] } });
  });
});

describe("trustWriteFailure", () => {
  it("is silent when Codex answered the write ok", () => {
    const ok = JSON.stringify({ id: TRUST_WRITE_REQUEST_ID, result: { filePath: "/h/config.toml", status: "ok" } });
    expect(trustWriteFailure({ lines: [answer({ hooks: [] }), ok] })).toBe(undefined);
  });

  it("carries Codex's own refusal", () => {
    const refused = JSON.stringify({ error: { code: -32600, message: "config locked" }, id: TRUST_WRITE_REQUEST_ID });
    expect(trustWriteFailure({ lines: [refused] })).toBe("config/batchWrite refused: config locked");
  });

  it("names a status that is not ok", () => {
    const odd = JSON.stringify({ id: TRUST_WRITE_REQUEST_ID, result: { status: "conflict" } });
    expect(trustWriteFailure({ lines: [odd] })).toBe("config/batchWrite answered conflict");
  });

  it("reports the reader's marker, and the silence when nothing answered", () => {
    expect(trustWriteFailure({ lines: [`${LIVE_MARKER_PREFIX}deadline`] })).toBe(
      "the app-server gave no config/batchWrite answer (deadline)",
    );
    expect(trustWriteFailure({ lines: [answer({ hooks: [] })] })).toBe(
      "the app-server printed no config/batchWrite answer",
    );
  });
});

describe("renderHookTrust", () => {
  it("names every skipped hook with its status, and the fleet's --trust fix", () => {
    const report = renderHookTrust({
      codexHome: "/h/.codex",
      reading: {
        hooks: [
          hook({ key: PRE_TOOL_KEY, trustStatus: "modified" }),
          hook({ trustStatus: "untrusted" }),
          hook({ enabled: false, key: "slopweaver@inline:hooks/hooks.json:stop:0:0" }),
          hook({ key: "slopweaver@inline:hooks/hooks.json:user_prompt_submit:0:0" }),
        ],
        kind: "read",
      },
    });
    expect(report.allRun).toBe(false);
    expect(report.lines).toEqual([
      "codex hooks: Codex SKIPS 3 of 4 Slopweaver hooks in /h/.codex:",
      `  ${PRE_TOOL_KEY}  modified`,
      `  ${SESSION_START_KEY}  untrusted`,
      "  slopweaver@inline:hooks/hooks.json:stop:0:0  trusted, disabled",
      "  fix: `CODEX_HOME=/h/.codex slopweaver codex hooks --trust` has Codex trust each untrusted or modified " +
        "one — the fleet's to run, never the owner's; a disabled one stays off.",
    ]);
  });

  it("says all run when every hook is trusted or managed", () => {
    const report = renderHookTrust({
      codexHome: "/h/.codex",
      reading: { hooks: [hook({}), hook({ key: PRE_TOOL_KEY, trustStatus: "managed" })], kind: "read" },
    });
    expect(report).toEqual({ allRun: true, lines: ["codex hooks: all 2 Slopweaver hooks run in /h/.codex"] });
  });

  it("points an install with no Slopweaver hook at plugin-sync", () => {
    const report = renderHookTrust({ codexHome: "/h/.codex-two", reading: { hooks: [], kind: "read" } });
    expect(report.allRun).toBe(false);
    expect(report.lines[0]).toContain("lists no Slopweaver plugin hook");
    expect(report.lines[0]).toContain("`CODEX_HOME=/h/.codex-two slopweaver codex plugin-sync`");
  });

  it("carries an unreadable store's reason", () => {
    const report = renderHookTrust({ codexHome: "/h/.codex", reading: { kind: "unreadable", reason: "no CLI" } });
    expect(report).toEqual({ allRun: false, lines: ["codex hooks: /h/.codex could not be read — no CLI"] });
  });
});
