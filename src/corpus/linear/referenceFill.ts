/**
 * The FILL half of the reference pass: resolve, on demand, a reference the pass's index does not hold.
 *
 * `./references.ts` walks the workspace vocabulary once and builds the index; this module fills a miss in that
 * same index, as a cache, while the lanes after the pass page through their own nodes. Why the index is a
 * cache at all, and why an issue reference needs one, is the block above `NO_REFERENCES` in `./references.ts`.
 */
import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { issueRefsFrom, type LinearNameCache, type LinearRef, type LinearRefKind, refsFrom } from "./names.js";
import { connectionOf, type LinearReferences } from "./references.js";
import type { LinearRequest } from "./transport.js";

/**
 * How a MISS is filled, per kind: the document to send and the root field to read it back from.
 *
 * Every entry declares `$filter` with an `id: { in: [...] }` comparator, which is what makes a fill one
 * request rather than one per id. Three kinds are absent: `projectStatus`, whose document declares no
 * filter at all and whose whole set (15 rows) is already walked; `team`, walked whole at 23 rows; and
 * `customer`, which `./references.ts` also walks whole. A kind with no entry does not fill; its misses stay bare ids.
 */
const FILL_DOCUMENTS: Partial<Record<LinearRefKind, { readonly query: string; readonly field: string }>> = {
  cycle: { field: "cycles", query: String(LinearDocument.CyclesDocument) },
  externalUser: { field: "externalUsers", query: String(LinearDocument.ExternalUsersDocument) },
  initiative: { field: "initiatives", query: String(LinearDocument.InitiativesDocument) },
  issue: { field: "issues", query: String(LinearDocument.IssuesDocument) },
  issueLabel: { field: "issueLabels", query: String(LinearDocument.IssueLabelsDocument) },
  milestone: { field: "projectMilestones", query: String(LinearDocument.ProjectMilestonesDocument) },
  project: { field: "projects", query: String(LinearDocument.ProjectsDocument) },
  projectLabel: { field: "projectLabels", query: String(LinearDocument.ProjectLabelsDocument) },
  user: { field: "users", query: String(LinearDocument.UsersDocument) },
  workflowState: { field: "workflowStates", query: String(LinearDocument.WorkflowStatesDocument) },
};

/** How many ids one fill request asks about. Linear's own page ceiling, so a fill is as few requests as possible. */
const FILL_BATCH = 250;

/**
 * Fill the cache for every reference on `nodes` the index does not already know.
 *
 * Mutates the index this {@link LinearReferences} was built with, on purpose: the cache is the whole point,
 * and a crawl that rebuilt it per page would re-ask the provider about the same issue on every page that
 * mentions it.
 *
 * @param nodes the page's raw nodes
 * @param spec which kind each nested field on those nodes points at
 * @param references the crawl's reference cache, MUTATED in place
 * @param request the shared Linear transport
 * @param warnings the running warning list, MUTATED when a fill fails — a miss is never fatal
 */
export async function fillReferences({
  nodes,
  spec,
  references,
  request,
  warnings,
}: {
  nodes: readonly unknown[];
  spec: Readonly<Record<string, LinearRefKind>>;
  references: LinearReferences;
  request: LinearRequest;
  warnings: string[];
}): Promise<void> {
  if (!references.resolves) {
    return;
  }
  const index = references.cache;
  for (const [kind, ids] of missingIdsByKind({ index, nodes, spec })) {
    const document = FILL_DOCUMENTS[kind];
    if (document === undefined) {
      continue;
    }
    // A kind with no lane of its own has no map yet; MINTING one here is what makes the fill a cache write
    // rather than a read that throws away what it fetched.
    let known = index.get(kind);
    if (known === undefined) {
      known = new Map<string, LinearRef>();
      index.set(kind, known);
    }
    for (let at = 0; at < ids.length; at += FILL_BATCH) {
      await fillOneBatch({ batch: ids.slice(at, at + FILL_BATCH), document, index, kind, known, request, warnings });
    }
  }
}

/**
 * ONE filtered request for one batch of missing ids, folded into the cache. A failure WARNS and returns.
 *
 * Its own function rather than a loop body because the whole shape of a fill — request, shape, fold, and a
 * miss that is never fatal — is one idea, and inlining it took `fillReferences` past the complexity ceiling.
 *
 * @param batch the ids to fetch, already bounded by `FILL_BATCH`
 * @param document the root field and SDK document that reads this kind
 * @param index the whole cache, read for the team map an issue identifier is derived from
 * @param known the one map this fill writes into, MUTATED in place
 * @param warnings the running warning list, MUTATED when the request fails
 */
async function fillOneBatch({
  batch,
  document,
  index,
  kind,
  known,
  request,
  warnings,
}: {
  batch: readonly string[];
  document: { readonly field: string; readonly query: string };
  index: LinearNameCache;
  kind: LinearRefKind;
  known: Map<string, LinearRef>;
  request: LinearRequest;
  warnings: string[];
}): Promise<void> {
  try {
    const data = await request({
      query: document.query,
      variables: { filter: { id: { in: batch } }, first: batch.length, includeArchived: true },
    });
    // Passed as-is, undefined and all: `issueRefsFrom` names the no-team-lane case itself and leaves an
    // identifier off rather than inventing one, so there is nothing to substitute here.
    const teams = index.get("team");
    const nodes = connectionOf({ data, field: document.field }).nodes;
    const fetched = kind === "issue" ? issueRefsFrom({ nodes, teams }) : refsFrom({ kind, nodes });
    for (const [id, ref] of fetched) {
      known.set(id, ref);
    }
  } catch (error: unknown) {
    warnings.push(
      `linear ${kind} reference fill failed for ${String(batch.length)} id(s), so their names will not ` +
        `resolve: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/** Every id a page references that the cache does not hold, grouped by kind, deduped. Pure. */
function missingIdsByKind({
  nodes,
  spec,
  index,
}: {
  nodes: readonly unknown[];
  spec: Readonly<Record<string, LinearRefKind>>;
  index: LinearNameCache;
}): ReadonlyMap<LinearRefKind, readonly string[]> {
  const missing = new Map<LinearRefKind, Set<string>>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    for (const [field, kind] of Object.entries(spec)) {
      const id = unknownReferenceId({ index, kind, reference: node[field] });
      if (id === undefined) {
        continue;
      }
      const bucket = missing.get(kind);
      if (bucket === undefined) {
        missing.set(kind, new Set([id]));
      } else {
        bucket.add(id);
      }
    }
  }
  return new Map([...missing].map(([kind, ids]) => [kind, [...ids]]));
}

/**
 * The id of one nested reference, when the cache does NOT already hold it. Pure.
 *
 * Three ways to answer "nothing to fetch" collapse here rather than in the caller's loop: the field carried
 * no reference object, it carried one with no string id, or the cache already knows that id.
 *
 * @param reference the nested field's value, as the node carried it
 * @param kind which reference kind that field points at
 * @param index the cache to check against
 * @returns the id to fetch, or undefined when there is nothing to fetch
 */
function unknownReferenceId({
  reference,
  kind,
  index,
}: {
  reference: unknown;
  kind: LinearRefKind;
  index: LinearNameCache;
}): string | undefined {
  const id = isRecord(reference) ? reference["id"] : undefined;
  if (typeof id !== "string") {
    return undefined;
  }
  if (index.get(kind)?.has(id) === true) {
    return undefined;
  }
  return id;
}
