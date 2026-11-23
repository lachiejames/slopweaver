/**
 * Read the issue labels and project labels one team can apply, live — the only honest source of the
 * `labelIds` the issue and project write forms accept.
 *
 * ## Why this verb exists at all
 *
 * Both forms have carried `labelIds` from the start, and nothing in the product could say which ids exist.
 * MEASURED: a session filed 23 Security issues and two projects with the agreed bucket and access
 * labels written into each issue's fold instead, because no verb listed a label or created one.
 * `slopweaver linear labels --team SOPS` is the list half; `linear label create` is the
 * other.
 *
 * ## What "applicable to a team" means
 *
 * A Linear label is either workspace-scoped (`team: null`) or scoped to one team, and both vocabularies work
 * the same way — except that a sub-team also inherits its parent teams' labels (the SDK's own comment on both
 * label types). So the team's parent chain is walked first, to {@link MAX_TEAM_DEPTH}, and each connection is
 * read with ONE filter, `team is null OR team.id in <the team and its ancestors>`, rather than
 * `Team_LabelsDocument`, whose schema comment says only "labels associated with the team" and says neither
 * whether workspace labels nor inherited ones are among them.
 *
 * ## Complete or refused, never a first page
 *
 * Each connection is followed through `pageInfo` to its end, because the verb's whole job is to be the place
 * an id is copied from — a page that silently stopped at 250 would omit the very label a caller is looking
 * for. A connection that is still going after {@link MAX_LABEL_PAGES} pages is REFUSED rather than shown.
 */

import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import { type LinearStatesRequest, type LinearTeamIdentity, readLinearTeam } from "./states.js";

const ISSUE_LABELS_QUERY = String(LinearDocument.IssueLabelsDocument);
const PROJECT_LABELS_QUERY = String(LinearDocument.ProjectLabelsDocument);
const TEAM_QUERY = String(LinearDocument.TeamDocument);

/** Parent hops walked before the read refuses: a chain deeper than this is a cycle or a data fault. */
const MAX_TEAM_DEPTH = 10;

/** Labels requested per page: Linear's own maximum page size. */
const LABEL_PAGE_SIZE = 250;

/**
 * Pages followed per connection before the read refuses. 20 × 250 is 5,000 labels a team can apply; a whole
 * workspace held over a thousand issue labels and dozens of project labels when the vocabulary lanes were walked.
 */
const MAX_LABEL_PAGES = 20;

/**
 * Where a label applies: everywhere in the workspace, or on one team.
 *
 * @internal — reached through {@link LinearLabelSummary.scope}; nothing outside names the union.
 */
export type LinearLabelScope = { readonly kind: "team"; readonly teamId: string } | { readonly kind: "workspace" };

/** One label, as an operator copying its id needs it. */
export interface LinearLabelSummary {
  readonly id: string;
  readonly name: string;
  readonly scope: LinearLabelScope;
  /** The group this label sits in, with the group's name when the same read returned it. */
  readonly parent: { readonly id: string; readonly name: string | undefined } | undefined;
  readonly isGroup: boolean;
}

/** Everything one `linear labels` read establishes. */
export interface LinearLabelsDocument {
  readonly source: "linear";
  readonly readAtIso: string;
  readonly team: LinearTeamIdentity;
  readonly issueLabels: readonly LinearLabelSummary[];
  readonly projectLabels: readonly LinearLabelSummary[];
}

/** The injected request seam — the same shape `linear states` uses, over the same paced transport. */
export type LinearLabelsRequest = LinearStatesRequest;

/** A label as one page carries it, before its parent is named from the whole set. */
type RawLabel = Omit<LinearLabelSummary, "parent"> & { readonly parentId: string | undefined };

/**
 * One raw label node before parents are named, or the reason it cannot be read. A node with no id or name is
 * REFUSED rather than dropped: dropped, it would leave the vocabulary shown one label short of the truth. Pure.
 */
