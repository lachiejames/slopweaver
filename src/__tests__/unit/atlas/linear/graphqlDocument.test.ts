import { describe, expect, it } from "vitest";

import { documentTextOf, resolveRootFields, UNRESOLVED } from "../../../../atlas/kit/graphqlDocument.js";

describe("resolveRootFields", () => {
  it("resolves a plain query's root field to its query-scoped provider key", () => {
    const resolved = resolveRootFields({ requestBody: JSON.stringify({ query: "query { issues { id } }" }) });
    expect(resolved.rootFields).toEqual(["query.issues"]);
    expect(resolved.keyToRootField.get("issues")).toBe("query.issues");
  });

  it("maps an ALIAS back to the schema field it stands for", () => {
    const resolved = resolveRootFields({
      requestBody: JSON.stringify({ query: "query { latest: issues { id } }" }),
    });
    expect(resolved.rootFields).toEqual(["query.issues"]);
    expect(resolved.keyToRootField.get("latest")).toBe("query.issues");
    expect(resolved.keyToRootField.get("issues")).toBe(undefined);
  });

  it("separates a mutation root from a query root of the same name", () => {
    const asQuery = resolveRootFields({ requestBody: { query: 'query { projectUpdate(id: "x") { id } }' } });
    const asMutation = resolveRootFields({
      requestBody: { query: 'mutation { projectUpdate(id: "x", input: {}) { success } }' },
    });
    expect(asQuery.rootFields).toEqual(["query.projectUpdate"]);
    expect(asMutation.rootFields).toEqual(["mutation.projectUpdate"]);
  });

  it("reads a subscription root as its own kind", () => {
    const resolved = resolveRootFields({ requestBody: { query: "subscription { issues { id } }" } });
    expect(resolved.rootFields).toEqual(["subscription.issues"]);
  });

  it("follows a fragment spread at the root selection set", () => {
    const resolved = resolveRootFields({
      requestBody: { query: "query { ...Roots }\nfragment Roots on Query { teams { id } organization { id } }" },
    });
    expect(resolved.rootFields).toEqual(["query.organization", "query.teams"]);
  });

  it("flattens an inline fragment at the root", () => {
    const resolved = resolveRootFields({
      requestBody: { query: "query { ... on Query { workflowStates { id } } }" },
    });
    expect(resolved.rootFields).toEqual(["query.workflowStates"]);
  });

  it("picks the operation the envelope NAMES when a document declares several", () => {
    const resolved = resolveRootFields({
      requestBody: {
        operationName: "Two",
        query: "query One { issues { id } } query Two { teams { id } }",
      },
    });
    expect(resolved.rootFields).toEqual(["query.teams"]);
  });

  it("takes every operation when the envelope names none", () => {
    const resolved = resolveRootFields({
      requestBody: { query: "query One { issues { id } } query Two { teams { id } }" },
    });
    expect(resolved.rootFields).toEqual(["query.issues", "query.teams"]);
  });

  it("refuses to attribute a persisted query, which carries no document", () => {
    const resolved = resolveRootFields({
      requestBody: JSON.stringify({ extensions: { persistedQuery: { sha256Hash: "abc" } } }),
    });
    expect(resolved).toBe(UNRESOLVED);
  });

  it("refuses to attribute a document that does not parse", () => {
    const resolved = resolveRootFields({ requestBody: { query: "query { unclosed" } });
    expect(resolved.rootFields).toEqual([]);
  });

  it("reads the first document out of a batched envelope array", () => {
    expect(documentTextOf({ requestBody: [{ operationName: "A" }, { query: "query { teams { id } }" }] })).toBe(
      "query { teams { id } }",
    );
  });

  it("has no document for an absent request body", () => {
    expect(documentTextOf({ requestBody: undefined })).toBe(null);
  });
});

describe("resolveRootFields over a RAW production envelope", () => {
  it("keeps operationName when the envelope arrives as a JSON string, as production sends it", () => {
    const resolved = resolveRootFields({
      requestBody: JSON.stringify({
        operationName: "One",
        query: "query One { x: teams { id } } query Two { x: issues { id } }",
      }),
    });
    expect(resolved.rootFields).toEqual(["query.teams"]);
    expect(resolved.keyToRootField.get("x")).toBe("query.teams");
  });

  it("does not let a second operation's alias overwrite the named operation's", () => {
    const resolved = resolveRootFields({
      requestBody: JSON.stringify({
        operationName: "Two",
        query: "query One { x: teams { id } } query Two { x: issues { id } }",
      }),
    });
    expect(resolved.keyToRootField.get("x")).toBe("query.issues");
  });
});
