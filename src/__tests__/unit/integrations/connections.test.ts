/**
 * The integrations a board row may declare it needs, derived from each manifest's `connection`: the list equals the
 * table it replaced, row for row and in order, and a fixture integration with only a manifest appears in it.
 */
import { describe, expect, it } from "vitest";

import { disconnectedNeedsOf, INTEGRATION_NAMES, INTEGRATIONS } from "../../../handover/integrationNeeds.js";
import { integrationNeedRowsOf } from "../../../integrations/connections.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { registeredIntegrations } from "../../../integrations/registry.js";

/** The table `src/handover/integrationNeeds.ts` spelled by hand before it was derived. */
const HAND_KEPT_INTEGRATIONS = [
  { connectWith: "slopweaver gmail connect", credentialSets: [["gmail-oauth.json"]], integration: "gmail" },
  { connectWith: "slopweaver calendar connect", credentialSets: [["calendar-oauth.json"]], integration: "calendar" },
  { connectWith: "slopweaver drive connect", credentialSets: [["drive-oauth.json"]], integration: "drive" },
  { connectWith: "slopweaver outlook connect", credentialSets: [["outlook-oauth.json"]], integration: "outlook" },
  { connectWith: "slopweaver secrets set fathom-api-key", credentialSets: [["fathom-api-key"]], integration: "fathom" },
  {
    connectWith: "slopweaver secrets set slack-bot-token",
    credentialSets: [["slack-bot-token"], ["slack-user-token"]],
    integration: "slack",
  },
  { connectWith: "slopweaver secrets set linear-token", credentialSets: [["linear-token"]], integration: "linear" },
  { connectWith: "slopweaver secrets set notion-token", credentialSets: [["notion-token"]], integration: "notion" },
  {
    connectWith: "slopweaver secrets set datadog-api-key and datadog-app-key",
    credentialSets: [["datadog-api-key", "datadog-app-key"]],
    integration: "datadog",
  },
  {
    connectWith: "slopweaver secrets set vanta-client-id and vanta-client-secret",
    credentialSets: [["vanta-client-id", "vanta-client-secret"]],
    integration: "vanta",
  },
  { connectWith: "slopweaver secrets set hex-api-token", credentialSets: [["hex-api-token"]], integration: "hex" },
  {
    connectWith: "slopweaver secrets set trelica-tenant-host",
    credentialSets: [["trelica-tenant-host"]],
    integration: "trelica",
  },
  {
    connectWith: "slopweaver outlook-calendar connect",
    credentialSets: [["outlook-calendar-oauth.json"]],
    integration: "outlook-calendar",
  },
];

/** A manifest-only fixture integration that a row may need, connected by one stored key. */
const FIXTURE = {
  connection: { connectWith: "slopweaver secrets set hex-api-token", credentialSets: [["hex-api-token"]], ordinal: 13 },
  features: { read: async () => (await import("../../../live/github/read.js")).parseGithubReadAddress },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

describe("the integrations a board row may need, derived from the manifests", () => {
  it("equals the hand-kept table, row for row and in order", () => {
    expect(INTEGRATIONS).toEqual(HAND_KEPT_INTEGRATIONS);
    expect(INTEGRATION_NAMES).toEqual(HAND_KEPT_INTEGRATIONS.map((row) => row.integration));
  });

  it("never offers GitHub, which stores nothing on this install", () => {
    expect(INTEGRATION_NAMES.includes("github")).toBe(false);
  });

  it("the connection ordinals are 0..n-1 with no gap and no duplicate", () => {
    const ordinals = registeredIntegrations()
      .flatMap((manifest): number[] => ("connection" in manifest ? [manifest.connection.ordinal] : []))
      .toSorted((left, right) => left - right);
    expect(ordinals).toEqual(INTEGRATIONS.map((_, index) => index));
  });

  it("a fixture integration with only a manifest appears last, carrying its own connection", () => {
    const rows = integrationNeedRowsOf({ manifests: [...registeredIntegrations(), FIXTURE] });
    expect(rows).toEqual([
      ...INTEGRATIONS,
      { connectWith: "slopweaver secrets set hex-api-token", credentialSets: [["hex-api-token"]], integration: "acme" },
    ]);
  });

  it("a derived row still holds a row that needs it until its credential set is stored", () => {
    const tags = [{ key: "needs", source: "declared", value: "datadog" }];
    expect(disconnectedNeedsOf({ stored: new Set(["datadog-api-key"]), tags })).toEqual(["datadog"]);
    expect(disconnectedNeedsOf({ stored: new Set(["datadog-api-key", "datadog-app-key"]), tags })).toEqual([]);
  });

  it("orders by connection ordinal, never by the order the manifests arrive in", () => {
    expect(integrationNeedRowsOf({ manifests: registeredIntegrations().toReversed() })).toEqual(INTEGRATIONS);
  });

  it("is frozen, so one reader cannot change another's answer", () => {
    expect(Object.isFrozen(INTEGRATIONS)).toBe(true);
  });
});