function labelFrom({ node, field }: { node: unknown; field: string }): Result<RawLabel, LinearLiveError> {
  const id = isRecord(node) ? node["id"] : undefined;
  const name = isRecord(node) ? node["name"] : undefined;
  if (!isRecord(node) || typeof id !== "string" || typeof name !== "string") {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned a label in ${field} with no id or name` }));
  }
  const team = node["team"];
  const teamId = isRecord(team) ? team["id"] : undefined;
  const parent = node["parent"];
  const parentId = isRecord(parent) ? parent["id"] : undefined;
  return ok({
    id,
    isGroup: node["isGroup"] === true,
    name,
    parentId: typeof parentId === "string" ? parentId : undefined,
    scope: typeof teamId === "string" ? { kind: "team", teamId } : { kind: "workspace" },
  });
}

/**
 * Name each label's parent from the same set, and order the set: workspace before team, then by name, then by
 * id, so two reads of an unchanged vocabulary print identically. Pure.
 *
 * @param raw the labels with their parent ids
 * @returns the labels with their parents named where the parent was in the set
 */
export function nameParentsAndSort({ raw }: { raw: readonly RawLabel[] }): readonly LinearLabelSummary[] {
  const names = new Map(raw.map((label) => [label.id, label.name]));
  return raw
    .map(({ parentId, ...label }): LinearLabelSummary => ({
      ...label,
      parent: parentId === undefined ? undefined : { id: parentId, name: names.get(parentId) },
    }))
    .toSorted(
      (left, right) =>
        Number(left.scope.kind === "team") - Number(right.scope.kind === "team") ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
}

/** One page's nodes and its continuation cursor, or the reason the page is unreadable. Pure. */
function pageOf({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): Result<{ labels: readonly RawLabel[]; next: string | undefined }, LinearLiveError> {
  const connection = isRecord(value) ? value[field] : undefined;
  const nodes: unknown = isRecord(connection) ? connection["nodes"] : undefined;
  if (!Array.isArray(nodes)) {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned no ${field} connection` }));
  }
  const labels: RawLabel[] = [];
  for (const node of nodes) {
    const label = labelFrom({ field, node });
    if (label.isErr()) {
      return err(label.error);
    }
    labels.push(label.value);
  }
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  // A page that does not say whether more follow cannot be the last one: read as final, it would show a
  // truncated vocabulary as the whole of it.
  if (!isRecord(pageInfo) || typeof pageInfo["hasNextPage"] !== "boolean") {
    return err(LinearLiveErrors.readFailed({ message: `Linear did not say whether ${field} has another page` }));
  }
  const hasNext = pageInfo["hasNextPage"];
  const cursor = pageInfo["endCursor"];
  if (!hasNext) {
    return ok({ labels, next: undefined });
  }
  if (typeof cursor !== "string") {
    return err(LinearLiveErrors.readFailed({ message: `Linear said ${field} has another page and gave no cursor` }));
  }
  return ok({ labels, next: cursor });
}

/**
 * One team read's parent id, `null` for a root, or the reason the parent cannot be read. A parent already in
 * the lineage is a cycle and refused the same way. Pure.
 */
function parentFrom({
  value,
  current,
  lineage,
}: {
  value: unknown;
  current: string;
  lineage: readonly string[];
}): Result<string | null, LinearLiveError> {
  const team = isRecord(value) ? value["team"] : undefined;
  if (!isRecord(team) || !("parent" in team)) {
    return err(LinearLiveErrors.readFailed({ message: `Linear did not say whether team ${current} has a parent` }));
  }
  const parent = team["parent"];
  if (parent === null) {
    return ok(null);
  }
  const parentId = isRecord(parent) ? parent["id"] : undefined;
  if (typeof parentId !== "string" || lineage.includes(parentId)) {
    return err(LinearLiveErrors.readFailed({ message: `Linear returned an unreadable parent for team ${current}` }));
  }
  return ok(parentId);
}

/**
 * The team and every team above it, nearest first. A team whose parent cannot be read is REFUSED rather than
 * treated as a root: read as one, its parents' inherited labels would vanish from the list.
 */
async function readTeamLineage({
  request,
  teamId,
}: {
  request: LinearLabelsRequest;
  teamId: string;
}): Promise<Result<readonly string[], LinearLiveError>> {
  const lineage = [teamId];
  for (let hop = 0; hop < MAX_TEAM_DEPTH; hop += 1) {
    const current = lineage[lineage.length - 1]!;
    const response = await request({ query: TEAM_QUERY, variables: { id: current } });
    if (response.isErr()) {
      return err(response.error);
    }
    const parent = parentFrom({ current, lineage, value: response.value });
    if (parent.isErr()) {
      return err(parent.error);
    }
    if (parent.value === null) {
      return ok(lineage);
    }
    lineage.push(parent.value);
  }
  return err(
    LinearLiveErrors.readFailed({
      message: `team ${teamId} still had a parent after ${String(MAX_TEAM_DEPTH)} hops; refused rather than shown incomplete`,
    }),
  );
}

