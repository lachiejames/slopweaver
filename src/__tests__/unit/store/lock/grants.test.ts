/**
 * The API roles' stray table rights: the revoke statements, the queries' coverage, and how the read-back is worded.
 */
import { describe, expect, it } from "vitest";

import {
  API_ROLES,
  DEFAULT_GRANTS_QUERY,
  grantProblems,
  revokeStatements,
  TABLE_GRANTS_QUERY,
  TABLE_PRIVILEGES,
} from "../../../../store/lock/grants.js";

describe("revokeStatements", () => {
  it("revokes every table right now and in both owners' defaults", () => {
    expect(revokeStatements()).toEqual([
      "revoke all on all tables in schema public from anon, authenticated, service_role",
      "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role",
      "alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role",
    ]);
  });
});

describe("the read-back queries", () => {
  it("ask about every privilege, MAINTAIN included, for every API role", () => {
    expect(TABLE_PRIVILEGES.length).toBeGreaterThan(0);
    expect(TABLE_PRIVILEGES.filter((privilege) => !TABLE_GRANTS_QUERY.includes(`'${privilege}'`))).toEqual([]);
    expect(TABLE_GRANTS_QUERY).toContain("'MAINTAIN'");
    expect(API_ROLES.filter((role) => !TABLE_GRANTS_QUERY.includes(`'${role}'`))).toEqual([]);
  });

  it("count a right held through a role or PUBLIC, not only a direct grant", () => {
    expect(TABLE_GRANTS_QUERY).toContain("has_table_privilege(r, c.oid, p)");
    expect(DEFAULT_GRANTS_QUERY).toContain("a.grantee = 0");
  });
});

describe("grantProblems", () => {
  it("is empty when both read-backs print nothing", () => {
    expect(grantProblems({ defaultGrants: [""], tableGrants: ["", "  "] })).toEqual([]);
  });

  it("counts the rights and tables, and lists each kind once", () => {
    expect(
      grantProblems({
        defaultGrants: [],
        tableGrants: ["docs|TRUNCATE|anon", "docs|MAINTAIN|anon", "notes|TRUNCATE|anon", "notes|TRUNCATE|anon"],
      }),
    ).toEqual(["the API roles hold 4 table right(s) on 2 store table(s): MAINTAIN to anon, TRUNCATE to anon"]);
  });

  it("names what a new table would grant", () => {
    expect(
      grantProblems({ defaultGrants: ["postgres|TRUNCATE|anon", "postgres|SELECT|PUBLIC"], tableGrants: [] }),
    ).toEqual(["new tables in public would grant the API roles: postgres SELECT PUBLIC, postgres TRUNCATE anon"]);
  });
});
