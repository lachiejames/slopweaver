/**
 * The read models a Hex verb or the atlas fill is handed, and the pure projections from a validated wire value
 * into each.
 *
 * Separate from `schemas.ts` because a strict boundary DECLARES every key the provider sends, and a declared
 * unread key (`z.unknown().optional()`) survives the parse with its value. Returning the wire value would widen
 * every `--json` print to keys nobody chose to show — a data connection's username and access-key id among them.
 * So a read validates the whole answer first, then keeps exactly the fields below.
 */
import type { Boundary } from "../lib/boundary.js";
import type {
  hexCellOutputBoundary,
  hexCellsBoundary,
  hexCollectionsBoundary,
  hexDataConnectionsBoundary,
  hexGroupsBoundary,
  hexMeBoundary,
  hexProjectBoundary,
  hexProjectRunsBoundary,
  hexQueriedTablesBoundary,
} from "./schemas.js";

/** What a boundary admits, named by the boundary itself. */
type Answer<B> = B extends Boundary<infer T> ? T : never;

/** Who the token is — the personal-token arm carries the user, the workspace-token arm only the org. */
export interface HexMe {
  readonly email?: string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | null | undefined;
  readonly org: { readonly id: string };
  readonly role?: string | undefined;
  readonly token?: { readonly exp: number | null } | null | undefined;
}

/** One project's configuration. */
export interface HexProject {
  readonly analytics: { readonly lastViewedAt: string | null; readonly publishedResultsUpdatedAt: string | null };
  readonly archivedAt: string | null;
  readonly categories: readonly { readonly description: string | null; readonly name: string }[];
  readonly createdAt: string;
  readonly creator: { readonly email: string };
  readonly description: string | null;
  readonly id: string;
  readonly lastEditedAt: string;
  readonly lastPublishedAt: string | null;
  readonly owner: { readonly email: string };
  readonly schedules: readonly { readonly enabled: boolean }[];
  readonly status: { readonly name: string } | null;
  readonly title: string;
  readonly trashedAt: string | null;
  readonly type: string;
}

/** One warehouse table a project's cells read, with the connection it is read through. */
export type HexQueriedTable = Answer<typeof hexQueriedTablesBoundary>["values"][number];

/**
 * Where a connection points, in the identifiers that NAME the warehouse — never a credential.
 *
 * @internal
 */
export interface HexConnectionDetails {
  readonly bigquery?: { readonly projectId?: string | undefined } | undefined;
  readonly postgres?: { readonly database?: string | undefined; readonly hostname?: string | undefined } | undefined;
  readonly snowflake?: { readonly database?: string | undefined } | undefined;
}

