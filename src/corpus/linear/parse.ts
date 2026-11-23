/**
 * The PURE Linear node parses for issues, comments, project updates and initiatives: raw GraphQL node → shaped
 * item. No I/O, no transport, no paging. The shared field readers are in `parseFields.ts`, an issue's scalars,
 * lifecycle and stored `raw` in `parseIssueParts.ts`, a project in `parseProject.ts` and a document in
 * `parseDocument.ts`, and the rule below governs all of them.
 *
 * Split out of `fetch.ts` when the selection roughly tripled. The split is the repo's standing pure-core /
 * effectful-shell line, and it earns its keep here specifically: the interesting failures in this connector are
 * all projection failures — a field fetched with nowhere to land, a reordered connection churning a
 * fingerprint, a timestamp read off the wrong key — and every one of them is now testable with a literal
 * fixture and no fake transport at all.
 *
 * ## The rule that governs every addition below
 *
 * **A fetched field needs a destination in `attrs` or `text`, or it must not be fetched.** `raw` does NOT
 * count. `recordContentFingerprint` in `recordSerialisation.ts` deliberately excludes `raw`, and on a duplicate the
 * FIRST-captured record is the one retained — so a field that lands only in `raw` makes an already-known issue
 * look unchanged, the enriched record is discarded, and the thin original stays. The query would be right, the
 * API would return the data, the tests would pass, and nothing would reach the corpus.
 * `Project.externalLinks` and `Initiative.links` were heading exactly there; both now land in `attrs.links`.
 */
import { isRecord } from "../../lib/parsers.js";
import type { HistoryEventRow } from "../history/types.js";
import { initiativeProjectEdges, issueAttachmentRefs, issueEdgeRefs, relationEventRefs } from "./curated.js";
import { issueHistoryRows } from "./history.js";
import type {
  LinearCommentItem,
  LinearInitiativeItem,
  LinearIssueItem,
  LinearProjectItem,
  LinearUpdateItem,
} from "./items.js";
import type { NestedNodes } from "./nested.js";
import {
  connectionNodes,
  connectionStrings,
  displayName,
  nestedNum,
  nestedStr,
  optionalStrings,
  PROJECT_STRING_FIELDS,
  parseExternalLinks,
  parseReactionData,
  str,
  strOrEmpty,
} from "./parseFields.js";
import { issueRaw, parseIssueLifecycle, parseIssueScalars } from "./parseIssueParts.js";

/**
 * The author of a comment: the member's real id, else the external commenter's real id (both are joinable —
 * `externalUsers` land in the members store with a UUID same as org members), else a display name when
 * neither carries one, else the integration that posted it.
 */
function commentAuthor({ raw }: { raw: Record<string, unknown> }): string | undefined {
  return (
    nestedStr({ key: "id", value: raw["user"] }) ??
    nestedStr({ key: "id", value: raw["externalUser"] }) ??
    displayName({ value: raw["user"] }) ??
    displayName({ value: raw["externalUser"] }) ??
    nestedStr({ key: "name", value: raw["externalUser"] }) ??
    nestedStr({ key: "name", value: raw["botActor"] })
  );
}

/**
 * Parse a `comments` connection's nodes into shaped comment items.
 *
 * Three things were lost before and are recovered here. `parentId` restores the reply TREE — comment records
 * were a flat list, so threading was simply unrecoverable from bronze. `reactions` is the cheapest agreement
 * signal the source offers. And `externalUser` gives a name to the 652 non-member commenters who were
 * previously anonymous. Pure.
 *
 * @param nodes the connection's nodes
 * @returns the shaped comments (body-less nodes skipped)
 */
function parseComments({ nodes }: { nodes: unknown }): readonly LinearCommentItem[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  const comments: LinearCommentItem[] = [];
  for (const raw of nodes) {
    if (!isRecord(raw)) {
      continue;
    }
    const shaped = parseComment({ raw });
    if (shaped !== undefined) {
      comments.push(shaped);
    }
  }
  return comments;
}

