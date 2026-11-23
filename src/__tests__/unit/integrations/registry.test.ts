/**
 * The integration registry's invariants, and the proof that a list derived from it needs no hand edit.
 *
 * Every manifest module is imported here by name as well as reached through the registry, because the
 * untested-modules gate counts an import EDGE and a module only the registry imports reads as untested. That is
 * the same shape `unit/atlas/registryCoversEveryAtlas.test.ts` takes with the atlas registrations. Which
 * manifests the registry must hold is NOT read off that import list: it is enumerated from disk, so a manifest
 * directory the registry forgot fails below whether or not anyone added it here.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AtlasPlatformRegistration } from "../../../atlas/kit/registration.js";
import { atlasPlatforms } from "../../../atlas/registry.js";
import { ATLAS_NAMES } from "../../../automations/purposeNames.js";
import { AETHER_INTEGRATION } from "../../../integrations/aether/integration.js";
import { AIRTABLE_INTEGRATION } from "../../../integrations/airtable/integration.js";
import { BRAZE_INTEGRATION } from "../../../integrations/braze/integration.js";
import { CALENDAR_INTEGRATION } from "../../../integrations/calendar/integration.js";
import { CANVA_INTEGRATION } from "../../../integrations/canva/integration.js";
import { CHATGPT_INTEGRATION } from "../../../integrations/chatgpt/integration.js";
import { CLERK_INTEGRATION } from "../../../integrations/clerk/integration.js";
import { CLOUDFLARE_INTEGRATION } from "../../../integrations/cloudflare/integration.js";
import { CROWDSTRIKE_INTEGRATION } from "../../../integrations/crowdstrike/integration.js";
import { DATADOG_INTEGRATION } from "../../../integrations/datadog/integration.js";
import { DRIVE_INTEGRATION } from "../../../integrations/drive/integration.js";
import { FATHOM_INTEGRATION } from "../../../integrations/fathom/integration.js";
import { FIGMA_INTEGRATION } from "../../../integrations/figma/integration.js";
import { GEMINI_AI_STUDIO_INTEGRATION } from "../../../integrations/gemini-ai-studio/integration.js";
import { GITHUB_INTEGRATION } from "../../../integrations/github/integration.js";
import { GMAIL_INTEGRATION } from "../../../integrations/gmail/integration.js";
import { GOOGLE_ADMIN_INTEGRATION } from "../../../integrations/google-admin/integration.js";
import { GOOGLE_SECOPS_INTEGRATION } from "../../../integrations/google-secops/integration.js";
import { GRAPHQL_HIVE_INTEGRATION } from "../../../integrations/graphql-hive/integration.js";
import { HEX_INTEGRATION } from "../../../integrations/hex/integration.js";
import { INNGEST_INTEGRATION } from "../../../integrations/inngest/integration.js";
import { JAM_INTEGRATION } from "../../../integrations/jam/integration.js";
import { JUMPCLOUD_INTEGRATION } from "../../../integrations/jumpcloud/integration.js";
import { KNOCK_INTEGRATION } from "../../../integrations/knock/integration.js";
import { KNOWBE4_INTEGRATION } from "../../../integrations/knowbe4/integration.js";
import { LINEAR_INTEGRATION } from "../../../integrations/linear/integration.js";
import { MAKE_INTEGRATION } from "../../../integrations/make/integration.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { MICROSOFT365_INTEGRATION } from "../../../integrations/microsoft365/integration.js";
import { NIGHTFALL_INTEGRATION } from "../../../integrations/nightfall/integration.js";
import { NOTION_INTEGRATION } from "../../../integrations/notion/integration.js";
import { NX_CLOUD_INTEGRATION } from "../../../integrations/nx-cloud/integration.js";
import { ONEPASSWORD_INTEGRATION } from "../../../integrations/onepassword/integration.js";
import { OUTLOOK_INTEGRATION } from "../../../integrations/outlook/integration.js";
import { OUTLOOK_CALENDAR_INTEGRATION } from "../../../integrations/outlook-calendar/integration.js";
import { PRISMA_DATA_INTEGRATION } from "../../../integrations/prisma-data-platform/integration.js";
import { atlasNamesOf, atlasRegistrationsOf, integrations } from "../../../integrations/registry.js";
import { SLACK_INTEGRATION } from "../../../integrations/slack/integration.js";
import { TRELICA_INTEGRATION } from "../../../integrations/trelica/integration.js";
import { TWILIO_INTEGRATION } from "../../../integrations/twilio/integration.js";
import { VANTA_INTEGRATION } from "../../../integrations/vanta/integration.js";
import { WORKOS_INTEGRATION } from "../../../integrations/workos/integration.js";
import { XERO_INTEGRATION } from "../../../integrations/xero/integration.js";

/** The `src/integrations` directory, resolved from this file rather than from the working directory. */
const INTEGRATIONS_DIR = fileURLToPath(new URL("../../../integrations", import.meta.url));

