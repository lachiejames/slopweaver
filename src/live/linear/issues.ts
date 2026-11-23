/**
 * List the issues one team or one project holds, live — COMPLETE or refused, never a first page.
 *
 * ## Why this verb exists at all
 *
 * `linear query` answers a facet question from the LOCAL corpus and verifies only the page it cites, so it can
 * never prove a set is whole: an issue the corpus has not ingested yet is simply absent from its answer. The
 * question that needed a whole set was "every issue the fleet filed into a team the owner left" (a
 * team still collecting fleet filings months after the owner left it), and its sibling "every issue sitting
 * in this project", where an old issue attached to a new project is exactly the row that must not go missing.
 *
 * ## Complete or refused
 *
 * The connection is followed through `pageInfo` to its end, as `./labels.ts` does, and a page that does not say
 * whether more follow is REFUSED rather than read as final. Past {@link MAX_ISSUE_PAGES} pages the read refuses
 * rather than printing a set it knows is partial: a caller is about to act on every row.
 *
 * **The residue, stated: complete over a set nobody changed DURING the walk.** A cursor walk is not a snapshot,
 * and Linear's connection offers neither a version nor a total to check the walk against, so an issue created
 * or moved into scope behind the cursor while later pages are read is missed and the read still succeeds. A caller acting on the whole set re-runs the read after its writes; a row it never saw
 * appears then.
 */

import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import { parseLinearReadAddress } from "./read.js";
import { type LinearStatesRequest, type LinearTeamIdentity, readLinearTeam } from "./states.js";

const ISSUES_QUERY = String(LinearDocument.IssuesDocument);
const PROJECT_QUERY = String(LinearDocument.ProjectDocument);

/**
 * Issues requested per page. The SDK's `IssuesDocument` selects the whole issue fragment, description included.
 * One issue alone costs 29 complexity points and a 1,843-point read already succeeded (MEASURED, the
 * table in `./read.ts`), so 50 issues sits near that observed scale rather than at Linear's 250-row maximum. If a
 * live read is refused for complexity, lower this — completeness does not depend on it. Re-measure a page with
 * `slopweaver linear issues --team SOPS --json` and read the transport's complexity line.
 */
const ISSUE_PAGE_SIZE = 50;

/** Pages followed before the read refuses: 200 × 50 is 10,000 issues, a ceiling a few times a busy team's low-thousands inventory. */
const MAX_ISSUE_PAGES = 200;

/** Who filed the issues to list: anybody, or the token's own user. */
export type LinearIssuesCreator = "any" | "me";

/** What one `linear issues` read selects. At least one of `teamKey` and `project` is present. */
export interface LinearIssuesSelection {
  readonly teamKey: string | undefined;
  /** A project UUID, slug id or linear.app project URL. */
  readonly project: string | undefined;
  readonly creator: LinearIssuesCreator;
  readonly createdSinceIso: string | undefined;
}

/** One issue, as a caller about to move, detach or restore it needs it. */
export interface LinearIssueRow {
  readonly id: string;
  readonly identifier: string;
  /** The key prefix of `identifier` — the team the issue sits in, readable where `teamId` is not. */
  readonly teamKey: string;
  readonly title: string;
  readonly url: string;
  readonly teamId: string;
  readonly projectId: string | null;
  readonly stateId: string;
  readonly creatorId: string | null;
  /** Who the issue is assigned to, null when nobody is. Read strictly: a move refuses a colleague's issue. */
  readonly assigneeId: string | null;
  /** The parent issue, null when this is not a sub-issue. Read strictly, for the same reason. */
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly addedToProjectAt: string | null;
  readonly labelIds: readonly string[];
  readonly cycleId: string | null;
  readonly archivedAt: string | null;
  readonly canceledAt: string | null;
  readonly completedAt: string | null;
}

