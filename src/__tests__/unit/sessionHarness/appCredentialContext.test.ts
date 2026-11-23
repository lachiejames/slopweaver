/*
 * An app-hosted Claude seat is judged by the credential its worker really presents, never the spawning shell's.
 */
import { describe, expect, it } from "vitest";

import { classifyAmbientCredential } from "../../../claude/ambientCredential.js";
import {
  APP_CLAUDE_DROPPED_PREFIXES,
  APP_CLAUDE_KEPT_VARIABLES,
  appHarnessAmbientCredential,
} from "../../../sessionHarness/appCredentialContext.js";

describe("appHarnessAmbientCredential", () => {
  it("drops the Anthropic and Claude namespaces whole, bar the owner's configuration", () => {
    expect(APP_CLAUDE_DROPPED_PREFIXES).toEqual(["ANTHROPIC_", "CLAUDE"]);
    expect(APP_CLAUDE_KEPT_VARIABLES).toEqual(["CLAUDE_CONFIG_DIR"]);
  });

  it("reads a shell whose API key would shadow a cmux seat as the subscription an app seat presents", () => {
    const inherited = {
      ANTHROPIC_API_KEY: "sk-FIXTURE",
      ANTHROPIC_AUTH_TOKEN: "FIXTURE",
      CLAUDE_CODE_OAUTH_TOKEN: "FIXTURE",
      HOME: "/home/acme",
    };
    expect(classifyAmbientCredential({ env: inherited }).kind).toBe("shadowed");
    expect(appHarnessAmbientCredential({ inherited })).toEqual({
      kind: "subscription",
      reason: "no Anthropic-issued credential is configured, so a session presents its store's own plan login",
    });
  });

  it("reads a shell carrying a credential no list named as a subscription too", () => {
    const inherited = { CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "FIXTURE", CLAUDE_CONFIG_DIR: "/home/acme/.claude" };
    expect(appHarnessAmbientCredential({ inherited }).kind).toBe("subscription");
  });

  it("reads a clean shell as a subscription too", () => {
    expect(appHarnessAmbientCredential({ inherited: {} }).kind).toBe("subscription");
  });
});
