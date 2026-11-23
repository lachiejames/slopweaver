/**
 * Filling the two entity kinds this atlas has always DECLARED and never held — `project` and `resource` —
 * from the workspace itself, through the READ integration's own client.
 *
 * ## What changed, and what deliberately did not
 *
 * The `workspace-api` surface has stood `declared-unfilled` since this atlas was built, blocked on a token
 * nobody had minted, because minting one is a write in the workspace this atlas maps and the browser guard
 * refuses a session taking it. **The owner's rule lifts that hold for READS**: Hex has a first-class
 * integration for reading it, so a token the owner mints has verbs to feed, and this
 * module is what puts what those verbs can see into the generation. The mint stays the owner's hand — nothing
 * here asks for one, and `HEX_ENTITY_UNBLOCKED_BY` still names it as the thing that fills these kinds.
 *
 * **The withholding is untouched.** `disposition.ts` decides what this atlas may STORE, and a result set
 * stays `withheld` with a token exactly as without one. Every field this module writes is configuration
 * somebody created: a project's title, owner, status, schedules and the NAMES of the warehouse tables its
 * cells query; a connection's name and the warehouse it points at. No row of any of those tables is read
 * here, and the verb that does read one (`slopweaver hex output`) writes nothing at all.
 *
 * ## The claim boundary is its own value
 *
 * These cells carry `api-token-role`, not the `api` channel's anonymous scope. What a token read sees is
 * what that token's ROLE opens — Hex mints no read-only token, so the role is the minting user's own — and
 * a cell claiming to describe the product would be the overclaim the scope vocabulary exists to prevent.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { HexClient } from "../../hex/client.js";
import type { HexReadError } from "../../hex/errors.js";
import { listCollections, listDataConnections, listGroups, listProjects, listQueriedTables } from "../../hex/reads.js";
import type { HexProject } from "../../hex/responses.js";
import { hexAppUrl, hexConnectionTarget } from "../../hex/shape.js";
import { err, ok, type Result } from "../../lib/result.js";
import { channelView } from "../kit/channelEntity.js";

import { succeededHexCoverageCell } from "./coverage.js";
import { openHexGap } from "./gaps.js";
import { hexEntityId } from "./identity.js";
import { mergeHexChannel } from "./merge.js";
import {
  emptyHexKindFile,
  HEX_TOKEN_VISIBILITY_SCOPE,
  type HexAtlasEntity,
  type HexAtlasKind,
  type HexAtlasKindFile,
  type HexAtlasManifest,
  type HexProjectDetail,
  type HexResourceDetail,
  initialHexManifest,
} from "./model.js";
import { type HexAtlasPaths, publishHexAtlas, readHexAtlas, withHexPublishLock } from "./store.js";
import { HEX_WORKSPACE_API_SURFACE } from "./sync.js";

/**
 * Why one fill did not publish — a READ that Hex refused, or a PUBLISH the store would not complete.
 *
 * Two arms rather than one list because they are different domains and a caller acts differently on each:
 * a read failure is about the token or about Hex, and a publish failure is about this disk. Discriminated
 * rather than merged behind a shared base type, which `.claude/rules/error-handling.md` bans outright.
 */
export type HexEntitySyncFailure =
  | { readonly kind: "read"; readonly error: HexReadError }
  | { readonly kind: "publish"; readonly reasons: readonly string[] };

/**
 * How many projects, connections, collections and groups one fill reads at most, per family.
 *
 * @internal
 */
export const HEX_ENTITY_PAGE_BUDGET = 500;

/**
 * How many queried-table names one project's row may carry. A name list, bounded so a row stays readable.
 *
 * @internal
 */
export const HEX_QUERIED_TABLE_BUDGET = 200;

/** What one fill published. */
export interface HexEntitySyncOutcome {
  readonly projectCount: number;
  readonly resourceCount: number;
  /** Projects whose queried tables could not be read, by id — reported, never silently empty. */
  readonly tablesUnreadable: readonly string[];
  readonly written: readonly string[];
}

