/**
 * Shared builders for the GraphQL Hive atlas's unit tests.
 *
 * Every payload here is shaped like the one the real endpoint returns — MEASURED against
 * `api.graphql-hive.com/graphql`, which is where the `edges { node }` connections and the three
 * reference-taking root fields come from. Reproduce the shape with
 * `slopweaver atlas graphql-hive read --kind type --query Connection`.
 */
import type { HiveAtlasEntity, HiveChannelEntity } from "../../../../atlas/graphqlHive/model.js";

/** A fixed instant, so every assertion in these files is exact. */
export const AT = "2026-09-05T00:00:00.000Z";

/**
 * One introspection response, with the two root types and one ordinary type.
 *
 * @returns the `data` object a reducer takes
 */
export function introspection(): Record<string, unknown> {
  return {
    __schema: {
      mutationType: { name: "Mutation" },
      queryType: { name: "Query" },
      subscriptionType: null,
      types: [
        {
          fields: [
            {
              args: [{ defaultValue: null, name: "reference", type: nonNull({ name: "OrganizationReferenceInput" }) }],
              deprecationReason: null,
              description: "one organisation",
              name: "organization",
              type: { kind: "OBJECT", name: "Organization", ofType: null },
            },
          ],
          kind: "OBJECT",
          name: "Query",
        },
        {
          fields: [
            {
              args: [{ defaultValue: "SINGLE", name: "input", type: nonNull({ name: "CreateProjectInput" }) }],
              deprecationReason: "use createTarget",
              description: null,
              name: "createProject",
              type: { kind: "OBJECT", name: "Project", ofType: null },
            },
          ],
          kind: "OBJECT",
          name: "Mutation",
        },
        {
          fields: [
            { args: [], deprecationReason: null, description: null, name: "slug", type: nonNull({ name: "String" }) },
            { args: [], deprecationReason: null, description: null, name: "projects", type: listOfProjects() },
          ],
          kind: "OBJECT",
          name: "Organization",
        },
        { enumValues: [{ name: "SINGLE" }, { name: "FEDERATION" }], kind: "ENUM", name: "ProjectType" },
        {
          fields: [{ args: [], name: "ignored", type: { kind: "SCALAR", name: "String", ofType: null } }],
          kind: "OBJECT",
          name: "__Hidden",
        },
      ],
    },
  };
}

/** A `NON_NULL` wrapper around one named type. */
function nonNull({ name }: { name: string }): Record<string, unknown> {
  return { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name, ofType: null } };
}

/** A `[Project!]!` type reference, so the renderer's two wrappers are both exercised. */
function listOfProjects(): Record<string, unknown> {
  return {
    kind: "NON_NULL",
    name: null,
    ofType: {
      kind: "LIST",
      name: null,
      ofType: { kind: "NON_NULL", name: null, ofType: { kind: "OBJECT", name: "Project", ofType: null } },
    },
  };
}

/**
 * One content response, in the `edges { node }` shape Hive's own connections use.
 *
 * @param sdl the composed schema text the single target publishes
 * @returns the `data` object a reducer takes
 */
export function registryPayload({ sdl }: { sdl: string }): Record<string, unknown> {
  return {
    organization: {
      id: "org-1",
      projects: {
        edges: [
          {
            node: {
              id: "proj-1",
              slug: "gateway",
              targets: {
                edges: [
                  {
                    node: {
                      graphqlEndpointUrl: "https://example.test/graphql",
                      id: "target-1",
                      latestValidSchemaVersion: { id: "ver-1", sdl },
                      slug: "production",
                    },
                  },
                ],
              },
              type: "FEDERATION",
            },
          },
        ],
      },
      slug: "acme",
    },
  };
}

/**
 * One channel view, with only the fields a test needs pinned.
 *
 * @param name which channel this view belongs to
 * @param detail what that channel knows
 * @param deepLink the address it carries, or `null`
 * @returns the channel entity
 */
export function channel({
  name,
  detail = null,
  deepLink = null,
}: {
  name: "api" | "browser";
  detail?: unknown;
  deepLink?: string | null;
}): HiveChannelEntity {
  return {
    channel: name,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [],
      channel: name,
      deepLink,
      deepLinkStatus: deepLink === null ? "unavailable" : "unverified",
      endpoint: "fixture",
      observedAt: AT,
    },
    state: "observed",
  };
}

/**
 * One stored entity, with whichever channels a test wants filled.
 *
 * @param providerId the provider key
 * @param kind the entity kind
 * @param api the API channel's view, or `null`
 * @param browser the browser channel's view, or `null`
 * @returns the entity
 */
export function entity({
  providerId,
  kind = "page",
  api = null,
  browser = null,
}: {
  providerId: string;
  kind?: HiveAtlasEntity["kind"];
  api?: HiveChannelEntity | null;
  browser?: HiveChannelEntity | null;
}): HiveAtlasEntity {
  return { channels: { api, browser }, id: `id-${providerId}`, kind, providerId };
}
