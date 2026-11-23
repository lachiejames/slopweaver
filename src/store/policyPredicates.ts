/**
 * What `store verify` reads about row-level-security policies: each live policy's name, operation, roles
 * and both expressions, and each DECLARED expression as this same database deparses it.
 *
 * Its own module because the probe is the one place verify issues DDL — into a temp table, inside a
 * savepoint that is always rolled back — and that deserves to be read on its own rather than inside the
 * catalog reads beside it. Why the declared side is deparsed by Postgres and not canonicalised by hand is
 * on {@link PolicyPredicates}; the statements are {@link predicateProbeStatements}.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type postgres from "postgres";

import { declaredTablePolicies } from "./declared.js";
import { type DeclaredPolicyPredicates, type LivePolicy, type PolicyPredicates } from "./lifecycleCore.js";
import { predicateProbeStatements } from "./lifecycleVerify.js";

/**
 * Every declared policy's expressions as drizzle renders them — the same `sqlToQuery` drizzle-kit writes
 * into `USING (…)` in a migration.
 *
 * @returns one entry per declared policy, in declaration order
 */
export function declaredPolicyPredicates(): readonly DeclaredPolicyPredicates[] {
  const dialect = new PgDialect();
  const rendered = ({ expression }: { expression: SQL | undefined }): string | null =>
    expression === undefined ? null : dialect.sqlToQuery(expression).sql;
  return declaredTablePolicies().flatMap((entry) =>
    entry.policies.map(({ for: cmd = "all", name, using, withCheck }) => ({
      cmd,
      name,
      table: entry.table,
      using: rendered({ expression: using }),
      withCheck: rendered({ expression: withCheck }),
    })),
  );
}

/**
 * Read the live policies and have the database deparse the declared expressions.
 *
 * @param sql an open connection
 * @param predicates declared policies on tables the database has — an absent table is its own finding
 * @returns the live policy keys, their expressions, and the declared expressions as deparsed here
 */
export async function readPolicyFacts({
  sql,
  predicates,
}: {
  sql: postgres.Sql;
  predicates: readonly DeclaredPolicyPredicates[];
}): Promise<{
  readonly policies: readonly LivePolicy[];
  readonly livePredicates: readonly PolicyPredicates[];
  readonly declaredPredicates: readonly PolicyPredicates[];
}> {
  const rows = await sql<
    {
      tablename: string;
      policyname: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname`;
  return {
    declaredPredicates: await deparseDeclaredPredicates({ predicates, sql }),
    livePredicates: rows.map((row) => ({
      name: row.policyname,
      table: row.tablename,
      using: row.qual,
      withCheck: row.with_check,
    })),
    policies: rows.map((row) => ({ cmd: row.cmd, name: row.policyname, roles: row.roles, table: row.tablename })),
  };
}

/**
 * Have this database deparse every declared policy expression, and leave nothing behind.
 *
 * One transaction, one savepoint per table rolled back before the next: the probe's temp table carries the
 * real table's name, so two alive at once could shadow a table another predicate reads (`content`, inside
 * every per-source predicate). The transaction itself is rolled back too, by throwing once the reads are in
 * hand, so a probe can never be committed whatever a later statement does.
 *
 * @param sql an open connection
 * @param predicates declared policies on tables the database has
 * @returns each declared policy's expressions as this database deparses them
 */
async function deparseDeclaredPredicates({
  sql,
  predicates,
}: {
  sql: postgres.Sql;
  predicates: readonly DeclaredPolicyPredicates[];
}): Promise<readonly PolicyPredicates[]> {
  const tables = [...new Set(predicates.map((predicate) => predicate.table))];
  const deparsed: PolicyPredicates[] = [];
  const rollback = new Error("probe rollback");
  try {
    await sql.begin(async (tx) => {
      for (const table of tables) {
        const own = predicates.filter((predicate) => predicate.table === table);
        await tx.unsafe("savepoint predicate_probe");
        for (const statement of predicateProbeStatements({ predicates: own, table })) {
          await tx.unsafe(statement);
        }
        const rows = await tx<{ polname: string; using: string | null; with_check: string | null }[]>`
          select polname, pg_get_expr(polqual, polrelid) as using, pg_get_expr(polwithcheck, polrelid) as with_check
          from pg_policy where polrelid = format('pg_temp.%I', ${table}::text)::regclass`;
        await tx.unsafe("rollback to savepoint predicate_probe");
        own.forEach((predicate, position) => {
          const row = rows.find((candidate) => candidate.polname === `probe_${String(position)}`)!;
          deparsed.push({ name: predicate.name, table, using: row.using, withCheck: row.with_check });
        });
      }
      throw rollback;
    });
  } catch (error: unknown) {
    if (error !== rollback) {
      throw error;
    }
  }
  return deparsed;
}
