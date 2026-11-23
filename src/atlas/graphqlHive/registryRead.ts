/**
 * Reading the registry's own CONTENT — the organisations, projects and targets Hive holds, and each
 * target's composed schema.
 *
 * ## Why this is preflighted against the introspected schema rather than simply sent
 *
 * A REST atlas discovers a wrong path as a 404. A GraphQL one discovers a wrong FIELD as a 200 carrying an
 * `errors` array, which reads at a glance like a permissions problem and is not one. So the content query
 * is only sent once {@link registryQuerySupport} has confirmed against this run's own introspection that
 * the root field it names is actually declared — and when it is not, the atlas records what `Query` DOES
 * declare instead of a bare failure. That turns a schema Hive has since reshaped into a finding a reader
 * can act on, which is the difference between an atlas that is honest about its gaps and one that is merely
 * empty.
 *
 * ## The SDL is the payload, and it is the reason this atlas exists at the rank it does
 *
 * A target's composed schema is the typed surface an end-to-end map would otherwise have to rediscover.
 * It is read here and written as a content-addressed artifact by `sync.ts` — never inlined into a kind
 * file, which would put a large blob into a document meant to stay greppable.
 *
 * ## Everything else is parsed defensively
 *
 * Provider JSON is walked with type guards, tolerating both Relay-style `{ nodes: [...] }` connections and
 * a plain array, because which one a field returns is Hive's decision and not one this atlas should break
 * on. An entry it cannot identify is skipped, never guessed at.
 */
import { absentAs } from "#lib/absent.js";
import { fieldOf, isRecord, stringField } from "./client.js";
import type { HiveSchemaSurface } from "./schemaRead.js";

/** The root field the content query hangs off. Preflighted before the query is ever sent. */
export const HIVE_REGISTRY_ROOT_FIELD = "organization";

/**
 * The content document: one organisation's whole hierarchy plus each target's composed schema.
 *
 * Written against the schema this atlas's own introspection returned, and the shape is not the obvious one.
 * MEASURED against `api.graphql-hive.com/graphql`: the public API declares exactly three root
 * `Query` fields — `organization`, `project` and `target` — every one of them taking a REFERENCE, and no
 * list field of any kind. There is no enumeration entry point, which is why this query takes an
 * organisation selector rather than fetching every organisation the token can see. Reproduce with
 * `slopweaver atlas graphql-hive read --kind operation`.
 *
 * Connections are `edges { node }` rather than `nodes` here — also read off the introspection, from
 * `ProjectConnection` and `TargetConnection`.
 */
