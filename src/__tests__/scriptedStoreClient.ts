/**
 * A store client over no database: Drizzle's real postgres-js driver builds every statement and hands its SQL and
 * parameters to a test's own `answer`, which returns the rows a database would. A seam, not a mock — nothing is
 * patched, and the module under test runs its real query builder, transaction wrapper and row mapping.
 *
 * `drizzle.mock()` (the shape `unit/plans/storeRows.test.ts` uses) only reaches a register's refusal half, because
 * it cannot answer a statement. This one can, so a register's row operations are covered in the unit lane while what
 * only a real database proves (its indexes, its CHECKs, its locks) stays in that register's integration proof.
 *
 * It holds exactly the four members the driver reaches: `options` (whose parsers the driver installs), `unsafe` (every
 * statement; `.values()` for one with fields), `begin` (a transaction, here the same client) and nothing else.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import type { StoreClient } from "../store/client.js";
import * as storeSchema from "../store/schema.js";

/** One statement the driver issued. */
export interface ScriptedStatement {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * Whether a value carries the three members Drizzle's postgres-js driver reaches on a client. Those three are the
 * whole of what the driver calls, so a value carrying them is a client as far as Drizzle can observe.
 */
function reachesAsSql(value: unknown): value is Sql {
  return typeof value === "object" && value !== null && "begin" in value && "options" in value && "unsafe" in value;
}

/**
 * A client whose every statement is answered by `answer`, recording each in issue order.
 *
 * @param answer the rows one statement returns, each in its select's field order; a throw is a driver failure
 * @returns the client, every statement so far, and how many times it was closed
 */
export function scriptedStoreClient({
  answer,
}: {
  answer: (statement: ScriptedStatement) => readonly (readonly unknown[])[];
}): { client: StoreClient; statements: () => readonly ScriptedStatement[]; closes: () => number } {
  const statements: ScriptedStatement[] = [];
  let closed = 0;
  // named-object-params-exempt: postgres-js's `Sql.unsafe(query, params, options)` is positional and Drizzle calls it so
  const unsafe = (
    query: string,
    params: readonly unknown[] = [],
  ): Promise<unknown> & { values: () => Promise<unknown> } => {
    const statement = { params, query };
    statements.push(statement);
    const answered = Promise.resolve().then(() => answer(statement));
    // A statement with no fields is awaited as the result itself, and nothing here reads it.
    const awaited = answered.then(() => []);
    // A select reads `values()` instead, so this chain's own rejection is handled here rather than left unhandled.
    awaited.catch(() => undefined);
    return Object.assign(awaited, { values: () => answered });
  };
  const fake = {
    // named-object-params-exempt: postgres-js's `Sql.begin(callback)` is positional and Drizzle calls it so
    begin: async (run: (client: unknown) => Promise<unknown>): Promise<unknown> => run(fake),
    options: { parsers: {}, serializers: {} },
    unsafe,
  };
  if (!reachesAsSql(fake)) {
    throw new Error("the scripted client lacks a member Drizzle's postgres-js driver reaches");
  }
  const client: StoreClient = {
    close: async () => {
      closed += 1;
    },
    db: drizzle(fake, { schema: storeSchema }),
  };
  return { client, closes: () => closed, statements: () => statements };
}
