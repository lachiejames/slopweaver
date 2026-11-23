/**
 * The drizzle-migrations gate's run: it gathers every input and prints the verdict, while the six checks themselves
 * live in `drizzleMigrations.ts` and the entry `drizzleMigrations.entry.ts` only invokes this through `runGateEntry`.
 *
 * Every input is DERIVED from the schema barrel rather than a literal list here, and that is the whole
 * point: `drizzle.config.ts` points drizzle-kit at the same module, so a table drizzle-kit would emit DDL
 * for is exactly a table this gate demands DDL, policies and a barrel export for. A ninth table is
 * covered by construction rather than by somebody remembering to add its name.
 *
 * The drift check runs the real `drizzle-kit generate` into a scratch copy of `supabase/migrations`, so
 * it needs no database and touches nothing committed; the barrel check imports every module under
 * `src/store/schema/` and asks what each declares.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getTableName, is } from "drizzle-orm";
import { isPgEnum, PgRole, PgTable } from "drizzle-orm/pg-core";

import { declaredEnums, declaredTableNames, declaredTablePolicies } from "../store/declared.js";
import { storeErrorLines } from "../store/errors.js";
import { generateMigrations } from "../store/generate.js";

import {
  type DeclaredPolicy,
  MIGRATIONS_DIRNAME,
  migrationViolations,
  readMigrationSet,
  type SchemaModuleDeclarations,
} from "./drizzleMigrations.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/** Where the schema modules live, relative to the repository root. */
const SCHEMA_DIR = join("src", "store", "schema");

/**
 * The role a policy is declared `to`, as a name the check can compare.
 *
 * @param to drizzle's own `to` option — a role object, a role name, or a list of either
 * @returns the name, or undefined when the policy names no single role
 */
export function roleNameOf({ to }: { to: unknown }): string | undefined {
  if (is(to, PgRole)) {
    return to.name;
  }
  if (typeof to === "string") {
    return to;
  }
  return undefined;
}

/**
 * What one schema module declares, read by importing it.
 *
 * @param file the module's file name under {@link SCHEMA_DIR}
 * @returns its declared table and enum names
 */
async function declarationsOf({ file }: { file: string }): Promise<SchemaModuleDeclarations> {
  const loaded: unknown = await import(pathToFileURL(join(process.cwd(), SCHEMA_DIR, file)).href);
  const tables: string[] = [];
  const enums: string[] = [];
  if (typeof loaded === "object" && loaded !== null) {
    for (const value of Object.values(loaded)) {
      if (is(value, PgTable)) {
        tables.push(getTableName(value));
      } else if (isPgEnum(value)) {
        enums.push(value.enumName);
      }
    }
  }
  return { enums, file: join(SCHEMA_DIR, file), tables };
}

/**
 * Runs the drizzle-migrations gate: schema barrel, drift, journal, row-level security and safety checks.
 *
 * @returns the gate's exit code, 0 when every check passes and 1 on a violation or a check that could not run
 */
export async function checkDrizzleMigrations(): Promise<number> {
  const declaredTables = declaredTableNames();
  const modules = await Promise.all(
    readdirSync(SCHEMA_DIR)
      .filter((name) => name.endsWith(".ts"))
      .toSorted()
      .map((file) => declarationsOf({ file })),
  );

  const scratch = mkdtempSync(join(tmpdir(), "slopweaver-drizzle-drift-"));
  cpSync(MIGRATIONS_DIRNAME, scratch, { recursive: true });
  const drift = generateMigrations({ cwd: process.cwd(), out: scratch });
  rmSync(scratch, { force: true, recursive: true });
  if (drift.isErr()) {
    // devlint: not-a-refusal -- drizzle-kit itself could not run, so the drift check never saw the schema;
    // that is a fact to report, not a policy verdict about a drift it never measured
    process.stderr.write(
      `drizzle-migrations: the drift check could not run drizzle-kit:\n  ${storeErrorLines({ error: drift.error }).join("\n  ")}\n`,
    );
    return 1;
  }

  const set = readMigrationSet({ dir: MIGRATIONS_DIRNAME });
  const violations = migrationViolations({
    barrel: {
      barrelEnums: declaredEnums().map((enumeration) => enumeration.enumName),
      barrelTables: declaredTables,
      modules,
    },
    declaredTables,
    drift: { after: drift.value.after, before: drift.value.before },
    rls: declaredTablePolicies().map((entry) => ({
      policies: entry.policies.map((policy): DeclaredPolicy => ({
        for: policy.for,
        name: policy.name,
        to: roleNameOf({ to: policy.to }),
      })),
      rlsEnabled: entry.rlsEnabled,
      table: entry.table,
    })),
    set,
  });
  return reportMigrationVerdict({ declaredTables, set, violations });
}

