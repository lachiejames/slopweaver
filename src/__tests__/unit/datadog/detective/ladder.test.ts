import { describe, expect, it } from "vitest";

import {
  DATADOG_RUNGS,
  datadogQuery,
  datadogRungQuery,
  envClause,
  escapeDatadogTerm,
} from "../../../../datadog/detective/ladder.js";

describe("escapeDatadogTerm — a reserved character silently searches for something else", () => {
  it("escapes a colon, which would otherwise read as a facet", () => {
    expect(escapeDatadogTerm({ term: "a:b" })).toBe("a\\:b");
  });

  it("escapes a wildcard the caller typed literally", () => {
    expect(escapeDatadogTerm({ term: "a*b" })).toBe("a\\*b");
  });

  it("leaves a plain keyword alone", () => {
    expect(escapeDatadogTerm({ term: "Knock" })).toBe("Knock");
  });
});

describe("datadogRungQuery — the four rungs, and what whitespace forces", () => {
  it("builds the bare term rung", () => {
    expect(datadogRungQuery({ rung: "term", term: "Knock" })).toBe("Knock");
  });

  it("builds the all-fields rung, which is the one that cuts", () => {
    expect(datadogRungQuery({ rung: "all-fields", term: "Knock" })).toBe("*:Knock*");
  });

  it("builds the widest rung", () => {
    expect(datadogRungQuery({ rung: "all-fields-wild", term: "Knock" })).toBe("*:*Knock*");
  });

  it("collapses every rung to one quoted phrase when the term carries whitespace", () => {
    const queries = DATADOG_RUNGS.map((rung) => datadogRungQuery({ rung, term: "push token" }));
    expect(queries).toEqual(['"push token"', '"push token"', '"push token"', '"push token"']);
  });

  it("strips a quote out of a phrase rather than emitting an unbalanced one", () => {
    expect(datadogRungQuery({ rung: "term", term: 'a" b' })).toBe('"a b"');
  });
});

describe("envClause — no clause is every environment, by the owner's standing ruling", () => {
  it("emits nothing for an empty list", () => {
    expect(envClause({ envs: [] })).toBe(null);
  });

  it("emits a bare clause for one environment", () => {
    expect(envClause({ envs: ["staging"] })).toBe("env:staging");
  });

  it("emits an OR group for several", () => {
    expect(envClause({ envs: ["prod", "production"] })).toBe("env:(prod OR production)");
  });

  it("drops the absent-env bucket from the clause, because no query can express it", () => {
    expect(envClause({ envs: ["(none)"] })).toBe(null);
  });
});

describe("datadogQuery — the env narrowing, the caller's clause, then the rung", () => {
  it("emits only the rung when nothing narrows it", () => {
    expect(datadogQuery({ envs: [], rung: "term", term: "Knock" })).toBe("Knock");
  });

  it("puts the env and the extra clause before the rung", () => {
    expect(
      datadogQuery({ envs: ["production"], extra: "service:checkout-api", rung: "all-fields", term: "Knock" }),
    ).toBe("env:production service:checkout-api *:Knock*");
  });

  it("ignores an empty extra clause rather than emitting a double space", () => {
    expect(datadogQuery({ envs: [], extra: "", rung: "term", term: "Knock" })).toBe("Knock");
  });
});
