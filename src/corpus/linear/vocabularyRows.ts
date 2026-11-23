/**
 * The two org-VOCABULARY bulk entities, issue labels and saved custom views, projected into STRUCTURE rows.
 *
 * Pure: raw GraphQL nodes in, {@link StructureBronzeRow}s out. The paging and reference hydration that feed
 * them are `./structures.ts`'s `fetchLinearVocabulary`; where every other bulk entity lands, and why these two
 * are structure rather than activity, is the routing table in `./entities.ts`.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AttrValue, StructureBronzeRow, StructureRelation } from "../structures/types.js";
import { displayName, nestedStr, str } from "./parseFields.js";

/**
 * One issue label → an `issue_label` STRUCTURE row.
 *
 * Structure and not activity: a label is org VOCABULARY — how a team names kinds of work — and the structure
 * store is exactly where the scaffolding activity happens inside belongs. Only label NAMES ever rode the issue
 * query, so descriptions and the whole group/child hierarchy were lost entirely. Pure.
 *
 * @param node the raw label node
 * @param fetchedAtIso the hydration timestamp
 * @returns the structure row, or undefined without an id
 */
export function issueLabelRow({
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
  const description = str({ value: node["description"] });
  const teamId = nestedStr({ key: "id", value: node["team"] });
  const parentId = nestedStr({ key: "id", value: node["parent"] });
  const attrs: Record<string, AttrValue> = {
    isGroup: node["isGroup"] === true,
    ...(description !== undefined ? { description } : {}),
    ...(str({ value: node["color"] }) !== undefined ? { color: str({ value: node["color"] })! } : {}),
    ...(str({ value: node["archivedAt"] }) !== undefined ? { archived: true } : {}),
  };
  return {
    attrs,
    fetchedAtIso,
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind: "issue_label",
    provenance: ["linear.issueLabels"],
    raw: node,
    relations: labelRelations({ parentId, teamId }),
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/** The team binding and the group parent of a label, as structure relations. Pure. */
function labelRelations({
  teamId,
  parentId,
}: {
  teamId: string | undefined;
  parentId: string | undefined;
}): readonly StructureRelation[] {
  const relations: StructureRelation[] = [];
  if (teamId !== undefined) {
    relations.push({ targetId: teamId, targetKind: "team", targetSource: "linear", type: "parent" });
  }
  if (parentId !== undefined) {
    relations.push({ targetId: parentId, targetKind: "issue_label", targetSource: "linear", type: "parent" });
  }
  return relations;
}

/**
 * One custom view → a `custom_view` STRUCTURE row. A saved filter is a durable statement about what a team
 * treats as one body of work, which is org scaffolding rather than activity. Pure.
 *
 * The filter DEFINITION (`filterData`) is deliberately not captured: it is an opaque JSON blob that `attrs`
 * cannot hold and that no reader here can interpret, so fetching it would land it in `raw` only — where the
 * dedup fingerprint cannot see it and it would be discarded on re-ingest anyway.
 *
 * @param node the raw view node
 * @param fetchedAtIso the hydration timestamp
 * @returns the structure row, or undefined without an id
 */
export function customViewRow({
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
  const teamId = nestedStr({ key: "id", value: node["team"] });
  const description = str({ value: node["description"] });
  const owner = displayName({ value: node["owner"] });
  const modelName = str({ value: node["modelName"] });
  return {
    attrs: {
      shared: node["shared"] === true,
      ...(description !== undefined ? { description } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(modelName !== undefined ? { modelName } : {}),
      ...(str({ value: node["archivedAt"] }) !== undefined ? { archived: true } : {}),
    },
    fetchedAtIso,
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind: "custom_view",
    provenance: ["linear.customViews"],
    raw: node,
    relations:
      teamId === undefined ? [] : [{ targetId: teamId, targetKind: "team", targetSource: "linear", type: "parent" }],
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}
