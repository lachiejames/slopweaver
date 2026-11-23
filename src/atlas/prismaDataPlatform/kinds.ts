/**
 * Which atlas kind each Prisma Data Platform operation feeds, and why the answer cannot be the tag.
 *
 * ## On this platform the tag is not a vocabulary at all for most of the surface
 *
 * The Figma registry takes its kind from a table rather than from the provider's tag because Figma's tags
 * sometimes name the container instead of the resource. Here the problem is a whole order sharper, and it
 * is a measured property of the document rather than a judgement: **70 of the 115 declared operations carry
 * exactly one tag, `[Experimental]`**, and it names a stability rather than a resource. An app, a build, a
 * deployment, a branch, a custom domain, an environment variable, an SCM installation, a source repository
 * and twelve infrastructure-state operations all sit under it. A registry that keyed on the tag would file
 * three-fifths of this platform in one bucket called "experimental".
 *
 * So the kind comes from the PATH, by longest-prefix match over {@link KIND_BY_PATH_PREFIX}, and the
 * generator refuses an operation this table cannot place. That refusal is the mechanism: a path family
 * Prisma adds does not land in whichever kind happens to share its first segment, it stops the build.
 *
 * ## Three prefixes exist only because the shorter one would take the resource's own children
 *
 * `/v1/databases/{databaseId}/backups`, `…/usage` and `…/connections` each return a different resource from
 * the database that contains them, and a prefix table that stopped at `/v1/databases` would file all three
 * under `database`. Then "what backups does this database have" and "what is this database" would be one
 * question with two answers, which is the exact failure the Figma table's header names. Longest-prefix
 * match is what keeps the container and its contents apart without a second classifier.
 *
 * ## `apps` and `services` are ONE kind, and that is a finding rather than a tidy-up
 *
 * Eleven operations under `/v1/apps` are marked `deprecated: true` and eleven under `/v1/services` mirror
 * them one for one — same shapes, same children, same summaries. Prisma is renaming the noun in place. Both
 * prefixes therefore feed `service`, so the atlas answers "what services exist" once rather than twice, and
 * `generated/specLock.ts` records the deprecation set so the succession is a diff rather than a memory.
 */

/**
 * Every kind the Prisma Data Platform atlas holds, sorted.
 *
 * Three of them map the platform rather than the organisation — `method` is the management API's declared
 * surface, `console-route` the browser navigation surface, and `oauth-endpoint` the authorization server
 * that neither of the other two declares a path for. The other twenty-three are entities, because this is
 * the "everything reachable" side of `docs/atlas-intent/06-holdings.md`'s test: nothing else in this installation
 * holds a Prisma workspace, project, database, connection string, backup, bucket or service token, so if
 * this atlas does not, nothing does.
 */
export const PRISMA_DATA_PLATFORM_ATLAS_KINDS = [
  "account",
  "branch",
  "bucket",
  "bucket-key",
  "build",
  "connection",
  "console-route",
  "custom-domain",
  "database",
  "database-backup",
  "database-usage",
  "deployment",
  "environment-variable",
  "event-shape",
  "iac-state",
  "integration",
  "method",
  "oauth-endpoint",
  "project",
  "region",
  "scm-installation",
  "service",
  "service-token",
  "source-repository",
  "subscription",
  "workspace",
] as const;

/** One kind the Prisma Data Platform atlas holds. */
export type PrismaDataPlatformAtlasKind = (typeof PRISMA_DATA_PLATFORM_ATLAS_KINDS)[number];

/**
 * The kind each declared path prefix feeds, matched longest-first.
 *
 * Written as path templates with their `{brace}` parameters intact, exactly as the document declares them,
 * so a reader can grep a row here against the document without transforming either. Every entry is a prefix
 * of at least one declared path; the generator asserts that too, which is what stops a stale row surviving
 * a family Prisma removes.
 */