/** The project a selection resolved to, by its own read. */
interface LinearIssuesProject {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** Everything one `linear issues` read establishes. */
export interface LinearIssuesDocument {
  readonly source: "linear";
  readonly readAtIso: string;
  readonly team: LinearTeamIdentity | undefined;
  readonly project: LinearIssuesProject | undefined;
  readonly creator: LinearIssuesCreator;
  readonly createdSinceIso: string | undefined;
  /**
   * Every issue matching, ARCHIVED ones included and marked: a fleet filing that auto-archived is still a
   * filing in the wrong team, and a list that hid it would let the move leave it behind.
   */
  readonly issues: readonly LinearIssueRow[];
}

/** An issue identifier's team-key prefix: the `RRRR` in `RRRR-610`. */
const ISSUE_KEY = /^([A-Z][A-Z0-9]*)-\d+$/u;

/** A nested `{ id }` object's id, or null when the relation is empty. Pure. */
function relationId({ node, key }: { node: Record<string, unknown>; key: string }): string | null {
  const related = node[key];
  const id = isRecord(related) ? related["id"] : undefined;
  if (typeof id === "string") {
    return id;
  }
  return null;
}

/**
 * A relation a MOVE decides on, read strictly: `null` is a real "none", an `{ id }` is the id, and anything else
 * — the key absent, or an object without an id — is unreadable. {@link relationId}'s lenient null would read a
 * malformed assignee as "unassigned" and let a colleague's issue move. Pure.
 *
 * @param node the issue node
 * @param key the relation's field
 * @returns the id, null when the relation is genuinely empty, or undefined when it cannot be read
 */
function strictRelationId({ node, key }: { node: Record<string, unknown>; key: string }): string | null | undefined {
  const related = node[key];
  if (related === null) {
    return null;
  }
  const id = isRecord(related) ? related["id"] : undefined;
  if (typeof id === "string") {
    return id;
  }
  return undefined;
}

/** A nullable timestamp field as a string or null. Pure. */
function instantOrNull({ node, key }: { node: Record<string, unknown>; key: string }): string | null {
  const value = node[key];
  if (typeof value === "string") {
    return value;
  }
  return null;
}

/**
 * A timestamp a MOVE decides on, read strictly: `null` is a real "never", a string is the instant, and anything
 * else — the key absent included — is unreadable, so a malformed `archivedAt` never reads as "not archived". Pure.
 *
 * @param node the issue node
 * @param key the timestamp's field
 * @returns the instant, null when genuinely unset, or undefined when it cannot be read
 */
function strictInstant({ node, key }: { node: Record<string, unknown>; key: string }): string | null | undefined {
  const value = node[key];
  if (value === null || typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * One raw issue node as a row, or the reason it cannot be read. A node missing an identity field is REFUSED
 * rather than dropped: dropped, the set shown would be one issue short of the truth. Pure.
 *
 * @param node one element of the connection's `nodes`
 * @returns the row, or a named read failure
 */
export function issueRowFrom({ node }: { node: unknown }): Result<LinearIssueRow, LinearLiveError> {
  if (!isRecord(node)) {
    return err(LinearLiveErrors.readFailed({ message: "Linear returned an issue that is not an object" }));
  }
  const { id, identifier, title, url, createdAt, labelIds } = node;
  const teamId = relationId({ key: "team", node });
  const stateId = relationId({ key: "state", node });
  const identityRead =
    typeof id === "string" &&
    typeof identifier === "string" &&
    typeof title === "string" &&
    typeof url === "string" &&
    typeof createdAt === "string";
  const labelsRead = Array.isArray(labelIds) && labelIds.every((label) => typeof label === "string");
  const teamKey = typeof identifier === "string" ? ISSUE_KEY.exec(identifier)?.[1] : undefined;
  if (!identityRead || teamId === null || stateId === null || !labelsRead || teamKey === undefined) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear returned an issue missing its id, identifier, title, url, team, state, labels or createdAt`,
      }),
    );
  }
  const assigneeId = strictRelationId({ key: "assignee", node });
  const parentId = strictRelationId({ key: "parent", node });
  const projectId = strictRelationId({ key: "project", node });
  const archivedAt = strictInstant({ key: "archivedAt", node });
  if (assigneeId === undefined || parentId === undefined || projectId === undefined || archivedAt === undefined) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear returned ${identifier} with an unreadable assignee, parent, project or archivedAt`,
      }),
    );
  }
  return ok({
    addedToProjectAt: instantOrNull({ key: "addedToProjectAt", node }),
    archivedAt,
    assigneeId,
    canceledAt: instantOrNull({ key: "canceledAt", node }),
    completedAt: instantOrNull({ key: "completedAt", node }),
    createdAt,
    creatorId: relationId({ key: "creator", node }),
    cycleId: relationId({ key: "cycle", node }),
    id,
    identifier,
    labelIds,
    parentId,
    projectId,
    stateId,
    teamId,
    teamKey,
    title,
    url,
  });
}

/**
 * One page's rows and its continuation cursor, or the reason the page is unreadable. Pure.
 *
 * @param value the raw GraphQL response for one `issues` page
 * @returns the page's rows and the next cursor (undefined on the last page), or a named read failure
 */
