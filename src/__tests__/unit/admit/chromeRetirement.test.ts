import { describe, expect, it } from "vitest";

import { resolveBrowserPagePolicy } from "../../../admit/browserPagePolicy.js";
import { retiredChromeCall } from "../../../admit/chromeRetirement.js";

describe("the Claude-in-Chrome retirement", () => {
  it("refuses a read through the extension, not only a write", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__read_page" });
    expect(decided?.block).toBe(true);
  });

  it("refuses a screenshot through it", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__computer" });
    expect(decided?.block).toBe(true);
  });

  it("refuses a tool that takes no page at all", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__tabs_context_mcp" });
    expect(decided?.block).toBe(true);
  });

  it("refuses a batch, so wrapping a call does not walk past it", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__browser_batch" });
    expect(decided?.block).toBe(true);
  });

  it("refuses a tool name the extension has not shipped yet, because the test is the prefix", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__some_future_tool" });
    expect(decided?.block).toBe(true);
  });

  it("journals under its own reason code", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__computer" });
    expect(decided?.reason).toBe("chrome-retired");
  });

  it("hands the caller the replacement verb", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__computer" });
    expect(decided?.message).toContain("slopweaver browser open --url");
  });

  it("says plainly that there is no override", () => {
    const decided = retiredChromeCall({ toolName: "mcp__claude-in-chrome__computer" });
    expect(decided?.message).toContain("There is no override");
  });

  it("leaves every other tool alone", () => {
    expect(retiredChromeCall({ toolName: "Bash" })).toBe(undefined);
  });
});

describe("resolving what a page may be driven to do", () => {
  it("refuses every write on the JumpCloud console, by NAME rather than by default", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://console.jumpcloud.com/#/users" });
    expect(resolved.provider).toBe("JumpCloud");
  });

  it("gives JumpCloud the refusing policy", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://console.jumpcloud.com/#/users" });
    expect(resolved.policy).toBe("refuse-every-write");
  });

  it("keeps Vanta a write page, because Vanta is written to now", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://app.vanta.com/policies" });
    expect(resolved.policy).toBe("read-before-write");
  });

  it("keeps Datadog a write page", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://app.datadoghq.com/monitors" });
    expect(resolved.policy).toBe("read-before-write");
  });

  it("gives an unregistered host the refusing default", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://twilio.com/console" });
    expect(resolved.policy).toBe("refuse-every-write");
  });

  it("names no provider for an unregistered host", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://twilio.com/console" });
    expect(resolved.provider).toBe(null);
  });

  it("refuses an address that will not parse rather than guessing", () => {
    const resolved = resolveBrowserPagePolicy({ url: "not a url at all" });
    expect(resolved.policy).toBe("refuse-every-write");
  });

  it("is not fooled by a hostname that merely ends in the right letters", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://jumpcloud.com.example.invalid/" });
    expect(resolved.provider).toBe(null);
  });

  it("covers a JumpCloud subdomain", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://console.jumpcloud.com/" });
    expect(resolved.provider).toBe("JumpCloud");
  });
});
