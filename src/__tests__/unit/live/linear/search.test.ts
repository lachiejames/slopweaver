import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../live/linear/errors.js";
import {
  type LinearSearchDocument,
  renderLinearSearchJson,
  renderLinearSearchText,
  searchLinear,
} from "../../../../live/linear/search.js";

const NOW = "2026-08-10T12:00:00.000Z";

describe("searchLinear", () => {
  it("issues one issue search and one project search, and merges both result sets", async () => {
    const requests: unknown[] = [];
    const result = await searchLinear({
      limit: 10,
      nowIso: () => NOW,
      request: ({ query, variables }) => {
        requests.push({ query: query.includes("query searchIssues"), variables });
        if (query.includes("query searchIssues")) {
          return Promise.resolve(
            ok({
              searchIssues: {
                nodes: [
                  { id: "i1", identifier: "AIL-9", title: "Fix the pool", url: "https://linear.app/acme/issue/AIL-9" },
                ],
              },
            }),
          );
        }
        return Promise.resolve(
          ok({
            searchProjects: { nodes: [{ id: "p1", name: "Pool rewrite", url: "https://linear.app/acme/project/p1" }] },
          }),
        );
      },
      term: "pool",
    });

    expect(requests).toEqual([
      { query: true, variables: { first: 10, term: "pool" } },
      { query: false, variables: { first: 10, term: "pool" } },
    ]);
    expect(unwrap(result)).toEqual({
      readAtIso: NOW,
      results: [
        {
          id: "i1",
          identifier: "AIL-9",
          kind: "issue",
          title: "Fix the pool",
          url: "https://linear.app/acme/issue/AIL-9",
        },
        {
          id: "p1",
          identifier: undefined,
          kind: "project",
          title: "Pool rewrite",
          url: "https://linear.app/acme/project/p1",
        },
      ],
      source: "linear",
      term: "pool",
    });
  });

  it("returns no results as a normal, non-error outcome", async () => {
    const result = await searchLinear({
      limit: 10,
      nowIso: () => NOW,
      request: () => Promise.resolve(ok({})),
      term: "nothing-matches-this",
    });

    expect(unwrap(result).results).toEqual([]);
  });

  it("drops a returned node missing an id, title or url instead of throwing", async () => {
    const result = await searchLinear({
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          query.includes("query searchIssues")
            ? ok({ searchIssues: { nodes: [{ id: "i1", title: "No url here" }] } })
            : ok({}),
        ),
      term: "x",
    });

    expect(unwrap(result).results).toEqual([]);
  });

  it("propagates a failed issue search instead of merging in whatever the project search returned", async () => {
    const result = await searchLinear({
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          query.includes("query searchIssues")
            ? err(LinearLiveErrors.searchFailed({ message: "rate limited" }))
            : ok({}),
        ),
      term: "x",
    });

    expect(unwrapErr(result)).toEqual(LinearLiveErrors.searchFailed({ message: "rate limited" }));
  });
});

describe("rendering a search document", () => {
  const document: LinearSearchDocument = {
    readAtIso: NOW,
    results: [
      {
        id: "i1",
        identifier: "AIL-9",
        kind: "issue",
        title: "Fix the pool",
        url: "https://linear.app/acme/issue/AIL-9",
      },
      {
        id: "p1",
        identifier: undefined,
        kind: "project",
        title: "Pool rewrite",
        url: "https://linear.app/acme/project/p1",
      },
    ],
    source: "linear",
    term: "pool",
  };

  it("keeps every match in both machine and human forms", () => {
    expect(JSON.parse(renderLinearSearchJson({ document }))).toEqual(document);
    expect(renderLinearSearchText({ document })).toBe(
      'linear search: "pool" — 2 match(es)\n' +
        `read at: ${NOW}\n` +
        "  issue    AIL-9  Fix the pool  https://linear.app/acme/issue/AIL-9\n" +
        "  project  p1  Pool rewrite  https://linear.app/acme/project/p1",
    );
  });

  it("states plainly when nothing matched", () => {
    const empty: LinearSearchDocument = { readAtIso: NOW, results: [], source: "linear", term: "nope" };
    expect(renderLinearSearchText({ document: empty })).toBe(
      `linear search: "nope" — no matching issue or project\nread at: ${NOW}`,
    );
  });
});
