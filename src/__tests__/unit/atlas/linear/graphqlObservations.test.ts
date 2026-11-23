import { describe, expect, it } from "vitest";

import {
  type CapturedGraphqlResponse,
  observationsFromResponses,
} from "../../../../atlas/linear/graphqlObservations.js";

const GRAPHQL_URL = "https://client-api.linear.app/graphql";

const exchange = ({
  query,
  data,
  url = GRAPHQL_URL,
}: {
  query?: string;
  data: unknown;
  url?: string;
}): CapturedGraphqlResponse => ({
  body: { data },
  url,
  ...(query === undefined ? {} : { requestBody: JSON.stringify({ query }) }),
});

describe("observationsFromResponses", () => {
  it("attributes a response to the root field the DOCUMENT selected", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({ data: { teams: { nodes: [{ key: "AAA" }] } }, query: "query { teams { nodes { key } } }" }),
      ],
    });
    expect(reduced.observations.map((observation) => observation.providerId)).toEqual(["query.teams"]);
  });

  it("resolves an ALIAS rather than reporting it as an undeclared field", () => {
    const reduced = observationsFromResponses({
      responses: [exchange({ data: { latest: { nodes: [] } }, query: "query { latest: teams { nodes { key } } }" })],
    });
    expect(reduced.observations.map((observation) => observation.providerId)).toEqual(["query.teams"]);
    expect(reduced.unexplainedKeys).toEqual([]);
  });

  it("records a response key no document explains, and attributes nothing from it", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({ data: { clientOnly: { x: 1 }, teams: { nodes: [] } }, query: "query { teams { nodes { key } } }" }),
      ],
    });
    expect(reduced.unexplainedKeys).toEqual(["clientOnly"]);
    expect(reduced.observations.map((observation) => observation.providerId)).toEqual(["query.teams"]);
  });

  it("counts a request with no document as unresolved rather than guessing a root field", () => {
    const reduced = observationsFromResponses({ responses: [exchange({ data: { teams: { nodes: [] } } })] });
    expect(reduced.unresolvedRequests).toBe(1);
    expect(reduced.observations).toEqual([]);
  });

  it("ignores a response that is not from the GraphQL endpoint", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({ data: { teams: {} }, query: "query { teams { id } }", url: "https://linear.app/assets/a.json" }),
      ],
    });
    expect(reduced.graphqlResponses).toBe(0);
    expect(reduced.observations).toEqual([]);
  });

  it("redacts a UUID used as a map key, so no workspace id is stored", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({
          data: { teams: { byId: { "3fa85f64-5717-4562-b3fc-2c963f66afa6": { key: "AAA" } } } },
          query: "query { teams { byId } }",
        }),
      ],
    });
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["byId", "byId.<id>", "byId.<id>.key"]);
  });

  it("collapses an array into one path however many elements it holds", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({
          data: { teams: { nodes: [{ key: "AAA" }, { key: "BBB" }, { key: "CCC" }] } },
          query: "query { teams { nodes { key } } }",
        }),
      ],
    });
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["nodes", "nodes[].key"]);
  });

  it("counts every exchange that carried the same root field", () => {
    const one = exchange({ data: { teams: { nodes: [] } }, query: "query { teams { nodes { key } } }" });
    const reduced = observationsFromResponses({ responses: [one, one, one] });
    expect(reduced.observations[0]!.detail.callCount).toBe(3);
  });

  it("keeps the total path count beside a capped list, so truncation says it is truncation", () => {
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`f${String(index)}`, index]));
    const reduced = observationsFromResponses({
      responses: [exchange({ data: { teams: wide }, query: "query { teams { id } }" })],
    });
    expect(reduced.observations[0]!.detail.responsePaths.length).toBe(400);
    expect(reduced.observations[0]!.detail.responsePathsTotal).toBe(500);
  });
});

describe("observationsFromResponses over NESTED aliases", () => {
  it("rewrites a nested alias back to the field the schema declares", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({
          data: { latest: { displayName: "Acme" } },
          query: "query { latest: organization { displayName: name } }",
        }),
      ],
    });
    expect(reduced.observations[0]!.providerId).toBe("query.organization");
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["name"]);
  });

  it("rewrites an alias inside a connection, keeping the array marker", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({
          data: { teams: { rows: [{ ident: "AAA" }] } },
          query: "query { teams { rows: nodes { ident: key } } }",
        }),
      ],
    });
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["nodes", "nodes[].key"]);
  });

  it("leaves an unaliased path exactly as the response spelled it", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({ data: { teams: { nodes: [{ key: "AAA" }] } }, query: "query { teams { nodes { key } } }" }),
      ],
    });
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["nodes", "nodes[].key"]);
  });
});

describe("observationsFromResponses over MERGED root selections", () => {
  it("keeps both selections' aliases when two root selections share one response key", () => {
    const reduced = observationsFromResponses({
      responses: [
        exchange({
          data: { latest: { first: "org-id", second: "Acme" } },
          query: "query { latest: organization { first: id } latest: organization { second: name } }",
        }),
      ],
    });
    expect(reduced.observations[0]!.providerId).toBe("query.organization");
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["id", "name"]);
  });
});

describe("observationsFromResponses over a root field returning a DIRECT list", () => {
  it("resolves a nested alias under a leading array marker", () => {
    const reduced = observationsFromResponses({
      responses: [exchange({ data: { templates: [{ ident: "t1" }] }, query: "query { templates { ident: id } }" })],
    });
    expect(reduced.observations[0]!.providerId).toBe("query.templates");
    expect(reduced.observations[0]!.detail.responsePaths).toEqual(["[].id"]);
  });
});
