/**
 * `readRecipeDefinitionRuns` / `recordRecipeDefinitionRun` — the last-run stamp `definitionDue.ts` needs.
 *
 * A genuine round-trip through a `mkdtempSync` directory, which `testing.md` admits as a fixture rather
 * than as I/O: the thing under test IS the file, so a fake would be testing the fake.
 *
 * The concurrency cases are the reason this file matters more than its size suggests. `recordRecipeDefinitionRun`
 * used to merge the row into a map its CALLER had read, so a stamp written between that read and this write
 * was erased — and an erased stamp makes the row due again, which for an `alert-summary` row is a second
 * card in a channel. Each case below is written so it goes RED against that shape.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  lastRecipeRun,
  mergeRecipeDefinitionRun,
  RECIPE_DEFINITION_RUNS_LOCK_KEY,
  RECIPE_DEFINITION_RUNS_SCHEMA_VERSION,
  readRecipeDefinitionRuns,
  recordRecipeDefinitionRun,
} from "../../../../live/automation/definitionRunStore.js";
import { RecipeErrors, recipeErrorLines } from "../../../../live/automation/errors.js";

const dirs: string[] = [];

/** One throwaway directory, removed after the test that minted it. */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  dirs.push(dir);
  return dir;
}

/** The instant every lock attempt in this file is judged at; no case here depends on lock staleness. */
const AT = "2026-09-15T08:00:00.000Z";

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readRecipeDefinitionRuns", () => {
  it("reads an absent file as an empty map rather than a failure", () => {
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(sandbox(), "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("reads back what was recorded", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "atlas-rolling-window",
        run: { exitCode: 0, lastRunAtIso: "2026-09-08T12:00:00.000Z", watermarkIso: "2026-09-08T12:00:00.000Z" },
      }),
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path }));
    expect(runs["atlas-rolling-window"]).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-08T12:00:00.000Z",
      lastRunAtIso: "2026-09-08T12:00:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });

  it("reads back a dead firing's cause, so it outlives the ledger row it was settled from", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: {
          exitCode: 1,
          failureCause: "ATTEMPTS_EXHAUSTED: slack post: channel_not_found",
          failureSlotIso: "2026-09-08T12:00:00.000Z",
          lastRunAtIso: "2026-09-08T12:05:00.000Z",
          watermarkIso: "2026-09-08T12:00:00.000Z",
        },
      }),
    );
    expect(unwrap(readRecipeDefinitionRuns({ path }))["knock-alerts"]).toEqual({
      exitCode: 1,
      failureCause: "ATTEMPTS_EXHAUSTED: slack post: channel_not_found",
      failureSlotIso: "2026-09-08T12:00:00.000Z",
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });

  it("reads an entry written before the cause existed as carrying none, never refusing it", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(
      path,
      JSON.stringify({
        runs: {
          one: { exitCode: 1, lastRunAtIso: "2026-09-08T12:05:00.000Z", watermarkIso: "2026-09-08T12:00:00.000Z" },
        },
        schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION,
      }),
      "utf8",
    );
    expect(unwrap(readRecipeDefinitionRuns({ path }))["one"]).toEqual({
      exitCode: 1,
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });

  it("takes the finish instant as the watermark of an entry that recorded no slot, so its verdict does not move", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(
      path,
      JSON.stringify({
        runs: { one: { exitCode: 0, lastRunAtIso: "2026-09-08T12:05:00.000Z" } },
        schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION,
      }),
      "utf8",
    );
    expect(unwrap(readRecipeDefinitionRuns({ path }))["one"]).toEqual({
      exitCode: 0,
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:05:00.000Z",
    });
  });

  it("refuses an entry whose watermark is not an instant rather than guessing one", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(
      path,
      JSON.stringify({
        runs: { one: { exitCode: 0, lastRunAtIso: "2026-09-08T12:05:00.000Z", watermarkIso: 7 } },
        schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION,
      }),
      "utf8",
    );
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))).toEqual(
      recipeErrorLines({ error: RecipeErrors.runEntryUnreadable({ path, recipeId: "one" }) }),
    );
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))[0]).toContain("unreadable entry for recipe 'one'");
  });

  it("refuses a file this build did not write, rather than reading it as never-ran", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(path, JSON.stringify({ runs: {}, schemaVersion: 99 }), "utf8");
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))).toEqual(
      recipeErrorLines({
        error: RecipeErrors.runsFileWrongSchema({ expected: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION, path }),
      }),
    );
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))[0]).toContain("is not a definition-runs file");
  });

  it("refuses a file that is not JSON", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(path, "{not json", "utf8");
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))[0]).toContain("is not valid JSON");
  });

  it("refuses an entry it cannot read rather than dropping it", () => {
    const path = join(sandbox(), "definition-runs.json");
    writeFileSync(
      path,
      JSON.stringify({ runs: { one: { lastRunAtIso: 7 } }, schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION }),
      "utf8",
    );
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))).toEqual(
      recipeErrorLines({ error: RecipeErrors.runEntryUnreadable({ path, recipeId: "one" }) }),
    );
    expect(unwrapErr(readRecipeDefinitionRuns({ path }))[0]).toContain("unreadable entry for recipe 'one'");
  });
});

