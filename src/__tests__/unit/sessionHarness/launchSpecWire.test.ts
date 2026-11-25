/**
 * What a launch asks the app's control plane to open: each vendor's arm carries only its own keys, and a Claude
 * launch's effort is one of the Agent SDK's levels or absent.
 */
import { describe, expect, it } from "vitest";

import { APP_CLAUDE_EFFORTS, isAppLaunchSpec } from "../../../sessionHarness/launchSpecWire.js";

const COMMON = { directory: "/work/acme", ledgerKey: "abc-1", title: "abc-1" } as const;

const CODEX = { ...COMMON, codexHome: "/h/codex-one", judgedInstanceId: "instance-a", vendor: "codex" } as const;

const CLAUDE = {
  ...COMMON,
  claudeMdExcludes: ["/work/acme/AGENTS.md"],
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  vendor: "claude",
} as const;

describe("APP_CLAUDE_EFFORTS", () => {
  it("lists the Agent SDK's levels, lowest first", () => {
    expect(APP_CLAUDE_EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("isAppLaunchSpec", () => {
  it("accepts a Codex launch and a Claude launch, each with its optional fields", () => {
    expect(
      [
        CODEX,
        { ...CODEX, ledgerHome: "/h/sw", model: "gpt-5" },
        CLAUDE,
        { ...CLAUDE, effort: "xhigh", model: "fable", pluginDir: "/p" },
      ].map((spec) => isAppLaunchSpec(spec)),
    ).toEqual([true, true, true, true]);
  });

  it("refuses a field from the other vendor's arm, an unknown effort, or an unknown vendor", () => {
    expect(
      [
        { ...CODEX, claudeMdExcludes: [] },
        { ...CLAUDE, codexHome: "/h/codex-one" },
        { ...CLAUDE, effort: "extreme" },
        { ...CODEX, vendor: "gemini" },
      ].map((spec) => isAppLaunchSpec(spec)),
    ).toEqual([false, false, false, false]);
  });

  it("refuses a launch short of a field its arm requires, or one that is not an object", () => {
    const { judgedInstanceId: _unjudged, ...unjudged } = CODEX;
    const { credential: _anonymous, ...anonymous } = CLAUDE;
    const { title: _untitled, ...untitled } = CLAUDE;
    expect([unjudged, anonymous, untitled, "codex", null].map((spec) => isAppLaunchSpec(spec))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
