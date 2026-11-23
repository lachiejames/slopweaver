/**
 * The refusals that keep a per-source filter from returning an empty result set instead of an answer.
 *
 * A per-source column belongs to exactly one source, so `--source slack --repo o/r` can only ever match
 * nothing — and an empty answer is indistinguishable from "we have no Slack", which is the failure the
 * whole query layer exists to end. Every case below is refused BEFORE a connection opens, so none of them
 * needs a database.
 */
import { describe, expect, it } from "vitest";

import { STORE_QUESTION_FILTERS, selectedBy, storeQueryInput } from "../../../cli/commands/store/shell.js";
import {
  ALL_STORE_FACETS,
  isStoreFacet,
  parseStoreQuery,
  sourceForQuery,
  TEXT_PREDICATES,
  textPredicateConflict,
} from "../../../store/query.js";

/** Parse an input the way the CLI does, so a test never hand-builds the validated shape. */
const query = (input: Record<string, unknown>): ReturnType<typeof parseStoreQuery> => parseStoreQuery({ input });

/** The validated query for an input the schema accepts. */
const valid = (input: Record<string, unknown>): Parameters<typeof sourceForQuery>[0]["query"] => {
  const parsed = query(input);
  if ("errors" in parsed) {
    throw new Error(parsed.errors.join("; "));
  }
  return parsed.query;
};

describe("a query naming one source's columns names that source's table", () => {
  it("resolves a channel filter to slack", () => {
    expect(sourceForQuery({ query: valid({ channel: "C1" }) })).toEqual({ source: "slack" });
  });

  it("resolves a repo filter to github", () => {
    expect(sourceForQuery({ query: valid({ repo: "o/r" }) })).toEqual({ source: "github" });
  });

  it("resolves a namespaced facet to its own source", () => {
    expect(sourceForQuery({ facet: "linear.team", query: valid({}) })).toEqual({ source: "linear" });
  });

  it("needs no table for a query that names none", () => {
    expect(sourceForQuery({ query: valid({ search: "staging" }) })).toEqual({ source: null });
  });

  it("accepts a filter that agrees with an explicit source", () => {
    expect(sourceForQuery({ query: valid({ channel: "C1", source: "slack" }) })).toEqual({ source: "slack" });
  });
});

describe("a query naming two sources' columns is refused rather than answered", () => {
  it("refuses a github filter under an explicit slack source", () => {
    const refused = sourceForQuery({ query: valid({ repo: "o/r", source: "slack" }) });
    expect("errors" in refused ? refused.errors[0] : "").toContain("--source slack was given");
  });

  it("refuses a github filter beside a linear facet", () => {
    const refused = sourceForQuery({ facet: "linear.team", query: valid({ repo: "o/r" }) });
    expect("errors" in refused ? refused.errors[0] : "").toContain("a query may name one source's columns");
  });

  it("names both sources in the refusal, so the fix is in the message", () => {
    const refused = sourceForQuery({ facet: "linear.team", query: valid({ repo: "o/r" }) });
    expect("errors" in refused ? refused.errors[0] : "").toContain("(linear)");
  });

  it("lists every flag that reached one source, in the order each was noted", () => {
    expect(sourceForQuery({ facet: "linear.team", query: valid({ assignee: "ana", repo: "o/r" }) })).toEqual({
      errors: [
        "a query may name one source's columns, and this one names --assignee, --facet linear.team (linear) and --repo (github)",
      ],
    });
  });

  it("names both of one source's flags when an explicit source disagrees with them", () => {
    expect(sourceForQuery({ query: valid({ assignee: "ana", source: "slack", team: "ENG" }) })).toEqual({
      errors: ["--assignee, --team is a linear filter, but --source slack was given"],
    });
  });
});

describe("state belongs to two sources, so it needs one named", () => {
  it("refuses a bare state filter", () => {
    const refused = sourceForQuery({ query: valid({ state: "open" }) });
    expect("errors" in refused ? refused.errors[0] : "").toContain("belongs to both github and linear");
  });

  it("accepts it under an explicit source", () => {
    expect(sourceForQuery({ query: valid({ source: "github", state: "open" }) })).toEqual({ source: null });
  });

  it("accepts it beside another filter that settles the source", () => {
    expect(sourceForQuery({ query: valid({ repo: "o/r", state: "open" }) })).toEqual({ source: "github" });
  });

  it("accepts it beside a facet that settles the source", () => {
    expect(sourceForQuery({ facet: "linear.state", query: valid({ state: "Done" }) })).toEqual({ source: "linear" });
  });
});