/** One project's row, with the table names its cells query. */
function projectEntity({
  project,
  tables,
  at,
}: {
  project: HexProject;
  tables: readonly string[];
  at: string;
}): HexAtlasEntity {
  const detail: HexProjectDetail = {
    categories: project.categories.map((category) => category.name).toSorted(),
    createdAt: project.createdAt,
    creatorEmail: project.creator.email,
    description: project.description,
    lastEditedAt: project.lastEditedAt,
    lastPublishedAt: project.lastPublishedAt,
    ownerEmail: project.owner.email,
    queriedTables: [...tables].toSorted().slice(0, HEX_QUERIED_TABLE_BUDGET),
    scheduleCount: project.schedules.length,
    status: project.status === null ? null : project.status.name,
    title: project.title,
    type: project.type,
  };
  return {
    channels: {
      api: channelView({
        artifacts: [],
        at,
        channel: "api",
        deepLink: hexAppUrl({ projectId: project.id }),
        deepLinkStatus: "provider-provided",
        detail,
        endpoint: "GET /v1/projects",
      }),
      browser: null,
    },
    id: hexEntityId({ kind: "project", providerId: project.id }),
    kind: "project",
    providerId: project.id,
  };
}

/** One resource row — a data connection, a collection or a group. */
function resourceEntity({
  family,
  id,
  name,
  description,
  connectionType,
  target,
  endpoint,
  at,
}: {
  family: HexResourceDetail["family"];
  id: string;
  name: string;
  description: string | null;
  connectionType: string | null;
  target: string | null;
  endpoint: string;
  at: string;
}): HexAtlasEntity {
  const providerId = `${family}:${id}`;
  return {
    channels: {
      api: channelView({
        artifacts: [],
        at,
        channel: "api",
        deepLink: null,
        deepLinkStatus: "unavailable",
        detail: { connectionType, description, family, name, target } satisfies HexResourceDetail,
        endpoint,
      }),
      browser: null,
    },
    id: hexEntityId({ kind: "resource", providerId }),
    kind: "resource",
    providerId,
  };
}

/** What the fill read out of the workspace, before anything is merged or published. */
interface WorkspaceReading {
  readonly projects: readonly HexAtlasEntity[];
  readonly resources: readonly HexAtlasEntity[];
  readonly tablesUnreadable: readonly string[];
}

/**
 * Read every family the two entity kinds are built from.
 *
 * A project whose queried tables cannot be read still gets a row with an empty `queriedTables` and its id
 * is REPORTED: an empty list that could mean "queries nothing" or "could not be read" is the silence this
 * atlas's whole vocabulary refuses. A queried-tables answer its boundary REFUSED is not that: the endpoint
 * answered a shape this version does not read, which is true of every project alike, so it stops the fill
 * by name rather than publishing each project as one that would not hand its tables over.
 *
 * @param client the bound read client
 * @param at this run's ISO timestamp
 * @returns the projected entities, or the first typed failure that stopped the read
 *
 * @internal
 */
export async function readHexWorkspace({
  client,
  at,
}: {
  client: HexClient;
  at: string;
}): Promise<Result<WorkspaceReading, HexReadError>> {
  const projects = await listProjects({ client, limit: HEX_ENTITY_PAGE_BUDGET });
  if (projects.isErr()) {
    return err(projects.error);
  }
  const projectEntities: HexAtlasEntity[] = [];
  const tablesUnreadable: string[] = [];
  for (const project of projects.value) {
    const tables = await listQueriedTables({ client, limit: HEX_QUERIED_TABLE_BUDGET, projectId: project.id });
    if (tables.isErr() && tables.error.code === "MALFORMED_RESPONSE") {
      return err(tables.error);
    }
    if (tables.isErr()) {
      tablesUnreadable.push(project.id);
    }
    const names = tables.isOk() ? tables.value.map((table) => table.tableName) : [];
    projectEntities.push(projectEntity({ at, project, tables: names }));
  }
  const resources = await readHexResources({ at, client });
  if (resources.isErr()) {
    return err(resources.error);
  }
  return ok({ projects: projectEntities, resources: resources.value, tablesUnreadable });
}

/**
 * The three families that share the `resource` kind — data connections, collections and groups.
 *
 * Its own read because the three are one kind for a reason (`model.ts` on `HEX_ATLAS_KINDS`) and a caller
 * should meet them together. Any one of them failing stops the fill: unlike a project's queried tables,
 * there is no per-row absence to report here, so a partial resource list would silently claim the workspace
 * has fewer connections than it does.
 *
 * @param client the bound read client
 * @param at this run's ISO timestamp
 * @returns one entity per resource, or the first typed failure
 */
