/**
 * `makeLinearApi`'s documents lane: each document's team joined from one per-team walk per crawl, and no
 * per-team request at all when no reference pass ran.
 */
import { describe, expect, it } from "vitest";

import { makeLinearApi } from "../../../../../corpus/linear/fetch.js";
import { linearNameIndexFrom } from "../../../../../corpus/linear/names.js";
import type { LinearReferences } from "../../../../../corpus/linear/references.js";
import type { LinearRequest } from "../../../../../corpus/linear/transport.js";
import { conn } from "./harness.js";

describe("the documents lane joins each document's team from the per-team walk", () => {
  /** A crawl's references holding ONE team, so the walk has exactly one team to ask about. */
  function referencesWithTeam(): LinearReferences {
    const index = linearNameIndexFrom({ lanes: { team: [{ id: "t-eng", key: "ENG", name: "Engineering" }] } });
    return {
      cache: index,
      index,
      initiativeProjects: new Map(),
      issueRelations: new Map(),
      projectInitiatives: new Map(),
      resolves: true,
      userTeams: new Map(),
    };
  }

  /** The SDK `documents` document, answered with one team-scoped and one team-less document. */
  function documentsRequest({ sent }: { sent: Record<string, unknown>[] }): LinearRequest {
    return async ({ query, variables }) => {
      sent.push({ query, ...variables });
      const filtered = variables["filter"] !== undefined;
      const nodes = filtered
        ? [{ id: "d-spec", title: "spec" }]
        : [
            {
              id: "d-spec",
              title: "spec",
              updatedAt: "2026-05-01T00:00:00.000Z",
              url: "https://linear.app/acme/document/d-spec",
            },
            {
              id: "d-note",
              title: "note",
              updatedAt: "2026-05-02T00:00:00.000Z",
              url: "https://linear.app/acme/document/d-note",
            },
          ];
      return { documents: conn({ nodes }) };
    };
  }

  it("resolves the joined team to its key and leaves a team-less document without one", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = makeLinearApi({ references: referencesWithTeam(), request: documentsRequest({ sent }) });
    const page = await api.documents!({});
    expect(page.documents.map((document) => [document.id, document.team])).toEqual([
      ["d-spec", "ENG"],
      ["d-note", undefined],
    ]);
    // One page, then one filtered walk for the one team — and the filter names that team.
    expect(sent.map((request) => request["filter"])).toEqual([undefined, { team: { id: { eq: "t-eng" } } }]);
  });

  it("walks the teams ONCE per crawl, not once per page", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = makeLinearApi({ references: referencesWithTeam(), request: documentsRequest({ sent }) });
    await api.documents!({});
    await api.documents!({ cursor: "page-2" });
    expect(sent.filter((request) => request["filter"] !== undefined)).toHaveLength(1);
  });

  it("sends no per-team request when no reference pass ran", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = makeLinearApi({ request: documentsRequest({ sent }) });
    const page = await api.documents!({});
    expect(page.documents.map((document) => document.team)).toEqual([undefined, undefined]);
    expect(sent.map((request) => request["filter"])).toEqual([undefined]);
  });
});
