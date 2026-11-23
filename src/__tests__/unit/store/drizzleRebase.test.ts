/**
 * What a rebase discards, over journals shaped like the merges that produce them.
 *
 * The property being protected is narrow and it is the whole point of the verb: an entry that was
 * ALREADY APPLIED must never be discarded, because deleting an applied migration is not recoverable by
 * re-running anything. That is why `planRebase` keeps the earliest of a conflicting pair rather than the
 * latest, and why the two-branch case below asserts which of the two survives rather than only how many.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEV_DRIZZLE_REBASE_USAGE,
  parseDevDrizzleRebaseArgs,
  runDevDrizzleRebaseWithDeps,
} from "../../../cli/commands/dev/drizzleRebase.js";
import {
  filesOfEntry,
  planRebase,
  type RebaseJournalEntry,
  renderRebasePlan,
} from "../../../cli/commands/dev/drizzleRebaseCore.js";
import type { Logger } from "../../../lib/logger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One journal entry, so a test names only the field it is about. */
function entry({ idx, tag, when }: { idx: number; tag: string; when: number }): RebaseJournalEntry {
  return { idx, tag, when };
}

describe("a journal that is already in order", () => {
  const plan = planRebase({
    entries: [entry({ idx: 0, tag: "0000_a", when: 100 }), entry({ idx: 1, tag: "0001_b", when: 200 })],
  });

  it("discards nothing", () => {
    expect(plan.discard).toEqual([]);
  });

  it("keeps every entry", () => {
    expect(plan.keep.map((e) => e.tag)).toEqual(["0000_a", "0001_b"]);
  });

  it("says so rather than printing an empty plan", () => {
    const lines = renderRebasePlan({ dryRun: true, plan });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("already in order — nothing to do");
  });
});

describe("two branches that each generated a migration", () => {
  const plan = planRebase({
    entries: [
      entry({ idx: 0, tag: "0000_base", when: 100 }),
      entry({ idx: 1, tag: "0001_branch_a", when: 300 }),
      entry({ idx: 2, tag: "0002_branch_b", when: 200 }),
    ],
  });

  it("discards the entry generated out of order", () => {
    expect(plan.discard.map((e) => e.tag)).toEqual(["0002_branch_b"]);
  });

  it("keeps the earlier of the conflicting pair, which is the one that may already be applied", () => {
    expect(plan.keep.map((e) => e.tag)).toEqual(["0000_base", "0001_branch_a"]);
  });

  it("says which entry it was ordered after, so the reason is checkable", () => {
    expect(plan.reasons[0]).toContain("0002_branch_b was generated at 200, no later than 0001_branch_a's 300");
  });
});

describe("three entries where the last two are both out of order", () => {
  const plan = planRebase({
    entries: [
      entry({ idx: 0, tag: "0000_base", when: 500 }),
      entry({ idx: 1, tag: "0001_x", when: 100 }),
      entry({ idx: 2, tag: "0002_y", when: 200 }),
    ],
  });

  it("discards both, because neither is after the highest already kept", () => {
    expect(plan.discard.map((e) => e.tag)).toEqual(["0001_x", "0002_y"]);
  });

  it("keeps only the base", () => {
    expect(plan.keep.map((e) => e.tag)).toEqual(["0000_base"]);
  });

  it("gives one reason per discarded entry", () => {
    expect(plan.reasons.length).toBe(2);
  });
});

describe("an entry generated at exactly the same instant as the one before it", () => {
  it("is discarded, because equal is not later and the order is therefore not one anybody chose", () => {
    const plan = planRebase({
      entries: [entry({ idx: 0, tag: "a", when: 100 }), entry({ idx: 1, tag: "b", when: 100 })],
    });
    expect(plan.discard.map((e) => e.tag)).toEqual(["b"]);
  });
});

describe("an empty journal", () => {
  it("discards nothing and keeps nothing", () => {
    const plan = planRebase({ entries: [] });
    expect(plan.discard).toEqual([]);
    expect(plan.keep).toEqual([]);
  });
});

describe("the files one discarded entry owns", () => {
  it("names the SQL and the snapshot, because deleting only the SQL misleads the generator", () => {
    expect(filesOfEntry({ entry: entry({ idx: 2, tag: "0002_absurd_magma", when: 1 }) })).toEqual([
      "0002_absurd_magma.sql",
      "meta/0002_snapshot.json",
    ]);
  });

  it("pads the snapshot index to four digits, which is how drizzle-kit names them", () => {
    expect(filesOfEntry({ entry: entry({ idx: 11, tag: "0011_x", when: 1 }) })[1]).toBe("meta/0011_snapshot.json");
  });
});

describe("rendering a plan that will be applied", () => {
  const plan = planRebase({
    entries: [entry({ idx: 0, tag: "0000_a", when: 100 }), entry({ idx: 1, tag: "0001_b", when: 50 })],
  });

  it("says it is discarding rather than would discard", () => {
    expect(renderRebasePlan({ dryRun: false, plan })[0]).toContain("discarding 1 out-of-order entr(ies)");
  });

  it("ends by naming the command that regenerates, rather than running it", () => {
    const lines = renderRebasePlan({ dryRun: false, plan });
    expect(lines[lines.length - 1]).toContain("now run: slopweaver store push");
  });

  it("previews the same plan differently, so a dry run cannot be mistaken for a real one", () => {
    expect(renderRebasePlan({ dryRun: true, plan })[0]).toContain("would discard");
  });
});

/**
 * The verb itself, driven over a real temp fixture with an injected logger.
 *
 * The logger is a plain object of collecting functions passed in through the module's own `deps` seam,
 * not a mock — `runDevDrizzleRebaseWithDeps` exists precisely so a test drives the shipped code path
 * rather than a restatement of it. The filesystem is a genuine round-trip in a `mkdtempSync` directory,
 * which is the one I/O `testing.md` allows, and every test removes what it minted.
 */