/** One data connection. */
export interface HexDataConnection {
  readonly connectionDetails?: HexConnectionDetails | null | undefined;
  readonly description?: string | undefined;
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/** One collection — name and description; membership is a project read. */
export interface HexCollection {
  readonly description?: string | undefined;
  readonly id: string;
  readonly name: string;
}

/** One group — the name a sharing read resolves against. */
export interface HexGroup {
  readonly id: string;
  readonly name: string;
}

/** One draft cell's source — its own validated row, which declares no key it does not read. */
export type HexCell = Answer<typeof hexCellsBoundary>["values"][number];

/** A SQL cell's latest output preview, as validated — every key it declares is one `outputRun.ts` reads. */
export type HexCellOutput = Answer<typeof hexCellOutputBoundary>;

/** The table arm of a cell's output. */
export type HexTableResult = Extract<HexCellOutput["result"], { type: "table" }>;

/** One project run. */
export interface HexProjectRun {
  readonly elapsedTime: number | null;
  readonly endTime: string | null;
  readonly projectVersion: string;
  readonly runId: string;
  readonly runTrigger: string;
  readonly runUrl: string;
  readonly startTime: string | null;
  readonly status: string;
}

/**
 * The identity, without the unread `lastLoginDate`.
 *
 * @param answer what `GET /v1/users/me` answered
 * @returns the read model
 */
export function hexMeOf({ answer }: { answer: Answer<typeof hexMeBoundary> }): HexMe {
  return {
    email: answer.email,
    id: answer.id,
    name: answer.name,
    org: { id: answer.org.id },
    role: answer.role,
    token: answer.token,
  };
}

/**
 * One project, keeping its configuration and dropping its unread `reviews`, `sharing` and schedule detail.
 *
 * @param answer one project row, from the list or the by-id read
 * @returns the read model
 */
export function hexProjectOf({ answer }: { answer: Answer<typeof hexProjectBoundary> }): HexProject {
  return {
    analytics: {
      lastViewedAt: answer.analytics.lastViewedAt,
      publishedResultsUpdatedAt: answer.analytics.publishedResultsUpdatedAt,
    },
    archivedAt: answer.archivedAt,
    categories: answer.categories.map(({ description, name }) => ({ description, name })),
    createdAt: answer.createdAt,
    creator: { email: answer.creator.email },
    description: answer.description,
    id: answer.id,
    lastEditedAt: answer.lastEditedAt,
    lastPublishedAt: answer.lastPublishedAt,
    owner: { email: answer.owner.email },
    schedules: answer.schedules.map(({ enabled }) => ({ enabled })),
    status: answer.status === null ? null : { name: answer.status.name },
    title: answer.title,
    trashedAt: answer.trashedAt,
    type: answer.type,
  };
}

/** One validated connection row. */
type ConnectionRow = Answer<typeof hexDataConnectionsBoundary>["values"][number];

/**
 * A connection's target identifiers only; every other detail key is dropped here.
 *
 * @param details the validated `connectionDetails`
 * @returns the identifier-only details
 */
function connectionDetailsOf({
  details,
}: {
  details: NonNullable<ConnectionRow["connectionDetails"]>;
}): HexConnectionDetails {
  return {
    bigquery: details.bigquery === undefined ? undefined : { projectId: details.bigquery.projectId },
    postgres:
      details.postgres === undefined
        ? undefined
        : { database: details.postgres.database, hostname: details.postgres.hostname },
    snowflake: details.snowflake === undefined ? undefined : { database: details.snowflake.database },
  };
}

/**
 * One data connection, reduced to its name and target — never a username, a port or a credential.
 *
 * @param answer one validated connection row
 * @returns the read model
 */
export function hexDataConnectionOf({ answer }: { answer: ConnectionRow }): HexDataConnection {
  const details = answer.connectionDetails;
  let connectionDetails: HexConnectionDetails | null | undefined = undefined;
  if (details === null) {
    connectionDetails = null;
  } else if (details !== undefined) {
    connectionDetails = connectionDetailsOf({ details });
  }
  return { connectionDetails, description: answer.description, id: answer.id, name: answer.name, type: answer.type };
}

/**
 * One collection, without its unread `creator` and `sharing`.
 *
 * @param answer one validated collection row
 * @returns the read model
 */
export function hexCollectionOf({
  answer,
}: {
  answer: Answer<typeof hexCollectionsBoundary>["values"][number];
}): HexCollection {
  return { description: answer.description, id: answer.id, name: answer.name };
}

/**
 * One group, without its unread `createdAt`.
 *
 * @param answer one validated group row
 * @returns the read model
 */
export function hexGroupOf({ answer }: { answer: Answer<typeof hexGroupsBoundary>["values"][number] }): HexGroup {
  return { id: answer.id, name: answer.name };
}

/**
 * One run, without its unread project id, trace id, notifications and state events.
 *
 * @param answer one validated run row
 * @returns the read model
 */
export function hexProjectRunOf({
  answer,
}: {
  answer: Answer<typeof hexProjectRunsBoundary>["runs"][number];
}): HexProjectRun {
  return {
    elapsedTime: answer.elapsedTime,
    endTime: answer.endTime,
    projectVersion: answer.projectVersion,
    runId: answer.runId,
    runTrigger: answer.runTrigger,
    runUrl: answer.runUrl,
    startTime: answer.startTime,
    status: answer.status,
  };
}

/**
 * One queried table, without anything the row might later carry beside its three identifiers.
 *
 * @param answer one validated queried-table row
 * @returns the read model
 */
export function hexQueriedTableOf({ answer }: { answer: HexQueriedTable }): HexQueriedTable {
  return {
    dataConnectionId: answer.dataConnectionId,
    dataConnectionName: answer.dataConnectionName,
    tableName: answer.tableName,
  };
}
