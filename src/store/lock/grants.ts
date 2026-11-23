/**
 * The PURE half of the lock's grant cleanup: the stray table rights Supabase's API roles hold on the store's own
 * tables, the statements that take them away, and the judgement of what is left.
 *
 * MEASURED on the live store (read-only, through `aclexplode(pg_class.relacl)`, because
 * `information_schema.role_table_grants` does not show PostgreSQL 17's MAINTAIN): `anon`, `authenticated` and
 * `service_role` each held MAINTAIN, REFERENCES, TRIGGER and TRUNCATE on every one of the 65 tables in `public`,
 * and no SELECT, INSERT, UPDATE or DELETE. They come from default privileges — tables `postgres` creates in
 * `public` grant those four, tables `supabase_admin` creates there grant everything — so a revoke without the
 * matching default change would be undone by the next migration. Nothing in the store reads through the API
 * roles: every row-level-security policy names the store's own roles (`src/store/schema/rls.ts`).
 *
 * Supabase's own schemas (`storage`, `realtime`, `auth`) are left alone — their grants are those services'
 * contracts, not strays.
 */

/** The API roles PostgREST and Storage authenticate requests as. */
export const API_ROLES = ["anon", "authenticated", "service_role"] as const;

/** The roles whose default privileges in `public` decide what a NEW table grants the API roles. */
const DEFAULT_PRIVILEGE_OWNERS = ["postgres", "supabase_admin"] as const;

/**
 * The statements that take every table right in `public` away from the API roles, now and for every table created
 * later. Idempotent: a re-run revokes nothing and changes nothing.
 *
 * @returns the statements, run as `supabase_admin` — `postgres` may not change `supabase_admin`'s defaults
 */
export function revokeStatements(): readonly string[] {
  const roles = API_ROLES.join(", ");
  return [
    `revoke all on all tables in schema public from ${roles}`,
    ...DEFAULT_PRIVILEGE_OWNERS.map(
      (owner) => `alter default privileges for role ${owner} in schema public revoke all on tables from ${roles}`,
    ),
  ];
}

/** Every table privilege PostgreSQL 17 has — MAINTAIN included, which is the one `information_schema` misses. */
export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

/** The API roles as a SQL array literal. */
const API_ROLE_ARRAY = `array[${API_ROLES.map((role) => `'${role}'`).join(", ")}]`;

/**
 * The query that lists every table right an API role EFFECTIVELY holds in `public` — through a direct grant, a
 * role it inherits, or `PUBLIC` — one `relation|privilege|role` per line. `has_table_privilege` rather than the
 * ACL itself, because an ACL lists direct grantees only and a right inherited another way would read clean.
 */
export const TABLE_GRANTS_QUERY = `select c.relname || '|' || p || '|' || r
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join unnest(${API_ROLE_ARRAY}) r
cross join unnest(array[${TABLE_PRIVILEGES.map((privilege) => `'${privilege}'`).join(", ")}]) p
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and has_table_privilege(r, c.oid, p)
order by 1`;

/**
 * The query that lists every default table right an API role, or `PUBLIC`, would get on a new table in `public`,
 * one `owner|privilege|grantee` per line. A `PUBLIC` default is listed rather than revoked: the revoke names the
 * API roles only, so it stays a finding `store verify` fails on.
 */
export const DEFAULT_GRANTS_QUERY = `select pg_get_userbyid(d.defaclrole) || '|' || a.privilege_type || '|' || coalesce(r.rolname, 'PUBLIC')
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) a
left join pg_roles r on r.oid = a.grantee
where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
  and (a.grantee = 0 or r.rolname = any(${API_ROLE_ARRAY}))
order by 1`;

/**
 * What is wrong with the API roles' table rights, from the two queries' output.
 *
 * @param tableGrants the table-grants query's lines
 * @param defaultGrants the default-grants query's lines
 * @returns one sentence per kind of stray right — empty when the API roles hold nothing on the store's tables
 */
export function grantProblems({
  tableGrants,
  defaultGrants,
}: {
  tableGrants: readonly string[];
  defaultGrants: readonly string[];
}): readonly string[] {
  const problems: string[] = [];
  const tableRows = tableGrants.filter((line) => line.trim().length > 0);
  const defaultRows = defaultGrants.filter((line) => line.trim().length > 0);
  if (tableRows.length > 0) {
    const tables = new Set(tableRows.map((line) => line.split("|")[0]));
    const kinds = [...new Set(tableRows.map((line) => line.split("|").slice(1).join(" to ")))].toSorted();
    problems.push(
      `the API roles hold ${String(tableRows.length)} table right(s) on ${String(tables.size)} store table(s): ${kinds.join(", ")}`,
    );
  }
  if (defaultRows.length > 0) {
    const kinds = [...new Set(defaultRows.map((line) => line.split("|").join(" ")))].toSorted();
    problems.push(`new tables in public would grant the API roles: ${kinds.join(", ")}`);
  }
  return problems;
}