const KIND_BY_PATH_PREFIX: readonly { readonly kind: PrismaDataPlatformAtlasKind; readonly prefix: string }[] = [
  // The Compute product, whose whole vocabulary is invisible to the `[Experimental]` tag.
  { kind: "service", prefix: "/v1/apps" },
  { kind: "deployment", prefix: "/v1/apps/{appId}/deployments" },
  { kind: "custom-domain", prefix: "/v1/apps/{appId}/domains" },
  { kind: "service", prefix: "/v1/services" },
  { kind: "deployment", prefix: "/v1/services/{serviceId}/deployments" },
  { kind: "custom-domain", prefix: "/v1/services/{serviceId}/domains" },
  { kind: "deployment", prefix: "/v1/deployments" },
  { kind: "custom-domain", prefix: "/v1/domains" },
  { kind: "build", prefix: "/v1/builds" },
  { kind: "branch", prefix: "/v1/branches" },
  { kind: "environment-variable", prefix: "/v1/environment-variables" },
  { kind: "scm-installation", prefix: "/v1/scm-installations" },
  { kind: "source-repository", prefix: "/v1/source-repositories" },
  // Minting a workspace service token from a CI identity produces a service token, whatever the path says.
  { kind: "service-token", prefix: "/v1/auth/github-actions/token" },

  // Prisma Postgres, the documented half.
  { kind: "workspace", prefix: "/v1/workspaces" },
  { kind: "subscription", prefix: "/v1/workspaces/{id}/subscription" },
  { kind: "integration", prefix: "/v1/workspaces/{workspaceId}/integrations" },
  { kind: "service-token", prefix: "/v1/workspaces/{workspaceId}/service-tokens" },
  { kind: "project", prefix: "/v1/projects" },
  { kind: "database", prefix: "/v1/projects/{projectId}/databases" },
  { kind: "branch", prefix: "/v1/projects/{projectId}/branches" },
  { kind: "iac-state", prefix: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state" },
  { kind: "branch", prefix: "/v1/projects/{projectId}/branches/{branchId}/application-topology" },
  { kind: "database", prefix: "/v1/databases" },
  { kind: "database-backup", prefix: "/v1/databases/{databaseId}/backups" },
  { kind: "database-usage", prefix: "/v1/databases/{databaseId}/usage" },
  { kind: "connection", prefix: "/v1/databases/{databaseId}/connections" },
  { kind: "connection", prefix: "/v1/connections" },
  { kind: "bucket", prefix: "/v1/buckets" },
  { kind: "bucket-key", prefix: "/v1/buckets/{bucketId}/keys" },
  { kind: "integration", prefix: "/v1/integrations" },
  { kind: "region", prefix: "/v1/regions" },
  { kind: "account", prefix: "/v1/me" },
];

/**
 * The kinds one operation feeds BEYOND its own, because its single response carries them nested.
 *
 * Two members, and the boundary between a fan-out and a mere reference is what the entries were checked
 * against. `GET /v1/databases` and `GET /v1/projects/{projectId}/databases` each return every database with
 * its whole `connections` array — id, name, kind, the direct, pooled and accelerate endpoints, and the
 * deprecated `directConnection` — which is the same object `GET /v1/connections` returns, not a stub. So a
 * reader asking "what connections exist" is answered by the database listing too.
 *
 * The near misses are the reason this table is short. `GET /v1/projects` carries a `workspace` of exactly
 * `{id, url, name}`, and `GET /v1/buckets` a `project` of the same three fields: those are POINTERS to a
 * resource, not the resource, and listing them here would make the atlas claim it had read a workspace when
 * it had read a foreign key. `GET /v1/workspaces` carries no subscription at all — the subscription is
 * reachable only through `GET /v1/workspaces/{id}/subscription`.
 */
const ALSO_FEEDS: Readonly<Record<string, readonly PrismaDataPlatformAtlasKind[]>> = {
  "GET /v1/databases": ["connection"],
  "GET /v1/projects/{projectId}/databases": ["connection"],
};

/**
 * The operations whose kind the path prefix gets wrong, each with the reason.
 *
 * Two members, and both are the same case: the path names the RESOURCE the observations are about, and what
 * the atlas stores is the observation stream's SHAPE rather than the build or the deployment. Filed under
 * `build` and `deployment`, "what builds exist" and "what does a build log line look like" would be one
 * question with two answers in one file, and the second is not a build at all. `event-shape` is where every
 * atlas here puts a shape-indexed stream, so the vocabulary is shared rather than reinvented.
 *
 * Kept as an explicit table rather than derived from the disposition, because a `shape-index` disposition
 * and an `event-shape` kind are two decisions that happen to coincide today: an operation could be
 * shape-indexed for volume and still belong to its own resource's file.
 */
const KIND_BY_OPERATION: Readonly<Record<string, PrismaDataPlatformAtlasKind>> = {
  "GET /v1/builds/{buildId}/logs": "event-shape",
  "GET /v1/deployments/{deploymentId}/logs": "event-shape",
};

/** The other kinds one operation's response fills; `ALSO_FEEDS` names only the operations that fill a second. */
function fanOutOf({ operation }: { operation: string }): readonly PrismaDataPlatformAtlasKind[] {
  const alsoFeeds = ALSO_FEEDS[operation];
  if (alsoFeeds === undefined) {
    return [];
  }
  return alsoFeeds;
}

/**
 * Which kind an operation feeds, and which others its response also fills.
 *
 * @param method the operation's HTTP method, which with the path forms the override and fan-out keys
 * @param path the document's own path template, `{brace}` parameters intact
 * @returns the primary kind and the fan-out, or `null` when no declared prefix covers the path
 */
export function prismaDataPlatformKindFor({ method, path }: { method: string; path: string }): {
  readonly alsoFeeds: readonly PrismaDataPlatformAtlasKind[];
  readonly kind: PrismaDataPlatformAtlasKind;
} | null {
  const operation = `${method} ${path}`;
  const alsoFeeds = fanOutOf({ operation });
  const override = KIND_BY_OPERATION[operation];
  if (override !== undefined) {
    return { alsoFeeds, kind: override };
  }
  const matches = KIND_BY_PATH_PREFIX.filter((row) => path === row.prefix || path.startsWith(`${row.prefix}/`));
  const longest = matches.toSorted((left, right) => right.prefix.length - left.prefix.length)[0];
  if (longest === undefined) {
    return null;
  }
  return { alsoFeeds, kind: longest.kind };
}

/**
 * Every path prefix this table places, so the generator can refuse one that no longer matches any operation.
 *
 * @returns the declared prefixes, in table order
 */
export function prismaDataPlatformKindPrefixes(): readonly string[] {
  return KIND_BY_PATH_PREFIX.map((row) => row.prefix);
}
