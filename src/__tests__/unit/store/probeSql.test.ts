import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { hitsStatement } from "../../../store/probe/hits.js";
import {
  botFilter,
  exactCountsStatement,
  ladderCountsStatement,
  regexCountsStatement,
  shapeIdsStatement,
  shapePredicate,
  TERM_SHAPES,
} from "../../../store/probe/sql.js";

/**
 * Render a statement the way the driver would.
 *
 * `PgDialect` is drizzle's own pure renderer — it holds no connection and reaches nothing — so this is a
 * unit test of the SQL rather than an integration test that happens not to connect.
 */
const dialect = new PgDialect();
const render = ({
  statement,
}: {
  statement: ReturnType<typeof exactCountsStatement>;
}): { sql: string; params: unknown[] } => {
  const query = dialect.sqlToQuery(statement);
  return { params: [...query.params], sql: query.sql.replaceAll(/\s+/gu, " ").trim() };
};

describe("the ladder statement", () => {
  it("narrows on the two INDEXED expressions, never on their concatenation", () => {
    const { sql } = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    expect(sql).toContain("where (body ilike $1 or coalesce(title, '') ilike $2)");
    expect(sql).not.toContain("where (coalesce(title, '') || ' ' || body ilike");
  });

  it("projects the two fields separately, never concatenated into one haystack", () => {
    const { sql } = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    expect(sql).toContain("select source, coalesce(title, '') as title, body");
    expect(sql).not.toContain("as hay");
  });

  it("counts all five substring shapes over ONE narrowing scan", () => {
    const { sql } = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    expect(sql).toContain('count(*)::bigint as "wild-both"');
    expect(sql).toContain("count(*) filter (where (coalesce(title, '') ~* $3 or body ~* $4))::bigint as \"wild-left\"");
    expect(sql).toContain(
      "count(*) filter (where (coalesce(title, '') ~* $5 or body ~* $6))::bigint as \"wild-right\"",
    );
    expect(sql).toContain("count(*) filter (where (coalesce(title, '') ~* $7 or body ~* $8))::bigint as \"alnum\"");
    expect(sql).toContain("count(*) filter (where (coalesce(title, '') ~* $9 or body ~* $10))::bigint as \"slash\"");
  });

  // The defect this asserts against: the counts once ran over `coalesce(title,'') || ' ' || body` while
  // `shapeIdsStatement` ran over the two fields separately, so a multi-word keyword could match across the
  // seam the concatenation invented and report a count whose `store hits` came back empty. Reproduce the seam with title `foo`, body `bar foo barx`, keyword `foo bar`.
  it("counts a shape with the SAME predicate the id fetch selects it with", () => {
    const counts = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    const ids = render({
      statement: shapeIdsStatement({
        includeBots: true,
        limit: 5,
        shape: "wild-left",
        source: undefined,
        term: "barten",
      }),
    });
    expect(ids.sql).toContain("where (coalesce(title, '') ~* $1 or body ~* $2)");
    expect(counts.sql).toContain("(coalesce(title, '') ~* $3 or body ~* $4)");
    expect(counts.params[2]).toBe(ids.params[0]);
    expect(counts.params[3]).toBe(ids.params[1]);
  });

  it("binds the containment pattern and every shape regex as parameters, never as text", () => {
    const { params } = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    expect(params).toEqual([
      "%barten%",
      "%barten%",
      "barten\\M",
      "barten\\M",
      "\\mbarten",
      "\\mbarten",
      "\\m[0-9a-z]*barten[0-9a-z]*\\M",
      "\\m[0-9a-z]*barten[0-9a-z]*\\M",
      "/[^/[:space:]]*barten[^/[:space:]]*(/|\\M)",
      "/[^/[:space:]]*barten[^/[:space:]]*(/|\\M)",
    ]);
  });

  it("escapes a keyword carrying a LIKE wildcard before it reaches the pattern", () => {
    const { params } = render({
      statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "100%" }),
    });
    expect(params[0]).toBe("%100\\%%");
  });

  it("adds no clause and no parameter at all when the probe is unrestricted", () => {
    const { sql, params } = render({
      statement: exactCountsStatement({ includeBots: true, source: undefined, term: "barten" }),
    });
    expect(params).toEqual(["barten"]);
    expect(sql).toBe(
      "select source::text as source, count(*)::bigint as rows from content where searchable @@ plainto_tsquery('english', $1) group by source",
    );
  });

  it("binds the source as a second parameter when the probe is restricted", () => {
    const { sql, params } = render({
      statement: exactCountsStatement({ includeBots: true, source: "github", term: "barten" }),
    });
    expect(params).toEqual(["barten", "github"]);
    expect(sql).toContain("and source = $2");
  });
});