/** One comment node → item, or undefined without an id + body. Pure. */
function parseComment({ raw }: { raw: Record<string, unknown> }): LinearCommentItem | undefined {
  const id = str({ value: raw["id"] });
  const body = str({ value: raw["body"] });
  if (id === undefined || body === undefined) {
    return undefined;
  }
  const author = commentAuthor({ raw });
  // The scalar `parentId`, not `parent { id }`: an object selection inside a 25-item connection multiplies
  // into the per-query complexity budget, and the id is the whole of what a reply link needs.
  const parentId = str({ value: raw["parentId"] }) ?? nestedStr({ key: "id", value: raw["parent"] });
  const reactions = parseReactionData({ value: raw["reactionData"] });
  const editedAtIso = str({ value: raw["editedAt"] });
  const resolvedAtIso = str({ value: raw["resolvedAt"] });
  const quotedText = str({ value: raw["quotedText"] });
  return {
    body,
    id,
    raw,
    tsIso: strOrEmpty({ value: raw["createdAt"] }),
    url: strOrEmpty({ value: raw["url"] }),
    ...(author !== undefined ? { author } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
    ...(editedAtIso !== undefined ? { editedAtIso } : {}),
    ...(resolvedAtIso !== undefined ? { resolvedAtIso } : {}),
    ...(quotedText !== undefined ? { quotedText } : {}),
  };
}

/**
 * The identity fields shared into the item (identifier + the fallback-title/url/ts), or undefined if no id.
 *
 * @param node one raw issue node from the GraphQL response
 * @returns the identity fields, or undefined without an `identifier` — an issue that cannot be named is
 *   dropped rather than filed under a synthesised key. A missing title falls back to the identifier
 */
export function parseLinearIssueIdentity({
  node,
}: {
  node: Record<string, unknown>;
}): { identifier: string; title: string; url: string; tsIso: string; description?: string } | undefined {
  const identifier = str({ value: node["identifier"] });
  if (identifier === undefined) {
    return undefined;
  }
  const description = str({ value: node["description"] });
  return {
    identifier,
    title: str({ value: node["title"] }) ?? identifier,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * The optional people/state/team/project relations off an issue node (missing ones drop out). Pure.
 *
 * @param node one raw issue node
 * @returns only the relations actually present; an absent one is OMITTED rather than set to a placeholder, so
 *   "unassigned" stays distinguishable from "assignee we failed to read"
 */
export function parseLinearIssueRelations({ node }: { node: Record<string, unknown> }): {
  author?: string;
  assignee?: string;
  state?: string;
  stateType?: string;
  team?: string;
  project?: string;
  projectId?: string;
  parent?: string;
  milestone?: string;
  cycle?: string;
  cycleNumber?: number;
} {
  // The real id first — a display name is never an identity (see nativeIdShape.ts) — falling back to the
  // name only when the node carries no id, so a malformed payload still gets a label rather than nothing.
  const author = nestedStr({ key: "id", value: node["creator"] }) ?? displayName({ value: node["creator"] });
  const assignee = displayName({ value: node["assignee"] });
  const state = nestedStr({ key: "name", value: node["state"] });
  const stateType = nestedStr({ key: "type", value: node["state"] });
  const team = nestedStr({ key: "key", value: node["team"] });
  // The same rule for the project: its id is what an issue JOINS on, and its name is only what a reader sees.
  // Kept apart rather than one falling back to the other, because a title is not unique — a real corpus has
  // titles each held by two distinct projects, and dozens of projects that have been renamed.
  const project = nestedStr({ key: "name", value: node["project"] });
  const projectId = nestedStr({ key: "id", value: node["project"] });
  const parent = nestedStr({ key: "identifier", value: node["parent"] });
  const milestone = nestedStr({ key: "name", value: node["projectMilestone"] });
  const cycle = nestedStr({ key: "name", value: node["cycle"] });
  const cycleNumber = nestedNum({ key: "number", value: node["cycle"] });
  return {
    ...(author !== undefined ? { author } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(stateType !== undefined ? { stateType } : {}),
    ...(team !== undefined ? { team } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(parent !== undefined ? { parent } : {}),
    ...(milestone !== undefined ? { milestone } : {}),
    ...(cycle !== undefined ? { cycle } : {}),
    ...(cycleNumber !== undefined ? { cycleNumber } : {}),
  };
}

/**
 * Parse one issue node PLUS its completed nested connections into a shaped item and its history rows.
 *
 * The nested connections are passed in already paged to exhaustion (see {@link ./nested}) rather than read off
 * the node, which is the whole point: reading them off the node would silently use only the inline first page
 * and truncate every connection that overflowed.
 *
 * `raw` is rebuilt rather than passed through. Each overflowed connection is replaced by its COMPLETE node
 * list, so `raw` does not disagree with `attrs` — and the two history streams are REMOVED from it entirely,
 * because they live in the sibling history store and duplicating hundreds of thousands of events into bronze would multiply the
 * store's size for no reader's benefit.
 *
 * @param node the raw issue node
 * @param nested every nested connection's complete node list
 * @returns the shaped item and its history rows, or undefined when the node has no identifier
 */
export function parseLinearIssueNode({ node, nested }: { node: unknown; nested: NestedNodes }):
  | {
      item: LinearIssueItem;
      id: string;
      historyRows: readonly HistoryEventRow[];
    }
  | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const identity = parseLinearIssueIdentity({ node });
  if (identity === undefined) {
    return undefined;
  }
  const id = str({ value: node["id"] }) ?? identity.identifier;
  const relations = parseLinearIssueRelations({ node });
  const container = relations.team !== undefined ? `linear/${relations.team}` : "linear";
  const historyRows = issueHistoryRows({
    container,
    historyNodes: nested["history"] ?? [],
    stateNodes: nested["stateHistory"] ?? [],
    subjectId: identity.identifier,
  });
  return { historyRows, id, item: issueItem({ historyRows, identity, nested, node, relations }) };
}

/** Assemble the shaped issue item from its already-parsed parts. Pure. */
function issueItem({
  node,
  nested,
  identity,
  relations,
  historyRows,
}: {
  node: Record<string, unknown>;
  nested: NestedNodes;
  identity: NonNullable<ReturnType<typeof parseLinearIssueIdentity>>;
  relations: ReturnType<typeof parseLinearIssueRelations>;
  historyRows: readonly HistoryEventRow[];
}): LinearIssueItem {
  const edgeRefs = issueEdgeRefs({ children: nested["children"] ?? [], nodes: nested["relations"] ?? [] });
  const attachments = issueAttachmentRefs({ nodes: nested["attachments"] ?? [] });
  const relationEvents = relationEventRefs({
    forward: nested["relations"] ?? [],
    holder: identity.identifier,
    inverse: nested["inverseRelations"] ?? [],
  });
  const subscribers = connectionStrings({ field: "displayName", nodes: nested["subscribers"] ?? [] });
  const reactions = parseReactionData({ value: node["reactionData"] });
  return {
    comments: parseComments({ nodes: nested["comments"] ?? [] }),
    historyRows,
    labels: connectionStrings({ field: "name", nodes: nested["labels"] ?? [] }),
    raw: issueRaw({ nested, node }),
    ...identity,
    ...relations,
    ...parseIssueScalars({ node }),
    ...parseIssueLifecycle({ node }),
    ...(edgeRefs.length > 0 ? { edgeRefs } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(relationEvents.length > 0 ? { relationEvents } : {}),
    ...(subscribers.length > 0 ? { subscribers } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  };
}

/** One project-update node → item, or undefined without an id + body. Pure. */
function parseProjectUpdate({ raw }: { raw: Record<string, unknown> }): LinearUpdateItem | undefined {
  const id = str({ value: raw["id"] });
  const body = str({ value: raw["body"] });
  if (id === undefined || body === undefined) {
    return undefined;
  }
  const author = nestedStr({ key: "id", value: raw["user"] }) ?? displayName({ value: raw["user"] });
  const health = str({ value: raw["health"] });
  const reactions = parseReactionData({ value: raw["reactionData"] });
  const editedAtIso = str({ value: raw["editedAt"] });
  return {
    body,
    id,
    raw,
    tsIso: strOrEmpty({ value: raw["createdAt"] }),
    url: strOrEmpty({ value: raw["url"] }),
    ...(author !== undefined ? { author } : {}),
    ...(health !== undefined ? { health } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
    ...(editedAtIso !== undefined ? { editedAtIso } : {}),
  };
}

/**
 * Shape a project's `projectUpdates` connection into update items (skips body-less updates). Pure.
 *
 * @param nodes the connection's COMPLETE node list (paged to exhaustion by the caller)
 * @returns the shaped updates
 */
export function parseProjectUpdates({ nodes }: { nodes: readonly unknown[] }): readonly LinearUpdateItem[] {
  return nodes
    .map((raw) => (isRecord(raw) ? parseProjectUpdate({ raw }) : undefined))
    .filter((update): update is LinearUpdateItem => update !== undefined);
}

/**
 * The optional project fields, each dropped when absent rather than faked. Pure.
 *
 * Every list comes from the COMPLETED connection nodes, never from the inline node. Reading the node directly is
 * what made these silently truncate: the query carried a `hasNextPage` flag and nothing consulted it.
 *
 * @returns only the optional fields actually present
 */
export function projectOptionals({
  node,
  nested,
}: {
  node: Record<string, unknown>;
  nested: NestedNodes;
}): Partial<LinearProjectItem> {
  const links = parseExternalLinks({ nodes: nested["externalLinks"] ?? [] });
  const teams = connectionStrings({ field: "key", nodes: nested["teams"] ?? [] });
  const members = connectionStrings({ field: "displayName", nodes: nested["members"] ?? [] });
  const labels = connectionStrings({ field: "name", nodes: nested["labels"] ?? [] });
  const initiatives = connectionStrings({ field: "name", nodes: nested["initiatives"] ?? [] });
  return {
    ...optionalStrings({ node, pairs: PROJECT_STRING_FIELDS }),
    ...(nestedStr({ key: "name", value: node["status"] }) !== undefined
      ? { state: nestedStr({ key: "name", value: node["status"] })! }
      : {}),
    ...(displayName({ value: node["lead"] }) !== undefined ? { lead: displayName({ value: node["lead"] })! } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(teams.length > 0 ? { teams } : {}),
    ...(members.length > 0 ? { members } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(initiatives.length > 0 ? { initiatives } : {}),
  };
}

/**
 * Shape one initiative node. `content` is the full brief (the same story as `Project.content`); `links` gets an
 * `attrs` destination so it is not fetched into `raw` and discarded. Pure.
 *
 * @param node the raw initiative node
 * @param nested the COMPLETED connection node lists; defaults to empty so a fixture can exercise the
 *   scalars alone
 * @returns the shaped initiative, or undefined without an id + name
 */
export function parseInitiativeNode({
  node,
  nested = {},
}: {
  node: unknown;
  /** The COMPLETED connection node lists. Defaults to empty so a fixture can exercise the scalars alone. */
  nested?: NestedNodes;
}): LinearInitiativeItem | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const name = str({ value: node["name"] });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  const projectNodes = nested["projects"] ?? connectionNodes({ holder: node, key: "projects" });
  const links = parseExternalLinks({ nodes: nested["links"] ?? connectionNodes({ holder: node, key: "links" }) });
  const projects = connectionStrings({ field: "name", nodes: projectNodes });
  const projectEdges = initiativeProjectEdges({ projectIds: connectionStrings({ field: "id", nodes: projectNodes }) });
  const owner = displayName({ value: node["owner"] });
  return {
    id,
    name,
    raw: node,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...optionalStrings({
      node,
      pairs: [
        ["description", "description"],
        ["content", "content"],
        ["status", "status"],
        ["health", "health"],
        ["targetDate", "targetDate"],
        ["createdAt", "createdAtIso"],
        ["archivedAt", "archivedAtIso"],
      ],
    }),
    ...(owner !== undefined ? { owner } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(projects.length > 0 ? { projects } : {}),
    ...(projectEdges.length > 0 ? { projectEdges } : {}),
  };
}
