import { describe, expect, it } from "vitest";

import {
  connectionNodes,
  hiveRegistryVariables,
  projectPath,
  reduceHiveRegistry,
  registryQuerySupport,
  targetPath,
} from "../../../../atlas/graphqlHive/registryRead.js";
import { reduceHiveSchema } from "../../../../atlas/graphqlHive/schemaRead.js";
import { unwrap } from "../../../../lib/result.js";

import { introspection, registryPayload } from "./hiveFixtures.js";

const SDL = "type Query { hello: String }";

describe("connectionNodes", () => {
  it("reads Hive's own edges-and-node connection shape", () => {
    expect(connectionNodes({ value: { edges: [{ node: { slug: "a" } }, { node: { slug: "b" } }] } })).toStrictEqual([
      { slug: "a" },
      { slug: "b" },
    ]);
  });

  it("reads a Relay-style nodes array, so a reshaped field does not break the atlas", () => {
    expect(connectionNodes({ value: { nodes: [{ slug: "a" }] } })).toStrictEqual([{ slug: "a" }]);
  });

  it("reads a bare array", () => {
    expect(connectionNodes({ value: [{ slug: "a" }] })).toStrictEqual([{ slug: "a" }]);
  });

  it("answers nothing for a field carrying no connection at all", () => {
    expect(connectionNodes({ value: null })).toStrictEqual([]);
  });

  it("drops an edge whose node is not an object, rather than guessing at it", () => {
    expect(connectionNodes({ value: { edges: [{ node: null }, { node: { slug: "a" } }] } })).toStrictEqual([
      { slug: "a" },
    ]);
  });
});

describe("registryQuerySupport", () => {
  it("allows the content query when the schema declares the root field it names", () => {
    const support = registryQuerySupport({ surface: unwrap(reduceHiveSchema({ data: introspection() })) });
    expect(support.supported).toBe(true);
  });

  it("names every root Query field the schema DOES declare, which is what makes a refusal actionable", () => {
    const support = registryQuerySupport({ surface: unwrap(reduceHiveSchema({ data: introspection() })) });
    expect(support.declaredQueryFields).toStrictEqual(["organization"]);
  });

  it("refuses when the schema declares no such root field, rather than sending a query that 200s with errors", () => {
    const support = registryQuerySupport({ surface: { operations: [], types: [] } });
    expect(support.supported).toBe(false);
  });
});

describe("hiveRegistryVariables", () => {
  it("wraps a slug in the selector shape OrganizationReferenceInput declares", () => {
    expect(hiveRegistryVariables({ organizationSlug: "acme" })).toStrictEqual({
      reference: { bySelector: { organizationSlug: "acme" } },
    });
  });
});

describe("reduceHiveRegistry", () => {
  it("counts an organisation's projects from the connection rather than trusting a field", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(surface.organizations).toStrictEqual([{ projectCount: 1, slug: "acme" }]);
  });

  it("keys a project by its whole slug path, so two organisations' projects never collide", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(projectPath({ project: surface.projects[0]! })).toBe("acme/gateway");
  });

  it("carries the project type through", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(surface.projects[0]!.projectType).toBe("FEDERATION");
  });

  it("keys a target by its three-segment slug path", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(targetPath({ target: surface.targets[0]! })).toBe("acme/gateway/production");
  });

  it("reads the composed SDL, which is the payload this atlas exists to hold", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(surface.targets[0]!.sdl).toBe(SDL);
  });

  it("reads the target's own gateway endpoint", () => {
    const surface = reduceHiveRegistry({ data: registryPayload({ sdl: SDL }) });
    expect(surface.targets[0]!.graphqlEndpointUrl).toBe("https://example.test/graphql");
  });

  it("answers nothing at all when the root field resolved null, which is a token that cannot see it", () => {
    expect(reduceHiveRegistry({ data: { organization: null } })).toStrictEqual({
      organizations: [],
      projects: [],
      targets: [],
    });
  });

  it("holds a target with no published version as a target, not as an absence", () => {
    const payload = registryPayload({ sdl: SDL });
    const organization = payload["organization"] as Record<string, unknown>;
    const projects = organization["projects"] as { edges: { node: Record<string, unknown> }[] };
    const target = (projects.edges[0]!.node["targets"] as { edges: { node: Record<string, unknown> }[] }).edges[0]!
      .node;
    target["latestValidSchemaVersion"] = null;
    const surface = reduceHiveRegistry({ data: payload });
    expect(surface.targets[0]!.sdl).toBeNull();
  });
});
