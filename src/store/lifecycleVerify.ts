/**
 * The pure half of `store verify` — every way the live database can disagree with the declared schema, the
 * probe statements that make Postgres deparse a declared policy, and the report. The vocabulary it compares
 * in (a finding, the live and declared facts) and the migration state it reports on are `lifecycleCore.ts`'s.
 * Nothing here connects to anything; `lifecycle.ts` gathers the facts from Postgres and hands them in.
 */
import {
  type DeclaredPolicyPredicates,
  type DeclaredSchemaFacts,
  type LivePolicy,
  type LiveSchemaFacts,
  type MigrationState,
  migrationStateLine,
  type VerifyFinding,
} from "./lifecycleCore.js";

/**
 * Every way the live database disagrees with what the schema declares.
 *
 * A finding is a DISAGREEMENT, in either direction where a direction is meaningful: a declared table the
 * database lacks is the defect the owner named; a live policy the schema does not declare is the wider
 * grant a reviewer would never see. Extra TABLES are not findings — a database may hold a table the
 * schema retired, and the migrator's own bookkeeping schema is not `public`.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns every finding, tables first, then rls, policies, grants, enums, extensions, roles, migration
 */
export function verifyFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  return [
    ...tableFindings({ declared, live }),
    ...policyFindings({ declared, live }),
    ...predicateFindings({ live }),
    ...grantFindings({ declared, live }),
    ...enumFindings({ declared, live }),
    ...extensionAndRoleFindings({ declared, live }),
    ...(live.migration.kind === "current"
      ? []
      : [
          {
            kind: "migration",
            message: migrationStateLine({
              state: live.migration,
              ...(live.landed === undefined ? {} : { landed: live.landed }),
            }),
          } as const,
        ]),
  ];
}

/**
 * A declared table the database lacks, and a declared table whose row-level security is off.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns the findings, in declared order
 * @internal
 */
function tableFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  const liveTables = new Map(live.tables.map((table) => [table.name, table.rlsEnabled]));
  return declared.tables.flatMap((table): readonly VerifyFinding[] => {
    const rls = liveTables.get(table);
    if (rls === undefined) {
      return [{ kind: "table", message: `"${table}" is declared and does not exist in the database` }];
    }
    return rls ? [] : [{ kind: "rls", message: `"${table}" exists and row level security is OFF` }];
  });
}

/**
 * One policy as a comparable key: the table, the name, the operation and its roles.
 *
 * @param policy either side's policy
 * @returns the key
 * @internal
 */
function policyKey({ policy }: { policy: LivePolicy }): string {
  return `${policy.table}.${policy.name} ${policy.cmd} to ${[...policy.roles].toSorted().join(",")}`;
}

/**
 * A declared policy that is absent, and a live policy nothing declares — the second is the wider grant a
 * reviewer would never see.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns the findings, declared-absent first
 * @internal
 */
function policyFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  const liveKeys = new Set(live.policies.map((policy) => policyKey({ policy })));
  const wantedKeys = new Set(declared.policies.map((policy) => policyKey({ policy })));
  return [
    ...declared.policies
      .filter((policy) => !liveKeys.has(policyKey({ policy })))
      .map((policy): VerifyFinding => ({
        kind: "policy",
        message: `policy ${policyKey({ policy })} is declared and absent`,
      })),
    ...live.policies
      .filter((policy) => !wantedKeys.has(policyKey({ policy })))
      .map((policy): VerifyFinding => ({
        kind: "policy",
        message: `policy ${policyKey({ policy })} exists and is not declared`,
      })),
  ];
}

/**
 * A policy whose USING or WITH CHECK is not what the schema declares — the finding a name-and-role
 * comparison can never make.
 *
 * Why it exists: `content_slack_bot_read` shipped as `using (true)` and let the bot role read every private
 * message's side row until a later migration narrowed it to the public parent. A database whose predicate reverted to
 * `true` keeps the same name, operation and role, so without this it verifies clean while the leak is back.
 * Matched on table and name alone, so a policy whose operation or role ALSO drifted reports both. A
 * declared policy with no live row of that name is already `declared and absent` and is not repeated.
 *
 * @param live the database's deparse of both its own policies and the declared expressions
 * @returns the findings, in declared order, USING before WITH CHECK
 * @internal
 */
function predicateFindings({ live }: { live: LiveSchemaFacts }): readonly VerifyFinding[] {
  const byName = new Map(live.livePredicates.map((policy) => [`${policy.table}.${policy.name}`, policy]));
  return live.declaredPredicates.flatMap((wanted): readonly VerifyFinding[] => {
    const found = byName.get(`${wanted.table}.${wanted.name}`);
    if (found === undefined) {
      return [];
    }
    const clauses = [
      { clause: "USING", has: found.using, wants: wanted.using },
      { clause: "WITH CHECK", has: found.withCheck, wants: wanted.withCheck },
    ] as const;
    return clauses
      .filter(({ has, wants }) => has !== wants)
      .map(({ clause, has, wants }) => ({
        kind: "policy",
        message: `policy ${wanted.table}.${wanted.name} ${clause} is ${expressionText({ expression: has })} and the schema declares ${expressionText({ expression: wants })}`,
      }));
  });
}

