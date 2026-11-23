/**
 * One strict boundary per Hex endpoint this integration reads — every object a `z.strictObject`, so a field Hex
 * adds, drops or renames is refused BY NAME at the read rather than passed through or dropped
 * ([provider SDKs](../../docs/provider-sdks.md#validate-what-you-read)). What a caller gets back is the narrow
 * read model `responses.ts` projects AFTER the read, never the validated wire value.
 *
 * ## Where the key sets come from, and the live read that is still owed
 *
 * Transcribed from the published Hex OpenAPI document as served when this was written (the
 * digest `src/atlas/hex/generated/specLock.ts` pins has since moved, which `slopweaver atlas hex sync` reports as
 * spec drift, and the ten operations below declare the same key sets in both). Reproduce by reading each path's
 * `200` schema out of `https://static.hex.site/openapi.json`. NOT YET read against the live API: this install
 * holds no Hex token. The first `slopweaver hex verify` after one is minted is that read, and a key the document
 * omits refuses it naming the key — one line here to declare.
 *
 * ## The rule each schema follows
 *
 * A field a verb or the atlas fill reads is typed with the document's own required, optional and nullable
 * marking. Every other key the document declares is `z.unknown().optional()`: its key is known, so a NEW sibling
 * is loud, while its own removal is not this reader's concern. Two documented anyOf pairs — `/v1/users/me`'s
 * personal-token and workspace-token arms, and a data connection's basic and full arms — share no discriminator,
 * so each is ONE strict object whose arm-only keys are optional — the shape `src/lib/boundaryUnion.ts` sanctions in
 * place of two arms no refusal could tell apart. Its trade is that a dropped arm-only key reads quietly, so where an
 * arm is told apart by its own keys the read closes it: `hexMeArmDrift` refuses a personal-token answer missing a key
 * the personal arm requires (the document: `id`, `name`, `email`, `role`, `lastLoginDate`, `org`). Only those keys
 * tell the arms apart: the document gives BOTH the same optional, nullable `token: { exp }`, so an answer carrying
 * no personal key is the workspace arm whatever its `token` holds. `hexDataConnectionArmDrift` does the same for a
 * connection carrying any of the eight keys only the full arm has, and missing one of the six that arm requires.
 *
 * `GET /v1/cells/{cellId}/output` is marked **Unstable** by Hex — "Hex may make breaking changes to this endpoint
 * without notice" — so its boundary is expected to refuse more often than the rest. That is the point of it.
 */
import { z } from "zod";

import { type Boundary, type BoundaryDrift, defineBoundary } from "../lib/boundary.js";

/** A key this reader declares and never reads. */
const unread = z.unknown().optional();

/** The cursor pair every `/v1` list carries; only `after` is walked. */
const paginationSchema = z.strictObject({ after: z.string().nullable(), before: unread });

/** `GET /v1/users/me` — both documented arms as one strict object; see the header for the trade. */
export const hexMeBoundary = defineBoundary({
  endpoint: "GET /v1/users/me",
  schema: z.strictObject({
    email: z.string().optional(),
    id: z.string().optional(),
    lastLoginDate: unread,
    name: z.string().nullable().optional(),
    org: z.strictObject({ id: z.string() }),
    role: z
      .enum(["ADMIN", "MANAGER", "EDITOR", "EXPLORER", "MEMBER", "GUEST", "EMBEDDED_USER", "ANONYMOUS"])
      .optional(),
    token: z.strictObject({ exp: z.number().nullable() }).nullable().optional(),
  }),
});

/** The keys the document's personal-token arm requires beyond the `org` both arms carry. */
const HEX_ME_PERSONAL_KEYS = ["email", "id", "lastLoginDate", "name", "role"] as const;

/**
 * The drift one strict object cannot see in an admitted `/v1/users/me` answer: a personal-token answer missing a key
 * its own arm requires. Any personal key present means the personal arm was sent, so every one of them must be —
 * the trade the header names, closed for the arm a reader can tell apart by its own keys.
 *
 * @param answer what {@link hexMeBoundary} admitted
 * @returns one `missing` drift per personal key absent beside another one present; empty for a whole arm
 */
export function hexMeArmDrift({
  answer,
}: {
  answer: typeof hexMeBoundary extends Boundary<infer T> ? T : never;
}): readonly BoundaryDrift[] {
  const absent = HEX_ME_PERSONAL_KEYS.filter((key) => answer[key] === undefined);
  if (absent.length === HEX_ME_PERSONAL_KEYS.length) {
    return [];
  }
  return absent.map((key): BoundaryDrift => ({ detail: `field "${key}" is missing`, kind: "missing", path: key }));
}

