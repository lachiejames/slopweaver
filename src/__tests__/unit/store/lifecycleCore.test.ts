/**
 * The pure half of the store lifecycle: what a database's migration state IS, what the destructive verb
 * demands before it acts, and what the verifier calls a disagreement. No Postgres anywhere near it; the
 * live half is proven against a throwaway database in `docs/store/lifecycle-and-schema.md` § "The lifecycle".
 */
import { describe, expect, it } from "vitest";

import {
  acknowledgementProblems,
  baselineDisagreements,
  classifyMigrationState,
  type DeclaredSchemaFacts,
  databaseNameOf,
  type JournalMigration,
  type LiveSchemaFacts,
  migrationStateLine,
  objectsCreatedBy,
  TERMINATE_OTHER_BACKENDS,
  unlandedMigrationDetails,
} from "../../../store/lifecycleCore.js";
import { predicateProbeStatements, verifyFindings, verifyLines } from "../../../store/lifecycleVerify.js";
import { isLocalStoreUrl } from "../../../store/localStoreUrl.js";

const JOURNAL: readonly JournalMigration[] = [
  { hash: "h0", tag: "0000_a", when: 100 },
  { hash: "h1", tag: "0001_b", when: 200 },
  { hash: "h2", tag: "0002_c", when: 300 },
];

describe("classifying a database against the journal", () => {
  it("is fresh with no bookkeeping and no tables — push creates everything", () => {
    const state = classifyMigrationState({ applied: [], journal: JOURNAL, tablesPresent: false });
    expect(state.kind).toBe("fresh");
    expect(state.pending).toEqual(["0000_a", "0001_b", "0002_c"]);
  });

  it("is unrecorded with no bookkeeping and tables present — the hand-applied shape the live store was found in", () => {
    const state = classifyMigrationState({ applied: [], journal: JOURNAL, tablesPresent: true });
    expect(state.kind).toBe("unrecorded");
    expect(state.applied).toBe(0);
  });

  it("is current when every entry is recorded in order", () => {
    const applied = JOURNAL.map((entry) => ({ createdAt: entry.when, hash: entry.hash }));
    const state = classifyMigrationState({ applied, journal: JOURNAL, tablesPresent: true });
    expect(state.kind).toBe("current");
    expect(state.pending).toEqual([]);
    expect(state.applied).toBe(3);
  });

  it("is behind by exactly the unrecorded tail when a prefix is recorded", () => {
    const applied = [{ createdAt: 100, hash: "h0" }];
    const state = classifyMigrationState({ applied, journal: JOURNAL, tablesPresent: true });
    expect(state.kind).toBe("behind");
    expect(state.pending).toEqual(["0001_b", "0002_c"]);
  });

  it("is foreign when a recorded hash is not in the journal — a different tree migrated this database", () => {
    const applied = [
      { createdAt: 100, hash: "h0" },
      { createdAt: 150, hash: "squashed" },
    ];
    const state = classifyMigrationState({ applied, journal: JOURNAL, tablesPresent: true });
    expect(state.kind).toBe("foreign");
    expect(state.foreignHashes).toEqual(["squashed"]);
  });

  it("is foreign when the recorded set skips an entry, because that is not a prefix the migrator produced", () => {
    const applied = [
      { createdAt: 100, hash: "h0" },
      { createdAt: 300, hash: "h2" },
    ];
    const state = classifyMigrationState({ applied, journal: JOURNAL, tablesPresent: true });
    expect(state.kind).toBe("foreign");
  });

  it("says what to run in every non-current line", () => {
    const fresh = classifyMigrationState({ applied: [], journal: JOURNAL, tablesPresent: false });
    const unrecorded = classifyMigrationState({ applied: [], journal: JOURNAL, tablesPresent: true });
    const behind = classifyMigrationState({
      applied: [{ createdAt: 100, hash: "h0" }],
      journal: JOURNAL,
      tablesPresent: true,
    });
    expect(migrationStateLine({ state: fresh })).toContain("slopweaver store push");
    expect(migrationStateLine({ state: unrecorded })).toContain("slopweaver store baseline --through <tag>");
    expect(migrationStateLine({ state: behind })).toBe(
      "migrations: behind by 2 — 0001_b, 0002_c; run `slopweaver store push`",
    );
  });
});

