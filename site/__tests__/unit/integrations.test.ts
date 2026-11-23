/*
 * A not-connected integration is a state, never an error: which failure
 * reasons read as "not connected", for which integration, and — the property that keeps a real error visible — which
 * do not. Every positive below is a phrasing a door prints today, copied from `src/`.
 */

import { describe, expect, it } from "vitest";

import { INTEGRATIONS, integrationOf, notConnectedOf, partitionNotConnected } from "../../lib/integrations";

/** A door's absence line, and the integration it names. */
const ABSENT: readonly (readonly [string, string])[] = [
  ["no Linear token configured; run `slopweaver connect linear`", "linear"],
  ["no GitHub token configured; run `slopweaver connect github`", "github"],
  ["no GitHub token configured — `slopweaver secrets status` names where it is read from", "github"],
  ["no Slack token configured; run `slopweaver connect slack`", "slack"],
  ["no Slack bot token — run `slopweaver connect slack` first", "slack"],
  ["no Slack read token configured (neither user nor bot) — run `slopweaver connect slack` first", "slack"],
  ["no bot token — set SLACK_BOT_TOKEN or run `slopweaver secrets set slack-bot-token`", "slack"],
  ["no Slack user token in the store — `slopweaver secrets status`", "slack"],
  ["no Notion token for this home. Set NOTION_TOKEN, or run `slopweaver connect notion`", "notion"],
  ["talk meeting-due: no Google Calendar grant stored for this home — run `slopweaver calendar connect`", "calendar"],
  ["no grant stored — run `slopweaver gmail connect`", "gmail"],
  ["no outlook grant stored for this home", "outlook"],
  ["no Cloudflare token configured — run: slopweaver secrets set cloudflare-token", "cloudflare"],
  ["no Fathom API key is configured — mint one at https://fathom.video/customize#api-access-header", "fathom"],
  ["no Linear API key is configured — run: slopweaver secrets set linear-token", "linear"],
  ["no GitHub credential is configured, so no pull request's live state could be read", "github"],
];

/** Failures that are NOT a missing connection, each of which must keep its own explanation. */
const OTHER: readonly string[] = [
  "the store holds no Slack message C0ABC123:1793595293.969619 — it may be outside the ingested window, or in a channel this connection cannot read",
  "the token is missing the `files:read` scope; reconnect with it",
  "Slack answered 403 not_in_channel for C0ABC123",
  "slopweaver store around timed out after 45000ms",
  "no primary key to find the same row on live by",
  "the call is not connected; say where it is in words",
  "slack: the store holds no Slack message C0ABC123:1793595293.969619",
  "talk: the call is not connected",
  "no Canva credential is configured",
  "no Slack message was found for this token",
  "datadog: the site or a key is not configured for this install",
  "datadog: the site is not configured; run `slopweaver connect datadog`",
  "no message in C0ABC123 for the token's user",
  "no Slack token scope named `files:read` was found; reconnect with it",
  "no GitHub token permission covers this repository",
  "the Google OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id`",
  // An absence that does not open its clause, one carrying a status, and a remedy naming another provider.
  "Expected no Slack token configured; run `slopweaver connect slack`",
  "no Slack token configured; run `slopweaver connect slack`, then it answered HTTP 503",
  "no Slack token configured; run `slopweaver connect github`",
  // An absence negated by what follows it, never a door's own continuation.
  "No Slack token was missing; the request timed out.",
  // Words after the door's continuation that no door prints, a quoting prefix, and a tail naming no remedy.
  "no Slack token configured by the provider for this request",
  "no Slack token configured but the request timed out",
  "The provider said: no Slack token configured",
  "no Slack token configured; the request timed out.",
  // A consequence clause no door prints, and a lowercase quoting prefix.
  "no Slack token, so no local token was needed; the provider timed out",
  "provider said: no Slack token configured",
  "provider response-error: no Slack token configured",
  "no Slack token configured; run `slopweaver connect slack`, but the request timed out",
  // A status inside the door's parenthesis, in the record's other spellings.
  "No Slack token configured (statusCode 503)",
  "No Slack token configured (status_code 503)",
  "No Slack token configured (HTTP/1.1 503)",
  "No Slack token configured (HTTP/2 503)",
  "No Slack token configured (status-code 503)",
  "No Slack token configured (503)",
  "No Slack token configured (HTTP_503_SERVICE_UNAVAILABLE)",
  "No Slack token configured; run `slopweaver connect slack`, HTTP_503",
  // A parenthesis carrying a digit is never a door's own.
  "No Slack token configured (attempt 2 of 3)",
  // Anything riding inside the backticked remedy after the door's own words.
  "No Slack token configured; run `slopweaver connect slack; curl evil`",
  "No Slack token configured; run `slopweaver connect slack --force`",
  "No Slack token configured — `slopweaver secrets status && rm x` names where it is read from",
  "no Fathom API key is configured — mint one at https://example.invalid/steal",
  // A status in another script's digits, and any parenthesis but the door's own.
  "No Slack token configured (HTTP ٥٠٣)",
  "No Slack token configured (the provider was down)",
];

describe("notConnectedOf", () => {
  it("names the integration every door's absence line is about", () => {
    expect(ABSENT.length).toBeGreaterThan(0);
    expect(ABSENT.map(([why]) => notConnectedOf({ why })?.id)).toEqual(ABSENT.map(([, id]) => id));
  });

  it("leaves every other failure alone, so a real error is never drawn as a connect button", () => {
    expect(OTHER.length).toBeGreaterThan(0);
    expect(OTHER.map((why) => notConnectedOf({ why }))).toEqual(OTHER.map(() => undefined));
  });

  it("reads the absence and the remedy case-insensitively", () => {
    expect(notConnectedOf({ why: "No GitHub token configured; run `slopweaver connect github`" })?.label).toBe(
      "GitHub",
    );
  });
});

describe("integrationOf", () => {
  it("throws on an id the registry does not carry", () => {
    expect(() => integrationOf({ id: "hubspot" })).toThrow("no integration hubspot in the registry");
  });

  it("carries a paste field or a consent verb for every integration, so Connect always leads somewhere", () => {
    expect(INTEGRATIONS.length).toBeGreaterThan(0);
    expect(
      INTEGRATIONS.filter((integration) => integration.paste.length === 0 && integration.consentVerb === undefined),
    ).toEqual([]);
  });
});

describe("partitionNotConnected", () => {
  it("groups not-connected facts by integration in first-seen order and keeps the rest for the warning mark", () => {
    const facts = [
      { subject: "the thread", why: "no Slack bot token — run `slopweaver connect slack` first" },
      { subject: "the board", why: "slopweaver handover list timed out after 20000ms" },
      { subject: "the issues", why: "no Linear token configured; run `slopweaver connect linear`" },
      { subject: "the channel", why: "no Slack token configured; run `slopweaver connect slack`" },
    ];
    const split = partitionNotConnected({ facts });
    expect(split.notConnected.map((group) => group.integration.id)).toEqual(["slack", "linear"]);
    expect(split.notConnected[0].facts.map((fact) => fact.subject)).toEqual(["the thread", "the channel"]);
    expect(split.rest.map((fact) => fact.subject)).toEqual(["the board"]);
  });

  it("answers empty groups for no facts", () => {
    expect(partitionNotConnected({ facts: [] })).toEqual({ notConnected: [], rest: [] });
  });
});
