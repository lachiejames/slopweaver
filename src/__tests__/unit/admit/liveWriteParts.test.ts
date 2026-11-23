/**
 * The pieces `admit/liveWrite.ts` composes, each pinned on its own: the rule grammar, the runner unwrapper,
 * the SQL write test, the migration-script name test and the two tables' entry points.
 */
import { describe, expect, it } from "vitest";

import { infraFinding } from "../../../admit/liveWriteInfra.js";
import { migrationFinding, scriptRunsMigration } from "../../../admit/liveWriteMigrations.js";
import {
  anyMatching,
  anyOf,
  commandWords,
  either,
  pairOf,
  readsOnly,
  ruleInput,
  unless,
} from "../../../admit/liveWriteRules.js";
import { sqlWrites } from "../../../admit/liveWriteSql.js";
import { unwrapRunner } from "../../../admit/liveWriteUnwrap.js";

describe("the rule grammar", () => {
  it("keeps every word but takes only the dashless ones as positional", () => {
    expect(ruleInput({ args: ["-n", "prod", "delete", "--now"] })).toStrictEqual({
      args: ["-n", "prod", "delete", "--now"],
      positional: ["prod", "delete"],
    });
  });

  it("matches a verb anywhere, past a flag's value", () => {
    const rule = anyOf({ verbs: ["delete"] });

    expect(rule(ruleInput({ args: ["-n", "prod", "delete", "pod"] }))).toBe("delete");
    expect(rule(ruleInput({ args: ["get", "pods"] }))).toBeUndefined();
  });

  it("matches an adjacent pair only, and never reads past the last word", () => {
    const rule = pairOf({ group: ["migrate"], verbs: ["deploy"] });

    expect(rule(ruleInput({ args: ["--schema", "x", "migrate", "deploy"] }))).toBe("migrate deploy");
    expect(rule(ruleInput({ args: ["migrate", "status", "deploy"] }))).toBeUndefined();
    expect(rule(ruleInput({ args: ["migrate"] }))).toBeUndefined();
  });

  it("matches a task:name word, takes the first rule that names one, and stands down on a prefix", () => {
    const colon = anyMatching({ pattern: /^config:set$/ });
    const both = either(anyOf({ verbs: ["restart"] }), colon);
    const guarded = unless({ prefixes: ["--dry-run"], rule: anyOf({ verbs: ["apply"] }) });

    expect(both(ruleInput({ args: ["config:set", "A=1"] }))).toBe("config:set");
    expect(both(ruleInput({ args: ["config:get", "A"] }))).toBeUndefined();
    expect(guarded(ruleInput({ args: ["apply", "-f", "x"] }))).toBe("apply");
    expect(guarded(ruleInput({ args: ["apply", "--dry-run=server"] }))).toBeUndefined();
  });
});

describe("the allowlist rule", () => {
  const rule = readsOnly({ reads: { get: true, state: ["list"] }, valueFlags: ["-n"] });

  it("drops a value flag's value, so the first command word is the subcommand", () => {
    expect(commandWords({ args: ["-n", "prod", "get", "pods", "-o", "wide"], valueFlags: ["-n"] })).toStrictEqual([
      "get",
      "pods",
      "wide",
    ]);
  });

  it("passes a listed read and a listed read inside a group, and nothing else", () => {
    expect(rule(ruleInput({ args: ["-n", "prod", "get", "pods"] }))).toBeUndefined();
    expect(rule(ruleInput({ args: ["state", "list"] }))).toBeUndefined();
    expect(rule(ruleInput({ args: ["state", "rm", "x"] }))).toBe("state rm");
    expect(rule(ruleInput({ args: ["certificate", "approve", "csr-1"] }))).toBe("certificate approve");
    expect(rule(ruleInput({ args: ["state"] }))).toBe("state");
  });

  it("reads a bare invocation and a --help as harmless", () => {
    expect(rule(ruleInput({ args: [] }))).toBeUndefined();
    expect(rule(ruleInput({ args: ["delete", "--help"] }))).toBeUndefined();
  });

  it("refuses when an unknown flag's value shifts the words — the safe direction", () => {
    expect(rule(ruleInput({ args: ["--cluster", "prod", "get", "pods"] }))).toBe("prod get");
  });
});

describe("unwrapRunner", () => {
  it.each([
    ["yarn", ["run", "db:migrate"], { kind: "script", script: "db:migrate" }],
    ["yarn", ["migrate"], { kind: "script", script: "migrate" }],
    [
      "pnpm",
      ["--filter", "api", "exec", "prisma", "migrate", "deploy"],
      { kind: "program", words: ["prisma", "migrate", "deploy"] },
    ],
    ["yarn", ["prisma", "migrate", "deploy"], { kind: "program", words: ["prisma", "migrate", "deploy"] }],
    [
      "docker",
      ["compose", "-f", "prod.yml", "run", "--rm", "api", "rails", "db:migrate"],
      { kind: "program", words: ["rails", "db:migrate"] },
    ],
    ["npx", ["-c", "prisma migrate deploy"], { kind: "line", line: "prisma migrate deploy" }],
    ["cross-env", ["A=1", "prisma", "migrate", "deploy"], { kind: "program", words: ["prisma", "migrate", "deploy"] }],
    ["bundle", ["exec", "rake", "db:migrate"], { kind: "program", words: ["rake", "db:migrate"] }],
    ["just", ["--yes", "migrate-prod"], { kind: "script", script: "migrate-prod" }],
  ] as const)("%s %j unwraps to what it runs", (name, args, expected) => {
    expect(unwrapRunner({ args, name })).toStrictEqual(expected);
  });

  it.each([
    ["npm", ["install"]],
    ["yarn", ["run"]],
    ["docker", ["ps"]],
    ["docker", ["exec", "api"]],
    ["make", ["build"]],
    ["bundle", ["install"]],
    ["kubectl", ["delete", "pod", "x"]],
  ] as const)("%s %j wraps nothing this walk follows", (name, args) => {
    expect(unwrapRunner({ args, name })).toBeUndefined();
  });
});

