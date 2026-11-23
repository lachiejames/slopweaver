/*
 * The NAMESPACE each atlas layers over the kit's stable-identity hashing.
 *
 * An entity id is `sha1("<namespace>:<sorted components>")`, and the namespace is `<platform>:<kind>`. Each
 * `identity.ts` in the table below — every one no older test reaches; cloudflare, datadog, microsoft365, nxCloud
 * and vanta carry their own — is pinned here to the one expression that defines it, with the platform read from the
 * atlas's own registration rather than retyped — so an id function that drifts from its registered platform
 * fails. The KIND half is read from each atlas's own model, which means renaming a kind in the model re-ids its
 * stored entities without failing this file; that half is not pinned here.
 */
import { describe, expect, it } from "vitest";

import { airtableEntityId, airtableGapId } from "../../../atlas/airtable/identity.js";
import { AIRTABLE_ATLAS_KINDS } from "../../../atlas/airtable/kinds.js";
import { AIRTABLE_ATLAS_REGISTRATION } from "../../../atlas/airtable/registration.js";
import { brazeEntityId, brazeGapId } from "../../../atlas/braze/identity.js";
import { BRAZE_KINDS } from "../../../atlas/braze/model.js";
import { BRAZE_ATLAS_REGISTRATION } from "../../../atlas/braze/registration.js";
import { clerkEntityId, clerkGapId } from "../../../atlas/clerk/identity.js";
import { CLERK_ATLAS_KINDS } from "../../../atlas/clerk/model.js";
import { CLERK_ATLAS_REGISTRATION } from "../../../atlas/clerk/registration.js";
import { crowdstrikeEntityId } from "../../../atlas/crowdstrike/identity.js";
import { CROWDSTRIKE_KINDS } from "../../../atlas/crowdstrike/model.js";
import { CROWDSTRIKE_ATLAS_REGISTRATION } from "../../../atlas/crowdstrike/registration.js";
import { figmaEntityId, figmaGapId } from "../../../atlas/figma/identity.js";
import { FIGMA_ATLAS_KINDS } from "../../../atlas/figma/kinds.js";
import { FIGMA_ATLAS_REGISTRATION } from "../../../atlas/figma/registration.js";
import { geminiAiStudioEntityId, geminiAiStudioGapId } from "../../../atlas/geminiAiStudio/identity.js";
import { GEMINI_AI_STUDIO_KINDS } from "../../../atlas/geminiAiStudio/model.js";
import { GEMINI_AI_STUDIO_ATLAS_REGISTRATION } from "../../../atlas/geminiAiStudio/registration.js";
import { githubEntityId } from "../../../atlas/github/identity.js";
import { GITHUB_KINDS } from "../../../atlas/github/model.js";
import { GITHUB_ATLAS_REGISTRATION } from "../../../atlas/github/registration.js";
import { hiveEntityId, hiveGapId } from "../../../atlas/graphqlHive/identity.js";
import { HIVE_ATLAS_KINDS } from "../../../atlas/graphqlHive/model.js";
import { GRAPHQL_HIVE_ATLAS_REGISTRATION } from "../../../atlas/graphqlHive/registration.js";
import { hexEntityId, hexGapId } from "../../../atlas/hex/identity.js";
import { HEX_ATLAS_KINDS } from "../../../atlas/hex/model.js";
import { HEX_ATLAS_REGISTRATION } from "../../../atlas/hex/registration.js";
import { inngestEntityId, inngestGapId } from "../../../atlas/inngest/identity.js";
import { INNGEST_KINDS } from "../../../atlas/inngest/model.js";
import { INNGEST_ATLAS_REGISTRATION } from "../../../atlas/inngest/registration.js";
import { jamEntityId, jamGapId } from "../../../atlas/jam/identity.js";
import { JAM_ATLAS_KINDS } from "../../../atlas/jam/model.js";
import { JAM_ATLAS_REGISTRATION } from "../../../atlas/jam/registration.js";
import { jumpcloudEntityId } from "../../../atlas/jumpcloud/identity.js";
import { JUMPCLOUD_KINDS } from "../../../atlas/jumpcloud/model.js";
import { JUMPCLOUD_ATLAS_REGISTRATION } from "../../../atlas/jumpcloud/registration.js";
import { stableEntityId, stableGapId } from "../../../atlas/kit/identity.js";
import { knockEntityId, knockGapId } from "../../../atlas/knock/identity.js";
import { KNOCK_ATLAS_KINDS } from "../../../atlas/knock/kinds.js";
import { KNOCK_ATLAS_REGISTRATION } from "../../../atlas/knock/registration.js";
import { notionEntityId, notionGapId } from "../../../atlas/notion/identity.js";
import { NOTION_ATLAS_KINDS } from "../../../atlas/notion/model.js";
import { NOTION_ATLAS_REGISTRATION } from "../../../atlas/notion/registration.js";
import { onepasswordEdgeProviderId, onepasswordEntityId } from "../../../atlas/onepassword/identity.js";
import { ONEPASSWORD_KINDS } from "../../../atlas/onepassword/model.js";
import { ONEPASSWORD_ATLAS_REGISTRATION } from "../../../atlas/onepassword/registration.js";
import { prismaDataPlatformEntityId, prismaDataPlatformGapId } from "../../../atlas/prismaDataPlatform/identity.js";
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS } from "../../../atlas/prismaDataPlatform/kinds.js";
import { PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION } from "../../../atlas/prismaDataPlatform/registration.js";
import { atlasPlatforms } from "../../../atlas/registry.js";
import { trelicaEntityId, trelicaGapId } from "../../../atlas/trelica/identity.js";
import { TRELICA_ATLAS_KINDS } from "../../../atlas/trelica/model.js";
import { TRELICA_ATLAS_REGISTRATION } from "../../../atlas/trelica/registration.js";
import { twilioEntityId, twilioGapId } from "../../../atlas/twilio/identity.js";
import { TWILIO_ATLAS_KINDS } from "../../../atlas/twilio/model.js";
import { TWILIO_ATLAS_REGISTRATION } from "../../../atlas/twilio/registration.js";
import { workosEntityId, workosGapId } from "../../../atlas/workos/identity.js";
import { WORKOS_ATLAS_KINDS } from "../../../atlas/workos/model.js";
import { WORKOS_ATLAS_REGISTRATION } from "../../../atlas/workos/registration.js";
import { xeroEntityId, xeroGapId } from "../../../atlas/xero/identity.js";
import { XERO_ATLAS_KINDS } from "../../../atlas/xero/model.js";
import { XERO_ATLAS_REGISTRATION } from "../../../atlas/xero/registration.js";

