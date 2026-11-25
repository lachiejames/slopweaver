/**
 * How one finished hook-trust pass decides a Codex home's install: a refused write fails it, a re-list in which
 * any Slopweaver hook would still be skipped fails it with that report as the detail, and otherwise the trusted
 * count comes through. Every pass is a literal, so no case launches Codex.
 */
import { describe, expect, it } from "vitest";

import { hookTrustOutcome } from "../../../../../cli/commands/codex/pluginTrust.js";
import type { CodexPluginHook } from "../../../../../codex/hookTrust.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CODEX_HOME = "/x/codex-two";

/** One Slopweaver plugin hook as Codex lists it, trusted and enabled unless a case says otherwise. */
const hook = (over: Partial<CodexPluginHook> = {}): CodexPluginHook => ({
  currentHash: "sha256:aaaa",
  enabled: true,
  eventName: "PreToolUse",
  key: "slopweaver:pre-tool-use",
  pluginId: "slopweaver@personal",
  source: "plugin",
  trustStatus: "trusted",
  ...over,
});

describe("judging one hook-trust pass", () => {
  it("passes the trusted count through when every hook in the re-list runs", () => {
    const pass = {
      failure: undefined,
      reading: { hooks: [hook(), hook({ key: "slopweaver:stop", trustStatus: "managed" })], kind: "read" as const },
      trusted: 2,
    };

    expect(unwrap(hookTrustOutcome({ codexHome: CODEX_HOME, pass }))).toEqual({ trusted: 2 });
  });

  it("fails the home with Codex's own reason when the trust write was refused", () => {
    const pass = {
      failure: "config/batchWrite answered an error",
      reading: { hooks: [hook()], kind: "read" as const },
      trusted: 0,
    };

    expect(unwrapErr(hookTrustOutcome({ codexHome: CODEX_HOME, pass }))).toEqual({
      code: "HOOK_TRUST_FAILED",
      codexHome: CODEX_HOME,
      message: "not every Slopweaver hook runs in /x/codex-two: config/batchWrite answered an error",
    });
  });

  it("fails the home with the re-list's report when a hook is still skipped after the write", () => {
    const pass = {
      failure: undefined,
      reading: { hooks: [hook(), hook({ key: "slopweaver:stop", trustStatus: "untrusted" })], kind: "read" as const },
      trusted: 0,
    };

    expect(unwrapErr(hookTrustOutcome({ codexHome: CODEX_HOME, pass }))).toEqual({
      code: "HOOK_TRUST_FAILED",
      codexHome: CODEX_HOME,
      message:
        "not every Slopweaver hook runs in /x/codex-two: codex hooks: Codex SKIPS 1 of 2 Slopweaver hooks in " +
        "/x/codex-two: slopweaver:stop  untrusted fix: `CODEX_HOME=/x/codex-two slopweaver codex hooks --trust` " +
        "has Codex trust each untrusted or modified one — the fleet's to run, never the owner's; a disabled one " +
        "stays off.",
    });
  });

  it("fails the home naming why Codex could not be read when the re-list said nothing", () => {
    const pass = {
      failure: undefined,
      reading: { kind: "unreadable" as const, reason: "app-server exited 1" },
      trusted: 0,
    };

    expect(unwrapErr(hookTrustOutcome({ codexHome: CODEX_HOME, pass }))).toEqual({
      code: "HOOK_TRUST_FAILED",
      codexHome: CODEX_HOME,
      message:
        "not every Slopweaver hook runs in /x/codex-two: codex hooks: /x/codex-two could not be read — app-server exited 1",
    });
  });
});