describe("sqlWrites and scriptRunsMigration", () => {
  it("sees a write anywhere in the text, and a read as a read", () => {
    expect(
      sqlWrites({ escapes: "standard", sql: "WITH d AS (DELETE FROM t RETURNING id) SELECT count(*) FROM d" }),
    ).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "select 1; truncate jobs" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "\\copy t from 'x.csv'" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT id, created_at FROM users WHERE plan = 'pro'" })).toBe(false);
  });

  it("reads by allowlist, so a write nobody listed is still a write", () => {
    expect(sqlWrites({ escapes: "standard", sql: "COMMENT ON TABLE users IS 'production metadata change'" })).toBe(
      true,
    );
    expect(sqlWrites({ escapes: "standard", sql: "SECURITY LABEL ON TABLE users IS 'x'" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT * INTO backup_users FROM users" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT * FROM jobs FOR UPDATE" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SET GLOBAL max_connections = 10" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "\\i fix.sql" })).toBe(true);
  });

  it("keeps a write keyword inside a literal, a quoted name or a comment a read", () => {
    expect(sqlWrites({ escapes: "standard", sql: "SELECT 'update' AS operation" })).toBe(false);
    expect(sqlWrites({ escapes: "standard", sql: 'SELECT "delete" FROM audit -- drop me' })).toBe(false);
    expect(
      sqlWrites({ escapes: "standard", sql: "SET statement_timeout = '5s'; SELECT replace(name, 'a', 'b') FROM t" }),
    ).toBe(false);
    expect(sqlWrites({ escapes: "standard", sql: "\\dt\nSHOW search_path" })).toBe(false);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT $$update$$ AS operation, $q$delete$q$ AS other" })).toBe(
      false,
    );
    expect(sqlWrites({ escapes: "standard", sql: "DO $$ BEGIN PERFORM 1; END $$" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT E'can\\'t update' AS note" })).toBe(false);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT 'x\\'; DELETE FROM t; SELECT '" })).toBe(true);
  });

  it("reads an EXPLAIN that only plans, and not one that ANALYZEs and so runs the write", () => {
    expect(sqlWrites({ escapes: "standard", sql: "EXPLAIN DELETE FROM jobs WHERE id = 1" })).toBe(false);
    expect(sqlWrites({ escapes: "standard", sql: "EXPLAIN ANALYZE DELETE FROM jobs" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "EXPLAIN (ANALYSE true) UPDATE jobs SET x = 1" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "EXPLAIN SELECT 1; DELETE FROM jobs" })).toBe(true);
  });

  it("takes a backslash escape in every string where the dialect does", () => {
    expect(sqlWrites({ escapes: "backslash", sql: "SELECT 'can\\'t update' AS note" })).toBe(false);
    expect(sqlWrites({ escapes: "backslash", sql: 'SELECT "say \\"delete\\"" AS note' })).toBe(false);
    expect(sqlWrites({ escapes: "backslash", sql: "SELECT 'a\\\\'; DELETE FROM t" })).toBe(true);
    expect(sqlWrites({ escapes: "standard", sql: "SELECT 'can\\'t update' AS note" })).toBe(true);
  });

  it("takes a script named after a migration as one, unless the name says it only authors or reads", () => {
    expect(scriptRunsMigration({ script: "db:migrate" })).toBe(true);
    expect(scriptRunsMigration({ script: "migrations:apply" })).toBe(true);
    expect(scriptRunsMigration({ script: "migrate:status" })).toBe(false);
    expect(scriptRunsMigration({ script: "migration:generate" })).toBe(false);
    expect(scriptRunsMigration({ script: "build" })).toBe(false);
  });
});

describe("the tables' entry points", () => {
  it("answers an alias under the name it was run as, and nothing for an unknown program", () => {
    expect(migrationFinding({ args: ["db:migrate"], name: "rake" })).toStrictEqual({
      kind: "migration",
      operation: "db:migrate",
      tool: "rake",
    });
    expect(infraFinding({ args: ["delete", "pod", "x"], name: "oc", stdin: undefined })).toStrictEqual({
      kind: "live-write",
      operation: "delete pod",
      tool: "oc",
    });
    expect(migrationFinding({ args: ["up"], name: "constructor" })).toBeUndefined();
    expect(infraFinding({ args: ["x"], name: "toString", stdin: undefined })).toBeUndefined();
    expect(migrationFinding({ args: ["up"], name: "ls" })).toBeUndefined();
    expect(infraFinding({ args: ["delete"], name: "ls", stdin: undefined })).toBeUndefined();
  });

  it("reads Django's manage.py only behind a python interpreter", () => {
    expect(migrationFinding({ args: ["manage.py", "flush"], name: "python3.12" })).toStrictEqual({
      kind: "migration",
      operation: "manage.py flush",
      tool: "python3.12",
    });
    expect(migrationFinding({ args: ["manage.py", "shell"], name: "python" })).toBeUndefined();
  });

  it("takes a SQL client with no statement and no stdin as interactive, which writes nothing yet", () => {
    expect(infraFinding({ args: ["-h", "prod"], name: "psql", stdin: undefined })).toBeUndefined();
    expect(infraFinding({ args: ["-h", "prod"], name: "psql", stdin: { kind: "file" } })).toStrictEqual({
      kind: "live-write",
      operation: "a SQL file",
      tool: "psql",
    });
  });
});