export const HIVE_REGISTRY_QUERY = `query SlopweaverHiveAtlasRegistry($reference: OrganizationReferenceInput!) {
  organization(reference: $reference) {
    id
    slug
    projects {
      edges {
        node {
          id
          slug
          type
          targets {
            edges {
              node {
                id
                slug
                graphqlEndpointUrl
                latestValidSchemaVersion { id sdl }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * The variables one content query takes.
 *
 * @param organizationSlug the organisation to read, which the API cannot enumerate — see the query above
 * @returns the `reference` variable, in the selector shape `OrganizationReferenceInput` declares
 */
export function hiveRegistryVariables({
  organizationSlug,
}: {
  organizationSlug: string;
}): Readonly<Record<string, unknown>> {
  return { reference: { bySelector: { organizationSlug } } };
}

/**
 * Whether this run may send the content query, and what the schema declares if it may not.
 *
 * @internal
 */
export interface HiveRegistrySupport {
  readonly supported: boolean;
  /** Every root `Query` field this schema declares, sorted — the evidence behind a `false`. */
  readonly declaredQueryFields: readonly string[];
}

/**
 * Decide whether the introspected schema declares the root field the content query names.
 *
 * @param surface this run's own introspection
 * @returns whether to send the content query, and the root fields the schema actually declares
 */
export function registryQuerySupport({ surface }: { surface: HiveSchemaSurface }): HiveRegistrySupport {
  const queryFields = surface.operations
    .filter((operation) => operation.parentType === "Query")
    .map((operation) => operation.name)
    .toSorted();
  return { declaredQueryFields: queryFields, supported: queryFields.includes(HIVE_REGISTRY_ROOT_FIELD) };
}

/** One organisation, with the projects hanging off it already counted. */
interface HiveRegistryOrganization {
  readonly slug: string;
  readonly projectCount: number;
}

/** One project, keyed by the slug path that locates it. */
export interface HiveRegistryProject {
  readonly organizationSlug: string;
  readonly slug: string;
  readonly projectType: string;
  readonly targetCount: number;
}

/** One target, with its composed schema's own text where the registry holds one. */
export interface HiveRegistryTarget {
  readonly organizationSlug: string;
  readonly projectSlug: string;
  readonly slug: string;
  readonly schemaVersionId: string | null;
  /** The endpoint this target's gateway is served from, when the registry records one. */
  readonly graphqlEndpointUrl: string | null;
  /** The composed SDL's text, or `null` when this target has published no valid version. */
  readonly sdl: string | null;
}

/** The whole registry, flattened into the three kinds this atlas stores. */
export interface HiveRegistrySurface {
  readonly organizations: readonly HiveRegistryOrganization[];
  readonly projects: readonly HiveRegistryProject[];
  readonly targets: readonly HiveRegistryTarget[];
}

/**
 * Reduce a content response into the three registry kinds.
 *
 * @param data the `data` object the content query returned
 * @returns the flattened registry, each list sorted by its own slug path so a published file is stable
 */
export function reduceHiveRegistry({ data }: { data: Record<string, unknown> }): HiveRegistrySurface {
  const root = fieldOf({ key: HIVE_REGISTRY_ROOT_FIELD, record: data });
  // The root answers ONE organisation, so a `null` there means the selector named an organisation this
  // token cannot see — which the caller reports as a gap rather than as an empty registry.
  if (!isRecord(root)) {
    return { organizations: [], projects: [], targets: [] };
  }
  const organizationSlug = slugOf({ node: root });
  if (organizationSlug === null) {
    return { organizations: [], projects: [], targets: [] };
  }
  const projectNodes = connectionNodes({ value: fieldOf({ key: "projects", record: root }) });
  const read = projectNodes.map((node) => readProject({ node, organizationSlug }));
  return {
    organizations: [{ projectCount: projectNodes.length, slug: organizationSlug }],
    projects: read
      .flatMap((entry) => (entry === null ? [] : [entry.project]))
      .toSorted((left, right) => projectPath({ project: left }).localeCompare(projectPath({ project: right }))),
    targets: read
      .flatMap((entry) => (entry === null ? [] : entry.targets))
      .toSorted((left, right) => targetPath({ target: left }).localeCompare(targetPath({ target: right }))),
  };
}

/**
 * Reduce one project node and every target hanging off it.
 *
 * @param node the provider object
 * @param organizationSlug the organisation above it, which the node itself does not repeat
 * @returns the project and its targets, or `null` when the node carries no slug and cannot be located
 */
function readProject({
  node,
  organizationSlug,
}: {
  node: Record<string, unknown>;
  organizationSlug: string;
}): { project: HiveRegistryProject; targets: readonly HiveRegistryTarget[] } | null {
  const projectSlug = slugOf({ node });
  if (projectSlug === null) {
    return null;
  }
  const targetNodes = connectionNodes({ value: fieldOf({ key: "targets", record: node }) });
  return {
    project: {
      organizationSlug,
      projectType: absentAs({ value: stringField({ key: "type", record: node }), whenAbsent: "UNKNOWN" }),
      slug: projectSlug,
      targetCount: targetNodes.length,
    },
    targets: targetNodes.flatMap((target) => {
      const targetSlug = slugOf({ node: target });
      if (targetSlug === null) {
        return [];
      }
      return [
        {
          ...readSchemaVersion({ target }),
          graphqlEndpointUrl: stringField({ key: "graphqlEndpointUrl", record: target }),
          organizationSlug,
          projectSlug,
          slug: targetSlug,
        },
      ];
    }),
  };
}

/**
 * The slug path that locates one project — the provider key its entity is tracked under.
 *
 * @param project the project to key
 * @returns `<organizationSlug>/<projectSlug>`
 */
export function projectPath({ project }: { project: HiveRegistryProject }): string {
  return `${project.organizationSlug}/${project.slug}`;
}

/**
 * The slug path that locates one target — the provider key its entity is tracked under.
 *
 * @param target the target to key
 * @returns `<organizationSlug>/<projectSlug>/<targetSlug>`
 */
export function targetPath({ target }: { target: HiveRegistryTarget }): string {
  return `${target.organizationSlug}/${target.projectSlug}/${target.slug}`;
}

/** The latest valid schema version's id and SDL, or nulls when the target has published none. */
function readSchemaVersion({ target }: { target: Record<string, unknown> }): {
  schemaVersionId: string | null;
  sdl: string | null;
} {
  const version = fieldOf({ key: "latestValidSchemaVersion", record: target });
  if (!isRecord(version)) {
    return { schemaVersionId: null, sdl: null };
  }
  const raw = fieldOf({ key: "sdl", record: version });
  const sdl = typeof raw === "string" && raw.length > 0 ? raw : null;
  return { schemaVersionId: stringField({ key: "id", record: version }), sdl };
}

/**
 * One node's slug, however the provider spelled it.
 *
 * @param node the provider object
 * @returns the slug, or `null` when the node carries none and cannot be located
 */
function slugOf({ node }: { node: Record<string, unknown> }): string | null {
  return stringField({ key: "slug", record: node }) ?? stringField({ key: "name", record: node });
}

/**
 * The nodes of a connection, whichever of the three shapes the provider used.
 *
 * Hive's own connections are `edges { node }` — measured, from `ProjectConnection` and `TargetConnection`
 * in this atlas's own introspection — but a Relay-style `nodes` array and a bare array are both accepted,
 * because which one a field returns is Hive's decision and not something this atlas should break on.
 *
 * @param value the provider field
 * @returns every object node it carries, empty when it carries none
 */
export function connectionNodes({ value }: { value: unknown }): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry: unknown): entry is Record<string, unknown> => isRecord(entry));
  }
  if (!isRecord(value)) {
    return [];
  }
  const nodes = fieldOf({ key: "nodes", record: value });
  if (Array.isArray(nodes)) {
    return nodes.filter((entry: unknown): entry is Record<string, unknown> => isRecord(entry));
  }
  const edges = fieldOf({ key: "edges", record: value });
  if (!Array.isArray(edges)) {
    return [];
  }
  return edges
    .map((edge: unknown) => (isRecord(edge) ? fieldOf({ key: "node", record: edge }) : null))
    .filter((node: unknown): node is Record<string, unknown> => isRecord(node));
}
