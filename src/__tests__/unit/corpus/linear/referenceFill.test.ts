/*
 * The reference pass's cache FILL: a reference the index does not hold is fetched once, in one filtered
 * request, and folded into the same cache; a crawl with no reference pass asks nothing; a failed fill warns.
 *
 * The request is a plain fake function passed in, never a mock, recording what it was asked.
 */
import { describe, expect, it } from "vitest";

import type { LinearNameCache, LinearRef, LinearRefKind } from "../../../../corpus/linear/names.js";
import { fillReferences } from "../../../../corpus/linear/referenceFill.js";
import { type LinearReferences, NO_REFERENCES } from "../../../../corpus/linear/references.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";

/** A reference pass that ran, over a cache holding one team and no issues. */
function referencesWithTeam(): LinearReferences {
  const cache: LinearNameCache = new Map<LinearRefKind, Map<string, LinearRef>>([
    ["team", new Map<string, LinearRef>([["t1", { id: "t1", key: "ENG", name: "Engineering" }]])],
  ]);
  return {
    cache,
    index: cache,
    initiativeProjects: new Map<string, readonly LinearRef[]>(),
    issueRelations: new Map<string, readonly unknown[]>(),
    projectInitiatives: new Map<string, readonly LinearRef[]>(),
    resolves: true,
    userTeams: new Map<string, readonly LinearRef[]>(),
  };
}

/** Two page nodes naming the SAME issue the cache does not know. */
const NODES: readonly unknown[] = [
  { id: "n1", issue: { id: "i1" } },
  { id: "n2", issue: { id: "i1" } },
];

const SPEC: Readonly<Record<string, LinearRefKind>> = { issue: "issue" };

describe("fillReferences", () => {
  it("asks ONE filtered request for a missing id two nodes share, and caches its derived identifier", async () => {
    const asked: Record<string, unknown>[] = [];
    const request: LinearRequest = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve({ issues: { nodes: [{ id: "i1", number: 42, team: { id: "t1" } }] } });
    };
    const references = referencesWithTeam();
    const warnings: string[] = [];

    await fillReferences({ nodes: NODES, references, request, spec: SPEC, warnings });

    expect(asked).toEqual([{ filter: { id: { in: ["i1"] } }, first: 1, includeArchived: true }]);
    expect(references.cache.get("issue")!.get("i1")).toEqual({ id: "i1", identifier: "ENG-42" });
    expect(warnings).toEqual([]);
  });

  it("asks nothing at all when the id is already cached", async () => {
    const asked: Record<string, unknown>[] = [];
    const request: LinearRequest = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve({});
    };
    const references = referencesWithTeam();
    references.cache.set("issue", new Map<string, LinearRef>([["i1", { id: "i1", identifier: "ENG-42" }]]));

    await fillReferences({ nodes: NODES, references, request, spec: SPEC, warnings: [] });

    expect(asked).toEqual([]);
  });

  it("asks nothing when no reference pass ran, so every node stays as Linear sent it", async () => {
    const asked: Record<string, unknown>[] = [];
    const request: LinearRequest = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve({});
    };
    const warnings: string[] = [];

    await fillReferences({ nodes: NODES, references: NO_REFERENCES, request, spec: SPEC, warnings });

    expect(asked).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("WARNS and carries on when the fill request fails, because a miss is never fatal", async () => {
    const request: LinearRequest = () => Promise.reject(new Error("offline"));
    const warnings: string[] = [];

    await fillReferences({ nodes: NODES, references: referencesWithTeam(), request, spec: SPEC, warnings });

    expect(warnings).toEqual([
      "linear issue reference fill failed for 1 id(s), so their names will not resolve: offline",
    ]);
  });
});