export function issuesPageOf({
  value,
}: {
  value: unknown;
}): Result<{ rows: readonly LinearIssueRow[]; next: string | undefined }, LinearLiveError> {
  const connection = isRecord(value) ? value["issues"] : undefined;
  const nodes: unknown = isRecord(connection) ? connection["nodes"] : undefined;
  if (!Array.isArray(nodes)) {
    return err(LinearLiveErrors.readFailed({ message: "Linear returned no issues connection" }));
  }
  const rows: LinearIssueRow[] = [];
  for (const node of nodes) {
    const row = issueRowFrom({ node });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  if (!isRecord(pageInfo) || typeof pageInfo["hasNextPage"] !== "boolean") {
    return err(LinearLiveErrors.readFailed({ message: "Linear did not say whether issues has another page" }));
  }
  if (!pageInfo["hasNextPage"]) {
    return ok({ next: undefined, rows });
  }
  const cursor = pageInfo["endCursor"];
  if (typeof cursor !== "string") {
    return err(LinearLiveErrors.readFailed({ message: "Linear said issues has another page and gave no cursor" }));
  }
  return ok({ next: cursor, rows });
}

/**
 * The `IssueFilter` a resolved selection sends. Every clause is AND-ed, and a clause the selection does not
 * name is absent rather than sent empty. Pure.
 *
 * @param teamId the resolved team, when the selection names one
 * @param projectId the resolved project, when the selection names one
 * @param creator who filed the issues
 * @param createdSinceIso the earliest creation instant to include
 * @returns the filter object
 */
export function issuesFilterFor({
  teamId,
  projectId,
  creator,
  createdSinceIso,
}: {
  teamId: string | undefined;
  projectId: string | undefined;
  creator: LinearIssuesCreator;
  createdSinceIso: string | undefined;
}): Readonly<Record<string, unknown>> {
  return {
    ...(teamId === undefined ? {} : { team: { id: { eq: teamId } } }),
    ...(projectId === undefined ? {} : { project: { id: { eq: projectId } } }),
    ...(creator === "me" ? { creator: { isMe: { eq: true } } } : {}),
    ...(createdSinceIso === undefined ? {} : { createdAt: { gte: createdSinceIso } }),
  };
}

/** Resolve a project address to its UUID, name and URL by reading it. */
async function readProject({
  project,
  request,
}: {
  project: string;
  request: LinearStatesRequest;
}): Promise<Result<LinearIssuesProject, LinearLiveError>> {
  const isUrl = project.startsWith("https://");
  let id = project;
  if (isUrl) {
    const parsed = parseLinearReadAddress({ address: project });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    if (parsed.value.kind !== "project") {
      return err(LinearLiveErrors.invalidAddress({ message: `--project wants a project, got a ${parsed.value.kind}` }));
    }
    id = parsed.value.id;
  }
  const response = await request({ query: PROJECT_QUERY, variables: { id } });
  if (response.isErr()) {
    return err(response.error);
  }
  const node = isRecord(response.value) ? response.value["project"] : undefined;
  if (!isRecord(node)) {
    return err(LinearLiveErrors.notFound({ identity: project, kind: "project" }));
  }
  const { id: projectId, name, url } = node;
  if (typeof projectId !== "string" || typeof name !== "string" || typeof url !== "string") {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned project ${project} with no id, name or url` }));
  }
  return ok({ id: projectId, name, url });
}

/**
 * Follow the issues connection to its end under one filter, archived issues included — complete or refused.
 *
 * @param request the shared safe GraphQL transport
 * @param filter the `IssueFilter` every page is read under
 * @returns every matching issue oldest first, or a named read failure
 */
export async function readAllLinearIssues({
  request,
  filter,
}: {
  request: LinearStatesRequest;
  filter: Readonly<Record<string, unknown>>;
}): Promise<Result<readonly LinearIssueRow[], LinearLiveError>> {
  const collected: LinearIssueRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const base = { filter, first: ISSUE_PAGE_SIZE, includeArchived: true };
    const response = await request({ query: ISSUES_QUERY, variables: after === undefined ? base : { ...base, after } });
    if (response.isErr()) {
      return err(response.error);
    }
    const parsed = issuesPageOf({ value: response.value });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    collected.push(...parsed.value.rows);
    if (parsed.value.next === undefined) {
      return ok(collected.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)));
    }
    after = parsed.value.next;
  }
  return err(
    LinearLiveErrors.readFailed({
      message: `issues still had more after ${String(MAX_ISSUE_PAGES * ISSUE_PAGE_SIZE)}; refused rather than shown incomplete`,
    }),
  );
}

/**
 * Read every issue one team and/or one project holds, optionally only those the token's own user filed.
 *
 * @param selection what to list; at least one of `teamKey` and `project`
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @returns the resolved team and project and every matching issue oldest first, or a named read failure
 */
export async function readLinearIssues({
  selection,
  request,
  nowIso,
}: {
  selection: LinearIssuesSelection;
  request: LinearStatesRequest;
  nowIso: () => string;
}): Promise<Result<LinearIssuesDocument, LinearLiveError>> {
  let team: LinearTeamIdentity | undefined;
  if (selection.teamKey !== undefined) {
    const read = await readLinearTeam({ request, teamKey: selection.teamKey });
    if (read.isErr()) {
      return err(read.error);
    }
    team = read.value;
  }
  let project: LinearIssuesProject | undefined;
  if (selection.project !== undefined) {
    const read = await readProject({ project: selection.project, request });
    if (read.isErr()) {
      return err(read.error);
    }
    project = read.value;
  }
  if (team === undefined && project === undefined) {
    return err(LinearLiveErrors.invalidAddress({ message: "linear issues needs --team, --project, or both" }));
  }
  const filter = issuesFilterFor({
    createdSinceIso: selection.createdSinceIso,
    creator: selection.creator,
    projectId: project?.id,
    teamId: team?.id,
  });
  const issues = await readAllLinearIssues({ filter, request });
  if (issues.isErr()) {
    return err(issues.error);
  }
  return ok({
    createdSinceIso: selection.createdSinceIso,
    creator: selection.creator,
    issues: issues.value,
    project,
    readAtIso: nowIso(),
    source: "linear",
    team,
  });
}