/** The scope github's entity id is keyed by, in every row that has to supply one. */
const GITHUB_SCOPE = "example-org/example-repo";

/** One atlas's identity, normalised so a single table can drive every assertion. */
interface PlatformRow {
  /** The platform name the atlas's own registration declares — the namespace's first half. */
  readonly platform: string;
  /** Every kind the atlas's model declares — the namespace's second half. */
  readonly kinds: readonly string[];
  /** Components beyond `providerId` that the atlas's id function folds in. */
  readonly extraComponents: Readonly<Record<string, string>>;
  /** The atlas's own id function applied to one provider id under every declared kind. */
  readonly idsFor: (args: { providerId: string }) => readonly { readonly id: string; readonly kind: string }[];
}

/** Bind an atlas's typed id function to its typed kinds, so a kind not in the union cannot be tabled. */
function platformRow<K extends string>({
  platform,
  kinds,
  entityId,
  extraComponents = {},
}: {
  platform: string;
  kinds: readonly K[];
  entityId: (args: { kind: K; providerId: string }) => string;
  extraComponents?: Readonly<Record<string, string>>;
}): PlatformRow {
  return {
    extraComponents,
    idsFor: ({ providerId }) => kinds.map((kind) => ({ id: entityId({ kind, providerId }), kind })),
    kinds,
    platform,
  };
}