describe("the facet vocabulary", () => {
  it("carries the source-neutral facets and the per-source ones together", () => {
    expect([...ALL_STORE_FACETS]).toEqual([
      "source",
      "kind",
      "container",
      "author",
      "visibility",
      "day",
      "github.repo",
      "github.state",
      "linear.assignee",
      "linear.project",
      "linear.state",
      "linear.team",
      "notion.parent",
      "slack.channel",
      "slack.subtype",
    ]);
  });

  it("accepts a namespaced facet", () => {
    expect(isStoreFacet("slack.channel")).toBe(true);
  });

  it("refuses a bare column name that only exists under a namespace", () => {
    expect(isStoreFacet("channel")).toBe(false);
  });

  it("refuses a facet over an unindexed column", () => {
    expect(isStoreFacet("body")).toBe(false);
  });
});

describe("the three text predicates are alternatives, not filters that compose", () => {
  it("accepts each one on its own", () => {
    expect(textPredicateConflict({ query: valid({ search: "staging pool" }) })).toEqual([]);
    expect(textPredicateConflict({ query: valid({ contains: "17000" }) })).toEqual([]);
    expect(textPredicateConflict({ query: valid({ like: "%staging%" }) })).toEqual([]);
  });

  it("accepts a query naming none of them", () => {
    expect(textPredicateConflict({ query: valid({ source: "slack" }) })).toEqual([]);
  });

  it("refuses two, naming both flags and what each one matches", () => {
    expect(textPredicateConflict({ query: valid({ contains: "17000", search: "staging" }) })).toEqual([
      "a query may name one text predicate, and this one names --search and --contains — " +
        "--search matches stemmed words, --contains matches literal characters, --like takes your own pattern",
    ]);
  });

  it("refuses all three in the declared order, whatever order the caller wrote them", () => {
    const refusal = textPredicateConflict({ query: valid({ contains: "b", like: "%c%", search: "a" }) });
    expect(refusal).toEqual([
      "a query may name one text predicate, and this one names --search and --contains and --like — " +
        "--search matches stemmed words, --contains matches literal characters, --like takes your own pattern",
    ]);
  });

  it("declares exactly the three predicates the schema carries, so a fourth cannot be enforced in one place", () => {
    expect([...TEXT_PREDICATES]).toEqual(["search", "contains", "like"]);
  });
});

describe("the shells default `search` from the question only when no predicate was named", () => {
  const fold = (values: Record<string, string | boolean>): Record<string, unknown> =>
    storeQueryInput({ filters: STORE_QUESTION_FILTERS, limit: 12, question: "why did the pool exhaust", values });

  it("uses the question as the search term when the caller named nothing", () => {
    expect(fold({})["search"]).toBe("why did the pool exhaust");
  });

  it("uses an explicit --search over the question", () => {
    expect(fold({ search: "pool" })["search"]).toBe("pool");
  });

  it("leaves search ABSENT under --contains, so the question does not become a second predicate", () => {
    const folded = fold({ contains: "17000" });
    expect(folded["search"]).toBe(undefined);
    expect(folded["contains"]).toBe("17000");
    expect(textPredicateConflict({ query: valid(folded) })).toEqual([]);
  });

  it("leaves search ABSENT under --like too", () => {
    const folded = fold({ like: "%17000%" });
    expect(folded["search"]).toBe(undefined);
    expect(folded["like"]).toBe("%17000%");
    expect(textPredicateConflict({ query: valid(folded) })).toEqual([]);
  });

  it("still refuses when the caller names two of them explicitly", () => {
    const folded = fold({ contains: "17000", search: "pool" });
    expect(textPredicateConflict({ query: valid(folded) }).length).toBe(1);
  });
});

describe("the selection report names WHICH predicate selected the candidates", () => {
  it("names full text for a search, quoting the terms the question became", () => {
    expect(selectedBy({ query: valid({ search: "staging pool" }) })).toBe("full text: staging pool");
  });

  it("names the literal substring for a contains, never 'full text'", () => {
    expect(selectedBy({ query: valid({ contains: "17000" }) })).toBe("literal substring: 17000");
  });

  it("names the pattern for a like", () => {
    expect(selectedBy({ query: valid({ like: "%staging%" }) })).toBe("pattern: %staging%");
  });

  // Before the two substring predicates existed, `search` was the only text filter and a bare `store query`
  // reached this line with it absent, printing the word `undefined` as the terms it had used.
  it("says the structured filters alone selected them when no predicate ran", () => {
    expect(selectedBy({ query: valid({ source: "slack" }) })).toBe(
      "no text predicate — the structured filters alone selected these",
    );
  });
});