/**
 * A deparsed expression on one line, for a finding: Postgres breaks a subquery across lines.
 *
 * @param expression the deparse, or `null` for a clause the policy does not have
 * @returns the expression with each whitespace run collapsed, or `no clause`
 */
function expressionText({ expression }: { expression: string | null }): string {
  if (expression === null) {
    return "no clause";
  }
  return `\`${expression.replaceAll(/\s+/g, " ")}\``;
}

/**
 * The statements that make Postgres deparse one table's declared policy expressions, run inside a
 * savepoint the caller rolls back.
 *
 * A TEMP table of the same name, not the real one: `create policy` on the real table would take an
 * exclusive lock and write the catalog of the store being verified. The name must be the same because the
 * deparse qualifies an outer column with it (`content_slack.content_id`); the columns come from `like` so a
 * predicate naming one resolves. Each probe is `to public` so a missing store role — its own finding —
 * cannot fail the probe. MEASURED on the local store: the probe's
 * `pg_get_expr(polqual, polrelid)` for `content_slack_bot_read` is byte-identical to `pg_policies.qual`.
 * Reproduce with the statements this returns plus
 * `select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'pg_temp.content_slack'::regclass`.
 *
 * @param table the declared table, which must exist in `public`
 * @param predicates that table's declared policies
 * @returns the statements, table first, one probe per policy named `probe_<position>`
 */
export function predicateProbeStatements({
  table,
  predicates,
}: {
  table: string;
  predicates: readonly DeclaredPolicyPredicates[];
}): readonly string[] {
  const relation = quoteIdentifier({ identifier: table });
  return [
    `create temp table ${relation} (like public.${relation})`,
    ...predicates.map((predicate, position) => {
      const using = predicate.using === null ? "" : ` using (${predicate.using})`;
      const withCheck = predicate.withCheck === null ? "" : ` with check (${predicate.withCheck})`;
      return `create policy "probe_${String(position)}" on pg_temp.${relation} for ${predicate.cmd} to public${using}${withCheck}`;
    }),
  ];
}

/**
 * A Postgres identifier, double-quoted with any embedded quote doubled.
 *
 * @param identifier the bare name
 * @returns the quoted identifier
 */
function quoteIdentifier({ identifier }: { identifier: string }): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Every (role, table, privilege) the grants phase promises and the database does not hold.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns the findings, in declared order
 * @internal
 */
function grantFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  const held = new Set(
    live.privileges.filter((row) => row.held).map((row) => `${row.role} ${row.privilege} ${row.table}`),
  );
  return declared.privileges
    .filter((grant) => !held.has(`${grant.role} ${grant.privilege} ${grant.table}`))
    .map((grant) => ({ kind: "grant", message: `${grant.role} has no ${grant.privilege} on "${grant.table}"` }));
}

/**
 * A declared enum the database does not have, and a declared label its type is missing.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns the findings, in declared order
 * @internal
 */
function enumFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  const liveEnums = new Map(live.enums.map((entry) => [entry.name, new Set(entry.labels)]));
  return declared.enums.flatMap((enumeration): readonly VerifyFinding[] => {
    const labels = liveEnums.get(enumeration.name);
    if (labels === undefined) {
      return [{ kind: "enum", message: `enum "${enumeration.name}" is declared and does not exist` }];
    }
    return enumeration.labels
      .filter((label) => !labels.has(label))
      .map((label) => ({ kind: "enum", message: `enum "${enumeration.name}" lacks the declared label '${label}'` }));
  });
}

/**
 * A declared extension that is not installed, and a declared role the connecting user cannot assume.
 *
 * Together because each is one set difference and neither has ever fired alone: both are products of the
 * pre-migration phase, so a database missing one is usually missing the other.
 *
 * @param declared what the schema says
 * @param live what the database says
 * @returns the extension findings, then the role findings
 * @internal
 */
function extensionAndRoleFindings({
  declared,
  live,
}: {
  declared: DeclaredSchemaFacts;
  live: LiveSchemaFacts;
}): readonly VerifyFinding[] {
  const installed = new Set(live.extensions);
  const assumable = new Set(live.assumableRoles);
  return [
    ...declared.extensions
      .filter((name) => !installed.has(name))
      .map((name): VerifyFinding => ({ kind: "extension", message: `extension "${name}" is not installed` })),
    ...declared.roles
      .filter((name) => !assumable.has(name))
      .map((name): VerifyFinding => ({
        kind: "role",
        message: `role "${name}" cannot be assumed by the connecting user`,
      })),
  ];
}

/**
 * The human report of a verify.
 *
 * @param findings every disagreement
 * @param declaredTables how many tables were checked, so a clean report says what it checked
 * @param state where the migrations stand
 * @returns the lines
 */
export function verifyLines({
  findings,
  declaredTables,
  state,
}: {
  findings: readonly VerifyFinding[];
  declaredTables: number;
  state: MigrationState;
}): readonly string[] {
  if (findings.length === 0) {
    return [
      `store verify: clean — ${String(declaredTables)} declared table(s) present with row level security on, every declared policy and its predicate, grant, enum label, extension and role in place`,
      migrationStateLine({ state }),
    ];
  }
  return [
    `store verify: ${String(findings.length)} finding(s) — the database does not match the schema`,
    ...findings.map((finding) => `  [${finding.kind}] ${finding.message}`),
  ];
}
