/**
 * What the two credential resolvers say, line for line, when a value is absent or unusable. Every message
 * names the variable and never its value — the token below is fake and only its length may surface.
 */
import { describe, expect, it } from "vitest";

import {
  resolveOnepasswordAccount,
  resolveOnepasswordEventsCredentials,
} from "../../../../atlas/onepassword/credentials.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("resolveOnepasswordEventsCredentials", () => {
  it("says how to mint a token when none is set", () => {
    expect(unwrapErr(resolveOnepasswordEventsCredentials({ env: {} }))).toEqual([
      "ONEPASSWORD_EVENTS_TOKEN is not set — mint a token at 1Password.com → Integrations → Events Reporting, then: slopweaver secrets set onepassword-events-token",
    ]);
  });

  it("reports length, whitespace and host as three separate lines, in that order", () => {
    const resolved = resolveOnepasswordEventsCredentials({
      env: { ONEPASSWORD_EVENTS_HOST: "https://x", ONEPASSWORD_EVENTS_TOKEN: "short tok" },
    });

    expect(unwrapErr(resolved)).toEqual([
      "ONEPASSWORD_EVENTS_TOKEN is set (9 chars) but is not a plausible token length — re-issue it rather than editing it",
      "ONEPASSWORD_EVENTS_TOKEN is set but contains whitespace, which is not part of any token 1Password issues — re-copy it",
      "ONEPASSWORD_EVENTS_HOST is not a bare hostname — set it to something like events.1password.com, with no scheme and no path",
    ]);
  });

  it("resolves a plausible token on the default host", () => {
    const resolved = resolveOnepasswordEventsCredentials({
      env: { ONEPASSWORD_EVENTS_TOKEN: "abcdefghijklmnopqrstuvwx" },
    });

    expect(unwrap(resolved)).toEqual({ host: "events.1password.com", token: "abcdefghijklmnopqrstuvwx" });
  });

  it("resolves a configured regional host, trimmed", () => {
    const resolved = resolveOnepasswordEventsCredentials({
      env: {
        ONEPASSWORD_EVENTS_HOST: " events.ent.1password.com\n",
        ONEPASSWORD_EVENTS_TOKEN: "abcdefghijklmnopqrstuvwx",
      },
    });

    expect(unwrap(resolved)).toEqual({ host: "events.ent.1password.com", token: "abcdefghijklmnopqrstuvwx" });
  });

  it("refuses a host that is SET but blank rather than reading it as unset", () => {
    const resolved = resolveOnepasswordEventsCredentials({
      env: { ONEPASSWORD_EVENTS_HOST: "  ", ONEPASSWORD_EVENTS_TOKEN: "abcdefghijklmnopqrstuvwx" },
    });

    expect(unwrapErr(resolved)).toEqual([
      "ONEPASSWORD_EVENTS_HOST is not a bare hostname — set it to something like events.1password.com, with no scheme and no path",
    ]);
  });
});

describe("resolveOnepasswordAccount", () => {
  it("refuses a value that could not safely become an argv element, naming the variable only", () => {
    expect(unwrapErr(resolveOnepasswordAccount({ env: { ONEPASSWORD_ACCOUNT: "a b" } }))).toEqual([
      "ONEPASSWORD_ACCOUNT is not a plain account shorthand or sign-in address — refusing to put it in an argv",
    ]);
  });

  it("pins the dedicated atlas account when none is configured", () => {
    expect(unwrap(resolveOnepasswordAccount({ env: {} }))).toBe("atlas");
  });

  it("honours a configured account", () => {
    expect(unwrap(resolveOnepasswordAccount({ env: { ONEPASSWORD_ACCOUNT: "other.1password.com" } }))).toBe(
      "other.1password.com",
    );
  });
});