/** Every manifest module, by its own import. */
const IMPORTED: readonly IntegrationManifest[] = [
  AETHER_INTEGRATION,
  AIRTABLE_INTEGRATION,
  BRAZE_INTEGRATION,
  CALENDAR_INTEGRATION,
  CANVA_INTEGRATION,
  CHATGPT_INTEGRATION,
  CLERK_INTEGRATION,
  CLOUDFLARE_INTEGRATION,
  CROWDSTRIKE_INTEGRATION,
  DATADOG_INTEGRATION,
  DRIVE_INTEGRATION,
  FATHOM_INTEGRATION,
  FIGMA_INTEGRATION,
  GEMINI_AI_STUDIO_INTEGRATION,
  GITHUB_INTEGRATION,
  GMAIL_INTEGRATION,
  GOOGLE_ADMIN_INTEGRATION,
  GOOGLE_SECOPS_INTEGRATION,
  GRAPHQL_HIVE_INTEGRATION,
  HEX_INTEGRATION,
  INNGEST_INTEGRATION,
  JAM_INTEGRATION,
  JUMPCLOUD_INTEGRATION,
  KNOCK_INTEGRATION,
  KNOWBE4_INTEGRATION,
  LINEAR_INTEGRATION,
  MAKE_INTEGRATION,
  MICROSOFT365_INTEGRATION,
  NIGHTFALL_INTEGRATION,
  NOTION_INTEGRATION,
  NX_CLOUD_INTEGRATION,
  ONEPASSWORD_INTEGRATION,
  OUTLOOK_INTEGRATION,
  OUTLOOK_CALENDAR_INTEGRATION,
  PRISMA_DATA_INTEGRATION,
  SLACK_INTEGRATION,
  TRELICA_INTEGRATION,
  TWILIO_INTEGRATION,
  VANTA_INTEGRATION,
  WORKOS_INTEGRATION,
  XERO_INTEGRATION,
];

/** The files that sit at the top of `src/integrations/` and are not an integration. */
const TOP_LEVEL_FILES: ReadonlySet<string> = new Set([
  "connections.ts",
  "corpusProjections.ts",
  "corpusSources.ts",
  "manifest.ts",
  "policyRows.ts",
  "registry.ts",
  "routing.ts",
]);

/**
 * Every entry under `src/integrations/` that is not one of its top-level files — each must be an integration.
 * Counted by NAME rather than by `isDirectory()`, so a symlinked or misplaced entry is still counted and fails.
 */
function manifestDirectories(): readonly string[] {
  return readdirSync(INTEGRATIONS_DIR)
    .filter((name) => !TOP_LEVEL_FILES.has(name))
    .toSorted();
}

/** The feature loaders a manifest declares, as `[feature, loader]` pairs (the atlas row is a value, not a loader). */
function loadersOf({
  manifest,
}: {
  manifest: IntegrationManifest;
}): readonly (readonly [string, () => Promise<unknown>])[] {
  const { atlas: _atlas, ...loaders } = manifest.features;
  return Object.entries(loaders);
}

