/*
 * The app's launch spec by vendor: a Codex seat on the repository's Codex model and its routed home; a Claude seat
 * carrying the login its credential gate routed, by path only, its template's rule exclusions, model, effort and
 * plugin directory — and the refusals for a seat the app cannot say how to run.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { CODE_STANDARD_RULES } from "../../../cmux/launchTemplate.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { appLaunchSpecOf } from "../../../sessionHarness/appLaunchSpec.js";
import { planFromLaunchSpec } from "../../../sessionHarness/cmuxLaunch.js";
import type { HarnessLaunchSpec } from "../../../sessionHarness/launch.js";
import { SPEC } from "./recordingLedgerFixtures.js";

const CODEX_SPEC: HarnessLaunchSpec = { ...SPEC, codexHome: "/home/codex-plan-1", host: "codex", model: "gpt-5" };

/** The plan a Claude seat's credential gate allowed: routed to a plan's own store. */
const STORE_ROUTED = { ...planFromLaunchSpec({ spec: SPEC }), credentialStoreDir: "/home/claude-plan-2" };

function specOf({
  spec,
  gated = planFromLaunchSpec({ spec }),
  pluginDir,
  ledgerHome,
}: {
  spec: HarnessLaunchSpec;
  gated?: ReturnType<typeof planFromLaunchSpec>;
  pluginDir?: string;
  ledgerHome?: string;
}): ReturnType<typeof appLaunchSpecOf> {
  return appLaunchSpecOf({ gated, ledgerHome, operation: "open", pluginDir, spec });
}

describe("appLaunchSpecOf — Codex", () => {
  it("carries a Codex seat's plan and place, on the repository's Codex model", () => {
    expect(unwrap(specOf({ spec: CODEX_SPEC }))).toEqual({
      codexHome: "/home/codex-plan-1",
      directory: "/work/tree-7",
      ledgerKey: "a-doc",
      model: CODEX_MODEL,
      title: "a-doc",
      vendor: "codex",
    });
  });

  it("never hands Codex the Claude tier `cmux spawn --model` was given", () => {
    expect(unwrap(specOf({ spec: { ...CODEX_SPEC, model: "opus" } })).model).toBe(CODEX_MODEL);
  });

  it("carries the spawn's named state home, so the card's Stop closes the same ledger row", () => {
    expect(unwrap(specOf({ ledgerHome: "/state/b", spec: CODEX_SPEC })).ledgerHome).toBe("/state/b");
  });

  it("refuses a Codex seat with no routed CODEX_HOME", () => {
    const { codexHome: _dropped, ...unrouted } = CODEX_SPEC;
    expect(
      unwrapErr(
        appLaunchSpecOf({
          gated: planFromLaunchSpec({ spec: unrouted }),
          ledgerHome: undefined,
          operation: "resume",
          pluginDir: undefined,
          spec: unrouted,
        }),
      ),
    ).toEqual({
      code: "SESSION_LAUNCH_FAILED",
      message: "app harness: the session has no routed CODEX_HOME, so the app cannot say which plan it spends",
      operation: "resume",
    });
  });
});

describe("appLaunchSpecOf — Claude", () => {
  it("carries a store-routed seat's login by path, its model, and no exclusion for the code template", () => {
    expect(unwrap(specOf({ gated: STORE_ROUTED, spec: SPEC }))).toEqual({
      claudeMdExcludes: [],
      credential: { kind: "store", secureStorageDir: "/home/claude-plan-2" },
      directory: "/work/tree-7",
      ledgerKey: "a-doc",
      model: "opus",
      title: "a-doc",
      vendor: "claude",
    });
  });

  it("carries a setup-token seat's token FILE beside its unbound store, never a token", () => {
    const gated = { ...STORE_ROUTED, credentialTokenPath: "/home/secrets/claude-plan-2.token" };
    expect(unwrap(specOf({ gated, spec: SPEC }))).toMatchObject({
      credential: {
        kind: "setup-token",
        secureStorageDir: "/home/claude-plan-2",
        tokenFilePath: "/home/secrets/claude-plan-2.token",
      },
    });
  });

  it("carries the effort, the plugin directory, the state home and a non-code template's exclusions exactly", () => {
    const spec: HarnessLaunchSpec = { ...SPEC, effort: "high", template: "research" };
    const built = unwrap(specOf({ gated: STORE_ROUTED, ledgerHome: "/state/b", pluginDir: "/work/repo", spec }));
    expect(CODE_STANDARD_RULES.length).toBeGreaterThan(0);
    expect(built).toMatchObject({
      claudeMdExcludes: CODE_STANDARD_RULES.map((rule) => `/work/tree-7/${rule}`),
      effort: "high",
      ledgerHome: "/state/b",
      pluginDir: "/work/repo",
    });
  });

  it("refuses a seat no plan routed a store to, rather than run an unrouted login", () => {
    expect(unwrapErr(specOf({ spec: SPEC })).message).toBe(
      "app harness: no plan routed this Claude seat a credential store, and the app runs no unrouted login",
    );
  });

  it("refuses an effort level the app does not know", () => {
    expect(unwrapErr(specOf({ gated: STORE_ROUTED, spec: { ...SPEC, effort: "ludicrous" } })).message).toBe(
      "app harness: the app does not know the effort level ludicrous",
    );
  });
});