/** One project row, as both the list and the by-id read answer it. Configuration only. */
const projectSchema = z.strictObject({
  analytics: z.strictObject({
    appViews: unread,
    lastViewedAt: z.string().nullable(),
    publishedResultsUpdatedAt: z.string().nullable(),
  }),
  archivedAt: z.string().nullable(),
  categories: z.array(z.strictObject({ description: z.string().nullable(), name: z.string() })),
  createdAt: z.string(),
  creator: z.strictObject({ email: z.string() }),
  description: z.string().nullable(),
  id: z.string(),
  lastEditedAt: z.string(),
  lastPublishedAt: z.string().nullable(),
  owner: z.strictObject({ email: z.string() }),
  reviews: unread,
  schedules: z.array(
    z.strictObject({
      cadence: unread,
      custom: unread,
      daily: unread,
      enabled: z.boolean(),
      hourly: unread,
      monthly: unread,
      weekly: unread,
    }),
  ),
  sharing: unread,
  status: z.strictObject({ name: z.string() }).nullable(),
  title: z.string(),
  trashedAt: z.string().nullable(),
  type: z.enum(["PROJECT", "COMPONENT"]),
});

/** `GET /v1/projects`. */
export const hexProjectsBoundary = defineBoundary({
  endpoint: "GET /v1/projects",
  schema: z.strictObject({ pagination: paginationSchema, values: z.array(projectSchema) }),
});

/** `GET /v1/projects/{projectId}` — its own boundary, because the endpoint, not the row schema, is the unit. */
export const hexProjectBoundary = defineBoundary({ endpoint: "GET /v1/projects/{projectId}", schema: projectSchema });

/** `GET /v1/projects/{projectId}/queriedTables` — which warehouse tables the project's cells read. */
export const hexQueriedTablesBoundary = defineBoundary({
  endpoint: "GET /v1/projects/{projectId}/queriedTables",
  schema: z.strictObject({
    pagination: paginationSchema,
    traceId: unread,
    values: z.array(
      z.strictObject({ dataConnectionId: z.string(), dataConnectionName: z.string(), tableName: z.string() }),
    ),
  }),
});

/**
 * Where a connection points, one optional key per warehouse kind. Only the identifiers `shape.ts` names a
 * connection by are typed; a username, a port or an access-key id is declared and never read, and
 * `responses.ts` projects it away so no verb can print it.
 */
const connectionDetailsSchema = z.strictObject({
  athena: unread,
  bigquery: z
    .strictObject({ enableDriveAccess: unread, enableStorageApi: unread, projectId: z.string().optional() })
    .optional(),
  clickhouse: unread,
  databricks: unread,
  postgres: z
    .strictObject({ database: z.string().optional(), hostname: z.string().optional(), port: unread, username: unread })
    .optional(),
  redshift: unread,
  snowflake: z
    .strictObject({
      accountName: unread,
      database: z.string().optional(),
      role: unread,
      schema: unread,
      username: unread,
      warehouse: unread,
    })
    .optional(),
  trino: unread,
});

/** `GET /v1/data-connections` — the basic and full arms as one strict row; the full arm's keys are optional. */
export const hexDataConnectionsBoundary = defineBoundary({
  endpoint: "GET /v1/data-connections",
  schema: z.strictObject({
    pagination: paginationSchema,
    values: z.array(
      z.strictObject({
        allowWritebackCells: unread,
        connectViaSsh: unread,
        connectionDetails: connectionDetailsSchema.nullable().optional(),
        description: z.string().optional(),
        id: z.string(),
        includeMagic: unread,
        name: z.string(),
        schemaFilters: unread,
        schemaRefreshAccess: unread,
        schemaRefreshSchedule: unread,
        sensitivity: unread,
        sharing: unread,
        type: z.enum(["athena", "bigquery", "clickhouse", "databricks", "postgres", "redshift", "snowflake", "trino"]),
      }),
    ),
  }),
});

/** The keys the document's full data-connection arm requires beyond the basic arm's. */
const HEX_CONNECTION_FULL_KEYS = [
  "allowWritebackCells",
  "connectViaSsh",
  "connectionDetails",
  "includeMagic",
  "schemaRefreshAccess",
  "sharing",
] as const;

/** Every key only the full arm carries: the six it requires, and the two it marks optional. */
const HEX_CONNECTION_FULL_ONLY_KEYS = [...HEX_CONNECTION_FULL_KEYS, "schemaFilters", "schemaRefreshSchedule"] as const;

/**
 * The drift one strict row cannot see in admitted data connections: a full-arm row missing a key its own arm
 * requires. Any key only the full arm carries, optional ones included, means the full arm was sent, so every key
 * that arm requires must be, as for `hexMeArmDrift`.
 *
 * @param rows every row {@link hexDataConnectionsBoundary} admitted, in the order they were read
 * @returns one `missing` drift per full-arm key absent beside another one present; empty when every row is whole
 */