/** A manifest-only fixture integration with an atlas, as a brand-new one would arrive. */
const FIXTURE_ATLAS: AtlasPlatformRegistration = {
  catalogue: { doorRouted: true, example: "slopweaver atlas acme read", summary: "a fixture" },
  platform: "acme",
  readDescriptor: async () => (await import("../../../atlas/knock/descriptor.js")).KNOCK_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("../../../atlas/knock/readAdapter.js")).readKnockSnapshot(args),
  verbs: [],
};
const FIXTURE: IntegrationManifest = { features: { atlas: FIXTURE_ATLAS }, id: "acme", name: "Acme" };

const manifests = integrations();

describe("the integration registry", () => {
  it("is not empty, and holds every manifest imported here, in the same order", () => {
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests).toEqual(IMPORTED);
  });

  it("holds exactly one manifest per directory under src/integrations, and the directory is the id", () => {
    expect(manifestDirectories().length).toBeGreaterThan(0);
    expect(manifests.map((manifest) => manifest.id)).toEqual(manifestDirectories());
  });

  it("every id is a lowercase slug", () => {
    const notSlugs = manifests.map((manifest) => manifest.id).filter((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
    expect(notSlugs).toEqual([]);
  });

  it("ids are unique and alphabetical — the order the atlas catalogue inherits", () => {
    const ids = manifests.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(ids.toSorted());
  });

  it("every name is non-empty", () => {
    expect(manifests.filter((manifest) => manifest.name.trim() === "").map((manifest) => manifest.id)).toEqual([]);
  });

  it("every declared feature loader resolves to a defined export", async () => {
    const loaders = manifests.flatMap((manifest) =>
      loadersOf({ manifest }).map(([feature, load]) => ({ feature, id: manifest.id, load })),
    );
    expect(loaders.length).toBeGreaterThan(0);
    const resolved = await Promise.all(loaders.map(async (row) => ({ ...row, value: await row.load() })));
    expect(resolved.filter((row) => row.value === undefined).map((row) => `${row.id}.${row.feature}`)).toEqual([]);
  });

  it("an integration's atlas carries the integration's own id as its platform", () => {
    const mismatched = manifests
      .filter((manifest) => manifest.features.atlas !== undefined && manifest.features.atlas.platform !== manifest.id)
      .map((manifest) => manifest.id);
    expect(mismatched).toEqual([]);
  });
});

describe("the lists derived from it", () => {
  it("the atlas registry is exactly the manifests that declare an atlas, in registry order", () => {
    const declaringAtlas = manifests.filter((manifest) => manifest.features.atlas !== undefined);
    expect(declaringAtlas.length).toBe(34);
    expect(atlasPlatforms()).toEqual(declaringAtlas.map((manifest) => manifest.id));
  });

  it("ATLAS_NAMES is each atlas's manifest name, keyed by platform, and nothing for an integration without one", () => {
    expect(Object.keys(ATLAS_NAMES)).toEqual(atlasPlatforms());
    expect(ATLAS_NAMES["onepassword"]).toBe("1Password");
    expect(ATLAS_NAMES["gemini-ai-studio"]).toBe("Gemini AI Studio");
    expect(Object.keys(ATLAS_NAMES)).not.toContain("gmail");
    expect(manifests.map((manifest) => manifest.id)).toContain("gmail");
  });

  it("a fixture integration with only a manifest appears in every derived list", () => {
    const withFixture = [...manifests, FIXTURE];
    expect(atlasRegistrationsOf({ manifests: withFixture }).map((row) => row.platform)).toEqual([
      ...atlasPlatforms(),
      "acme",
    ]);
    expect(atlasNamesOf({ manifests: withFixture })["acme"]).toBe("Acme");
    expect(atlasRegistrationsOf({ manifests }).map((row) => row.platform)).not.toContain("acme");
  });
});
