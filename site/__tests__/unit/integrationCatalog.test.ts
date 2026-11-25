/**
 * The Integrations catalog: each integration's status off which store files exist, search, the status filter and its
 * counts, needs-attention first then A to Z — and every integration's guide covering every field it pastes.
 */
import { describe, expect, it } from "vitest";

import {
  type CatalogEntry,
  catalogOrder,
  catalogShown,
  entryMatches,
  filterCounts,
  integrationStatusOf,
  type StoredFile,
} from "../../lib/integrationCatalog";
import { guideOf, INTEGRATION_GUIDES } from "../../lib/integrationGuides";
import { INTEGRATIONS, integrationOf } from "../../lib/integrations";

/**
 * The store with exactly these files stored.
 *
 * @returns the rows
 */
function storeWith(...names: string[]): readonly StoredFile[] {
  return names.map((name) => ({ name, state: "ok", stored: true }));
}

/** The Google client both halves, healthy. */
const GOOGLE_CLIENT = ["google-client-id", "google-client-secret"];

/**
 * Every integration as an entry, at the status the given store gives it.
 *
 * @returns the entries, in the registry's order
 */
function entriesFor({ files }: { files: readonly StoredFile[] }): readonly CatalogEntry[] {
  return INTEGRATIONS.map((integration) => ({
    integration,
    pitch: guideOf({ id: integration.id }).pitch,
    status: integrationStatusOf({ datadogSite: "set", files, integration }),
  }));
}