/** What every atlas's id function must equal: the kit's hash over `<platform>:<kind>` and the components. */
function expectedId({
  platform,
  kind,
  providerId,
  extraComponents,
}: {
  platform: string;
  kind: string;
  providerId: string;
  extraComponents: Readonly<Record<string, string>>;
}): string {
  return stableEntityId({ components: { providerId, ...extraComponents }, namespace: `${platform}:${kind}` });
}

const ROWS: readonly PlatformRow[] = [
  platformRow({
    entityId: airtableEntityId,
    kinds: AIRTABLE_ATLAS_KINDS,
    platform: AIRTABLE_ATLAS_REGISTRATION.platform,
  }),
  platformRow({ entityId: brazeEntityId, kinds: BRAZE_KINDS, platform: BRAZE_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: clerkEntityId, kinds: CLERK_ATLAS_KINDS, platform: CLERK_ATLAS_REGISTRATION.platform }),
  platformRow({
    entityId: crowdstrikeEntityId,
    kinds: CROWDSTRIKE_KINDS,
    platform: CROWDSTRIKE_ATLAS_REGISTRATION.platform,
  }),
  platformRow({ entityId: figmaEntityId, kinds: FIGMA_ATLAS_KINDS, platform: FIGMA_ATLAS_REGISTRATION.platform }),
  platformRow({
    entityId: geminiAiStudioEntityId,
    kinds: GEMINI_AI_STUDIO_KINDS,
    platform: GEMINI_AI_STUDIO_ATLAS_REGISTRATION.platform,
  }),
  platformRow({
    entityId: ({ kind, providerId }) => githubEntityId({ kind, providerId, scopeRef: GITHUB_SCOPE }),
    extraComponents: { scopeRef: GITHUB_SCOPE },
    kinds: GITHUB_KINDS,
    platform: GITHUB_ATLAS_REGISTRATION.platform,
  }),
  platformRow({
    entityId: hiveEntityId,
    kinds: HIVE_ATLAS_KINDS,
    platform: GRAPHQL_HIVE_ATLAS_REGISTRATION.platform,
  }),
  platformRow({ entityId: hexEntityId, kinds: HEX_ATLAS_KINDS, platform: HEX_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: inngestEntityId, kinds: INNGEST_KINDS, platform: INNGEST_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: jamEntityId, kinds: JAM_ATLAS_KINDS, platform: JAM_ATLAS_REGISTRATION.platform }),
  platformRow({
    entityId: jumpcloudEntityId,
    kinds: JUMPCLOUD_KINDS,
    platform: JUMPCLOUD_ATLAS_REGISTRATION.platform,
  }),
  platformRow({ entityId: knockEntityId, kinds: KNOCK_ATLAS_KINDS, platform: KNOCK_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: notionEntityId, kinds: NOTION_ATLAS_KINDS, platform: NOTION_ATLAS_REGISTRATION.platform }),
  platformRow({
    entityId: ({ kind, providerId }) => onepasswordEntityId({ components: { providerId }, kind }),
    kinds: ONEPASSWORD_KINDS,
    platform: ONEPASSWORD_ATLAS_REGISTRATION.platform,
  }),
  platformRow({
    entityId: prismaDataPlatformEntityId,
    kinds: PRISMA_DATA_PLATFORM_ATLAS_KINDS,
    platform: PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION.platform,
  }),
  platformRow({
    entityId: trelicaEntityId,
    kinds: TRELICA_ATLAS_KINDS,
    platform: TRELICA_ATLAS_REGISTRATION.platform,
  }),
  platformRow({ entityId: twilioEntityId, kinds: TWILIO_ATLAS_KINDS, platform: TWILIO_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: workosEntityId, kinds: WORKOS_ATLAS_KINDS, platform: WORKOS_ATLAS_REGISTRATION.platform }),
  platformRow({ entityId: xeroEntityId, kinds: XERO_ATLAS_KINDS, platform: XERO_ATLAS_REGISTRATION.platform }),
];