describe("shapePredicate", () => {
  it("reaches the tsvector for exact", () => {
    const { sql } = render({ statement: shapePredicate({ shape: "exact", term: "barten" }) });
    expect(sql).toBe("searchable @@ plainto_tsquery('english', $1)");
  });

  // `or` short-circuits and `title` is a line where `body` can be thousands of characters, so the short
  // field is tested first. MEASURED over a million-row `datadog` containment set:
  // title-first took a bit over half the time body-first did, same count. Reproduce with `store probe datadog`.
  it("tests the SHORT field first in every two-field shape, so the long one is skipped on a hit", () => {
    const shapes = TERM_SHAPES.filter((shape) => shape !== "exact");
    const rendered = shapes.map((shape) => render({ statement: shapePredicate({ shape, term: "barten" }) }).sql);
    expect(rendered.every((sql) => sql.startsWith("(coalesce(title, '')"))).toBe(true);
    expect(rendered.some((sql) => sql.startsWith("(body"))).toBe(false);
  });

  it("reaches ILIKE for wild-both, which the planner serves from the trigram index", () => {
    const { sql } = render({ statement: shapePredicate({ shape: "wild-both", term: "barten" }) });
    expect(sql).toBe("(coalesce(title, '') ilike $1 or body ilike $2)");
  });

  it("passes the caller's own regex through without escaping it — that is the point of the shape", () => {
    const { params } = render({ statement: shapePredicate({ shape: "regex", term: "pull/1[0-9]{4}" }) });
    expect(params).toEqual(["pull/1[0-9]{4}", "pull/1[0-9]{4}"]);
  });

  it("qualifies every column when a joining statement asks it to", () => {
    const { sql } = render({ statement: shapePredicate({ qualified: true, shape: "alnum", term: "barten" }) });
    expect(sql).toBe("(coalesce(content.title, '') ~* $1 or content.body ~* $2)");
  });

  it("builds a predicate for every shape the ladder reports", () => {
    const rendered = TERM_SHAPES.map((shape) => render({ statement: shapePredicate({ shape, term: "x" }) }).sql);
    expect(rendered.filter((sql) => sql.length > 0)).toHaveLength(TERM_SHAPES.length);
  });
});

describe("shapeIdsStatement", () => {
  it("orders newest first and binds its own limit", () => {
    const { sql, params } = render({
      statement: shapeIdsStatement({ includeBots: true, limit: 10, shape: "slash", source: undefined, term: "17000" }),
    });
    expect(sql).toContain("order by occurred_at desc limit $3");
    expect(params[2]).toBe(10);
  });
});

describe("regexCountsStatement", () => {
  it("matches case-insensitively against body and title alike", () => {
    const { sql } = render({
      statement: regexCountsStatement({ includeBots: true, pattern: "pull/17000", source: undefined }),
    });
    expect(sql).toContain("where (coalesce(title, '') ~* $1 or body ~* $2)");
  });
});