describe("integrationStatusOf", () => {
  it("calls an integration with nothing stored available", () => {
    expect(INTEGRATIONS.length).toBeGreaterThan(0);
    expect(
      INTEGRATIONS.map((integration) => integrationStatusOf({ datadogSite: "set", files: [], integration })),
    ).toEqual(INTEGRATIONS.map(() => "available"));
  });

  it("calls a two-key integration connected with both, and needs-attention with one", () => {
    const datadog = integrationOf({ id: "datadog" });
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith("datadog-api-key", "datadog-app-key"),
        integration: datadog,
      }),
    ).toBe("connected");
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("datadog-app-key"), integration: datadog })).toBe(
      "needs-attention",
    );
  });

  it("calls Slack connected with either token alone", () => {
    const slack = integrationOf({ id: "slack" });
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("slack-user-token"), integration: slack })).toBe(
      "connected",
    );
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("slack-bot-token"), integration: slack })).toBe(
      "connected",
    );
  });

  it("never calls a consent door half-connected by its client alone, the shared Google one included", () => {
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith(...GOOGLE_CLIENT),
        integration: integrationOf({ id: "drive" }),
      }),
    ).toBe("available");
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith("outlook-client-id"),
        integration: integrationOf({ id: "outlook" }),
      }),
    ).toBe("available");
  });

  it("calls a consent door connected by its grant beside its client, and needs-attention by a grant alone", () => {
    const gmail = integrationOf({ id: "gmail" });
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith(...GOOGLE_CLIENT, "gmail-oauth.json"),
        integration: gmail,
      }),
    ).toBe("connected");
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("gmail-oauth.json"), integration: gmail })).toBe(
      "needs-attention",
    );
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith(...GOOGLE_CLIENT, "gmail-oauth.json"),
        integration: integrationOf({ id: "drive" }),
      }),
    ).toBe("available");
  });

  it("reads Outlook mail and Outlook Calendar off their own grant files, so a mail grant alone leaves the calendar available", () => {
    const mailOnly = storeWith("outlook-client-id", "outlook-oauth.json");
    expect(
      integrationStatusOf({ datadogSite: "set", files: mailOnly, integration: integrationOf({ id: "outlook" }) }),
    ).toBe("connected");
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: mailOnly,
        integration: integrationOf({ id: "outlook-calendar" }),
      }),
    ).toBe("available");
    expect(
      integrationStatusOf({
        datadogSite: "set",
        files: storeWith("outlook-client-id", "outlook-calendar-oauth.json"),
        integration: integrationOf({ id: "outlook-calendar" }),
      }),
    ).toBe("connected");
  });

  it("calls a consent door needs-attention by a finding on its client before any grant exists", () => {
    const looseClient: readonly StoredFile[] = [
      { name: "google-client-id", state: "loose-mode", stored: true },
      ...storeWith("google-client-secret"),
    ];
    expect(
      integrationStatusOf({ datadogSite: "set", files: looseClient, integration: integrationOf({ id: "gmail" }) }),
    ).toBe("needs-attention");
  });

  it("calls any stored file the verb reports a finding on needs-attention, never connected", () => {
    const expired: readonly StoredFile[] = [
      ...storeWith(...GOOGLE_CLIENT),
      { name: "calendar-oauth.json", state: "access-token-expired", stored: true },
    ];
    expect(
      integrationStatusOf({ datadogSite: "set", files: expired, integration: integrationOf({ id: "calendar" }) }),
    ).toBe("needs-attention");
    const loose: readonly StoredFile[] = [{ name: "linear-token", state: "loose-mode", stored: true }];
    expect(
      integrationStatusOf({ datadogSite: "set", files: loose, integration: integrationOf({ id: "linear" }) }),
    ).toBe("needs-attention");
    const unheard: readonly StoredFile[] = [{ name: "hex-api-token", state: "some-later-state", stored: true }];
    expect(integrationStatusOf({ datadogSite: "set", files: unheard, integration: integrationOf({ id: "hex" }) })).toBe(
      "needs-attention",
    );
  });

  it("keeps Datadog out of Connected on both keys while its site is unset or invalid, and Available with nothing", () => {
    const datadog = integrationOf({ id: "datadog" });
    const keys = storeWith("datadog-api-key", "datadog-app-key");
    expect(integrationStatusOf({ datadogSite: "unset", files: keys, integration: datadog })).toBe("needs-attention");
    expect(integrationStatusOf({ datadogSite: "invalid", files: keys, integration: datadog })).toBe("needs-attention");
    expect(integrationStatusOf({ datadogSite: "unset", files: [], integration: datadog })).toBe("available");
    expect(
      integrationStatusOf({
        datadogSite: "unset",
        files: storeWith("linear-token"),
        integration: integrationOf({ id: "linear" }),
      }),
    ).toBe("connected");
  });

  it("lets Slack's optional app token neither connect it alone nor hold it back absent, but flags a finding on it", () => {
    const slack = integrationOf({ id: "slack" });
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("slack-app-token"), integration: slack })).toBe(
      "available",
    );
    expect(integrationStatusOf({ datadogSite: "set", files: storeWith("slack-bot-token"), integration: slack })).toBe(
      "connected",
    );
    const loose: readonly StoredFile[] = [
      ...storeWith("slack-bot-token"),
      { name: "slack-app-token", state: "loose-mode", stored: true },
    ];
    expect(integrationStatusOf({ datadogSite: "set", files: loose, integration: slack })).toBe("needs-attention");
  });

  it("keeps Slack out of Connected when its second token has a problem", () => {
    const files: readonly StoredFile[] = [
      ...storeWith("slack-user-token"),
      { name: "slack-bot-token", state: "loose-mode", stored: true },
    ];
    expect(integrationStatusOf({ datadogSite: "set", files, integration: integrationOf({ id: "slack" }) })).toBe(
      "needs-attention",
    );
  });

  it("reads a row the store lists as absent as empty, and ignores a finding on a file no integration reads", () => {
    const files: readonly StoredFile[] = [
      { name: "linear-token", state: "absent", stored: false },
      { name: "stray-file", state: "off-allowlist", stored: true },
    ];
    expect(integrationStatusOf({ datadogSite: "set", files, integration: integrationOf({ id: "linear" }) })).toBe(
      "available",
    );
    expect(filterCounts({ entries: entriesFor({ files }), query: "" })["needs-attention"]).toBe(0);
  });
});