async function readHexResources({
  client,
  at,
}: {
  client: HexClient;
  at: string;
}): Promise<Result<readonly HexAtlasEntity[], HexReadError>> {
  const connections = await listDataConnections({ client, limit: HEX_ENTITY_PAGE_BUDGET });
  if (connections.isErr()) {
    return err(connections.error);
  }
  const collections = await listCollections({ client, limit: HEX_ENTITY_PAGE_BUDGET });
  if (collections.isErr()) {
    return err(collections.error);
  }
  const groups = await listGroups({ client, limit: HEX_ENTITY_PAGE_BUDGET });
  if (groups.isErr()) {
    return err(groups.error);
  }
  return ok([
    ...connections.value.map((connection) =>
      resourceEntity({
        at,
        connectionType: connection.type,
        description: unsetFieldAsNull({ key: "description", record: connection }),
        endpoint: "GET /v1/data-connections",
        family: "data-connection",
        id: connection.id,
        name: connection.name,
        target: hexConnectionTarget({ connection }),
      }),
    ),
    ...collections.value.map((collection) =>
      resourceEntity({
        at,
        connectionType: null,
        description: unsetFieldAsNull({ key: "description", record: collection }),
        endpoint: "GET /v1/collections",
        family: "collection",
        id: collection.id,
        name: collection.name,
        target: null,
      }),
    ),
    ...groups.value.map((group) =>
      resourceEntity({
        at,
        connectionType: null,
        description: null,
        endpoint: "GET /v1/groups",
        family: "group",
        id: group.id,
        name: group.name,
        target: null,
      }),
    ),
  ]);
}

/** One kind.s file: this run.s rows merged onto the stored ones, its `workspace-api` cell replaced. */
function filledKindFile({
  stored,
  kind,
  scope,
  entities,
  reason,
  at,
}: {
  stored: HexAtlasKindFile | null;
  kind: HexAtlasKind;
  scope: string;
  entities: readonly HexAtlasEntity[];
  reason: string;
  at: string;
}): Result<HexAtlasKindFile> {
  // A kind never published yet merges onto a fresh empty file, stamped with this run's timestamp.
  if (stored === null) {
    const fresh = emptyHexKindFile({ kind, updatedAt: at });
    return filledKindFile({ at, entities, kind, reason, scope, stored: fresh });
  }
  const base = stored;
  const merged = mergeHexChannel({ at, channel: "api", observed: entities, stored: base.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const cell = succeededHexCoverageCell({
    artifacts: [],
    at,
    channel: "api",
    reason,
    role: "authoritative",
    scope,
    state: "synced",
    surface: HEX_WORKSPACE_API_SURFACE,
  });
  return ok({
    ...base,
    coverage: [
      ...base.coverage.filter((held) => held.surface !== HEX_WORKSPACE_API_SURFACE),
      { ...cell, visibilityScope: HEX_TOKEN_VISIBILITY_SCOPE },
    ],
    // The not-configured gap is CLOSED by removal rather than left open with a fresh reason: the condition
    // it named — no token reaches the workspace — is no longer true on this install, and a gap that stays
    // open after its cause is gone is the stale surface the gap list exists to be the opposite of.
    entities: [...merged.value],
    gaps: base.gaps.filter((held) => held.condition !== "entity-surface-not-configured"),
    updatedAt: at,
  });
}

/**
 * The stored manifest, or a fresh empty one when nothing has been published yet.
 *
 * @param manifest what the store held
 * @param at this run.s ISO timestamp, stamped on a fresh manifest
 * @returns the manifest to build on
 */
function readManifestOrEmpty({ manifest, at }: { manifest: HexAtlasManifest | null; at: string }): HexAtlasManifest {
  if (manifest === null) {
    return initialHexManifest({ updatedAt: at });
  }
  return manifest;
}

/** The manifest rows for the two kinds this fill wrote. */
function filledManifest({
  manifest,
  projectCount,
  resourceCount,
  at,
}: {
  manifest: HexAtlasManifest | null;
  projectCount: number;
  resourceCount: number;
  at: string;
}): HexAtlasManifest {
  const base = readManifestOrEmpty({ at, manifest });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      project: {
        digest: null,
        entityCount: projectCount,
        lastAttempt: { at, outcome: "ok", reasons: [] },
        lastSuccessAt: at,
      },
      resource: {
        digest: null,
        entityCount: resourceCount,
        lastAttempt: { at, outcome: "ok", reasons: [] },
        lastSuccessAt: at,
      },
    },
    updatedAt: at,
  };
}

/**
 * Raise the gap that says an EMPTY queried-table list means refused rather than "queries nothing", when any
 * project's read was refused.
 *
 * Its own function because the distinction is the point: a reader who cannot tell those apart has been
 * misled by silence, and the gap has to name one project id so the remedy is a command rather than advice.
 *
 * @param file the project kind file as the fill built it
 * @param unreadable the ids whose queried tables were refused
 * @param at this run's ISO timestamp
 * @returns the file, with the gap raised or removed
 */