describe("the verb, over a real migrations directory", () => {
  let dir: string;

  /** A journal in drizzle's own shape, so what the verb reads is what drizzle-kit writes. */
  function writeFixture({ entries }: { entries: readonly RebaseJournalEntry[] }): void {
    mkdirSync(join(dir, "meta"), { recursive: true });
    for (const e of entries) {
      writeFileSync(join(dir, `${e.tag}.sql`), `-- ${e.tag}\n`, "utf8");
      writeFileSync(join(dir, "meta", `${String(e.idx).padStart(4, "0")}_snapshot.json`), "{}\n", "utf8");
    }
    const document = { version: "7", dialect: "postgresql", entries };
    writeFileSync(join(dir, "meta", "_journal.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }

  /** Collects what the verb printed, so an assertion reads the real output. */
  function collectingLogger({ lines }: { lines: string[] }): Logger {
    const push = ({ msg }: { msg: string }): void => {
      lines.push(msg);
    };
    return {
      debug: push,
      error: push,
      info: push,
      out: ({ line }) => {
        lines.push(line);
      },
      warn: push,
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sw-rebase-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("prints its usage and does nothing on --help", () => {
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--help"],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(0);
    expect(lines[0]).toBe(DEV_DRIZZLE_REBASE_USAGE);
  });

  it("refuses a directory with no journal rather than reporting nothing to do", () => {
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(1);
    expect(lines[0]).toContain("nothing records an apply order");
  });

  it("refuses --migrations with no value rather than reading an empty path", () => {
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations"],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(2);
    expect(lines).toEqual(["--migrations requires a value", DEV_DRIZZLE_REBASE_USAGE]);
  });

  it("refuses --migrations followed by --dry-run, rather than reading a directory called --dry-run", () => {
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", "--dry-run"],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(2);
    expect(lines).toEqual(["--migrations requires a value", DEV_DRIZZLE_REBASE_USAGE]);
  });

  it("refuses --migrations given an empty path", () => {
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", ""],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(2);
    expect(lines).toEqual(["--migrations was given an empty value — pass the value itself", DEV_DRIZZLE_REBASE_USAGE]);
  });

  it("leaves every file in place on --dry-run", () => {
    writeFixture({
      entries: [
        entry({ idx: 0, tag: "0000_a", when: 100 }),
        entry({ idx: 1, tag: "0001_b", when: 300 }),
        entry({ idx: 2, tag: "0002_c", when: 200 }),
      ],
    });
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir, "--dry-run"],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(0);
    expect(lines[0]).toContain("would discard 1 out-of-order entr(ies)");
    expect(existsSync(join(dir, "0002_c.sql"))).toBe(true);
    expect(existsSync(join(dir, "meta", "0002_snapshot.json"))).toBe(true);
  });

  it("removes the out-of-order migration and its snapshot on a real run", () => {
    writeFixture({
      entries: [
        entry({ idx: 0, tag: "0000_a", when: 100 }),
        entry({ idx: 1, tag: "0001_b", when: 300 }),
        entry({ idx: 2, tag: "0002_c", when: 200 }),
      ],
    });
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "0002_c.sql"))).toBe(false);
    expect(existsSync(join(dir, "meta", "0002_snapshot.json"))).toBe(false);
  });

  it("keeps the migration that may already have been applied", () => {
    writeFixture({
      entries: [
        entry({ idx: 0, tag: "0000_a", when: 100 }),
        entry({ idx: 1, tag: "0001_b", when: 300 }),
        entry({ idx: 2, tag: "0002_c", when: 200 }),
      ],
    });
    runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir],
      log: collectingLogger({ lines: [] }),
    });
    expect(existsSync(join(dir, "0001_b.sql"))).toBe(true);
  });

  it("rewrites the journal to what survived, renumbered from zero", () => {
    writeFixture({
      entries: [
        entry({ idx: 0, tag: "0000_a", when: 100 }),
        entry({ idx: 1, tag: "0001_b", when: 300 }),
        entry({ idx: 2, tag: "0002_c", when: 200 }),
      ],
    });
    runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir],
      log: collectingLogger({ lines: [] }),
    });
    const written: unknown = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
    expect(JSON.stringify(written)).toBe(
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, tag: "0000_a", when: 100 },
          { idx: 1, tag: "0001_b", when: 300 },
        ],
      }),
    );
  });

  it("touches nothing when the journal is already in order", () => {
    writeFixture({
      entries: [entry({ idx: 0, tag: "0000_a", when: 100 }), entry({ idx: 1, tag: "0001_b", when: 300 })],
    });
    const lines: string[] = [];
    const code = runDevDrizzleRebaseWithDeps({
      argv: ["node", "slopweaver", "dev", "drizzle-rebase", "--migrations", dir],
      log: collectingLogger({ lines }),
    });
    expect(code).toBe(0);
    expect(lines[0]).toContain("already in order — nothing to do");
    expect(existsSync(join(dir, "0001_b.sql"))).toBe(true);
  });
});

describe("parsing the flag tail", () => {
  it("takes the repository's own migrations directory when --migrations is absent", () => {
    expect(unwrap(parseDevDrizzleRebaseArgs({ rest: ["--dry-run"] }))).toEqual({
      dir: join("supabase", "migrations"),
      dryRun: true,
    });
  });

  it("refuses an empty --migrations rather than reading it as a directory with no journal", () => {
    expect(unwrapErr(parseDevDrizzleRebaseArgs({ rest: ["--migrations", ""] }))).toEqual([
      "--migrations was given an empty value — pass the value itself",
    ]);
  });
});