describe("lastRecipeRun", () => {
  const run = { exitCode: 0, lastRunAtIso: AT, watermarkIso: AT };

  it("returns the stamp a row that ran carries", () => {
    expect(lastRecipeRun({ recipeId: "one", runs: { one: run } })).toBe(run);
  });

  it("returns null for a row that never ran, which is due for the first time", () => {
    expect(lastRecipeRun({ recipeId: "two", runs: { one: run } })).toBeNull();
  });
});

describe("mergeRecipeDefinitionRun", () => {
  it("takes the arriving run whole when the row has never been stamped", () => {
    const arriving = {
      exitCode: 0,
      lastRunAtIso: "2026-09-15T13:00:30.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    };
    expect(mergeRecipeDefinitionRun({ arriving, stored: undefined })).toEqual({
      ...arriving,
      firstSucceededIso: "2026-09-15T13:00:30.000Z",
    });
  });

  it("records no first success for a first run that failed or was refused", () => {
    const arriving = {
      exitCode: 3,
      lastRunAtIso: "2026-09-15T13:00:30.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    };

    expect(mergeRecipeDefinitionRun({ arriving, stored: undefined })).toEqual(arriving);
  });

  it("carries an older record's own success forward when a later run fails", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 1, lastRunAtIso: "2026-09-16T13:00:30.000Z", watermarkIso: "2026-09-16T13:00:00.000Z" },
      stored: { exitCode: 0, lastRunAtIso: "2026-09-15T13:00:30.000Z", watermarkIso: "2026-09-15T13:00:00.000Z" },
    });

    expect(merged.firstSucceededIso).toBe("2026-09-15T13:00:30.000Z");
  });

  it("keeps the first success across a later failure, and never moves it to a later success", () => {
    const stored = {
      exitCode: 0,
      firstSucceededIso: "2026-09-14T13:00:30.000Z",
      lastRunAtIso: "2026-09-15T13:00:30.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    };
    const failed = mergeRecipeDefinitionRun({
      arriving: { exitCode: 1, lastRunAtIso: "2026-09-16T13:00:30.000Z", watermarkIso: "2026-09-16T13:00:00.000Z" },
      stored,
    });
    const succeeded = mergeRecipeDefinitionRun({
      arriving: { exitCode: 0, lastRunAtIso: "2026-09-17T13:00:30.000Z", watermarkIso: "2026-09-17T13:00:00.000Z" },
      stored: failed,
    });

    expect(failed.firstSucceededIso).toBe("2026-09-14T13:00:30.000Z");
    expect(succeeded.firstSucceededIso).toBe("2026-09-14T13:00:30.000Z");
  });

  it("advances a watermark the arriving run moved forward", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 0, lastRunAtIso: "2026-09-15T14:00:10.000Z", watermarkIso: "2026-09-15T14:00:00.000Z" },
      stored: { exitCode: 0, lastRunAtIso: "2026-09-15T13:00:30.000Z", watermarkIso: "2026-09-15T13:00:00.000Z" },
    });
    expect(merged.watermarkIso).toBe("2026-09-15T14:00:00.000Z");
  });

  it("clears a dead firing's cause once a later run succeeds, so a healed row says nothing stale", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 0, lastRunAtIso: "2026-09-16T13:00:30.000Z", watermarkIso: "2026-09-16T13:00:00.000Z" },
      stored: {
        exitCode: 1,
        failureCause: "ATTEMPTS_EXHAUSTED: slack post: channel_not_found",
        failureSlotIso: "2026-09-15T13:00:00.000Z",
        lastRunAtIso: "2026-09-15T13:00:30.000Z",
        watermarkIso: "2026-09-15T13:00:00.000Z",
      },
    });
    expect(merged).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-16T13:00:30.000Z",
      lastRunAtIso: "2026-09-16T13:00:30.000Z",
      watermarkIso: "2026-09-16T13:00:00.000Z",
    });
  });

  it("keeps the arriving dead firing's own cause when its older slot lands second", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: {
        exitCode: 1,
        failureCause: "HOLDER_GONE: attempt 1 started its run and was abandoned",
        failureSlotIso: "2026-09-15T12:00:00.000Z",
        lastRunAtIso: "2026-09-15T13:02:00.000Z",
        watermarkIso: "2026-09-15T12:00:00.000Z",
      },
      stored: { exitCode: 1, lastRunAtIso: "2026-09-15T13:00:30.000Z", watermarkIso: "2026-09-15T13:00:00.000Z" },
    });
    expect(merged).toEqual({
      exitCode: 1,
      failureCause: "HOLDER_GONE: attempt 1 started its run and was abandoned",
      failureSlotIso: "2026-09-15T12:00:00.000Z",
      lastRunAtIso: "2026-09-15T13:02:00.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    });
  });

  it("never lets a dead firing that finished BEFORE the stored run revive its cause over that run", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: {
        exitCode: 1,
        failureCause: "ATTEMPTS_EXHAUSTED: slack post: channel_not_found",
        failureSlotIso: "2026-09-15T09:00:00.000Z",
        lastRunAtIso: "2026-09-15T10:00:00.000Z",
        watermarkIso: "2026-09-15T09:00:00.000Z",
      },
      stored: { exitCode: 0, lastRunAtIso: "2026-09-15T10:01:00.000Z", watermarkIso: "2026-09-15T10:00:00.000Z" },
    });
    expect(merged).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-15T10:01:00.000Z",
      lastRunAtIso: "2026-09-15T10:01:00.000Z",
      watermarkIso: "2026-09-15T10:00:00.000Z",
    });
  });

  it("gives a same-millisecond tie to the run recorded last, as it always has", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 0, lastRunAtIso: "2026-10-10T10:00:00.000Z", watermarkIso: "2026-10-10T09:30:00.000Z" },
      stored: {
        exitCode: 1,
        failureCause: "ATTEMPTS_EXHAUSTED: slack post: channel_not_found",
        failureSlotIso: "2026-10-10T09:00:00.000Z",
        lastRunAtIso: "2026-10-10T10:00:00.000Z",
        watermarkIso: "2026-10-10T09:00:00.000Z",
      },
    });
    expect(merged).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-10-10T10:00:00.000Z",
      lastRunAtIso: "2026-10-10T10:00:00.000Z",
      watermarkIso: "2026-10-10T09:30:00.000Z",
    });
  });

  it("still advances the watermark from an arrival that finished before the stored run", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 1, lastRunAtIso: "2026-09-15T10:00:00.000Z", watermarkIso: "2026-09-15T11:00:00.000Z" },
      stored: { exitCode: 1, lastRunAtIso: "2026-09-15T10:01:00.000Z", watermarkIso: "2026-09-15T10:00:00.000Z" },
    });
    expect(merged).toEqual({
      exitCode: 1,
      lastRunAtIso: "2026-09-15T10:01:00.000Z",
      watermarkIso: "2026-09-15T11:00:00.000Z",
    });
  });

  it("keeps the newer watermark, and the arriving run's own finish and exit code, when an older slot lands second", () => {
    const merged = mergeRecipeDefinitionRun({
      arriving: { exitCode: 1, lastRunAtIso: "2026-09-15T13:02:00.000Z", watermarkIso: "2026-09-15T12:00:00.000Z" },
      stored: { exitCode: 0, lastRunAtIso: "2026-09-15T13:00:30.000Z", watermarkIso: "2026-09-15T13:00:00.000Z" },
    });
    expect(merged).toEqual({
      exitCode: 1,
      firstSucceededIso: "2026-09-15T13:00:30.000Z",
      lastRunAtIso: "2026-09-15T13:02:00.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    });
  });
});

