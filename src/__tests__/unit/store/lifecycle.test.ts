/**
 * The lifecycle's two database-free reads: the migration journal over a temp repository, and the facts the
 * declared schema commits the verifier to.
 *
 * Every other export here opens a connection, and is not exercised by this lane.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { declaredTableNames } from "../../../store/declared.js";
import { StoreErrors } from "../../../store/errors.js";
import { landedUnreadable } from "../../../store/landedRead.js";
import { declaredSchemaFacts, readJournal } from "../../../store/lifecycle.js";
import { tablesOwnerMayInsert } from "../../../store/policies.js";

const MIGRATION_SQL = "create table t (id int);\n";

/** sha256 of {@link MIGRATION_SQL}, taken with `shasum -a 256` over a file holding exactly that text. */
const MIGRATION_SHA256 = "fb1392022b81a61d209097d28d3ccc17a0de4619aa440f5f820859a94b208102";

// A timed-out landed read reached the live-schema report as a bare "spawnSync git ETIMEDOUT".
describe("landedUnreadable", () => {
  it("names a git read killed at its bound as stopped, with the ref and the bound", () => {
    const killed = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT", signal: "SIGKILL" });
    expect(landedUnreadable({ baseRef: "origin/main", error: killed })).toBe(
      "git was still reading origin/main after 2 minutes, so it was stopped",
    );
  });

  it("keeps an ordinary failure's own first line", () => {
    const missing = new Error("fatal: not a valid object name origin/main\nmore");
    expect(landedUnreadable({ baseRef: "origin/main", error: missing })).toBe(
      "fatal: not a valid object name origin/main",
    );
  });
});

describe("readJournal", () => {
  let cwd = "";
  let folder = "";

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "store-journal-"));
    folder = join(cwd, "supabase", "migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { force: true, recursive: true });
  });

  /** Write the journal document under the temp repository's migrations folder. */
  const journal = ({ entries }: { entries: readonly Record<string, unknown>[] }): void => {
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ entries }));
  };

  it("zips each journal entry's tag with the hash and instant drizzle reads for the same position", () => {
    journal({ entries: [{ breakpoints: true, tag: "0000_first", when: 1_757_000_000_000 }] });
    writeFileSync(join(folder, "0000_first.sql"), MIGRATION_SQL);

    expect(unwrap(readJournal({ cwd }))).toEqual([
      { hash: MIGRATION_SHA256, tag: "0000_first", when: 1_757_000_000_000 },
    ]);
  });

  it("reads an empty journal as no migrations", () => {
    journal({ entries: [] });

    expect(unwrap(readJournal({ cwd }))).toEqual([]);
  });

  it("refuses a journal entry whose tag is not a string as JOURNAL_MISMATCH, counting both sides", () => {
    journal({ entries: [{ tag: 7, when: 1 }] });
    writeFileSync(join(folder, "7.sql"), MIGRATION_SQL);

    const error = unwrapErr(readJournal({ cwd }));

    expect(error.code).toBe("JOURNAL_MISMATCH");
    expect(error.message).toBe("the journal lists 0 entries and drizzle read 1 files");
    expect(error).toEqual(StoreErrors.journalMismatch({ entries: 0, files: 1 }));
  });

  it("refuses a missing journal as JOURNAL_UNREADABLE naming the folder", () => {
    rmSync(join(folder, "meta"), { force: true, recursive: true });

    const error = unwrapErr(readJournal({ cwd }));

    const detail = `ENOENT: no such file or directory, open '${join(folder, "meta", "_journal.json")}'`;
    expect(error.code).toBe("JOURNAL_UNREADABLE");
    expect(error.message).toBe(`could not read the migration journal under ${folder}: ${detail}`);
    expect(error).toEqual(StoreErrors.journalUnreadable({ detail, folder }));
  });

  it("refuses an entry whose migration file is absent as JOURNAL_UNREADABLE with drizzle's own detail", () => {
    journal({ entries: [{ tag: "0000_gone", when: 1 }] });

    const error = unwrapErr(readJournal({ cwd }));

    const detail = `No file ${folder}/0000_gone.sql found in ${folder} folder`;
    expect(error.code).toBe("JOURNAL_UNREADABLE");
    expect(error).toEqual(StoreErrors.journalUnreadable({ detail, folder }));
  });
});

describe("declaredSchemaFacts", () => {
  const facts = declaredSchemaFacts();

  it("declares the three store roles and the one extension", () => {
    expect(facts.roles).toEqual(["slopweaver_owner", "slopweaver_bot", "slopweaver_agent"]);
    expect(facts.extensions).toEqual(["pg_trgm"]);
  });

  it("grants SELECT on every declared table to every role", () => {
    const selects = facts.privileges.filter((grant) => grant.privilege === "SELECT");

    expect(facts.tables.length).toBeGreaterThan(0);
    expect(selects.length).toBe(facts.tables.length * 3);
    for (const role of ["slopweaver_owner", "slopweaver_bot", "slopweaver_agent"]) {
      expect(selects.filter((grant) => grant.role === role).map((grant) => grant.table)).toEqual(facts.tables);
    }
  });

  it("grants INSERT only to the owner, and only on the tables the owner may insert into", () => {
    const inserts = facts.privileges.filter((grant) => grant.privilege === "INSERT");

    expect(inserts.length).toBeGreaterThan(0);
    expect(new Set(inserts.map((grant) => grant.role))).toEqual(new Set(["slopweaver_owner"]));
    expect(inserts.map((grant) => grant.table)).toEqual(
      tablesOwnerMayInsert().filter((table) => declaredTableNames().includes(table)),
    );
  });

  it("names only declared tables in its policies, each with an upper-case command", () => {
    expect(facts.policies.length).toBeGreaterThan(0);
    expect(facts.policies.filter((policy) => !facts.tables.includes(policy.table))).toEqual([]);
    expect(facts.policies.filter((policy) => policy.cmd !== policy.cmd.toUpperCase())).toEqual([]);
  });
});
