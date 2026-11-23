/*
 * The browser-off overrides an app-hosted Codex session carries must be exactly the ones a cmux seat's boot line
 * carries: the desktop restates the CLI's lists because it cannot import them at run time, so this holds the copy
 * to the authority, key for key and in order.
 */
import { describe, expect, it } from "vitest";

import { codexBrowserOffOverrides } from "../../../src/codex/browserSurface.js";
import { codexBrowserOffConfig } from "../../src/sessionWorker/codexBrowserOff";

describe("codexBrowserOffConfig", () => {
  it("names every override the CLI's seats carry, in the same order, as key paths", () => {
    const authority = codexBrowserOffOverrides();
    expect(authority.length).toBeGreaterThan(0);
    const restated = Object.entries(codexBrowserOffConfig()).map(([key, value]) => `${key}=${String(value)}`);
    expect(restated).toEqual(authority);
  });

  it("disables each server it names, never only re-points its command", () => {
    expect(codexBrowserOffConfig()["mcp_servers.node_repl.enabled"]).toBe(false);
    expect(codexBrowserOffConfig()["plugins.unified-computer-use@openai-bundled.enabled"]).toBe(false);
  });

  it("hands each caller a fresh map, so one session's additions never reach the next", () => {
    const first = codexBrowserOffConfig();
    first["model"] = "gpt-5";
    expect(codexBrowserOffConfig()["model"]).toBe(undefined);
  });
});