describe("recordRecipeDefinitionRun", () => {
  it("leaves every other row's stamp alone when one row runs", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "first",
        run: { exitCode: 0, lastRunAtIso: "2026-09-08T12:00:00.000Z", watermarkIso: "2026-09-08T12:00:00.000Z" },
      }),
    );
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "second",
        run: { exitCode: 1, lastRunAtIso: "2026-09-08T13:00:00.000Z", watermarkIso: "2026-09-08T13:00:00.000Z" },
      }),
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path }));
    expect(Object.keys(runs).toSorted()).toEqual(["first", "second"]);
    expect(runs["first"]!.lastRunAtIso).toBe("2026-09-08T12:00:00.000Z");
    expect(runs["second"]!.exitCode).toBe(1);
  });

  it("keeps a stamp another writer landed after this tick read the file", () => {
    // The measured failure, reproduced: tick A reads the file, tick B stamps `growth-ops` while
    // A is still running its row, then A stamps `knock-alerts`. `runsAtTickStart` is what A used to carry
    // into its write, and carrying it is what erased B's row. The assertion on `growth-ops` is the witness.
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "store-backup-daily",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T01:46:00.000Z", watermarkIso: "2026-09-15T01:46:00.000Z" },
      }),
    );
    const runsAtTickStart = unwrap(readRecipeDefinitionRuns({ path }));
    expect(Object.keys(runsAtTickStart)).toEqual(["store-backup-daily"]);

    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "growth-ops",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T03:07:00.000Z", watermarkIso: "2026-09-15T03:07:00.000Z" },
      }),
    );
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T03:08:00.000Z", watermarkIso: "2026-09-15T03:08:00.000Z" },
      }),
    );

    const runs = unwrap(readRecipeDefinitionRuns({ path }));
    expect(Object.keys(runs).toSorted()).toEqual(["growth-ops", "knock-alerts", "store-backup-daily"]);
    expect(runs["growth-ops"]!.lastRunAtIso).toBe("2026-09-15T03:07:00.000Z");
    expect(runs["store-backup-daily"]!.lastRunAtIso).toBe("2026-09-15T01:46:00.000Z");
  });

  it("never moves a watermark backwards when the tick covering an OLDER slot finishes second", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T13:00:30.000Z", watermarkIso: "2026-09-15T13:00:00.000Z" },
      }),
    );
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 1, lastRunAtIso: "2026-09-15T13:02:00.000Z", watermarkIso: "2026-09-15T12:00:00.000Z" },
      }),
    );
    expect(unwrap(readRecipeDefinitionRuns({ path }))["knock-alerts"]).toEqual({
      exitCode: 1,
      firstSucceededIso: "2026-09-15T13:00:30.000Z",
      lastRunAtIso: "2026-09-15T13:02:00.000Z",
      watermarkIso: "2026-09-15T13:00:00.000Z",
    });
  });

  it("refuses rather than overwriting a runs file it cannot read", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    writeFileSync(path, "{not json", "utf8");
    const written = recordRecipeDefinitionRun({
      home,
      nowIso: AT,
      path,
      recipeId: "knock-alerts",
      run: { exitCode: 0, lastRunAtIso: "2026-09-15T03:08:00.000Z", watermarkIso: "2026-09-15T03:08:00.000Z" },
    });
    expect(unwrapErr(written)[0]).toContain("is not valid JSON");
    // The unreadable bytes are still there: rewriting the file would have turned one corrupt file into a
    // roster of rows that read as never-ran, and re-run every one of them on the next tick.
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("reports a stamp it could not take the runs lock for, rather than writing without it", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    const held = acquireOperationLock({ home, key: RECIPE_DEFINITION_RUNS_LOCK_KEY, nowIso: AT });
    expect(held.isOk()).toBe(true);
    try {
      const written = recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T03:08:00.000Z", watermarkIso: "2026-09-15T03:08:00.000Z" },
      });
      expect(unwrapErr(written)[0]).toContain("cannot write");
      // The lock's own reason is carried through rather than flattened into "busy": which of contention and
      // a dead holder it was is the first thing an operator reading a failed tick needs.
      expect(unwrapErr(written)[0]).toContain("this is contention");
      expect(unwrap(readRecipeDefinitionRuns({ path }))).toEqual({});
    } finally {
      unwrap(held).release();
    }
  });

  it("releases the runs lock, so the next stamp is not blocked by the last one", () => {
    const home = sandbox();
    const path = join(home, "definition-runs.json");
    unwrap(
      recordRecipeDefinitionRun({
        home,
        nowIso: AT,
        path,
        recipeId: "knock-alerts",
        run: { exitCode: 0, lastRunAtIso: "2026-09-15T03:08:00.000Z", watermarkIso: "2026-09-15T03:08:00.000Z" },
      }),
    );
    const after = acquireOperationLock({ home, key: RECIPE_DEFINITION_RUNS_LOCK_KEY, nowIso: AT });
    expect(after.isOk()).toBe(true);
    unwrap(after).release();
  });
});

describe("recipeErrorLines", () => {
  it("prints each of an unreadable runs file's reasons on its own line, never the joined message", () => {
    const error = RecipeErrors.runsFileUnreadable({
      path: "/x/runs.json",
      reasons: ["cannot read /x/runs.json: EACCES", "second"],
    });
    expect(recipeErrorLines({ error })).toEqual(["cannot read /x/runs.json: EACCES", "second"]);
  });

  it("prints each of a digest card's schema issues on its own line", () => {
    expect(
      recipeErrorLines({ error: RecipeErrors.digestCardInvalid({ reasons: ["kind: bad", "items: bad"] }) }),
    ).toEqual(["kind: bad", "items: bad"]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(recipeErrorLines({ error: RecipeErrors.runsMapMissing({ path: "/x/runs.json" }) })).toEqual([
      "/x/runs.json carries no runs map",
    ]);
  });
});
