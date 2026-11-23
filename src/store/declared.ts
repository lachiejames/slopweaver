/**
 * What the schema DECLARES, read from the barrel rather than restated anywhere — the tables, the enums, and
 * the three policies every table must carry.
 *
 * ## Why a derivation and not a list
 *
 * `policies.ts` used to hold `STORE_TABLES`, ten names typed by hand, and `enums.ts` held `STORE_ENUMS`,
 * four of the nine enums the schema actually declares. Both were a second copy of something the barrel
 * already knew, and both drifted the only way a copy can: `memories` was added to the schema and had to be
 * added to the grant list by hand in the same change, and the three `memory_*` enums plus `link_status`
 * never made it into the enum list at all — so widening `memory_verdict` would have had NO path through
 * the apply loop, because the `drizzle-migrations` safety gate refuses `ALTER TYPE … ADD VALUE` inside a
 * migration and the loop's own way around that (`enumValueStatements`) only ever saw the four listed.
 * Reproduce on the commit before this file: `grep -n "STORE_ENUMS = " src/store/schema/enums.ts`.
 *
 * Owner rule: it is structurally impossible to have tables that exist in code but not in the database,
 * or row level security policies that are missing.
 * A list is exactly the mechanism that makes those mistakes possible; every consumer that used to read one
 * reads this module now, so the barrel is the ONE place a table or an enum is declared and everything
 * else — grants, enum labels, the lint gate, the live verifier — follows from it by construction.
 *
 * The functions here are pure over the imported barrel: nothing connects to anything.
 */
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, isPgEnum, type PgEnum, type PgPolicy, PgTable } from "drizzle-orm/pg-core";

import * as barrel from "./schema.js";

/**
 * The barrel's exports as `unknown`, so each guard below narrows from `unknown` rather than from the union of every
 * table's own type. Narrowing that union made the checker relate each table type to `PgTable` structurally, which hit
 * TypeScript's recursion depth limit 1,287 times in this one file and grew past CI's 8 GiB tsc heap once the
 * organisation table joined the barrel. Repro: `yarn tsc --noEmit -p tsconfig.json --extendedDiagnostics
 * --generateTrace <dir>`, then count `recursiveTypeRelatedTo_DepthLimit` events inside this file's `checkSourceFile`.
 */
function barrelValues(): readonly unknown[] {
  return Object.values(barrel);
}

/**
 * Every table the barrel exports, in export order.
 *
 * A loop rather than `filter(…): value is PgTable`, because the barrel's exports are a heterogeneous
 * union (tables, enums, statement arrays, helper functions) and a hand-written predicate narrowing to
 * `PgTable` is not assignable to it under `exactOptionalPropertyTypes`. Drizzle's own `is` narrows
 * correctly inside the branch, which is the check that matters.
 *
 * @returns the table objects themselves, for a caller that needs their config
 * @internal
 */
export function declaredTables(): readonly PgTable[] {
  const found: PgTable[] = [];
  for (const value of barrelValues()) {
    if (is(value, PgTable)) {
      found.push(value);
    }
  }
  return found;
}

/**
 * Every table's Postgres name, sorted, so two callers reading this agree on order without one sorting.
 *
 * @returns the table names the schema declares
 */
export function declaredTableNames(): readonly string[] {
  return declaredTables()
    .map((table) => getTableName(table))
    .toSorted();
}

/**
 * Every enum the barrel exports, in export order.
 *
 * @returns the enum objects, each carrying its Postgres name and its labels
 */
export function declaredEnums(): readonly PgEnum<[string, ...string[]]>[] {
  const found: PgEnum<[string, ...string[]]>[] = [];
  for (const value of barrelValues()) {
    if (isPgEnum(value)) {
      found.push(value);
    }
  }
  return found;
}

/** One table's row-level-security declaration, as the gate and the verifier both read it. */
export interface DeclaredTablePolicies {
  /** The Postgres table name. */
  readonly table: string;
  /** Whether the table's config says row-level security is on — true whenever a policy is declared. */
  readonly rlsEnabled: boolean;
  /** Every policy the table declares, in declaration order. */
  readonly policies: readonly PgPolicy[];
}

/**
 * Each declared table with the policies its config carries.
 *
 * drizzle-kit emits `ENABLE ROW LEVEL SECURITY` for a table that either called `.enableRLS()` or declares
 * at least one policy — the config's own `enableRLS` flag records only the first, MEASURED:
 * every table here reads `enableRLS: false` from `getTableConfig` while every migration carries the
 * statement. So `rlsEnabled` is the disjunction, which is what the DDL will say, read from the same
 * object the DDL is generated from.
 *
 * @returns one entry per declared table, in export order
 */
export function declaredTablePolicies(): readonly DeclaredTablePolicies[] {
  return declaredTables().map((table) => {
    const config = getTableConfig(table);
    return {
      policies: config.policies,
      rlsEnabled: config.enableRLS || config.policies.length > 0,
      table: config.name,
    };
  });
}