export function hexDataConnectionArmDrift({
  rows,
}: {
  rows: readonly (typeof hexDataConnectionsBoundary extends Boundary<infer T>
    ? T extends { values: readonly (infer R)[] }
      ? R
      : never
    : never)[];
}): readonly BoundaryDrift[] {
  return rows.flatMap((row, index) => {
    if (HEX_CONNECTION_FULL_ONLY_KEYS.every((key) => row[key] === undefined)) {
      return [];
    }
    const absent = HEX_CONNECTION_FULL_KEYS.filter((key) => row[key] === undefined);
    return absent.map((key): BoundaryDrift => {
      const path = `values[${index}].${key}`;
      return { detail: `field "${path}" is missing`, kind: "missing", path };
    });
  });
}

/** `GET /v1/collections`. */
export const hexCollectionsBoundary = defineBoundary({
  endpoint: "GET /v1/collections",
  schema: z.strictObject({
    pagination: paginationSchema,
    values: z.array(
      z.strictObject({
        creator: unread,
        description: z.string().optional(),
        id: z.string(),
        name: z.string(),
        sharing: unread,
      }),
    ),
  }),
});

/** `GET /v1/groups`. */
export const hexGroupsBoundary = defineBoundary({
  endpoint: "GET /v1/groups",
  schema: z.strictObject({
    pagination: paginationSchema,
    values: z.array(z.strictObject({ createdAt: unread, id: z.string(), name: z.string() })),
  }),
});

/** Every cell type the document declares, shared by the cell list and a cell's output. */
const cellTypeSchema = z.enum([
  "CODE",
  "MARKDOWN",
  "DISPLAY_TABLE",
  "INPUT",
  "SQL",
  "VEGA_CHART",
  "CELL_GROUP",
  "METRIC",
  "TEXT",
  "MAP",
  "WRITEBACK",
  "DBT_METRIC",
  "PIVOT",
  "FILTER",
  "COMPONENT_IMPORT",
  "CHART",
  "BLOCK",
  "EXPLORE",
  "COLLAPSIBLE",
]);

/** `GET /v1/cells?projectId=…` — each draft cell's SOURCE, which is configuration, never its output. */
export const hexCellsBoundary = defineBoundary({
  endpoint: "GET /v1/cells",
  schema: z.strictObject({
    pagination: paginationSchema,
    values: z.array(
      z.strictObject({
        cellType: cellTypeSchema,
        contents: z.strictObject({
          codeCell: z.strictObject({ source: z.string() }).nullable(),
          markdownCell: z.strictObject({ source: z.string() }).nullable(),
          sqlCell: z.strictObject({ outputDataframe: z.string(), source: z.string() }).nullable(),
        }),
        dataConnectionId: z.string().nullable(),
        id: z.string(),
        label: z.string().nullable(),
        projectId: z.string(),
        staticId: z.string(),
      }),
    ),
  }),
});

/** `GET /v1/cells/{cellId}/output` — UNSTABLE by Hex's own marking; the draft session's latest preview. */
export const hexCellOutputBoundary = defineBoundary({
  endpoint: "GET /v1/cells/{cellId}/output",
  schema: z.strictObject({
    cell: z.strictObject({ cellType: cellTypeSchema, id: z.string(), staticId: z.string() }),
    projectId: z.string(),
    result: z.discriminatedUnion("type", [
      z.strictObject({
        columns: z.array(z.strictObject({ name: z.string(), type: z.string() })),
        rowLimit: z.number(),
        rows: z.array(z.record(z.string(), z.string().nullable())),
        rowsReturned: z.number(),
        totalRows: z.number().nullable(),
        totalRowsKind: z.enum(["EXACT", "LOWER_BOUND", "UNKNOWN"]),
        truncated: z.boolean(),
        type: z.literal("table"),
      }),
      z.strictObject({ message: z.string(), traceback: z.string().nullable(), type: z.literal("cell_run_error") }),
    ]),
    runId: z.string(),
  }),
});

/** `GET /v1/projects/{projectId}/runs`, offset-paged by the document; only `runs` is walked. */
export const hexProjectRunsBoundary = defineBoundary({
  endpoint: "GET /v1/projects/{projectId}/runs",
  schema: z.strictObject({
    nextPage: unread,
    previousPage: unread,
    runs: z.array(
      z.strictObject({
        elapsedTime: z.number().nullable(),
        endTime: z.string().nullable(),
        flagConfigOverride: unread,
        notifications: unread,
        projectId: unread,
        projectVersion: z.string(),
        runId: z.string(),
        runTrigger: z.enum(["API", "SCHEDULED", "APP_REFRESH"]),
        runUrl: z.string(),
        startTime: z.string().nullable(),
        stateEvents: unread,
        status: z.enum(["PENDING", "RUNNING", "ERRORED", "COMPLETED", "KILLED", "UNABLE_TO_ALLOCATE_KERNEL"]),
        traceId: unread,
      }),
    ),
    traceId: unread,
  }),
});
