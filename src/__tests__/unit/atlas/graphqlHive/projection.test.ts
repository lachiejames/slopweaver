import { describe, expect, it } from "vitest";

import type {
  HiveOperationApiDetail,
  HivePageDetail,
  HiveTargetApiDetail,
} from "../../../../atlas/graphqlHive/model.js";
import {
  projectHiveConsolePages,
  projectHiveOperations,
  projectHiveOrganizations,
  projectHiveProjects,
  projectHiveTargets,
  projectHiveTypes,
} from "../../../../atlas/graphqlHive/projection.js";
import { reduceHiveRegistry } from "../../../../atlas/graphqlHive/registryRead.js";
import { reduceHiveSchema } from "../../../../atlas/graphqlHive/schemaRead.js";
import { unwrap } from "../../../../lib/result.js";

import { AT, introspection, registryPayload } from "./hiveFixtures.js";

const SCHEMA = unwrap(reduceHiveSchema({ data: introspection() }));
const REGISTRY = reduceHiveRegistry({ data: registryPayload({ sdl: "type Query { a: String }" }) });

describe("projectHiveOperations", () => {
  it("keys an operation by parent type and field, which is what both channels can name", () => {
    const entities = projectHiveOperations({ at: AT, surface: SCHEMA });
    expect(entities.map((entity) => entity.providerId).toSorted()).toStrictEqual([
      "Mutation.createProject",
      "Query.organization",
    ]);
  });

  it("leaves the browser channel untouched, so a sync can never blank a walk's rows", () => {
    const entities = projectHiveOperations({ at: AT, surface: SCHEMA });
    expect(entities.every((entity) => entity.channels.browser === null)).toBe(true);
  });

  it("says a GraphQL endpoint has no human address rather than leaving the link's absence ambiguous", () => {
    const entities = projectHiveOperations({ at: AT, surface: SCHEMA });
    expect(entities[0]!.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });

  it("carries the arguments into the stored detail", () => {
    const entities = projectHiveOperations({ at: AT, surface: SCHEMA });
    const detail = entities.find((entity) => entity.providerId === "Query.organization")!.channels.api!
      .detail as HiveOperationApiDetail;
    expect(detail.args).toStrictEqual([
      { argType: "OrganizationReferenceInput!", hasDefault: false, name: "reference" },
    ]);
  });
});

describe("projectHiveTypes", () => {
  it("keys a type by its own name", () => {
    const entities = projectHiveTypes({ at: AT, surface: SCHEMA });
    expect(entities.map((entity) => entity.providerId).toSorted()).toStrictEqual([
      "Mutation",
      "Organization",
      "ProjectType",
      "Query",
    ]);
  });
});

describe("projectHiveOrganizations", () => {
  it("gives an organisation the console address a human opens", () => {
    const entities = projectHiveOrganizations({ at: AT, registry: REGISTRY });
    expect(entities[0]!.channels.api!.source!.deepLink).toBe("https://app.graphql-hive.com/acme");
  });

  it("marks that address unverified, because the API computed it and no browser has opened it", () => {
    const entities = projectHiveOrganizations({ at: AT, registry: REGISTRY });
    expect(entities[0]!.channels.api!.source!.deepLinkStatus).toBe("unverified");
  });
});

describe("projectHiveProjects", () => {
  it("keys a project by its slug path", () => {
    const entities = projectHiveProjects({ at: AT, registry: REGISTRY });
    expect(entities[0]!.providerId).toBe("acme/gateway");
  });
});

describe("projectHiveTargets", () => {
  it("holds the composed schema by digest and length, never inline", () => {
    const artifact = {
      byteLength: 24,
      kind: "page-text" as const,
      mediaType: "application/graphql",
      relativePath: "artifacts/schemas/aa.graphql",
      sha256: "a".repeat(64),
    };
    const entities = projectHiveTargets({
      at: AT,
      registry: REGISTRY,
      schemas: [{ artifact, targetPath: "acme/gateway/production" }],
    });
    const detail = entities[0]!.channels.api!.detail as HiveTargetApiDetail;
    expect(detail).toStrictEqual({
      graphqlEndpointUrl: "https://example.test/graphql",
      organizationSlug: "acme",
      projectSlug: "gateway",
      schemaByteLength: 24,
      schemaSha256: "a".repeat(64),
      schemaVersionId: "ver-1",
      slug: "production",
    });
  });

  it("reports a null digest for a target whose schema was not stored, rather than a fake one", () => {
    const entities = projectHiveTargets({ at: AT, registry: REGISTRY, schemas: [] });
    expect((entities[0]!.channels.api!.detail as HiveTargetApiDetail).schemaSha256).toBeNull();
  });

  it("reports zero stored bytes for a target whose schema was not stored", () => {
    const entities = projectHiveTargets({ at: AT, registry: REGISTRY, schemas: [] });
    expect((entities[0]!.channels.api!.detail as HiveTargetApiDetail).schemaByteLength).toBe(0);
  });
});

describe("projectHiveConsolePages", () => {
  it("expands every declared route against the registry's own slugs", () => {
    const entities = projectHiveConsolePages({ at: AT, registry: REGISTRY });
    expect(entities.length).toBe(19);
  });

  it("publishes each page's exact address, which is the half of the browser surface needing no browser", () => {
    const entities = projectHiveConsolePages({ at: AT, registry: REGISTRY });
    const links = entities.map((entity) => entity.channels.api!.source!.deepLink);
    expect(links).toContain("https://app.graphql-hive.com/acme/gateway/production/settings");
  });

  it("leaves every page unreached, so a declared address is never mistaken for a witnessed one", () => {
    const entities = projectHiveConsolePages({ at: AT, registry: REGISTRY });
    expect(entities.every((entity) => (entity.channels.api!.detail as HivePageDetail).reachedAt === null)).toBe(true);
  });

  it("expands only the root routes when the registry holds nothing", () => {
    const entities = projectHiveConsolePages({
      at: AT,
      registry: { organizations: [], projects: [], targets: [] },
    });
    expect(entities.map((entity) => entity.providerId).toSorted()).toStrictEqual(["/", "/settings"]);
  });

  it("keeps the admin bound on the row, so a page a role cannot open is a declared bound not an absence", () => {
    const entities = projectHiveConsolePages({ at: AT, registry: REGISTRY });
    const settings = entities.find((entity) => entity.providerId.startsWith("/{organizationSlug}/view/settings"))!;
    expect((settings.channels.api!.detail as HivePageDetail).needsAdmin).toBe(true);
  });
});
