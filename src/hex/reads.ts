/**
 * One typed read per thing an investigation asks Hex — the effectful edge over `client.ts`, and the only
 * module that knows a path by heart.
 *
 * Every function here is a GET against the documented `/v1` surface, paged where the document pages, and
 * bounded by a `limit` the caller states. Nothing is stored: a list comes back to the caller and goes no
 * further, which is the owner's rule that Hex is never ingested. The atlas's entity fill is the
 * one caller that keeps anything, and it keeps configuration.
 *
 * ## What a cell OUTPUT is, stated where it is read
 *
 * `GET /v1/cells/{id}/output` is marked **Unstable** by Hex and returns "the latest output preview for a SQL
 * cell in the active draft notebook session". So it is: the rows the cell last produced when somebody (or a
 * schedule) last ran the DRAFT, capped at Hex's own `rowLimit`, with `truncated` saying whether more exist.
 * It is NOT the published app's result, NOT a fresh execution, and it may be as old as the draft's last run
 * — the response carries the `runId` it came from so a reader can say so. A project's run history
 * (`listRuns`) is how a reader judges that age. An investigation that needs a query nobody has written yet
 * opens Hex in the owner's Chrome; there is no verb that runs SQL, by design (`client.ts`'s header).
 */
import { type Boundary, type BoundaryDrift, BoundaryErrors } from "../lib/boundary.js";
import { err, ok, type Result } from "../lib/result.js";
import type { HexClient, HexQuery } from "./client.js";
import { type HexReadError, HexReadErrors } from "./errors.js";
import {
  type HexCell,
  type HexCellOutput,
  type HexCollection,
  type HexDataConnection,
  type HexGroup,
  type HexMe,
  type HexProject,
  type HexProjectRun,
  type HexQueriedTable,
  hexCollectionOf,
  hexDataConnectionOf,
  hexGroupOf,
  hexMeOf,
  hexProjectOf,
  hexProjectRunOf,
  hexQueriedTableOf,
} from "./responses.js";
import {
  hexCellOutputBoundary,
  hexCellsBoundary,
  hexCollectionsBoundary,
  hexDataConnectionArmDrift,
  hexDataConnectionsBoundary,
  hexGroupsBoundary,
  hexMeArmDrift,
  hexMeBoundary,
  hexProjectBoundary,
  hexProjectRunsBoundary,
  hexProjectsBoundary,
  hexQueriedTablesBoundary,
} from "./schemas.js";

/**
 * The largest page the document allows (`PageSize.maximum`).
 *
 * @internal
 */
export const HEX_PAGE_MAX = 100;

/**
 * The cursor half of a page request — present only once a first page has handed one back.
 *
 * A function rather than an inline substitution because an ABSENT cursor and a cursor whose value is the
 * string "null" are different requests, and an operator cannot say which one it meant.
 *
 * @param after the cursor the previous page returned, or `null` on the first page
 * @returns the `after` parameter, or nothing at all
 */
function cursorQuery({ after }: { after: string | null }): Readonly<Record<string, string>> {
  if (after === null) {
    return {};
  }
  return { after };
}

/** One cursor page as every `/v1` list boundary admits it; an envelope's unread keys ride along unread. */
interface CursorPage<TValue> {
  readonly pagination: { readonly after: string | null };
  readonly values: readonly TValue[];
}

/**
 * A cursor-paged list, walked until the caller's `limit` is met or the cursor runs out. An `armDrift` check runs on
 * each admitted page before a row of it is held or the cursor is followed.
 */
