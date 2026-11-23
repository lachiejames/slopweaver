/*
 * The filter and facet SQL, rendered through drizzle's own pure dialect: no connection, and every value a
 * caller typed asserted as a bound parameter rather than as text in the statement.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { PersonMatch } from "../../../store/personMatch.js";
import { facetColumn, predicateFor } from "../../../store/predicates.js";
import { type StoreFacet, storeQuerySchema } from "../../../store/query.js";

const dialect = new PgDialect();

const render = ({ statement }: { statement: SQL }): { sql: string; params: unknown[] } => {
  const query = dialect.sqlToQuery(statement);
  return { params: [...query.params], sql: query.sql.replaceAll(/\s+/gu, " ").trim() };
};

const NOBODY = { people: [] };

const predicate = ({ input }: { input: Record<string, unknown> }): { sql: string; params: unknown[] } =>
  render({ statement: predicateFor({ query: storeQuerySchema.parse(input), scope: NOBODY })! });

const match = ({ id }: { id: string }): PersonMatch => ({
  person: {
    displayName: "Ada Example",
    email: "ada@acme.example",
    githubId: null,
    githubLogin: null,
    id,
    linearUserId: null,
    notionUserId: null,
    slackUserId: null,
  },
  sources: [],
  way: "display-name",
});

describe("predicateFor", () => {
  it("answers undefined for a query that filters nothing", () => {
    expect(predicateFor({ query: storeQuerySchema.parse({}), scope: NOBODY })).toBe(undefined);
  });

  it("filters on every resolved person's id, so one person spans platforms", () => {
    const statement = predicateFor({
      query: storeQuerySchema.parse({}),
      scope: { people: [match({ id: "person-1" }), match({ id: "person-2" })] },
    });
    const { sql, params } = render({ statement: statement! });
    expect(sql).toBe('"content"."author_id" in ($1, $2)');
    expect(params).toEqual(["person-1", "person-2"]);
  });

  it("binds a full-text search rather than interpolating it", () => {
    const { sql, params } = predicate({ input: { search: "deploy failure" } });
    expect(sql).toBe(`"content"."searchable" @@ websearch_to_tsquery('english', $1)`);
    expect(params).toEqual(["deploy failure"]);
  });

  it("escapes --contains so a literal wildcard searches for itself, against each indexed expression", () => {
    const { sql, params } = predicate({ input: { contains: "100%_" } });
    expect(sql).toBe(`("content"."body" ilike $1 or coalesce("content"."title", '') ilike $2)`);
    expect(params).toEqual(["%100\\%\\_%", "%100\\%\\_%"]);
  });

  it("hands --like the caller's own wildcards unchanged", () => {
    const { params } = predicate({ input: { like: "%100_%" } });
    expect(params).toEqual(["%100_%", "%100_%"]);
  });

  it("walks a thread up to its root and back down, with a cycle guard on both walks", () => {
    const { sql, params } = predicate({ input: { source: "slack", thread: "reply-42" } });
    expect(sql).toContain("with recursive ancestry as");
    expect(sql).toContain("cycle id set climbed using climb");
    expect(sql).toContain("cycle id set descended using fall");
    expect(sql).toContain("select id from descent union select id from ancestry");
    expect(params).toEqual(["slack", "slack", "reply-42"]);
  });

  it("names no thread clause without the source that makes an anchor unique", () => {
    expect(predicateFor({ query: storeQuerySchema.parse({ thread: "reply-42" }), scope: NOBODY })).toBe(undefined);
  });

  it("filters a per-source column through an EXISTS correlated on the side table's key", () => {
    const { sql, params } = predicate({ input: { channel: "C-FIXTURE" } });
    expect(sql).toContain('exists (select 1 from "content_slack" where "content_slack"."content_id" = "content"."id"');
    expect(sql).toContain('"content_slack"."channel_id" = $1 or "content_slack"."channel_name" = $2');
    expect(params).toEqual(["C-FIXTURE", "C-FIXTURE"]);
  });

  it("reads --state's source off another filter when no --source names it", () => {
    const { sql, params } = predicate({ input: { state: "Done", team: "ABC" } });
    expect(sql).toContain('"content_linear"."team" = $1');
    expect(sql).toContain('"content_linear"."state" = $2');
    expect(params).toEqual(["ABC", "Done"]);
  });

  it("tests github's state column when --source settles it", () => {
    const { sql, params } = predicate({ input: { source: "github", state: "open" } });
    expect(sql).toContain('"content_github"."state" = $2');
    expect(params).toEqual(["github", "open"]);
  });

  it("drops a --state nothing settles rather than guessing a source", () => {
    expect(predicateFor({ query: storeQuerySchema.parse({ state: "open" }), scope: NOBODY })).toBe(undefined);
  });
});

describe("facetColumn", () => {
  it.each<[StoreFacet, string]>([
    ["source", '"content"."source"::text'],
    ["kind", '"content"."kind"::text'],
    ["visibility", '"content"."visibility"::text'],
    ["day", `to_char("content"."occurred_at", 'YYYY-MM-DD')`],
    ["container", `coalesce("container"."native_id", '(none)')`],
    ["author", `coalesce("person"."display_name", "content"."author_native_id", '(none)')`],
    [
      "github.state",
      `coalesce((select "content_github"."state"::text from "content_github" where "content_github"."content_id" = "content"."id"), '(none)')`,
    ],
  ])("groups %s by its own expression", (facet, expected) => {
    expect(render({ statement: facetColumn({ facet }) }).sql).toBe(expected);
  });
});