function withUnreadableTablesGap({
  file,
  unreadable,
  at,
}: {
  file: HexAtlasKindFile;
  unreadable: readonly string[];
  at: string;
}): HexAtlasKindFile {
  const without = file.gaps.filter((gap) => gap.condition !== "queried-tables-unreadable");
  const [first] = unreadable;
  if (first === undefined) {
    return { ...file, gaps: without };
  }
  return {
    ...file,
    gaps: [
      ...without,
      openHexGap({
        at,
        condition: "queried-tables-unreadable",
        fields: [],
        kind: "project",
        reason:
          `${String(unreadable.length)} project(s) carry an EMPTY queried-table list because the read was ` +
          "refused, not because they query nothing — most often the token's role does not open the project. " +
          "Re-run `slopweaver atlas hex sync`, or read one directly with " +
          `\`slopweaver hex project --project ${first} --tables\``,
        scope: "project-queried-tables",
        surfaces: ["api"],
      }),
    ],
  };
}

/**
 * What a filled `project` cell says it holds, and — the load-bearing half — what it still does not.
 *
 * @param count how many projects were read
 * @returns the coverage reason
 */
function projectCellReason({ count }: { count: number }): string {
  return (
    `${String(count)} project(s) read from the workspace with the configured token — titles, owners, ` +
    "statuses, schedules and the NAMES of the warehouse tables their cells query. No cell output is stored " +
    "here or anywhere: reading one is `slopweaver hex output`, which writes nothing"
  );
}

/**
 * What a filled `resource` cell says it holds.
 *
 * @param count how many resources were read across the three families
 * @returns the coverage reason
 */
function resourceCellReason({ count }: { count: number }): string {
  return (
    `${String(count)} data connection(s), collection(s) and group(s) read with the configured token. A ` +
    "connection carries the warehouse it points at in identifiers; no credential field is read at all"
  );
}

function publishWorkspaceEntities({
  paths,
  at,
  reading,
}: {
  paths: HexAtlasPaths;
  at: string;
  reading: WorkspaceReading;
}): Result<HexEntitySyncOutcome> {
  const snapshot = readHexAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const held = snapshot.value;
  const projectFile = filledKindFile({
    at,
    entities: reading.projects,
    kind: "project",
    reason: projectCellReason({ count: reading.projects.length }),
    scope: "workspace-projects",
    stored: held.files.project,
  });
  if (projectFile.isErr()) {
    return err(projectFile.error);
  }
  const resourceFile = filledKindFile({
    at,
    entities: reading.resources,
    kind: "resource",
    reason: resourceCellReason({ count: reading.resources.length }),
    scope: "workspace-collections-connections-and-members",
    stored: held.files.resource,
  });
  if (resourceFile.isErr()) {
    return err(resourceFile.error);
  }
  const withGap = withUnreadableTablesGap({ at, file: projectFile.value, unreadable: reading.tablesUnreadable });
  const published = publishHexAtlas({
    derivedFrom: held.manifest,
    files: { project: withGap, resource: resourceFile.value },
    manifest: filledManifest({
      at,
      manifest: held.manifest,
      projectCount: reading.projects.length,
      resourceCount: reading.resources.length,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    projectCount: reading.projects.length,
    resourceCount: reading.resources.length,
    tablesUnreadable: reading.tablesUnreadable,
    written: published.value,
  });
}

/**
 * Read the workspace with the configured token and publish it onto the `project` and `resource` kinds.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param client the bound read client — the caller resolves the token, so this function has no credential path
 * @returns what was published, or the typed reason the read failed, or why the publish could not complete
 */
export async function syncHexWorkspaceEntities({
  paths,
  at,
  client,
}: {
  paths: HexAtlasPaths;
  at: string;
  client: HexClient;
}): Promise<Result<HexEntitySyncOutcome, HexEntitySyncFailure>> {
  const reading = await readHexWorkspace({ at, client });
  if (reading.isErr()) {
    return err({ error: reading.error, kind: "read" });
  }
  const published = withHexPublishLock({
    nowIso: at,
    paths,
    publish: () => publishWorkspaceEntities({ at, paths, reading: reading.value }),
  });
  if (published.isErr()) {
    return err({ kind: "publish", reasons: published.error });
  }
  return ok(published.value);
}
