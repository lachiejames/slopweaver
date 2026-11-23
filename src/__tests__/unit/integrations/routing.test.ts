/**
 * The capability rows and nouns the integrations own, derived from each manifest: they equal the lists they replaced,
 * and a fixture integration with only a manifest appears in the table and in the partition.
 */
import { describe, expect, it } from "vitest";

import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { registeredIntegrations } from "../../../integrations/registry.js";
import {
  integrationNounsOf,
  integrationRoutingRowsOf,
  MEETING_ARTIFACT_TERMS,
  mergedRoutingTable,
} from "../../../integrations/routing.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/genericCapabilities.js";
import type { SourceCapability } from "../../../route/profile.js";
import { NOT_A_SOURCE_NOUNS, SOURCE_READING_NOUNS } from "../../../route/sourceNouns.js";

/** The integration-owned rows `src/route/genericCapabilities.ts` spelled by hand, at the index each held. */
const HAND_KEPT_ROWS = [
  { id: "telemetry", ordinal: 0 },
  { id: "drive", ordinal: 10 },
  { id: "gmail", ordinal: 11 },
  { id: "outlook", ordinal: 12 },
  { id: "calendar", ordinal: 13 },
  { id: "github-live", ordinal: 15 },
  { id: "linear-live", ordinal: 16 },
  { id: "notion-live", ordinal: 17 },
  { id: "slack-live", ordinal: 18 },
  { id: "hex", ordinal: 20 },
  { id: "twilio", ordinal: 21 },
  { id: "knock", ordinal: 22 },
];

/** The integration-owned source-reading nouns `src/route/sourceNouns.ts` spelled by hand. */
const HAND_KEPT_SOURCE_READING = [
  "calendar",
  "datadog",
  "drive",
  "github",
  "gmail",
  "hex",
  "knock",
  "linear",
  "notion",
  "outlook",
  "outlook-calendar",
  "slack",
  "twilio",
];

/** The integration-owned not-a-source nouns `src/route/sourceNouns.ts` spelled by hand. */
const HAND_KEPT_NOT_A_SOURCE = ["chatgpt", "cloudflare", "crowdstrike", "fathom", "onepassword"];

const REGISTERED_ROWS = integrationRoutingRowsOf({ manifests: registeredIntegrations() });

/** A real row, renamed, so a fixture carries every field the type requires. */
function capabilityNamed({ id }: { id: string }): SourceCapability {
  return { ...REGISTERED_ROWS[0]!.capability, id, terms: ["acme"] };
}

/** A manifest-only fixture integration that answers one question from the middle of the table. */
const FIXTURE = {
  features: { read: async () => (await import("../../../live/github/read.js")).parseGithubReadAddress },
  id: "acme",
  name: "Acme",
  noun: { kind: "source-reading" },
  routing: [{ capability: capabilityNamed({ id: "acme-live" }), ordinal: 5 }],
} as const satisfies IntegrationManifest;

/** A manifest-only fixture integration whose noun is not a source. */
const NOT_A_SOURCE_FIXTURE = {
  features: { read: async () => (await import("../../../live/github/read.js")).parseGithubReadAddress },
  id: "acme-sync",
  name: "Acme Sync",
  noun: { kind: "not-a-source", reason: "syncs the acme atlas" },
} as const satisfies IntegrationManifest;