const ROW_ENTRIES = ROWS.map((row) => [row.platform, row] as const);

describe("every atlas's entity id is the kit's hash over `<platform>:<kind>`", () => {
  it("tables all twenty atlases", () => {
    expect(ROWS.length).toBe(20);
  });

  it("names only platforms the registry serves", () => {
    const registered = atlasPlatforms();

    expect(ROWS.filter((row) => !registered.includes(row.platform)).map((row) => row.platform)).toEqual([]);
  });

  it("gives every atlas at least one kind", () => {
    expect(ROWS.filter((row) => row.kinds.length === 0).map((row) => row.platform)).toEqual([]);
  });

  it.each(ROW_ENTRIES)(
    "%s's id is exactly the kit hash under `<platform>:<kind>`, for every kind",
    (_platform, row) => {
      const actual = row.idsFor({ providerId: "x" });
      const expected = row.kinds.map((kind) => ({
        id: expectedId({ extraComponents: row.extraComponents, kind, platform: row.platform, providerId: "x" }),
        kind,
      }));

      expect(actual).toEqual(expected);
    },
  );

  it.each(ROW_ENTRIES)("%s's id changes with the provider id", (_platform, row) => {
    const forX = row.idsFor({ providerId: "x" }).map((entry) => entry.id);
    const forY = row.idsFor({ providerId: "y" }).map((entry) => entry.id);

    expect(forX.filter((id, index) => id === forY[index])).toEqual([]);
  });

  it("never gives one provider id the same identity across two platforms or two kinds", () => {
    const ids = ROWS.flatMap((row) => row.idsFor({ providerId: "x" }).map((entry) => entry.id));

    expect(ids.length).toBe(ROWS.reduce((total, row) => total + row.kinds.length, 0));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits 32-character hex digests", () => {
    const malformed = ROWS.flatMap((row) => row.idsFor({ providerId: "x" }))
      .filter((entry) => !/^[0-9a-f]{32}$/.test(entry.id))
      .map((entry) => entry.kind);

    expect(malformed).toEqual([]);
  });
});

describe("every atlas's gap id is the kit's gap hash, keyed by condition and scope alone", () => {
  const GAP_ROWS = [
    { gapId: airtableGapId, platform: AIRTABLE_ATLAS_REGISTRATION.platform },
    { gapId: brazeGapId, platform: BRAZE_ATLAS_REGISTRATION.platform },
    { gapId: clerkGapId, platform: CLERK_ATLAS_REGISTRATION.platform },
    { gapId: figmaGapId, platform: FIGMA_ATLAS_REGISTRATION.platform },
    { gapId: geminiAiStudioGapId, platform: GEMINI_AI_STUDIO_ATLAS_REGISTRATION.platform },
    { gapId: hiveGapId, platform: GRAPHQL_HIVE_ATLAS_REGISTRATION.platform },
    { gapId: hexGapId, platform: HEX_ATLAS_REGISTRATION.platform },
    { gapId: inngestGapId, platform: INNGEST_ATLAS_REGISTRATION.platform },
    { gapId: jamGapId, platform: JAM_ATLAS_REGISTRATION.platform },
    { gapId: knockGapId, platform: KNOCK_ATLAS_REGISTRATION.platform },
    { gapId: notionGapId, platform: NOTION_ATLAS_REGISTRATION.platform },
    { gapId: prismaDataPlatformGapId, platform: PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION.platform },
    { gapId: trelicaGapId, platform: TRELICA_ATLAS_REGISTRATION.platform },
    { gapId: twilioGapId, platform: TWILIO_ATLAS_REGISTRATION.platform },
    { gapId: workosGapId, platform: WORKOS_ATLAS_REGISTRATION.platform },
    { gapId: xeroGapId, platform: XERO_ATLAS_REGISTRATION.platform },
  ] as const;

  it("tables the sixteen atlases that declare a gap id", () => {
    expect(GAP_ROWS.length).toBe(16);
  });

  it.each(GAP_ROWS.map((row) => [row.platform, row.gapId] as const))(
    "%s's gap id is stableGapId over the same condition and scope",
    (_platform, gapId) => {
      expect(gapId({ condition: "schema-drift", scope: "controls" })).toBe(
        stableGapId({ condition: "schema-drift", scope: "controls" }),
      );
    },
  );

  it.each(GAP_ROWS.map((row) => [row.platform, row.gapId] as const))(
    "%s's gap id differs across scopes and across conditions",
    (_platform, gapId) => {
      const base = gapId({ condition: "schema-drift", scope: "controls" });

      expect(gapId({ condition: "schema-drift", scope: "risks" })).not.toBe(base);
      expect(gapId({ condition: "coverage-hole", scope: "controls" })).not.toBe(base);
    },
  );
});