/**
 * One gate, six genuinely different criteria. They used to share the COVERAGE declaration, so a safety finding
 * printed "N table(s) with no migration" and told the operator to generate a migration that already existed.
 * Each check answers with its own row now.
 */
const CHECK_REFUSALS = {
  barrel: { id: "drizzle-migrations-barrel", noun: "declaration(s) the barrel does not export" },
  coverage: { id: "drizzle-migrations", noun: "table(s) with no migration" },
  drift: { id: "drizzle-migrations-drift", noun: "schema change(s) with no migration" },
  journal: { id: "drizzle-migrations-journal", noun: "journal disagreement(s)" },
  rls: { id: "drizzle-migrations-rls", noun: "table(s) whose row-level security is not the declared shape" },
  safety: { id: "drizzle-migrations-safety", noun: "unsafe statement(s)" },
} as const;

/**
 * Print the gate's verdict over what the checks found, and answer its exit code.
 *
 * @param declaredTables every table the schema barrel exports
 * @param set the committed migrations and their journal, as read
 * @param violations every finding the six checks made
 * @returns 0 when every check passed, else 1
 */
function reportMigrationVerdict({
  declaredTables,
  set,
  violations,
}: {
  declaredTables: readonly string[];
  set: ReturnType<typeof readMigrationSet>;
  violations: ReturnType<typeof migrationViolations>;
}): number {
  if (declaredTables.length === 0) {
    // A coverage check over an empty list passes by finding nothing, which is worse than no check at all.
    // devlint: not-a-refusal -- the barrel exported no TABLES, so the coverage check had nothing to cover
    // and could not have failed; it gives no verdict rather than a clean one
    process.stderr.write(
      "drizzle-migrations: the schema barrel exported no tables, so the coverage check could not have failed. Something is wrong with src/store/schema.ts, not with the migrations.\n",
    );
    return 1;
  }

  if (set.journalUnreadable !== undefined) {
    // devlint: not-a-refusal -- the journal is THERE and unusable, so the gate never saw the apply order it
    // judges; that is a fact to report, not a policy verdict about an order it never read
    process.stderr.write(
      `drizzle-migrations: ${MIGRATIONS_DIRNAME}/meta/_journal.json is unusable: ${set.journalUnreadable}\n`,
    );
    return 1;
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(`  drizzle-migrations [${violation.check}]: ${violation.message}\n`);
    }
    for (const [check, refusal] of Object.entries(CHECK_REFUSALS)) {
      const breaches = violations.filter((violation) => violation.check === check);
      if (breaches.length > 0) {
        process.stderr.write(
          `${lintGateRefusal({
            declaration: lintDeclarationFor({ id: refusal.id }),
            detail: `${String(breaches.length)} ${refusal.noun}`,
          })}\n`,
        );
      }
    }
    return 1;
  }

  process.stdout.write(
    `drizzle-migrations: ${String(declaredTables.length)} declared table(s), each with its three policies and its barrel export, ${String(set.files.length)} migration(s), journal in order, drizzle-kit has nothing to generate\n`,
  );
  return 0;
}