// The search rungs start human-only, the way Slack search leaves automations out.
describe("the human-only default", () => {
  it("counts the containment set less its bot rows, and every shape the same way", () => {
    const { sql } = render({ statement: ladderCountsStatement({ includeBots: false, source: undefined, term: "x" }) });
    expect(sql).toContain('count(*) filter (where not author_is_bot)::bigint as "wild-both"');
    expect(sql).toContain(
      "count(*) filter (where not author_is_bot and (coalesce(title, '') ~* $3 or body ~* $4))::bigint as \"wild-left\"",
    );
    expect(sql).toContain(
      "count(*) filter (where not author_is_bot and (coalesce(title, '') ~* $9 or body ~* $10))::bigint as \"slash\"",
    );
  });

  it("keeps the bot filter OUT of the narrowing clause, so the trigram scan is the one it always was", () => {
    const { sql } = render({ statement: ladderCountsStatement({ includeBots: false, source: undefined, term: "x" }) });
    expect(sql).toContain("where (body ilike $1 or coalesce(title, '') ilike $2) )");
  });

  it("counts the bot rows it left out from the same scan, widened or not", () => {
    const human = render({ statement: ladderCountsStatement({ includeBots: false, source: undefined, term: "x" }) });
    const every = render({ statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "x" }) });
    expect(human.sql).toContain('count(*) filter (where author_is_bot)::bigint as "bots"');
    expect(every.sql).toContain('count(*) filter (where author_is_bot)::bigint as "bots"');
  });

  it("widened, counts exactly what the ladder counted before the column existed", () => {
    const { sql } = render({ statement: ladderCountsStatement({ includeBots: true, source: undefined, term: "x" }) });
    expect(sql).toContain('count(*)::bigint as "wild-both"');
    expect(sql.match(/not author_is_bot/gu)).toBe(null);
  });

  it("drops bot rows from the exact count after the tsvector match", () => {
    const { sql } = render({ statement: exactCountsStatement({ includeBots: false, source: "slack", term: "x" }) });
    expect(sql).toBe(
      "select source::text as source, count(*)::bigint as rows from content where searchable @@ plainto_tsquery('english', $1) and source = $2 and not author_is_bot group by source",
    );
  });

  it("counts a regex's human matches and its bot matches separately", () => {
    const { sql } = render({
      statement: regexCountsStatement({ includeBots: false, pattern: "p", source: undefined }),
    });
    expect(sql).toContain("count(*) filter (where not author_is_bot)::bigint as rows");
    expect(sql).toContain('count(*) filter (where author_is_bot)::bigint as "bots"');
  });

  it("lists only human-authored ids, so an enumerated cell's ids match its count", () => {
    const { sql } = render({
      statement: shapeIdsStatement({ includeBots: false, limit: 5, shape: "exact", source: undefined, term: "x" }),
    });
    expect(sql).toContain("and not author_is_bot order by occurred_at desc");
  });
});

describe("hitsStatement — the one search rung among the reading rungs", () => {
  const page = { limit: 25, offset: 50, shape: "exact" as const, source: "slack", term: "renovate" };

  it("drops bot-authored rows by default, after the shape and source narrowing", () => {
    const { sql, params } = render({ statement: hitsStatement({ ...page, includeBots: false }) });
    expect(sql).toContain("and content.source = $2 and not content.author_is_bot order by content.occurred_at desc");
    expect(params).toEqual(["renovate", "slack", 25, 50]);
  });

  it("widened, carries no bot predicate at all", () => {
    const { sql } = render({ statement: hitsStatement({ ...page, includeBots: true }) });
    expect(sql).toContain("and content.source = $2 order by content.occurred_at desc");
    expect(sql.match(/author_is_bot/gu)).toBe(null);
  });

  it("orders totally, breaking an occurred_at tie on the id, so offset pages neither skip nor repeat a row", () => {
    const { sql } = render({ statement: hitsStatement({ ...page, includeBots: false }) });
    expect(sql).toContain("order by content.occurred_at desc, content.id desc limit $3 offset $4");
  });
});

describe("botFilter", () => {
  it("qualifies the column for a statement that joins", () => {
    expect(render({ statement: botFilter({ includeBots: false, qualified: true }) }).sql).toBe(
      "and not content.author_is_bot",
    );
  });

  it("is an empty fragment once the caller widens", () => {
    expect(render({ statement: botFilter({ includeBots: true, qualified: true }) }).sql).toBe("");
  });
});
