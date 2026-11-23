/**
 * `storeTablePolicies` and the two named bot predicates: the row-level-security policies every store table
 * carries. Read through drizzle's own policy objects and rendered by the same `PgDialect.sqlToQuery`
 * drizzle-kit writes into a migration's `USING (…)`, so what is asserted is what the DDL would say. No database.
 */
import { type SQL, sql } from "drizzle-orm";
import { PgDialect, type PgPolicy, PgRole } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { botSeesEverything, botSeesPublicParent, storeTablePolicies } from "../../../../store/schema/rls.js";

const dialect = new PgDialect();

/**
 * One SQL fragment as a migration would render it, or `null` where the policy declares none.
 *
 * @returns the rendered SQL and its parameters
 */
function rendered({ expression }: { expression: SQL | undefined }): { sql: string; params: unknown[] } | null {
  if (expression === undefined) {
    return null;
  }
  const query = dialect.sqlToQuery(expression);
  return { params: query.params, sql: query.sql };
}

/**
 * The role a policy is granted to, refusing anything that is not a declared drizzle role.
 *
 * @returns the role's name
 */
function roleNameOf({ to }: { to: PgPolicy["to"] }): string {
  if (to instanceof PgRole) {
    return to.name;
  }
  throw new Error("policy is not granted to a declared PgRole");
}

/**
 * Everything a migration would emit for one policy.
 *
 * @returns the policy's projection
 */
function projected({ policy }: { policy: PgPolicy }): Record<string, unknown> {
  return {
    as: policy.as,
    for: policy.for,
    name: policy.name,
    to: roleNameOf({ to: policy.to }),
    using: rendered({ expression: policy.using }),
    withCheck: rendered({ expression: policy.withCheck }),
  };
}

describe("storeTablePolicies", () => {
  it("builds the owner, agent and bot policies in that order, with only the bot's predicate taken from the caller", () => {
    const policies = storeTablePolicies({ botRead: sql`visibility = 'public'`, table: "content" });

    expect(policies.map((policy) => projected({ policy }))).toEqual([
      {
        as: "permissive",
        for: "all",
        name: "content_owner_all",
        to: "slopweaver_owner",
        using: { params: [], sql: "true" },
        withCheck: { params: [], sql: "true" },
      },
      {
        as: "permissive",
        for: "select",
        name: "content_agent_read",
        to: "slopweaver_agent",
        using: { params: [], sql: "true" },
        withCheck: null,
      },
      {
        as: "permissive",
        for: "select",
        name: "content_bot_read",
        to: "slopweaver_bot",
        using: { params: [], sql: "visibility = 'public'" },
        withCheck: null,
      },
    ]);
  });

  it("interpolates the table name verbatim into all three policy names", () => {
    const policies = storeTablePolicies({ botRead: sql`false`, table: "door_ledger" });

    expect(policies.map((policy) => policy.name)).toEqual([
      "door_ledger_owner_all",
      "door_ledger_agent_read",
      "door_ledger_bot_read",
    ]);
  });

  it("hands the bot policy the very predicate object it was given", () => {
    const botRead = botSeesPublicParent();
    const policies = storeTablePolicies({ botRead, table: "content_slack" });

    expect(policies[2]!.using).toBe(botRead);
  });
});

describe("botSeesEverything", () => {
  it("renders exactly `true`, with no parameters", () => {
    expect(rendered({ expression: botSeesEverything() })).toEqual({ params: [], sql: "true" });
  });
});

describe("botSeesPublicParent", () => {
  it("renders the correlated exists over the public parent content row, with no parameters", () => {
    expect(rendered({ expression: botSeesPublicParent() })).toEqual({
      params: [],
      sql: "exists (select 1 from content c where c.id = content_id and c.visibility = 'public')",
    });
  });
});
