/**
 * The pure half of the Linear STRUCTURE lane: raw GraphQL nodes in, {@link StructureBronzeRow}s out. No request
 * and no clock reaches this file; the paging that feeds it is `./structures.ts`.
 */

import { isRecord } from "../../lib/parsers.js";
import { optStr as str } from "../slack/shape.js";
import type { AttrValue, StructureBronzeRow, StructureRelation } from "../structures/types.js";

/**
 * Project the `organization` object into an `org` structure row. Pure — undefined without an id.
 *
 * @param raw the raw `organization` object, of unvalidated shape
 * @param fetchedAtIso when the fetch happened, recorded on the row rather than read from a clock here
 * @returns the row, or undefined without an id — an org that cannot be keyed cannot be filed
 */
export function projectLinearOrg({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const id = isRecord(raw) ? str({ value: raw["id"] }) : undefined;
  if (!isRecord(raw) || id === undefined) {
    return undefined;
  }
  const name = str({ value: raw["name"] });
  const urlKey = str({ value: raw["urlKey"] });
  return {
    attrs: {
      ...(typeof raw["userCount"] === "number" ? { userCount: raw["userCount"] } : {}),
      ...(raw["samlEnabled"] === true ? { samlEnabled: true } : {}),
    },
    fetchedAtIso,
    identity: {
      nativeId: id,
      ...(name !== undefined ? { name } : {}),
      ...(urlKey !== undefined ? { slug: urlKey } : {}),
    },
    kind: "org",
    provenance: ["linear.organization"],
    raw,
    relations: [],
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/**
 * The team-to-members index, built from the ROOT `teamMemberships` connection. Pure.
 *
 * The join the SDK's fragments force, and the one that replaced the structure lane's inline-page-then-page-the-
 * overflow machinery: each membership node carries `team { id }` and `user { id }`, so one root walk keyed
 * by team id says everything the nested connection used to, with no per-team follow-up and no page to
 * silently truncate. A node missing either endpoint is skipped rather than fatal, as every parse here is.
 *
 * @param nodes the raw `teamMemberships` nodes, of unvalidated shape
 * @returns team id to the ids of its members, in the order the walk saw them
 */
export function teamMembersFromMemberships({ nodes }: { nodes: readonly unknown[] }): ReadonlyMap<string, string[]> {
  const byTeam = new Map<string, string[]>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const teamId = isRecord(node["team"]) ? str({ value: node["team"]["id"] }) : undefined;
    const userId = isRecord(node["user"]) ? str({ value: node["user"]["id"] }) : undefined;
    if (teamId === undefined || userId === undefined) {
      continue;
    }
    const members = byTeam.get(teamId);
    if (members === undefined) {
      byTeam.set(teamId, [userId]);
    } else {
      members.push(userId);
    }
  }
  return byTeam;
}

/** The `member` relations for one team, from the ids the root membership walk joined to it. Pure. */
function teamMemberRelations({ memberIds }: { memberIds: readonly string[] }): readonly StructureRelation[] {
  return memberIds.map((id) => ({
    targetId: `linear:${id}`,
    targetKind: "person",
    targetSource: "person",
    type: "member",
  }));
}

/**
 * Project one team node into a `team` structure row (with member relations). Pure — undefined without an id.
 *
 * @param node one raw team node, of unvalidated shape
 * @param fetchedAtIso when the fetch happened
 * @param memberIds the ids the root `teamMemberships` walk joined to this team; empty when it has none
 * @returns the row with one `member` relation per team member, or undefined without an id
 */
export function projectLinearTeam({
  node,
  fetchedAtIso,
  memberIds,
}: {
  node: unknown;
  fetchedAtIso: string;
  memberIds: readonly string[];
}): StructureBronzeRow | undefined {
  const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
  if (!isRecord(node) || id === undefined) {
    return undefined;
  }
  const key = str({ value: node["key"] });
  const name = str({ value: node["name"] });
  const description = str({ value: node["description"] });
  const visibility = str({ value: node["visibility"] });
  return {
    attrs: {
      // `visibility` is the field Linear now publishes; `private` is deprecated. The boolean attr is KEPT
      // under its existing name so nothing downstream has to change, and it is derived from the new field.
      private: visibility !== undefined && visibility !== "public",
      ...(visibility !== undefined ? { visibility } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    fetchedAtIso,
    identity: { nativeId: id, ...(key !== undefined ? { slug: key } : {}), ...(name !== undefined ? { name } : {}) },
    kind: "team",
    provenance: ["linear.teams"],
    raw: node,
    relations: teamMemberRelations({ memberIds }),
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/** The `state_for` relation binding a state/cycle to its team. Pure. */
function forTeam({ teamId, type }: { teamId: string; type: "state_for" | "cycle_for" }): readonly StructureRelation[] {
  return [{ targetId: teamId, targetKind: "team", targetSource: "linear", type }];
}

/**
 * Project one ROOT workflow-state node into a `workflow_state` row, bound to its team. Pure.
 *
 * The team binding comes from the node's own `team { id }` now that states are fetched at the root rather than
 * nested under a team — same relation, same row, one query that no longer breaches the complexity ceiling.
 *
 * @param node the raw state node
 * @param fetchedAtIso the hydration timestamp
 * @returns the row, or undefined without an id
 */
export function projectLinearState({
  node,
  fetchedAtIso,
}: {
  node: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  if (id === undefined) {
    return undefined;
  }
  const name = str({ value: node["name"] });
  const type = str({ value: node["type"] });
  const teamId = isRecord(node["team"]) ? str({ value: node["team"]["id"] }) : undefined;
  const attrs: Record<string, AttrValue> = {
    ...(type !== undefined ? { type } : {}),
    ...(typeof node["position"] === "number" ? { position: node["position"] } : {}),
  };
  return {
    attrs,
    fetchedAtIso,
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind: "workflow_state",
    provenance: ["linear.workflowStates"],
    raw: node,
    relations: teamId === undefined ? [] : forTeam({ teamId, type: "state_for" }),
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/**
 * Project one ROOT cycle node into a `cycle` row, bound to its team. Pure.
 *
 * @param node the raw cycle node
 * @param fetchedAtIso the hydration timestamp
 * @returns the row, or undefined without an id
 */
export function projectLinearCycle({
  node,
  fetchedAtIso,
}: {
  node: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  if (id === undefined) {
    return undefined;
  }
  const name = str({ value: node["name"] });
  const startsAt = str({ value: node["startsAt"] });
  const endsAt = str({ value: node["endsAt"] });
  const teamId = isRecord(node["team"]) ? str({ value: node["team"]["id"] }) : undefined;
  const attrs: Record<string, AttrValue> = {
    ...(typeof node["number"] === "number" ? { number: node["number"] } : {}),
    ...(typeof node["progress"] === "number" ? { progress: node["progress"] } : {}),
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
  };
  return {
    attrs,
    fetchedAtIso,
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind: "cycle",
    provenance: ["linear.cycles"],
    raw: node,
    relations: teamId === undefined ? [] : forTeam({ teamId, type: "cycle_for" }),
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/**
 * The pageInfo `{ hasNext, endCursor }` off a connection. Pure.
 *
 * @returns whether another page exists, and the cursor to it when Linear supplied one
 */
export function pageInfoOf({ connection }: { connection: unknown }): { hasNext: boolean; endCursor?: string } {
  const info = isRecord(connection) ? connection["pageInfo"] : undefined;
  if (!isRecord(info)) {
    return { hasNext: false };
  }
  const endCursor = str({ value: info["endCursor"] });
  return { hasNext: info["hasNextPage"] === true, ...(endCursor !== undefined ? { endCursor } : {}) };
}

/**
 * Every structure row off one raw teams-page (the team itself; states + cycles come from the root lanes). Pure.
 *
 * @param data one raw GraphQL `data` payload for the `teams` connection
 * @param fetchedAtIso when the fetch happened
 * @param membersByTeam the index the ROOT `teamMemberships` walk built, keyed by team id
 * @returns the team rows only — states and cycles arrive via their own root lanes rather than nested here —
 *   plus `nextCursor` when another page exists
 */
export function structuresFromTeamsPage({
  data,
  fetchedAtIso,
  membersByTeam,
}: {
  data: unknown;
  fetchedAtIso: string;
  membersByTeam: ReadonlyMap<string, readonly string[]>;
}): {
  rows: readonly StructureBronzeRow[];
  nextCursor?: string;
} {
  const connection = isRecord(data) ? data["teams"] : undefined;
  const nodes = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [];
  const rows: StructureBronzeRow[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const team = projectLinearTeam({ fetchedAtIso, memberIds: membersOf({ membersByTeam, node }), node });
    if (team !== undefined) {
      rows.push(team);
    }
  }
  const info = pageInfoOf({ connection });
  return { rows, ...(info.hasNext && info.endCursor !== undefined ? { nextCursor: info.endCursor } : {}) };
}

/**
 * One team node's member ids, joined off the root membership walk. Pure.
 *
 * An EMPTY list covers both absences and neither is an error: a team the walk returned no rows for has no
 * members, which is a real state of a team and what the row should record, and a node carrying no id cannot
 * be joined against the walk at all.
 *
 * @param node the raw team node
 * @param membersByTeam the index the root `teamMemberships` walk built
 * @returns that team's member ids, empty when there are none to join
 */
function membersOf({
  node,
  membersByTeam,
}: {
  node: Record<string, unknown>;
  membersByTeam: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const id = str({ value: node["id"] });
  if (id === undefined) {
    return [];
  }
  const joined = membersByTeam.get(id);
  if (joined === undefined) {
    return [];
  }
  return joined;
}
