/**
 * The Linear seam's producer side. The issue and project shapers return the raw nodes whole and a cursor only
 * when `hasNextPage` is true AND `endCursor` is a non-empty string; the document shaper parses each node,
 * joins its team from the per-team walk and drops an unparseable one; and the users lane, driven through the
 * existing one-object `LinearRequest` seam, clamps an oversized page size to 25, sends the cursor as `after`,
 * and writes the reference pass's team list back onto each user node.
 */
import { describe, expect, it } from "vitest";

import { makeLinearApi, shapeIssuesPage, shapeProjectsPage } from "../../../../corpus/linear/fetchApi.js";
import { shapeDocumentsPage } from "../../../../corpus/linear/fetchDocuments.js";
import type { LinearNameIndex, LinearRef, LinearRefKind } from "../../../../corpus/linear/names.js";
import { type LinearReferences, NO_REFERENCES } from "../../../../corpus/linear/references.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";

/** One root connection payload under `key`. */
function connection({ key, nodes, pageInfo }: { key: string; nodes: readonly unknown[]; pageInfo?: unknown }): unknown {
  return { [key]: { nodes, ...(pageInfo !== undefined ? { pageInfo } : {}) } };
}

describe("shapeIssuesPage and shapeProjectsPage", () => {
  const NODES = [{ id: "a", title: "first" }, "not-a-record", { id: "b" }];

  it("returns every raw node in order and the cursor when another page is reported and named", () => {
    const pageInfo = { endCursor: "cur-2", hasNextPage: true };

    expect(shapeIssuesPage({ data: connection({ key: "issues", nodes: NODES, pageInfo }) })).toEqual({
      nextCursor: "cur-2",
      nodes: [{ id: "a", title: "first" }, "not-a-record", { id: "b" }],
    });
    expect(shapeProjectsPage({ data: connection({ key: "projects", nodes: NODES, pageInfo }) })).toEqual({
      nextCursor: "cur-2",
      nodes: [{ id: "a", title: "first" }, "not-a-record", { id: "b" }],
    });
  });

  it("omits the cursor for hasNextPage false, an empty endCursor, a non-string endCursor or no pageInfo", () => {
    const shapes = [
      { endCursor: "cur-2", hasNextPage: false },
      { endCursor: "", hasNextPage: true },
      { endCursor: 7, hasNextPage: true },
      undefined,
    ].map((pageInfo) => shapeIssuesPage({ data: connection({ key: "issues", nodes: [{ id: "a" }], pageInfo }) }));

    expect(shapes).toEqual([
      { nodes: [{ id: "a" }] },
      { nodes: [{ id: "a" }] },
      { nodes: [{ id: "a" }] },
      { nodes: [{ id: "a" }] },
    ]);
  });

  it("reads only its own root key: an issues payload shaped as projects is empty", () => {
    expect(shapeProjectsPage({ data: connection({ key: "issues", nodes: [{ id: "a" }] }) })).toEqual({ nodes: [] });
  });
});

describe("shapeDocumentsPage", () => {
  it("parses each document, joins its team through the reference index, and drops an id-less node", () => {
    const teams: ReadonlyMap<string, LinearRef> = new Map([["team-1", { key: "ENG", name: "Engineering" }]]);
    const index: LinearNameIndex = new Map<LinearRefKind, ReadonlyMap<string, LinearRef>>([["team", teams]]);
    const references: LinearReferences = { ...NO_REFERENCES, index };
    const data = connection({
      key: "documents",
      nodes: [
        {
          content: "the spec body",
          createdAt: "2026-09-01T00:00:00.000Z",
          id: "doc-1",
          title: "Spec",
          updatedAt: "2026-09-02T00:00:00.000Z",
          url: "https://linear.app/doc-1",
        },
        { title: "no id here", updatedAt: "2026-09-02T00:00:00.000Z" },
      ],
      pageInfo: { endCursor: "doc-cur", hasNextPage: true },
    });

    expect(shapeDocumentsPage({ data, documentTeams: new Map([["doc-1", "team-1"]]), references })).toEqual({
      documents: [
        {
          content: "the spec body",
          createdAtIso: "2026-09-01T00:00:00.000Z",
          id: "doc-1",
          raw: {
            content: "the spec body",
            createdAt: "2026-09-01T00:00:00.000Z",
            id: "doc-1",
            team: { id: "team-1", key: "ENG", name: "Engineering" },
            title: "Spec",
            updatedAt: "2026-09-02T00:00:00.000Z",
            url: "https://linear.app/doc-1",
          },
          team: "ENG",
          title: "Spec",
          tsIso: "2026-09-02T00:00:00.000Z",
          url: "https://linear.app/doc-1",
        },
      ],
      nextCursor: "doc-cur",
    });
  });

  it("leaves a document absent from the team walk without a team", () => {
    const data = connection({ key: "documents", nodes: [{ id: "doc-2", title: "Loose" }] });

    expect(shapeDocumentsPage({ data })).toEqual({
      documents: [{ id: "doc-2", raw: { id: "doc-2", title: "Loose" }, title: "Loose", tsIso: "", url: "" }],
    });
  });
});

describe("makeLinearApi users lane", () => {
  /** One request as the fake transport saw it. */
  interface SentQuery {
    readonly variables: Record<string, unknown>;
  }

  /** A transport that answers every request with one payload, recording the variables it was sent. */
  function recordingRequest({ sent, data }: { sent: SentQuery[]; data: unknown }): LinearRequest {
    return async ({ variables }) => {
      sent.push({ variables });
      return data;
    };
  }

  it("clamps an oversized page size to 25 and sends the archived, disabled and after variables", async () => {
    const sent: SentQuery[] = [];
    const data = connection({
      key: "users",
      nodes: [{ id: "u1", name: "Ada" }],
      pageInfo: { endCursor: "u-next", hasNextPage: true },
    });
    const api = makeLinearApi({ request: recordingRequest({ data, sent }) });

    const page = await api.users({ cursor: "u-prev", pageSize: 100 });

    expect(sent).toEqual([{ variables: { after: "u-prev", first: 25, includeArchived: true, includeDisabled: true } }]);
    expect(page).toEqual({ nextCursor: "u-next", nodes: [{ id: "u1", name: "Ada" }] });
  });

  it("sends a smaller page size unchanged and no after key without a cursor", async () => {
    const sent: SentQuery[] = [];
    const api = makeLinearApi({ request: recordingRequest({ data: connection({ key: "users", nodes: [] }), sent }) });

    await api.users({ pageSize: 24 });

    expect(sent).toEqual([{ variables: { first: 24, includeArchived: true, includeDisabled: true } }]);
  });

  it("writes the reference pass's team list back onto a known user and leaves an unknown one untouched", async () => {
    const references: LinearReferences = {
      ...NO_REFERENCES,
      userTeams: new Map([["u1", [{ id: "team-1", key: "ENG" }]]]),
    };
    const data = connection({ key: "users", nodes: [{ id: "u1" }, { id: "u2" }] });
    const api = makeLinearApi({ references, request: recordingRequest({ data, sent: [] }) });

    expect(await api.users({})).toEqual({
      nodes: [{ id: "u1", teams: { nodes: [{ id: "team-1", key: "ENG" }] } }, { id: "u2" }],
    });
  });
});