describe("githubEntityId", () => {
  const KIND = "webhook";

  it("is the kit hash over `github:<kind>` with both providerId and scopeRef as components", () => {
    expect(githubEntityId({ kind: KIND, providerId: "x", scopeRef: "org/repo" })).toBe(
      stableEntityId({ components: { providerId: "x", scopeRef: "org/repo" }, namespace: "github:webhook" }),
    );
  });

  it("gives two scopes holding the same provider id two identities", () => {
    const first = githubEntityId({ kind: KIND, providerId: "12345", scopeRef: "org/repo-a" });
    const second = githubEntityId({ kind: KIND, providerId: "12345", scopeRef: "org/repo-b" });

    expect(first).not.toBe(second);
  });

  it("gives a repository's settings and an organisation's settings distinct identities when the scope is the provider id", () => {
    const repository = githubEntityId({
      kind: "repository-settings",
      providerId: "org/repo",
      scopeRef: "org/repo",
    });
    const organization = githubEntityId({ kind: "organization-settings", providerId: "org", scopeRef: "org" });

    expect(repository).not.toBe(organization);
  });

  it("is not the id the same provider id would have without its scope", () => {
    const scoped = githubEntityId({ kind: KIND, providerId: "x", scopeRef: "org/repo" });

    expect(scoped).not.toBe(stableEntityId({ components: { providerId: "x" }, namespace: "github:webhook" }));
  });
});

describe("onepasswordEdgeProviderId", () => {
  it("is exactly `<parentId>:<principalId>`", () => {
    expect(onepasswordEdgeProviderId({ parentId: "vault-1", principalId: "user-2" })).toBe("vault-1:user-2");
  });

  it("is ordered: the parent and the principal are not interchangeable", () => {
    expect(onepasswordEdgeProviderId({ parentId: "user-2", principalId: "vault-1" })).toBe("user-2:vault-1");
  });
});

describe("onepasswordEntityId", () => {
  it("is the kit hash over `onepassword:<kind>` with the caller's components verbatim", () => {
    const components = { parent: "vault-1", principal: "user-2" };

    expect(onepasswordEntityId({ components, kind: "vault-grant" })).toBe(
      stableEntityId({ components, namespace: "onepassword:vault-grant" }),
    );
  });

  it("gives one edge under two kinds two identities", () => {
    const providerId = onepasswordEdgeProviderId({ parentId: "g-1", principalId: "u-1" });

    expect(onepasswordEntityId({ components: { providerId }, kind: "group-member" })).not.toBe(
      onepasswordEntityId({ components: { providerId }, kind: "vault-grant" }),
    );
  });

  it("gives a null component a different identity from an empty one", () => {
    expect(onepasswordEntityId({ components: { providerId: null }, kind: "user" })).not.toBe(
      onepasswordEntityId({ components: { providerId: "" }, kind: "user" }),
    );
  });
});