/** Follow one label connection to its end, applying the team-applicability filter on every page. */
async function readConnection({
  request,
  query,
  field,
  teamIds,
}: {
  request: LinearLabelsRequest;
  query: string;
  field: string;
  teamIds: readonly string[];
}): Promise<Result<readonly LinearLabelSummary[], LinearLiveError>> {
  const filter = { or: [{ team: { null: true } }, { team: { id: { in: teamIds } } }] };
  const collected: RawLabel[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_LABEL_PAGES; page += 1) {
    const response = await request({
      query,
      variables: after === undefined ? { filter, first: LABEL_PAGE_SIZE } : { after, filter, first: LABEL_PAGE_SIZE },
    });
    if (response.isErr()) {
      return err(response.error);
    }
    const parsed = pageOf({ field, value: response.value });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    collected.push(...parsed.value.labels);
    if (parsed.value.next === undefined) {
      return ok(nameParentsAndSort({ raw: collected }));
    }
    after = parsed.value.next;
  }
  return err(
    LinearLiveErrors.readFailed({
      message: `${field} still had more after ${String(MAX_LABEL_PAGES * LABEL_PAGE_SIZE)} labels; refused rather than shown incomplete`,
    }),
  );
}

/**
 * Read the issue labels and project labels one team can apply.
 *
 * @param teamKey the team's human key, as it appears in every issue identifier (`RRRR` in `RRRR-610`)
 * @param request the shared safe GraphQL transport
 * @param nowIso the freshness clock
 * @returns the team, its applicable issue labels and project labels, or a named read failure
 */
export async function readLinearLabels({
  teamKey,
  request,
  nowIso,
}: {
  teamKey: string;
  request: LinearLabelsRequest;
  nowIso: () => string;
}): Promise<Result<LinearLabelsDocument, LinearLiveError>> {
  const team = await readLinearTeam({ request, teamKey });
  if (team.isErr()) {
    return err(team.error);
  }
  const lineage = await readTeamLineage({ request, teamId: team.value.id });
  if (lineage.isErr()) {
    return err(lineage.error);
  }
  const issueLabels = await readConnection({
    field: "issueLabels",
    query: ISSUE_LABELS_QUERY,
    request,
    teamIds: lineage.value,
  });
  if (issueLabels.isErr()) {
    return err(issueLabels.error);
  }
  const projectLabels = await readConnection({
    field: "projectLabels",
    query: PROJECT_LABELS_QUERY,
    request,
    teamIds: lineage.value,
  });
  if (projectLabels.isErr()) {
    return err(projectLabels.error);
  }
  return ok({
    issueLabels: issueLabels.value,
    projectLabels: projectLabels.value,
    readAtIso: nowIso(),
    source: "linear",
    team: team.value,
  });
}

/**
 * Render a labels document as stable, pretty JSON.
 *
 * @param document the labels document
 * @returns one JSON document
 */
export function renderLinearLabelsJson({ document }: { document: LinearLabelsDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/** A parent group's name, or its id when the group itself was outside the read set. Pure. */
function parentName({ parent }: { parent: NonNullable<LinearLabelSummary["parent"]> }): string {
  if (parent.name === undefined) {
    return parent.id;
  }
  return parent.name;
}

/** One label as a text row: the full id first, because copying it is the point. Pure. */
function labelRow({ label, teamId }: { label: LinearLabelSummary; teamId: string }): string {
  let scope = "workspace";
  if (label.scope.kind === "team") {
    scope = label.scope.teamId === teamId ? "team     " : "inherited";
  }
  const group = label.parent === undefined ? "" : `  (in ${parentName({ parent: label.parent })})`;
  const mark = label.isGroup ? "  [group]" : "";
  return `  ${label.id}  ${scope}  ${label.name}${group}${mark}`;
}

/**
 * Render a labels document as an operator-readable list, every id in full.
 *
 * @param document the labels document
 * @returns text listing every applicable issue label and project label with its id
 */
export function renderLinearLabelsText({ document }: { document: LinearLabelsDocument }): string {
  return [
    `linear labels: ${document.team.key} — ${document.team.name} (${document.team.id})`,
    `read at: ${document.readAtIso}`,
    `issue labels (${String(document.issueLabels.length)}):`,
    ...document.issueLabels.map((label) => labelRow({ label, teamId: document.team.id })),
    `project labels (${String(document.projectLabels.length)}):`,
    ...document.projectLabels.map((label) => labelRow({ label, teamId: document.team.id })),
  ].join("\n");
}