async function pageThrough<TValue>({
  client,
  path,
  query,
  limit,
  boundary,
  armDrift,
}: {
  client: HexClient;
  path: string;
  query: HexQuery;
  limit: number;
  boundary: Boundary<CursorPage<TValue>>;
  armDrift?: (input: { rows: readonly TValue[] }) => readonly BoundaryDrift[];
}): Promise<Result<readonly TValue[], HexReadError>> {
  const collected: TValue[] = [];
  let after: string | null = null;
  while (collected.length < limit) {
    const pageSize = Math.min(HEX_PAGE_MAX, limit - collected.length);
    const page: Result<CursorPage<TValue>, HexReadError> = await client.get({
      boundary,
      path,
      query: { ...query, ...cursorQuery({ after }), limit: pageSize },
    });
    if (page.isErr()) {
      return err(page.error);
    }
    const drift = armDrift === undefined ? [] : armDrift({ rows: page.value.values });
    if (drift.length > 0) {
      const boundaryError = BoundaryErrors.shapeChanged({ drift, endpoint: `GET ${path}` });
      return err(HexReadErrors.malformedResponse({ boundaryError, path }));
    }
    collected.push(...page.value.values);
    after = page.value.pagination.after;
    if (after === null || page.value.values.length === 0) {
      break;
    }
  }
  return ok(collected.slice(0, limit));
}

/**
 * Who the token is — `GET /v1/users/me`. A personal-token answer missing a key its own arm requires is refused by
 * name here, past the one strict object both arms share (`hexMeArmDrift`).
 *
 * @param client the bound client
 * @returns the identity, or the typed reason it could not be read
 */
export async function readMe({ client }: { client: HexClient }): Promise<Result<HexMe, HexReadError>> {
  const path = "/v1/users/me";
  const answer = await client.get({ boundary: hexMeBoundary, path });
  return answer.andThen((me) => {
    const drift = hexMeArmDrift({ answer: me });
    if (drift.length > 0) {
      const boundaryError = BoundaryErrors.shapeChanged({ drift, endpoint: `GET ${path}` });
      return err(HexReadErrors.malformedResponse({ boundaryError, path }));
    }
    return ok(hexMeOf({ answer: me }));
  });
}

/**
 * The workspace's projects, newest first, up to `limit` — `GET /v1/projects`.
 *
 * @param client the bound client
 * @param limit the most projects to return; pages of at most {@link HEX_PAGE_MAX} are walked until met
 * @param ownerEmail narrow to one owner's projects, when the caller knows one
 * @param includeArchived whether archived projects are listed; the default follows the document (false)
 * @returns the projects, or the typed failure
 */
export async function listProjects({
  client,
  limit,
  ownerEmail,
  includeArchived = false,
}: {
  client: HexClient;
  limit: number;
  ownerEmail?: string;
  includeArchived?: boolean;
}): Promise<Result<readonly HexProject[], HexReadError>> {
  const rows = await pageThrough({
    boundary: hexProjectsBoundary,
    client,
    limit,
    path: "/v1/projects",
    query: { includeArchived, ownerEmail },
  });
  return rows.map((values) => values.map((row) => hexProjectOf({ answer: row })));
}

/**
 * One project's configuration — `GET /v1/projects/{id}`.
 *
 * @param client the bound client
 * @param projectId the project's UUID (the segment after `/hex/` in its URL)
 * @returns the project, or the typed failure
 */
export async function readProject({
  client,
  projectId,
}: {
  client: HexClient;
  projectId: string;
}): Promise<Result<HexProject, HexReadError>> {
  const answer = await client.get({
    boundary: hexProjectBoundary,
    path: `/v1/projects/${encodeURIComponent(projectId)}`,
  });
  return answer.map((project) => hexProjectOf({ answer: project }));
}

/**
 * Which warehouse tables a project's cells read — `GET /v1/projects/{id}/queriedTables`.
 *
 * @param client the bound client
 * @param projectId the project's UUID
 * @param limit the most table rows to return
 * @returns the tables with the connection each is read through, or the typed failure
 */
export async function listQueriedTables({
  client,
  projectId,
  limit,
}: {
  client: HexClient;
  projectId: string;
  limit: number;
}): Promise<Result<readonly HexQueriedTable[], HexReadError>> {
  const rows = await pageThrough({
    boundary: hexQueriedTablesBoundary,
    client,
    limit,
    path: `/v1/projects/${encodeURIComponent(projectId)}/queriedTables`,
    query: {},
  });
  return rows.map((values) => values.map((row) => hexQueriedTableOf({ answer: row })));
}

