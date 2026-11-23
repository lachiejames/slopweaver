/**
 * The documents lane of the Linear seam's PRODUCER side: the SDK's document per page, shaped into parsed
 * documents, plus the ONE per-team walk that joins the `team` the SDK fragment lacks.
 *
 * Split out of `./fetchApi.ts` (file-size ratchet); {@link ./fetchApi}'s `makeLinearApi` wires this lane into
 * the seam, and this file imports nothing back from it.
 */
import { isRecord } from "../../lib/parsers.js";
import type { LinearApi, LinearDocumentsPage } from "./apiTypes.js";
import { documentTeamsFor, knownTeamIds } from "./fetchJoins.js";
import { clampPageSize, rootPage } from "./fetchPages.js";
import type { LinearDocumentItem } from "./items.js";
import { hydrateNode } from "./names.js";
import { parseDocumentNode } from "./parseDocument.js";
import { str } from "./parseFields.js";
import { DOCUMENTS_PAGE_SIZE, DOCUMENTS_QUERY, DOCUMENTS_REFS } from "./queries.js";
import { fillReferences } from "./referenceFill.js";
import { type LinearReferences, NO_REFERENCES } from "./references.js";
import type { LinearRequest } from "./transport.js";

/**
 * Shape one raw `documents` GraphQL response into shaped documents + the next cursor. Pure.
 *
 * A document's `team` is the one parent the SDK fragment does not carry at all, so it is JOINED here from
 * the per-team walk (`./fetchJoins.ts`'s `documentTeamsFor`) as a bare `{ id }` before hydration turns it
 * into the `key` the parser reads — the same shape the other five parents arrive in.
 *
 * @internal exported for symmetry with the other `shape*Page` functions and for a caller that only needs
 *   this one lane's shaping in isolation; no current caller outside this module needs it directly.
 * @param data one raw GraphQL `data` payload
 * @param references the crawl's reference index, which resolves the SDK fragment's bare `{ id }` parents
 * @param documentTeams each team-scoped document id to its team id; a document absent from it has no team
 * @returns the documents that parsed, plus `nextCursor` only when another page exists
 */
export function shapeDocumentsPage({
  data,
  references = NO_REFERENCES,
  documentTeams = new Map<string, string>(),
}: {
  data: unknown;
  references?: LinearReferences;
  documentTeams?: ReadonlyMap<string, string>;
}): LinearDocumentsPage {
  const page = rootPage({ data, key: "documents" });
  const documents = page.nodes
    .map((node) => withDocumentTeam({ documentTeams, node }))
    .map((node) => parseDocumentNode({ node: hydrateNode({ index: references.index, node, spec: DOCUMENTS_REFS }) }))
    .filter((item): item is LinearDocumentItem => item !== undefined);
  return { documents, ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}) };
}

/** A document node with its joined `team: { id }`, or the node untouched when it belongs to no team. Pure. */
function withDocumentTeam({
  node,
  documentTeams,
}: {
  node: unknown;
  documentTeams: ReadonlyMap<string, string>;
}): unknown {
  const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
  const teamId = id === undefined ? undefined : documentTeams.get(id);
  if (!isRecord(node) || teamId === undefined) {
    return node;
  }
  return { ...node, team: { id: teamId } };
}

/**
 * The per-team walk, started on the first ask and held for every later one.
 *
 * It covers the whole workspace, so a second page has nothing to add and a second request would only spend
 * budget. Held as a one-slot list rather than a reassigned binding, because the two gates that govern this
 * tree disagree about the reassignment: oxlint wants `??=`, and `no-silent-fallback` bans it.
 */
function heldDocumentTeams({
  call,
  references,
}: {
  call: LinearRequest;
  references: LinearReferences;
}): (args: { warnings: string[] }) => Promise<ReadonlyMap<string, string>> {
  const held: Promise<ReadonlyMap<string, string>>[] = [];
  return ({ warnings }) => {
    const started = held[0];
    if (started !== undefined) {
      return started;
    }
    const walk = documentTeamsFor({ call, teamIds: knownTeamIds({ references }), warnings });
    held.push(walk);
    return walk;
  };
}

/**
 * The documents lane: the SDK's document per page, plus ONE per-team walk for the `team` its fragment lacks.
 *
 * With no reference pass there is no team list to walk, and no request is sent: the seam tests and the
 * cassette get the provider's own shapes, exactly as before.
 *
 * @returns the documents lane
 */
export function documentsLane({
  call,
  references,
}: {
  call: LinearRequest;
  references: LinearReferences;
}): NonNullable<LinearApi["documents"]> {
  const documentTeams = heldDocumentTeams({ call, references });
  return async ({ cursor, pageSize }) => {
    const data = await call({
      query: DOCUMENTS_QUERY,
      variables: {
        first: clampPageSize({ laneMax: DOCUMENTS_PAGE_SIZE, requested: pageSize }),
        includeArchived: true,
        ...(cursor !== undefined ? { after: cursor } : {}),
      },
    });
    const warnings: string[] = [];
    // Fill before the shape reads it, for the reason `./fetchApi.ts`'s `nodeLane` records.
    await fillReferences({
      nodes: rootPage({ data, key: "documents" }).nodes,
      references,
      request: call,
      spec: DOCUMENTS_REFS,
      warnings,
    });
    const shaped = shapeDocumentsPage({ data, documentTeams: await documentTeams({ warnings }), references });
    return { ...shaped, ...(warnings.length > 0 ? { warnings } : {}) };
  };
}
