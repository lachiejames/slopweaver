/**
 * The lifecycle verbs' pure half: what each parses, and how each reports. The shell module is imported so
 * the manifest-loader gate sees it exercised; the acts themselves need a database and are proven live.
 */
import { describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  baselineLines,
  parseBaselineArgs,
  parsePushArgs,
  parseResetArgs,
  parseVerifyArgs,
  pushLines,
  resetLines,
} from "../../../cli/commands/store/lifecycleArgs.js";
import {
  runStoreBaseline,
  runStorePush,
  runStoreReset,
  runStoreVerify,
  storeBaselineCommand,
  storePushCommand,
  storeResetCommand,
  storeVerifyCommand,
} from "../../../cli/commands/store/lifecycleRun.js";
import { unwrap } from "../../../lib/result.js";
import { classifyMigrationState } from "../../../store/lifecycleCore.js";

describe("the lifecycle verbs are wired", () => {
  it("exports one command per verb, each the runner itself", () => {
    expect(storePushCommand).toBe(runStorePush);
    expect(storeVerifyCommand).toBe(runStoreVerify);
    expect(storeBaselineCommand).toBe(runStoreBaseline);
    expect(storeResetCommand).toBe(runStoreReset);
  });
});

describe("parsing", () => {
  it("push generates by default and --no-generate turns it off", () => {
    expect(unwrap(parsePushArgs({ rest: [] }))).toEqual({ generate: true, home: undefined, json: false });
    expect(unwrap(parsePushArgs({ rest: ["--no-generate", "--json", "--home", "/h"] }))).toEqual({
      generate: false,
      home: "/h",
      json: true,
    });
  });

  it("reset carries the acknowledgement through untouched — the store checks it against the URL", () => {
    expect(unwrap(parseResetArgs({ rest: ["--acknowledge", "slopweaver_small"] }))).toEqual({
      acknowledge: "slopweaver_small",
      home: undefined,
      json: false,
    });
    expect(unwrap(parseResetArgs({ rest: [] })).acknowledge).toBe(undefined);
  });

  it("baseline REQUIRES --through", () => {
    const refused = parseBaselineArgs({ rest: [] });
    expect(refused.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain("--through <tag> is required");
    expect(unwrap(parseBaselineArgs({ rest: ["--through", "0000_polite_lady_mastermind"] })).through).toBe(
      "0000_polite_lady_mastermind",
    );
  });

  it("verify takes --json and --home and nothing else", () => {
    expect(unwrap(parseVerifyArgs({ rest: ["--json"] }))).toEqual({ home: undefined, json: true, workdir: undefined });
    expect(unwrap(parseVerifyArgs({ rest: ["--workdir", "/checkout"] })).workdir).toBe("/checkout");
    expect(parseVerifyArgs({ rest: ["--acknowledge", "x"] }).isErr()).toBe(true);
  });
});

const CURRENT = classifyMigrationState({
  applied: [{ createdAt: 1, hash: "h" }],
  journal: [{ hash: "h", tag: "0000_a", when: 1 }],
  tablesPresent: true,
});

const PUSH = {
  applied: { guards: 60, migrationsDir: "/repo/supabase/migrations", recorded: 1, roles: 8 },
  generated: [],
  verify: { declaredTables: 10, findings: [], state: CURRENT },
};

describe("reporting", () => {
  it("says a push generated nothing when the schema and the migrations agreed", () => {
    expect(pushLines({ report: PUSH })[0]).toBe(
      "store push: the schema and the committed migrations already agree — nothing generated",
    );
  });

  it("tells the operator to COMMIT a generated migration", () => {
    expect(pushLines({ report: { ...PUSH, generated: ["0007_x.sql"] } })[0]).toBe(
      "store push: generated 0007_x.sql — COMMIT IT with the schema change it carries",
    );
  });

  it("says what a reset destroyed, per table with rows, before what it rebuilt", () => {
    const lines = resetLines({
      report: {
        database: "lifecycle_proof",
        destroyed: [
          { rows: 3, table: "content" },
          { rows: 0, table: "person" },
        ],
        push: PUSH,
      },
    });
    expect(lines[0]).toBe('store reset: dropped "lifecycle_proof" — 2 table(s), 3 row(s) destroyed');
    expect(lines[1]).toBe("  content: 3");
    expect(lines[2]).toBe("store push: the schema and the committed migrations already agree — nothing generated");
  });

  it("says what a baseline recorded and what is still pending", () => {
    expect(baselineLines({ report: { pending: ["0004_d"], recorded: ["0000_a", "0001_b"] } })).toEqual([
      "store baseline: recorded 0000_a, 0001_b as already applied",
      "store baseline: pending: 0004_d — run `slopweaver store push`",
    ]);
    expect(baselineLines({ report: { pending: [], recorded: ["0000_a"] } })[1]).toBe(
      "store baseline: nothing pending — the database is current",
    );
  });
});