describe("whether a push's pending migrations have landed", () => {
  const landed = { baseRef: "origin/main", hashes: new Map([["0001_b", "h1"]]) };

  it("says nothing when every pending migration is on the base ref byte for byte", () => {
    expect(unlandedMigrationDetails({ landed, pending: [JOURNAL[1]!] })).toEqual([]);
  });

  it("says nothing when nothing is pending, even with the base ref unreadable", () => {
    expect(
      unlandedMigrationDetails({ landed: { baseRef: "origin/main", unreadable: "bad ref" }, pending: [] }),
    ).toEqual([]);
  });

  it("names a migration the base ref does not carry, and one whose bytes differ from the landed copy", () => {
    const branchCopy = { hash: "branch-hash-000000", tag: "0001_b", when: 200 };
    expect(unlandedMigrationDetails({ landed, pending: [branchCopy, JOURNAL[2]!] })).toEqual([
      "0001_b differs from origin/main's copy (branch-hash- here, h1 landed)",
      "0002_c is not on origin/main",
    ]);
  });

  it("refuses to guess when the base ref cannot be read, naming the fetch", () => {
    expect(
      unlandedMigrationDetails({ landed: { baseRef: "origin/main", unreadable: "bad ref" }, pending: [JOURNAL[2]!] }),
    ).toEqual([
      "cannot tell whether 0002_c landed, because origin/main could not be read (bad ref); run `git fetch origin` in this checkout",
    ]);
  });
});

describe("a foreign database whose recorded hashes have all landed", () => {
  const foreign = classifyMigrationState({
    applied: [
      { createdAt: 100, hash: "h0" },
      { createdAt: 200, hash: "41d78831c1b3ffff" },
    ],
    journal: JOURNAL.slice(0, 1),
    tablesPresent: true,
  });

  it("names THIS CHECKOUT as behind, never a reset — the shape after a landed migration", () => {
    const landed = { baseRef: "origin/main", hashes: new Map([["0003_colorful_marauders", "41d78831c1b3ffff"]]) };
    expect(migrationStateLine({ landed, state: foreign })).toBe(
      "migrations: foreign to this checkout only — 41d78831c1b3 is origin/main's 0003_colorful_marauders; this checkout is behind origin/main, so pull or rebase it and the store reads current. Never `store reset` or `SLOPWEAVER_ALLOW_STALE_STORE` for this",
    );
  });

  it("keeps the different-tree line when any recorded hash is not on the base ref", () => {
    const landed = { baseRef: "origin/main", hashes: new Map([["0003_other", "elsewhere"]]) };
    expect(migrationStateLine({ landed, state: foreign })).toContain("migrated by a different tree");
  });

  it("keeps the different-tree line for a skipped history, even with every hash on the base ref — no pull makes it a prefix", () => {
    const skipped = classifyMigrationState({
      applied: [
        { createdAt: 100, hash: "h0" },
        { createdAt: 300, hash: "h2" },
      ],
      journal: JOURNAL,
      tablesPresent: true,
    });
    const landed = {
      baseRef: "origin/main",
      hashes: new Map([
        ["0000_a", "h0"],
        ["0002_c", "h2"],
      ]),
    };
    expect(skipped.skipped).toBe(true);
    expect(migrationStateLine({ landed, state: skipped })).toContain("migrated by a different tree");
  });

  it("keeps the different-tree line when the base ref cannot be read", () => {
    expect(migrationStateLine({ landed: { baseRef: "origin/main", unreadable: "bad ref" }, state: foreign })).toContain(
      "migrated by a different tree",
    );
  });
});

