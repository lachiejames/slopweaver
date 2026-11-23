/*
 * The initiatives lane, driven through a plain fake `LinearRequest`: it clamps the page size, sends ONE
 * companion request for the page's `links`, and rolls a sub-initiative's direct projects up to every ancestor
 * on the page, terminating on a cycle in the parent chain.
 */
import { describe, expect, it } from "vitest";

import { initiativesLane } from "../../../../corpus/linear/fetchInitiatives.js";
import type { LinearRef } from "../../../../corpus/linear/names.js";
import { INITIATIVE_CONNECTIONS_QUERY, INITIATIVES_QUERY } from "../../../../corpus/linear/queries.js";
import { type LinearReferences, NO_REFERENCES } from "../../../../corpus/linear/references.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";

/** One request as the fake transport saw it. */
interface SentQuery {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

/** The companion payload: every holder id with an empty, terminal `links` connection. */
function linksCompanion({ ids }: { ids: readonly string[] }): unknown {
  return {
    initiatives: {
      nodes: ids.map((id) => ({ id, links: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } } })),
      pageInfo: { endCursor: null, hasNextPage: false },
    },
  };
}

/** A transport answering the page query and the companion query, recording both and throwing on any other. */
function initiativesRequest({
  sent,
  page,
  companionIds,
}: {
  sent: SentQuery[];
  page: unknown;
  companionIds: readonly string[];
}): LinearRequest {
  return async ({ query, variables }) => {
    sent.push({ query, variables });
    if (query === INITIATIVES_QUERY) {
      return page;
    }
    if (query === INITIATIVE_CONNECTIONS_QUERY) {
      return linksCompanion({ ids: companionIds });
    }
    throw new Error(`unexpected query: ${query.slice(0, 40)}`);
  };
}

/** References whose only content is each initiative's DIRECT project edges. */
function withInitiativeProjects({
  projects,
}: {
  projects: ReadonlyMap<string, readonly LinearRef[]>;
}): LinearReferences {
  return { ...NO_REFERENCES, initiativeProjects: projects };
}

describe("initiativesLane", () => {
  it("clamps the page, sends one companion request, and rolls a child's project up to its parent", async () => {
    const sent: SentQuery[] = [];
    const parent = { id: "initiative-parent", name: "Parent" };
    const child = { id: "initiative-child", name: "Child", parentInitiative: { id: "initiative-parent" } };
    const page = {
      initiatives: { nodes: [parent, child], pageInfo: { endCursor: "initiative-next", hasNextPage: true } },
    };
    const references = withInitiativeProjects({
      projects: new Map([["initiative-child", [{ id: "project-child", name: "Child project" }]]]),
    });
    const lane = initiativesLane({
      call: initiativesRequest({ companionIds: ["initiative-parent", "initiative-child"], page, sent }),
      references,
    });

    const result = await lane({ pageSize: 100 });

    expect(sent).toEqual([
      { query: INITIATIVES_QUERY, variables: { first: 25, includeArchived: true } },
      {
        query: INITIATIVE_CONNECTIONS_QUERY,
        variables: { first: 2, ids: ["initiative-parent", "initiative-child"] },
      },
    ]);
    expect(result).toEqual({
      initiatives: [
        {
          id: "initiative-parent",
          name: "Parent",
          projectEdges: ["project-item|linear:project:project-child"],
          projects: ["Child project"],
          raw: parent,
          tsIso: "",
          url: "",
        },
        {
          id: "initiative-child",
          name: "Child",
          projectEdges: ["project-item|linear:project:project-child"],
          projects: ["Child project"],
          raw: child,
          tsIso: "",
          url: "",
        },
      ],
      nextCursor: "initiative-next",
    });
  });

  it("terminates on a cycle in the parent chain, rolling each side's project onto the other", async () => {
    const first = { id: "initiative-a", name: "A", parentInitiative: { id: "initiative-b" } };
    const second = { id: "initiative-b", name: "B", parentInitiative: { id: "initiative-a" } };
    const page = { initiatives: { nodes: [first, second] } };
    const references = withInitiativeProjects({
      projects: new Map([
        ["initiative-a", [{ id: "project-a", name: "Project A" }]],
        ["initiative-b", [{ id: "project-b", name: "Project B" }]],
      ]),
    });
    const lane = initiativesLane({
      call: initiativesRequest({ companionIds: ["initiative-a", "initiative-b"], page, sent: [] }),
      references,
    });

    const result = await lane({ cursor: "initiative-prev" });

    expect(result.initiatives.map((item) => [item.id, item.projects])).toEqual([
      ["initiative-a", ["Project A", "Project B"]],
      ["initiative-b", ["Project A", "Project B"]],
    ]);
    expect(result.nextCursor).toBeUndefined();
  });
});