/**
 * The workspace's data connections — `GET /v1/data-connections`. Names and targets, never a credential. A full-arm
 * row missing a key its own arm requires is refused by name (`hexDataConnectionArmDrift`).
 *
 * @param client the bound client
 * @param limit the most connections to return
 * @returns the connections, or the typed failure
 */
export async function listDataConnections({
  client,
  limit,
}: {
  client: HexClient;
  limit: number;
}): Promise<Result<readonly HexDataConnection[], HexReadError>> {
  const rows = await pageThrough({
    armDrift: hexDataConnectionArmDrift,
    boundary: hexDataConnectionsBoundary,
    client,
    limit,
    path: "/v1/data-connections",
    query: {},
  });
  return rows.map((values) => values.map((row) => hexDataConnectionOf({ answer: row })));
}

/**
 * The workspace's collections — `GET /v1/collections`.
 *
 * @param client the bound client
 * @param limit the most collections to return
 * @returns the collections, or the typed failure
 */
export async function listCollections({
  client,
  limit,
}: {
  client: HexClient;
  limit: number;
}): Promise<Result<readonly HexCollection[], HexReadError>> {
  const rows = await pageThrough({
    boundary: hexCollectionsBoundary,
    client,
    limit,
    path: "/v1/collections",
    query: {},
  });
  return rows.map((values) => values.map((row) => hexCollectionOf({ answer: row })));
}

/**
 * The workspace's groups — `GET /v1/groups`.
 *
 * @param client the bound client
 * @param limit the most groups to return
 * @returns the groups, or the typed failure
 */
export async function listGroups({
  client,
  limit,
}: {
  client: HexClient;
  limit: number;
}): Promise<Result<readonly HexGroup[], HexReadError>> {
  const rows = await pageThrough({ boundary: hexGroupsBoundary, client, limit, path: "/v1/groups", query: {} });
  return rows.map((values) => values.map((row) => hexGroupOf({ answer: row })));
}

/**
 * A project's draft cells — their source, never their output — `GET /v1/cells?projectId=…`.
 *
 * @param client the bound client
 * @param projectId the project's UUID
 * @param limit the most cells to return
 * @returns the cells, or the typed failure
 */
export async function listCells({
  client,
  projectId,
  limit,
}: {
  client: HexClient;
  projectId: string;
  limit: number;
}): Promise<Result<readonly HexCell[], HexReadError>> {
  return pageThrough({ boundary: hexCellsBoundary, client, limit, path: "/v1/cells", query: { projectId } });
}

/**
 * A SQL cell's latest output preview — `GET /v1/cells/{id}/output`, Hex's UNSTABLE endpoint.
 *
 * Read this file's header for what a preview is. The rows come back to the caller and are never written
 * anywhere by this integration.
 *
 * @param client the bound client
 * @param cellId the cell's id, from `listCells`
 * @returns the output, or the typed failure
 */
export async function readCellOutput({
  client,
  cellId,
}: {
  client: HexClient;
  cellId: string;
}): Promise<Result<HexCellOutput, HexReadError>> {
  return client.get({ boundary: hexCellOutputBoundary, path: `/v1/cells/${encodeURIComponent(cellId)}/output` });
}

/**
 * A project's run history, newest first — `GET /v1/projects/{id}/runs`, offset-paged by the document.
 *
 * @param client the bound client
 * @param projectId the project's UUID
 * @param limit the most runs to return (one page; the document caps a page at 100)
 * @returns the runs, or the typed failure
 */
export async function listRuns({
  client,
  projectId,
  limit,
}: {
  client: HexClient;
  projectId: string;
  limit: number;
}): Promise<Result<readonly HexProjectRun[], HexReadError>> {
  const page = await client.get({
    boundary: hexProjectRunsBoundary,
    path: `/v1/projects/${encodeURIComponent(projectId)}/runs`,
    query: { limit: Math.min(limit, HEX_PAGE_MAX), offset: 0 },
  });
  if (page.isErr()) {
    return err(page.error);
  }
  return ok(page.value.runs.slice(0, limit).map((run) => hexProjectRunOf({ answer: run })));
}
