/**
 * The store door's catch-up over a REAL Postgres: a database one landed, additive migration behind is brought
 * current by the first verb that opens it, rather than refusing every verb until somebody runs `store push`.
 *
 * Measured: a landed migration fast-forwarded the main checkout with nothing pushing the store, so
 * `connectStore` read `behind` and refused every store verb, the plans register and every Claude session boot for
 * five minutes. These cases hold down each condition the door judges, against the production migrator, git and
 * verify: a fixture checkout carries this tree's migrations plus one synthetic migration, and its
 * `refs/remotes/origin/main` decides whether that migration has landed.
 *
 * REQUIRED in CI (the subprocess job names `STORE_PROOF_ADMIN_URL`), opt-in locally; the command is in
 * `../proofDatabase.ts`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { catchUpStore } from "../../../store/catchUp.js";
import { ALLOW_STALE_STORE_ENV, connectStore } from "../../../store/client.js";
import { STORE_URL_ENV } from "../../../store/config.js";
import { storeErrorLines } from "../../../store/errors.js";
import { readMigrationState } from "../../../store/lifecycle.js";
import { MIGRATIONS_DIR } from "../../../store/migrate.js";
import { REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";
import { openProofTemplate, type ProofDatabase, type ProofTemplate, proofAdminUrl } from "../proofDatabase.js";

import { ADDITIVE_SQL, fixtureCheckout, SUBTRACTIVE_SQL, TAG } from "./catchUpFixture.js";

const ADMIN_URL = proofAdminUrl();

describe.skipIf(ADMIN_URL === undefined)("the store door catches up a behind database, over a real store", () => {
  // Built in the hooks, never at collection: `skipIf` still runs this body.
  let template: ProofTemplate;
  let database: ProofDatabase;
  let root: string;
  let home: string;

  beforeAll(async () => {
    template = await openProofTemplate({ adminUrl: ADMIN_URL!, prefix: "catch_up_proof" });
  }, 120_000);

  afterAll(async () => {
    await template.drop();
  });

  beforeEach(async () => {
    database = await template.open();
    root = mkdtempSync(join(tmpdir(), "sw-catchup-"));
    home = join(root, ".slopweaver");
    mkdirSync(home, { recursive: true });
  }, 60_000);

  afterEach(async () => {
    rmSync(root, { force: true, recursive: true });
    await database.drop();
  });

  /** Open the store through the door, as every verb does, from the fixture checkout. */
  async function open({ cwd, catchUp }: { cwd: string; catchUp?: boolean }): Promise<readonly string[]> {
    const opened = await connectStore({
      cwd,
      env: { [STORE_URL_ENV]: database.storeUrl },
      home,
      ...(catchUp === undefined ? {} : { catchUp }),
    });
    if (opened.isErr()) {
      return storeErrorLines({ error: opened.error });
    }
    await opened.value.close();
    return [];
  }

  /** How many rows the migrator's own ledger holds, and whether the synthetic table exists. */
  async function ledger(): Promise<{ recorded: number; table: boolean }> {
    const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
    try {
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
      const [table] = await sql<{ present: boolean }[]>`
        select to_regclass('public.catch_up_proof') is not null as present`;
      return { recorded: count!.n, table: table!.present };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  it(
    "applies a landed, additive migration and opens, so the verb never sees the database behind",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const before = await ledger();

      expect(await open({ cwd })).toEqual([]);
      expect(await ledger()).toEqual({ recorded: before.recorded + 1, table: true });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a migration that has not landed on origin/main, and applies nothing",
    async () => {
      const cwd = fixtureCheckout({ landed: false, root, sql: ADDITIVE_SQL });
      const before = await ledger();

      expect((await open({ cwd })).join("\n")).toContain("not caught up, because a pending migration has not landed");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a landed migration that does more than add, so `store push` applies it deliberately",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: SUBTRACTIVE_SQL });
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("not caught up, because a pending migration does more than add");
      expect(refusal).toContain(`${TAG}: DROP TABLE IF EXISTS "catch_up_proof_absent";`);
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a landed migration that is not valid UTF-8, since its text hash cannot prove it byte for byte",
    async () => {
      const sql = Buffer.concat([Buffer.from([0x2d, 0x2d, 0x20, 0x80, 0x0a]), Buffer.from(ADDITIVE_SQL)]);
      const cwd = fixtureCheckout({ landed: true, root, sql });
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("not caught up, because a pending migration has not landed");
      expect(refusal).toContain("is not valid UTF-8");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a ledger whose last created_at is not its entry's when, since the migrator would replay unjudged entries",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          "update drizzle.__drizzle_migrations set created_at = created_at - 1 where id = (select max(id) from drizzle.__drizzle_migrations)",
        );
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("not caught up, because the ledger's last created_at is");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while the store holds an operator in public, which an additive CHECK could run without naming it",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          "create function public.catch_up_proof_eq(integer, integer) returns boolean language sql immutable as 'select $1 = $2'",
        );
        await sql.unsafe(
          "create operator public.=== (leftarg = integer, rightarg = integer, function = public.catch_up_proof_eq)",
        );
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("not caught up, because the store holds code an additive statement could run");
      expect(refusal).toContain("operator === (catch_up_proof_eq)");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while ANY user schema holds an operator or a domain, which the search path or a qualified cast reaches (Codex r12)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create schema catch_up_proof_login");
        await sql.unsafe(
          "create function catch_up_proof_login.bump_eq(integer, integer) returns boolean language sql as 'select true'",
        );
        await sql.unsafe(
          "create operator catch_up_proof_login.=== (leftarg = integer, rightarg = integer, function = catch_up_proof_login.bump_eq)",
        );
        await sql.unsafe("create domain catch_up_proof_login.positive as integer check (value > 0)");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("operator === (catch_up_proof_login.bump_eq)");
      expect(refusal).toContain("domain positive");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while an extension carries a SQL function under an admitted name, since membership excuses nothing (Codex r13)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create extension seg");
        await sql.unsafe("create function public.now() returns timestamptz language sql as 'select clock_timestamp()'");
        await sql.unsafe("alter extension seg add function public.now()");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("function now carries a name the additive check admits");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while an extension-owned domain carries a DEFAULT, which filling an added column evaluates per row (Codex r29)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create extension seg");
        await sql.unsafe("create function public.catch_up_seven() returns integer language sql as 'select 7'");
        await sql.unsafe("create domain public.catch_up_defaulted as integer default public.catch_up_seven()");
        await sql.unsafe("alter extension seg add function public.catch_up_seven()");
        await sql.unsafe("alter extension seg add domain public.catch_up_defaulted");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("domain catch_up_defaulted");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while pg_catalog holds an added SQL function under an admitted name, judged by oid rather than schema (Codex r18)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create function pg_catalog.lower(integer) returns boolean language sql as 'select true'");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("function lower carries a name the additive check admits");
      expect(refusal).not.toContain("function timestamptz");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while an operator class carries an added SQL support function, which an index build runs (Codex r27)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          "create function public.catch_up_cmp(integer, integer) returns integer language sql immutable as 'select btint4cmp($1, $2)'",
        );
        await sql.unsafe(
          "create operator class public.catch_up_int_ops for type integer using btree as operator 1 <, operator 2 <=, operator 3 =, operator 4 >=, operator 5 >, function 1 public.catch_up_cmp(integer, integer)",
        );
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      // `::regproc` prints the name schema-qualified only when the search path would not find it bare.
      expect(refusal).toMatch(/index support function (?:public\.)?catch_up_cmp\b/);
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while a partition holds an index no parent index attached, which a new parent index would take over (Codex r17)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create table public.catchup_parent (id integer, payload text) partition by range (id)");
        await sql.unsafe("create index catchup_parent_id_idx on public.catchup_parent (id)");
        await sql.unsafe(
          "create table public.catchup_child partition of public.catchup_parent for values from (0) to (100)",
        );
        await sql.unsafe("create index catchup_child_payload_idx on public.catchup_child (payload)");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("unattached index catchup_child_payload_idx on partition catchup_child");
      expect(refusal).not.toContain("catchup_child_id_idx");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while public holds a WITH INOUT cast, which has no function for a join to find",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create type public.catch_up_proof_a as enum ('x')");
        await sql.unsafe("create type public.catch_up_proof_b as enum ('x')");
        await sql.unsafe("create cast (public.catch_up_proof_a as public.catch_up_proof_b) with inout");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("cast catch_up_proof_a as catch_up_proof_b");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses while public holds a function under any name the text check admits, built-in or not",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe("create function public.lower(text) returns text language sql immutable as 'select $1'");
        await sql.unsafe("create function public.btree() returns integer language sql as 'select 0'");
      } finally {
        await sql.end({ timeout: 5 });
      }
      const before = await ledger();

      const refusal = (await open({ cwd })).join("\n");

      expect(refusal).toContain("function btree carries a name the additive check admits");
      expect(refusal).toContain("function lower carries a name the additive check admits");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "opens a behind database UNCHANGED under the stale-store hatch, which may be holding it at an older schema (Codex r28)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const before = await ledger();

      const opened = await connectStore({
        cwd,
        env: { [ALLOW_STALE_STORE_ENV]: "1", [STORE_URL_ENV]: database.storeUrl },
        home,
      });
      await unwrap(opened).close();

      expect(await ledger()).toEqual(before);
      expect(before.table).toBe(false);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses under a dry run, which promised to change nothing",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const before = await ledger();

      expect((await open({ catchUp: false, cwd })).join("\n")).toContain("not caught up, because this is a dry run");
      expect(await ledger()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "records the migration ONCE when two verbs race the catch-up, and only one of them claims it",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const before = await ledger();
      const probe = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      const state = await readMigrationState({ cwd, sql: probe }).finally(() => probe.end({ timeout: 5 }));
      const behind = unwrap(state);

      const outcomes = await Promise.all([
        catchUpStore({ cwd, state: behind, url: database.storeUrl }),
        catchUpStore({ cwd, state: behind, url: database.storeUrl }),
      ]);

      expect(behind.kind).toBe("behind");
      expect(outcomes.map((outcome) => unwrap(outcome).kind).toSorted()).toEqual(["applied", "current"]);
      expect(await ledger()).toEqual({ recorded: before.recorded + 1, table: true });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves no snapshot directory behind when the migrations folder cannot be copied (Codex r31)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const probe = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      const state = await readMigrationState({ cwd, sql: probe }).finally(() => probe.end({ timeout: 5 }));
      const behind = unwrap(state);
      rmSync(join(cwd, MIGRATIONS_DIR), { force: true, recursive: true });
      const snapshots = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("sw-catchup-"));
      const before = snapshots();

      const outcome = await catchUpStore({ cwd, state: behind, url: database.storeUrl });

      expect(behind.kind).toBe("behind");
      expect(unwrapErr(outcome).code).toBe("JOURNAL_UNREADABLE");
      expect(snapshots()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  /**
   * Start a catch-up while the apply lock is held, overwrite the pending file once it waits, then release.
   *
   * @param cwd the fixture checkout whose pending migration is swapped
   * @returns how many sessions waited, whether the swapped file's table exists, and the catch-up's own outcome
   */
  async function swapDuringWait({
    cwd,
  }: {
    cwd: string;
  }): Promise<{ outcome: Awaited<ReturnType<typeof catchUpStore>>; swapped: boolean; waiting: number }> {
    const holder = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
    try {
      const probe = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      const behind = unwrap(await readMigrationState({ cwd, sql: probe }).finally(() => probe.end({ timeout: 5 })));
      await holder.unsafe("select pg_advisory_lock(hashtext('slopweaver:store-apply'))");
      const pending = catchUpStore({ cwd, state: behind, url: database.storeUrl });
      let waiting = 0;
      for (let attempt = 0; attempt < 400 && waiting === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const [row] = await holder<{ n: number }[]>`
          select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        waiting = row!.n;
      }
      writeFileSync(join(cwd, MIGRATIONS_DIR, `${TAG}.sql`), 'CREATE TABLE "catch_up_swapped" ("id" integer);\n');
      await holder.unsafe("select pg_advisory_unlock(hashtext('slopweaver:store-apply'))");
      const outcome = await pending;
      const [swapped] = await holder<{ present: boolean }[]>`
        select to_regclass('public.catch_up_swapped') is not null as present`;
      return { outcome, swapped: swapped!.present, waiting };
    } finally {
      await holder.end({ timeout: 5 });
    }
  }

  it(
    "applies the bytes it judged, never a file swapped in while it waited on the apply lock (Codex r26)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const before = await ledger();

      const raced = await swapDuringWait({ cwd });

      expect(raced.waiting).toBe(1);
      expect(raced.swapped).toBe(false);
      expect(await ledger()).toEqual({ recorded: before.recorded + 1, table: true });
      expect(storeErrorLines({ error: unwrapErr(raced.outcome) }).join("\n")).toContain(
        `caught up ${TAG} and store verify is not clean`,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "copies the files behind a symlinked migrations folder, so a swap through the link is never applied (Codex r31)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const live = join(root, "live-migrations");
      renameSync(join(cwd, MIGRATIONS_DIR), live);
      symlinkSync(live, join(cwd, MIGRATIONS_DIR), "dir");
      const before = await ledger();

      const raced = await swapDuringWait({ cwd });

      expect(raced.waiting).toBe(1);
      expect(raced.swapped).toBe(false);
      expect(await ledger()).toEqual({ recorded: before.recorded + 1, table: true });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a migrations entry that is not a regular file, before a FIFO's read can block the door (Codex r31)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const probe = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      const behind = unwrap(await readMigrationState({ cwd, sql: probe }).finally(() => probe.end({ timeout: 5 })));
      const fifo = join(root, "stuck-fifo");
      execFileSync("mkfifo", [fifo]);
      symlinkSync(fifo, join(cwd, MIGRATIONS_DIR, "stuck.sql"));
      const snapshots = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("sw-catchup-"));
      const before = snapshots();

      const outcome = await catchUpStore({ cwd, state: behind, url: database.storeUrl });

      expect(unwrapErr(outcome).code).toBe("JOURNAL_UNREADABLE");
      expect(snapshots()).toEqual(before);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a migrations folder that is itself a link to a FIFO, before it is listed (Codex r32)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const probe = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      const behind = unwrap(await readMigrationState({ cwd, sql: probe }).finally(() => probe.end({ timeout: 5 })));
      const folder = join(cwd, MIGRATIONS_DIR);
      rmSync(folder, { force: true, recursive: true });
      const fifo = join(root, "folder-fifo");
      execFileSync("mkfifo", [fifo]);
      symlinkSync(fifo, folder);
      const snapshots = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("sw-catchup-"));
      const before = snapshots();
      const ledgerBefore = await ledger();

      const outcome = await catchUpStore({ cwd, state: behind, url: database.storeUrl });

      expect(unwrapErr(outcome).code).toBe("JOURNAL_UNREADABLE");
      expect(unwrapErr(outcome).message).toContain("is not a folder");
      expect(snapshots()).toEqual(before);
      expect(await ledger()).toEqual(ledgerBefore);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "copies the bytes behind a symlinked migration FILE, which cpSync's dereference keeps as a link (Codex r31)",
    async () => {
      const cwd = fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL });
      const pendingFile = join(cwd, MIGRATIONS_DIR, `${TAG}.sql`);
      const target = join(root, "pending-target.sql");
      renameSync(pendingFile, target);
      symlinkSync(target, pendingFile);
      const before = await ledger();

      const raced = await swapDuringWait({ cwd });

      expect(raced.waiting).toBe(1);
      expect(raced.swapped).toBe(false);
      expect(await ledger()).toEqual({ recorded: before.recorded + 1, table: true });
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
