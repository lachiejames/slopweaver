/**
 * The initiatives lane of the Linear seam's PRODUCER side: the SDK's document per page, ONE companion request
 * for the `links` it cannot express, and the pure local roll-up of each initiative's projects through its
 * sub-initiatives.
 *
 * Split out of `./fetchApi.ts` (file-size ratchet); {@link ./fetchApi}'s `makeLinearApi` wires this lane into
 * the seam, and this file imports nothing back from it.
 */
import { isRecord } from "../../lib/parsers.js";
import type { LinearApi } from "./apiTypes.js";
import { initiativeConnectionsFor } from "./fetchJoins.js";
import { clampPageSize, idsOf, joinedNested, joinedRows, rootPage } from "./fetchPages.js";
import type { LinearInitiativeItem } from "./items.js";
import { hydrateNode, type LinearRef } from "./names.js";
import { parseInitiativeNode } from "./parse.js";
import { str } from "./parseFields.js";
import { INITIATIVES_PAGE_SIZE, INITIATIVES_QUERY, INITIATIVES_REFS } from "./queries.js";
import { fillReferences } from "./referenceFill.js";
import type { LinearReferences } from "./references.js";
import type { LinearRequest } from "./transport.js";

/**
 * The initiatives lane: the SDK's document, plus ONE companion request for the `links` it cannot express.
 *
 * An initiative's PROJECTS cost no request at all — the reference pass walked the root `initiativeToProjects`
 * edges once, for both directions. One thing that walk does not reproduce, and it is stated rather than
 * discovered: the old document asked for `projects(includeSubInitiatives: true)`, so a parent listed its
 * children's projects as its own. The root edges are DIRECT links, and the expansion is a local walk of the
 * `parentInitiative { id }` the SDK's own fragment carries.
 *
 * @returns the initiatives lane
 */
export function initiativesLane({
  call,
  references,
}: {
  call: LinearRequest;
  references: LinearReferences;
}): NonNullable<LinearApi["initiatives"]> {
  return async ({ cursor, pageSize }) => {
    const data = await call({
      query: INITIATIVES_QUERY,
      variables: {
        first: clampPageSize({ laneMax: INITIATIVES_PAGE_SIZE, requested: pageSize }),
        includeArchived: true,
        ...(cursor !== undefined ? { after: cursor } : {}),
      },
    });
    const page = rootPage({ data, key: "initiatives" });
    const warnings: string[] = [];
    const ids = idsOf({ nodes: page.nodes });
    await fillReferences({ nodes: page.nodes, references, request: call, spec: INITIATIVES_REFS, warnings });
    const companion = await initiativeConnectionsFor({ call, ids, warnings });
    const projectsOf = initiativeProjectsIncludingChildren({ nodes: page.nodes, references });
    const initiatives: LinearInitiativeItem[] = [];
    for (const node of page.nodes) {
      const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
      if (id === undefined) {
        continue;
      }
      const initiative = parseInitiativeNode({
        nested: { ...joinedNested({ byId: companion, id }), projects: joinedRows({ byId: projectsOf, id }) },
        node: hydrateNode({ index: references.index, node, spec: INITIATIVES_REFS }),
      });
      if (initiative !== undefined) {
        initiatives.push(initiative);
      }
    }
    return {
      initiatives,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };
}

/**
 * Each initiative's projects, INCLUDING those reached through its sub-initiatives. Pure.
 *
 * The `includeSubInitiatives: true` the old document asked the provider for, computed locally instead: the
 * SDK's `Initiative` fragment carries `parentInitiative { id }`, so a child's direct projects roll up to
 * every ancestor on the page. That rollup is what the `project-item` curated edges are built from, so a
 * truncation here would leave real projects orphaned from the strategy layer with nothing reporting it.
 *
 * @param nodes one page of initiative nodes
 * @param references the crawl's reference pass, for the direct project edges
 * @returns initiative id to its projects and its descendants' projects, deduped by project id
 */
function initiativeProjectsIncludingChildren({
  nodes,
  references,
}: {
  nodes: readonly unknown[];
  references: LinearReferences;
}): ReadonlyMap<string, readonly unknown[]> {
  const parents = parentInitiativeIds({ nodes });
  const rolled = new Map<string, Map<string, unknown>>();
  for (const id of idsOf({ nodes })) {
    rolled.set(id, new Map());
  }
  for (const [id, bucket] of rolled) {
    const own = joinedRows({ byId: references.initiativeProjects, id });
    for (const project of own) {
      bucket.set(String(project["id"]), project);
    }
    rollUpToAncestors({ from: id, parents, projects: own, rolled });
  }
  return new Map([...rolled].map(([id, bucket]) => [id, [...bucket.values()]]));
}

/**
 * Each initiative on the page to its PARENT initiative's id, for the ones that have one. Pure.
 *
 * @param nodes one page of initiative nodes
 * @returns child id to parent id, omitting a root initiative and any node missing either id
 */
function parentInitiativeIds({ nodes }: { nodes: readonly unknown[] }): ReadonlyMap<string, string> {
  const parents = new Map<string, string>();
  for (const node of nodes) {
    if (!isRecord(node) || !isRecord(node["parentInitiative"])) {
      continue;
    }
    const id = str({ value: node["id"] });
    const parent = str({ value: node["parentInitiative"]["id"] });
    if (id !== undefined && parent !== undefined) {
      parents.set(id, parent);
    }
  }
  return parents;
}

/**
 * Add one initiative's projects to every ANCESTOR of it that is also on this page. Mutates `rolled`.
 *
 * The `seen` set is what makes a cycle in the parent chain terminate rather than hang — Linear does not
 * promise a tree, so this walk cannot assume one. An ancestor that is not on the page is skipped, because
 * this lane only ever answers for the initiatives it was handed.
 *
 * @param from the initiative whose projects are being rolled up
 * @param parents the child-to-parent map for the page
 * @param projects the projects to add to each ancestor
 * @param rolled the per-initiative accumulator, keyed by project id so a diamond dedupes
 */
function rollUpToAncestors({
  from,
  parents,
  projects,
  rolled,
}: {
  from: string;
  parents: ReadonlyMap<string, string>;
  projects: readonly LinearRef[];
  rolled: Map<string, Map<string, unknown>>;
}): void {
  const seen = new Set<string>([from]);
  let at = parents.get(from);
  while (at !== undefined && !seen.has(at)) {
    seen.add(at);
    const ancestor = rolled.get(at);
    for (const project of projects) {
      ancestor?.set(String(project["id"]), project);
    }
    at = parents.get(at);
  }
}