describe("entryMatches", () => {
  const datadog = entriesFor({ files: [] }).find((entry) => entry.integration.id === "datadog")!;

  it("matches by name, id, pitch or alias, case-insensitively, and everything for an empty query", () => {
    expect(entryMatches({ entry: datadog, query: "DATA" })).toBe(true);
    expect(entryMatches({ entry: datadog, query: "traces" })).toBe(true);
    expect(entryMatches({ entry: datadog, query: "" })).toBe(true);
    const calendar = entriesFor({ files: [] }).find((entry) => entry.integration.id === "calendar")!;
    expect(entryMatches({ entry: calendar, query: "google cal" })).toBe(true);
  });

  it("needs every word, so a word no field carries misses", () => {
    expect(entryMatches({ entry: datadog, query: "datadog slack" })).toBe(false);
    expect(entryMatches({ entry: datadog, query: "billing" })).toBe(false);
  });
});

describe("catalogOrder and catalogShown", () => {
  const files = storeWith("datadog-api-key", "linear-token", "hex-api-token", "slack-bot-token");
  const entries = entriesFor({ files });

  it("puts needs-attention first, then every other A to Z whatever its status", () => {
    expect(catalogOrder({ entries }).map((entry) => entry.integration.label)).toEqual([
      "Datadog",
      "Cloudflare",
      "Fathom",
      "GitHub",
      "Gmail",
      "Google Calendar",
      "Google Drive",
      "Hex",
      "Linear",
      "Notion",
      "Outlook",
      "Outlook Calendar",
      "Slack",
    ]);
  });

  it("filters to one status, and by search, in the same order", () => {
    expect(catalogShown({ entries, filter: "connected", query: "" }).map((entry) => entry.integration.id)).toEqual([
      "hex",
      "linear",
      "slack",
    ]);
    expect(
      catalogShown({ entries, filter: "needs-attention", query: "" }).map((entry) => entry.integration.id),
    ).toEqual(["datadog"]);
    expect(catalogShown({ entries, filter: "all", query: "google" }).map((entry) => entry.integration.id)).toEqual([
      "gmail",
      "calendar",
      "drive",
    ]);
    expect(catalogShown({ entries, filter: "connected", query: "google" })).toEqual([]);
  });

  it("counts what each chip would show for the search in hand", () => {
    expect(filterCounts({ entries, query: "" })).toEqual({
      all: 13,
      available: 9,
      connected: 3,
      "needs-attention": 1,
    });
    expect(filterCounts({ entries, query: "google" })).toEqual({
      all: 3,
      available: 3,
      connected: 0,
      "needs-attention": 0,
    });
  });
});

describe("INTEGRATION_GUIDES", () => {
  it("gives every integration exactly one guide, and no guide to an integration the registry lacks", () => {
    expect(INTEGRATION_GUIDES.map((guide) => guide.id).toSorted()).toEqual(
      INTEGRATIONS.map((integration) => integration.id).toSorted(),
    );
  });

  it("draws every paste field an integration needs or can use under one of its steps, and nothing else", () => {
    expect(INTEGRATIONS.length).toBeGreaterThan(0);
    expect(integrationOf({ id: "slack" }).optional).toEqual(["slack-app-token"]);
    const uncovered = INTEGRATIONS.flatMap((integration) => {
      const pasted = guideOf({ id: integration.id }).steps.flatMap((step) =>
        step.paste === undefined ? [] : [...step.paste],
      );
      const fields = [...integration.paste, ...integration.optional];
      const same = [...pasted].toSorted().join(",") === fields.toSorted().join(",");
      return same ? [] : [integration.id];
    });
    expect(uncovered).toEqual([]);
  });

  it("runs a consent door's verb in one of its steps, and no verb on a paste-only door", () => {
    const wrong = INTEGRATIONS.flatMap((integration) => {
      const verbs = guideOf({ id: integration.id }).steps.flatMap((step) =>
        step.verb === undefined ? [] : [step.verb],
      );
      const expected = integration.consentVerb === undefined ? [] : [integration.consentVerb];
      return verbs.join(",") === expected.join(",") ? [] : [integration.id];
    });
    expect(wrong).toEqual([]);
  });

  it("throws for an id with no guide", () => {
    expect(() => guideOf({ id: "nope" })).toThrow("no integration guide for nope");
  });
});