describe("the routing rows the integrations own", () => {
  it("equal the hand-kept rows, each at the index it held", () => {
    expect(REGISTERED_ROWS.map((row) => ({ id: row.capability.id, ordinal: row.ordinal }))).toEqual(HAND_KEPT_ROWS);
    expect(HAND_KEPT_ROWS.map((row) => GENERIC_SOURCE_CAPABILITIES[row.ordinal]!.id)).toEqual(
      HAND_KEPT_ROWS.map((row) => row.id),
    );
  });

  it("do not depend on the order the manifests arrive in", () => {
    const reversed = integrationRoutingRowsOf({ manifests: registeredIntegrations().toReversed() });
    expect(reversed).toEqual(REGISTERED_ROWS);
  });

  it("append the meeting-record words to exactly the rows that asked for them", () => {
    const holders = REGISTERED_ROWS.filter((row) =>
      MEETING_ARTIFACT_TERMS.every((t) => row.capability.terms.includes(t)),
    );
    expect(holders.map((row) => row.capability.id)).toEqual(["drive", "gmail", "outlook"]);
    expect(holders[0]!.capability.terms.slice(-MEETING_ARTIFACT_TERMS.length)).toEqual(MEETING_ARTIFACT_TERMS);
  });

  it("are frozen", () => {
    expect(Object.isFrozen(REGISTERED_ROWS)).toBe(true);
  });
});

describe("the merged routing table", () => {
  const local = [capabilityNamed({ id: "local-a" }), capabilityNamed({ id: "local-b" })];
  const row = ({ id, ordinal }: { id: string; ordinal: number }) => ({ capability: capabilityNamed({ id }), ordinal });

  it("puts a fixture integration's row at its own index, with the local rows closing around it", () => {
    const merged = mergedRoutingTable({ integration: [row({ id: "acme-live", ordinal: 1 })], local });
    expect(merged.map((capability) => capability.id)).toEqual(["local-a", "acme-live", "local-b"]);
  });

  it("carries a fixture manifest's row into the table derived from every registered integration", () => {
    const merged = mergedRoutingTable({
      integration: integrationRoutingRowsOf({ manifests: [...registeredIntegrations(), FIXTURE] }),
      local: GENERIC_SOURCE_CAPABILITIES.filter(
        (capability) => !HAND_KEPT_ROWS.some((handKept) => handKept.id === capability.id),
      ),
    });
    expect(merged.length).toBe(GENERIC_SOURCE_CAPABILITIES.length + 1);
    expect(merged[5]!.id).toBe("acme-live");
  });

  it("refuses two rows claiming one index", () => {
    const integration = [row({ id: "one", ordinal: 0 }), row({ id: "two", ordinal: 0 })];
    expect(() => mergedRoutingTable({ integration, local })).toThrow("routing ordinals must be unique");
  });

  it("refuses an index past the table's end", () => {
    const integration = [row({ id: "one", ordinal: 3 })];
    expect(() => mergedRoutingTable({ integration, local })).toThrow("inside 0..2");
  });

  it("refuses a negative index", () => {
    const integration = [row({ id: "one", ordinal: -1 })];
    expect(() => mergedRoutingTable({ integration, local })).toThrow("inside 0..2");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(mergedRoutingTable({ integration: [], local }))).toBe(true);
  });
});

describe("the noun partition the integrations own", () => {
  const nouns = integrationNounsOf({ manifests: registeredIntegrations() });

  it("equals the hand-kept halves", () => {
    expect(nouns.sourceReading).toEqual(HAND_KEPT_SOURCE_READING);
    expect(nouns.notASource.map((row) => row.noun)).toEqual(HAND_KEPT_NOT_A_SOURCE);
  });

  it("reaches both exported lists", () => {
    expect(SOURCE_READING_NOUNS.filter((noun) => HAND_KEPT_SOURCE_READING.includes(noun))).toEqual(
      HAND_KEPT_SOURCE_READING,
    );
    expect(
      NOT_A_SOURCE_NOUNS.filter((row) => HAND_KEPT_NOT_A_SOURCE.includes(row.noun)).map((row) => row.noun),
    ).toEqual(HAND_KEPT_NOT_A_SOURCE);
  });

  it("carries a fixture manifest's noun onto the side it declares", () => {
    const derived = integrationNounsOf({ manifests: [FIXTURE, NOT_A_SOURCE_FIXTURE] });
    expect(derived).toEqual({
      notASource: [{ noun: "acme-sync", reason: "syncs the acme atlas" }],
      sourceReading: ["acme"],
    });
  });
});