describe("the store URL", () => {
  it("names the database", () => {
    expect(databaseNameOf({ url: "postgresql://postgres:x@127.0.0.1:55322/slopweaver_small" })).toBe(
      "slopweaver_small",
    );
  });

  it("names none when the path is empty or the string is not a URL", () => {
    expect(databaseNameOf({ url: "postgresql://127.0.0.1:55322" })).toBe(undefined);
    expect(databaseNameOf({ url: "not a url" })).toBe(undefined);
  });

  it("is local on loopback only", () => {
    expect(isLocalStoreUrl({ url: "postgresql://127.0.0.1:55322/postgres" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://localhost/postgres" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://[::1]/postgres" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://db.example.supabase.co/postgres" })).toBe(false);
    expect(isLocalStoreUrl({ url: "postgresql://10.0.0.5/postgres" })).toBe(false);
    expect(isLocalStoreUrl({ url: "garbage" })).toBe(false);
  });

  it("refuses a string whose URL hostname is loopback while the client would try another host first", () => {
    // The URL standard reads each hostname as loopback; postgres.js reads db.example.com first.
    expect(isLocalStoreUrl({ url: "postgresql://u:p@db.example.com,x@localhost/store" })).toBe(false);
    expect(isLocalStoreUrl({ url: "postgresql://u:p@db.example.com,x@[::1]/store" })).toBe(false);
    expect(isLocalStoreUrl({ url: "postgresql://u@db.example.com@localhost/store" })).toBe(false);
    expect(isLocalStoreUrl({ url: "postgresql://localhost#@db.example.com/store" })).toBe(false);
  });

  it("refuses a host the client reads from a parameter rather than the authority", () => {
    expect(isLocalStoreUrl({ url: "postgresql://localhost/store?host=db.example.com" })).toBe(false);
    expect(isLocalStoreUrl({ url: "postgresql://localhost/store?hostaddr=203.0.113.7" })).toBe(false);
  });

  it("keeps a local URL with credentials, a port and a malformed password the client will refuse itself", () => {
    expect(isLocalStoreUrl({ url: "postgresql://postgres:pw@127.0.0.1:54322/postgres" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://u:p@[::1]:5432/store" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://u:%ZZ@localhost:5999/db" })).toBe(true);
  });
});

describe("acknowledging a reset", () => {
  it("refuses with no flag, naming the database that would be destroyed", () => {
    expect(acknowledgementProblems({ acknowledged: undefined, database: "slopweaver_small" })).toEqual([
      'store reset destroys every table in "slopweaver_small" — re-run with --acknowledge slopweaver_small to say you mean that one',
    ]);
  });

  it("refuses a flag naming a DIFFERENT database, because the flag exists to be read before it is typed", () => {
    expect(acknowledgementProblems({ acknowledged: "postgres", database: "slopweaver_small" })).toEqual([
      '--acknowledge names "postgres" but the store URL selects "slopweaver_small" — the flag must name the database being reset',
    ]);
  });

  it("refuses when the URL names no database at all", () => {
    expect(acknowledgementProblems({ acknowledged: "x", database: undefined }).length).toBe(1);
  });

  it("admits the matching name", () => {
    expect(acknowledgementProblems({ acknowledged: "slopweaver_small", database: "slopweaver_small" })).toEqual([]);
  });
});

const CURRENT = classifyMigrationState({
  applied: JOURNAL.map((entry) => ({ createdAt: entry.when, hash: entry.hash })),
  journal: JOURNAL,
  tablesPresent: true,
});

const DECLARED: DeclaredSchemaFacts = {
  enums: [{ labels: ["a", "b"], name: "kind" }],
  extensions: ["vector"],
  policies: [
    { cmd: "ALL", name: "widget_owner_all", roles: ["slopweaver_owner"], table: "widget" },
    { cmd: "SELECT", name: "widget_bot_read", roles: ["slopweaver_bot"], table: "widget" },
  ],
  predicates: [
    { cmd: "all", name: "widget_owner_all", table: "widget", using: "true", withCheck: "true" },
    { cmd: "select", name: "widget_bot_read", table: "widget", using: "visibility = 'public'", withCheck: null },
  ],
  privileges: [{ privilege: "SELECT", role: "slopweaver_bot", table: "widget" }],
  roles: ["slopweaver_bot"],
  tables: ["widget"],
};

/** Both policies as Postgres deparses them — what the probe returns for the declared side of a correct store. */
const DEPARSED: LiveSchemaFacts["declaredPredicates"] = [
  { name: "widget_owner_all", table: "widget", using: "true", withCheck: "true" },
  { name: "widget_bot_read", table: "widget", using: "(visibility = 'public'::visibility)", withCheck: null },
];

const LIVE_MATCHING: LiveSchemaFacts = {
  assumableRoles: ["slopweaver_bot"],
  declaredPredicates: DEPARSED,
  enums: [{ labels: ["a", "b"], name: "kind" }],
  extensions: ["vector", "plpgsql"],
  livePredicates: DEPARSED,
  migration: CURRENT,
  policies: DECLARED.policies,
  privileges: [{ held: true, privilege: "SELECT", role: "slopweaver_bot", table: "widget" }],
  tables: [
    { name: "widget", rlsEnabled: true },
    { name: "retired_table", rlsEnabled: false },
  ],
};

describe("verifying a database against the schema", () => {
  it("is clean when everything declared is there, and ignores a table the schema does not declare", () => {
    expect(verifyFindings({ declared: DECLARED, live: LIVE_MATCHING })).toEqual([]);
  });

  it("names a declared table the database lacks — the mistake the owner asked to make impossible", () => {
    const live = { ...LIVE_MATCHING, tables: [{ name: "retired_table", rlsEnabled: false }] };
    const findings = verifyFindings({ declared: DECLARED, live });
    expect(findings[0]).toEqual({ kind: "table", message: '"widget" is declared and does not exist in the database' });
  });

  it("names a table with row level security off", () => {
    const live = { ...LIVE_MATCHING, tables: [{ name: "widget", rlsEnabled: false }] };
    expect(verifyFindings({ declared: DECLARED, live })[0]).toEqual({
      kind: "rls",
      message: '"widget" exists and row level security is OFF',
    });
  });

  it("names a declared policy that is absent AND a live policy that is not declared", () => {
    const live = {
      ...LIVE_MATCHING,
      policies: [
        DECLARED.policies[0]!,
        { cmd: "INSERT", name: "widget_bot_write", roles: ["slopweaver_bot"], table: "widget" },
      ],
    };
    const findings = verifyFindings({ declared: DECLARED, live }).map((finding) => finding.message);
    expect(findings).toEqual([
      "policy widget.widget_bot_read SELECT to slopweaver_bot is declared and absent",
      "policy widget.widget_bot_write INSERT to slopweaver_bot exists and is not declared",
    ]);
  });

  it("names a bot policy whose USING reverted to true — the leak that was closed, with name, operation and role unchanged", () => {
    const live: LiveSchemaFacts = {
      ...LIVE_MATCHING,
      livePredicates: [DEPARSED[0]!, { ...DEPARSED[1]!, using: "true" }],
    };
    expect(verifyFindings({ declared: DECLARED, live })).toEqual([
      {
        kind: "policy",
        message:
          "policy widget.widget_bot_read USING is `true` and the schema declares `(visibility = 'public'::visibility)`",
      },
    ]);
  });

  it("names a WITH CHECK that drifted or vanished, and prints a multi-line deparse on one line", () => {
    const live: LiveSchemaFacts = {
      ...LIVE_MATCHING,
      declaredPredicates: [
        { ...DEPARSED[0]!, withCheck: "(EXISTS ( SELECT 1\n   FROM content c\n  WHERE (c.id = widget.content_id)))" },
        DEPARSED[1]!,
      ],
      livePredicates: [{ ...DEPARSED[0]!, withCheck: null }, DEPARSED[1]!],
    };
    expect(verifyFindings({ declared: DECLARED, live }).map((finding) => finding.message)).toEqual([
      "policy widget.widget_owner_all WITH CHECK is no clause and the schema declares `(EXISTS ( SELECT 1 FROM content c WHERE (c.id = widget.content_id)))`",
    ]);
  });

  it("does not repeat a predicate finding for a declared policy that is already absent", () => {
    const live: LiveSchemaFacts = {
      ...LIVE_MATCHING,
      livePredicates: [DEPARSED[0]!],
      policies: [DECLARED.policies[0]!],
    };
    expect(verifyFindings({ declared: DECLARED, live }).map((finding) => finding.message)).toEqual([
      "policy widget.widget_bot_read SELECT to slopweaver_bot is declared and absent",
    ]);
  });

  it("builds the probe on a same-named temp table, to public, with each clause the policy declares", () => {
    expect(predicateProbeStatements({ predicates: DECLARED.predicates, table: "widget" })).toEqual([
      'create temp table "widget" (like public."widget")',
      'create policy "probe_0" on pg_temp."widget" for all to public using (true) with check (true)',
      'create policy "probe_1" on pg_temp."widget" for select to public using (visibility = \'public\')',
    ]);
  });

  it("names a grant a role does not hold, a missing enum label, a missing extension, an unassumable role", () => {
    const live: LiveSchemaFacts = {
      ...LIVE_MATCHING,
      assumableRoles: [],
      enums: [{ labels: ["a"], name: "kind" }],
      extensions: [],
      privileges: [{ held: false, privilege: "SELECT", role: "slopweaver_bot", table: "widget" }],
    };
    expect(
      verifyFindings({ declared: DECLARED, live }).map((finding) => `${finding.kind}: ${finding.message}`),
    ).toEqual([
      'grant: slopweaver_bot has no SELECT on "widget"',
      "enum: enum \"kind\" lacks the declared label 'b'",
      'extension: extension "vector" is not installed',
      'role: role "slopweaver_bot" cannot be assumed by the connecting user',
    ]);
  });

  it("names a migration state that is not current", () => {
    const live = {
      ...LIVE_MATCHING,
      migration: classifyMigrationState({ applied: [], journal: JOURNAL, tablesPresent: true }),
    };
    const findings = verifyFindings({ declared: DECLARED, live });
    expect(findings.length).toBe(1);
    expect(findings[0]?.kind).toBe("migration");
  });

  it("names a foreign database as this checkout being behind when the base ref carries every recorded hash", () => {
    const live = {
      ...LIVE_MATCHING,
      landed: { baseRef: "origin/main", hashes: new Map([["0003_colorful_marauders", "41d78831c1b3ffff"]]) },
      migration: classifyMigrationState({
        applied: [{ createdAt: 100, hash: "41d78831c1b3ffff" }],
        journal: JOURNAL,
        tablesPresent: true,
      }),
    };
    expect(verifyFindings({ declared: DECLARED, live }).map((finding) => finding.message)).toEqual([
      "migrations: foreign to this checkout only — 41d78831c1b3 is origin/main's 0003_colorful_marauders; this checkout is behind origin/main, so pull or rebase it and the store reads current. Never `store reset` or `SLOPWEAVER_ALLOW_STALE_STORE` for this",
    ]);
  });

  it("renders a clean report that says what it checked, and a dirty one that lists each finding", () => {
    expect(verifyLines({ declaredTables: 1, findings: [], state: CURRENT })).toEqual([
      "store verify: clean — 1 declared table(s) present with row level security on, every declared policy and its predicate, grant, enum label, extension and role in place",
      "migrations: current — 3 recorded, nothing pending",
    ]);
    expect(verifyLines({ declaredTables: 1, findings: [{ kind: "table", message: "x" }], state: CURRENT })).toEqual([
      "store verify: 1 finding(s) — the database does not match the schema",
      "  [table] x",
    ]);
  });
});

describe("what a migration creates, and whether the catalog agrees with a baseline claim", () => {
  const sql = [
    "CREATE TYPE \"public\".\"visibility\" AS ENUM('public', 'private');--> statement-breakpoint",
    'CREATE TABLE "content" ("id" uuid PRIMARY KEY);--> statement-breakpoint',
    'CREATE UNIQUE INDEX "uq_content_id_source" ON "content" USING btree ("id");--> statement-breakpoint',
    'CREATE INDEX "idx_content_body_trgm" ON "content" USING gin ("body" gin_trgm_ops);--> statement-breakpoint',
    'CREATE POLICY "content_bot_read" ON "content" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);',
  ].join("\n");

  it("reads tables, types, policies and indexes out of drizzle-kit's own spellings", () => {
    expect(objectsCreatedBy({ sql })).toEqual({
      indexes: ["uq_content_id_source", "idx_content_body_trgm"],
      policies: ["content_bot_read"],
      tables: ["content"],
      types: ["visibility"],
    });
  });

  const migrations = [
    { creates: { indexes: [], policies: [], tables: ["content"], types: ["visibility"] }, tag: "0000_a" },
    { creates: { indexes: [], policies: ["content_bot_read"], tables: [], types: [] }, tag: "0001_b" },
    { creates: { indexes: ["idx_content_body_trgm"], policies: [], tables: [], types: [] }, tag: "0002_c" },
  ];

  it("accepts a claim the catalog agrees with in both directions", () => {
    const live = {
      indexes: new Set<string>(),
      policies: new Set<string>(),
      tables: new Set(["content"]),
      types: new Set(["visibility"]),
    };
    expect(baselineDisagreements({ live, migrations, throughIndex: 0 })).toEqual([]);
  });

  it("refuses a claim that records a policy migration the database never got — the live store's shape", () => {
    const live = {
      indexes: new Set<string>(),
      policies: new Set<string>(),
      tables: new Set(["content"]),
      types: new Set(["visibility"]),
    };
    expect(baselineDisagreements({ live, migrations, throughIndex: 1 })).toEqual([
      '0001_b creates policy "content_bot_read" and the database does not have it, so it is not already applied',
    ]);
  });

  it("refuses a claim that stops before an index the database already has by hand — the 838 MB case", () => {
    const live = {
      indexes: new Set(["idx_content_body_trgm"]),
      policies: new Set<string>(),
      tables: new Set(["content"]),
      types: new Set(["visibility"]),
    };
    expect(baselineDisagreements({ live, migrations, throughIndex: 0 })).toEqual([
      '0002_c creates index "idx_content_body_trgm" and the database already has it, so --through stops too early',
    ]);
  });
});

describe("the loopback refusal a reset cannot be talked past", () => {
  it("is the same predicate the verb and the function both ask, so neither is the only place it lives", () => {
    expect(isLocalStoreUrl({ url: "postgresql://127.0.0.1:55322/lifecycle_proof" })).toBe(true);
    expect(isLocalStoreUrl({ url: "postgresql://db.example.supabase.co:5432/postgres" })).toBe(false);
  });
});

describe("the reset's terminate sweep survives a backend this role may not signal", () => {
  it("swallows ONLY insufficient_privilege, so a real failure still raises", () => {
    expect(TERMINATE_OTHER_BACKENDS).toContain("exception when insufficient_privilege then");
    expect(TERMINATE_OTHER_BACKENDS).not.toContain("when others");
  });

  it("never signals its own backend, which would kill the reset mid-drop", () => {
    expect(TERMINATE_OTHER_BACKENDS).toContain("pid <> pg_backend_pid()");
  });

  it("stays scoped to the database being reset", () => {
    expect(TERMINATE_OTHER_BACKENDS).toContain("datname = current_database()");
  });

  it("handles each backend separately, so one refusal cannot abandon the rest", () => {
    expect(TERMINATE_OTHER_BACKENDS).toContain("loop");
    expect(TERMINATE_OTHER_BACKENDS).toContain("perform pg_terminate_backend(target.pid)");
  });
});
