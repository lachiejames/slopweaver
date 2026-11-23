/**
 * `--recipe <id>` — the selector, against the store shape that produced the finding.
 *
 * The fixture is deliberately the measured one in miniature: a row the caller wants sits BEHIND rows that
 * belong to another session, so `--limit` — a prefix of store order, never a choice within it — reaches the
 * wrong ones. Each test below asserts the dispatch, because which argv reached the dispatcher is the only
 * thing that says a named row was actually the one that ran.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { failureFindingSlug } from "../../../../../../live/automation/failureHold.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, firingAt, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due --recipe", () => {
  /** The argv one dispatch of the `store-backup-daily` stand-in carries, as the row's own params name it. */
  const BACKUP_ARGV = ["node", "slopweaver", "store", "backup"];

  /** The argv one dispatch of the ahead-of-it `resync` stand-in carries. */
  const RESYNC_ARGV = ["node", "slopweaver", "atlas", "freshness", "--behind-only"];

  /**
   * The row registered behind the scheduler's own — a copy of the real `store-backup-daily` row's fields,
   * `effect: "read-write"` included, because `store backup` is an `external-write` verb and a row declaring
   * anything narrower is refused before it ever reaches the dispatcher.
   */
  function backupRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return row({
      effect: "read-write",
      params: { argv: ["store", "backup"] },
      recipeId: "store-backup-daily",
      ...over,
    });
  }

  /** A store whose FIRST row is the scheduler's and whose second is the one a chair wants. */
  function homeBehindOneRow(): string {
    return homeWith({ rows: [row({ recipeId: "resync-atlas-airtable" }), backupRow()] });
  }

  it("runs the named row when --limit alone would only ever reach the one ahead of it", async () => {
    const home = homeBehindOneRow();

    const unnarrowed = deps();
    await runDueUnderFake({ argv: argvFor({ home, tail: ["--limit", "1"] }), deps: unnarrowed });
    expect(unnarrowed.dispatched).toEqual([RESYNC_ARGV]);

    const narrowed = deps();
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-daily", "--limit", "1"] }),
      deps: narrowed,
    });
    expect(code).toBe(0);
    expect(narrowed.dispatched).toEqual([BACKUP_ARGV]);
  });

  it("judges and reports only the named row, so one id does not print the whole store", async () => {
    const home = homeBehindOneRow();
    const injected = deps();
    await runDueUnderFake({ argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }), deps: injected });
    expect(injected.out).toContain(
      "recipe store-backup-daily · DUE · has never run · covers slot 2026-09-08T12:00:00.000Z",
    );
    expect(injected.out.filter((line) => line.includes("resync-atlas-airtable"))).toEqual([]);
  });

  it("stamps the named row it ran, and leaves the row it did not run still due", async () => {
    const home = homeBehindOneRow();
    await runDueUnderFake({ argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }), deps: deps() });
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({
      "store-backup-daily": {
        exitCode: 0,
        firstSucceededIso: "2026-09-08T12:05:00.000Z",
        lastRunAtIso: "2026-09-08T12:05:00.000Z",
        watermarkIso: "2026-09-08T12:00:00.000Z",
      },
    });

    const second = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: second });
    expect(second.dispatched).toEqual([RESYNC_ARGV]);
  });

  it("runs nothing and says which row is not due when the named row is inside its cadence", async () => {
    const home = homeBehindOneRow();
    await runDueUnderFake({ argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }), deps: deps() });

    const second = deps();
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }),
      deps: second,
    });
    expect(code).toBe(0);
    expect(second.dispatched).toEqual([]);
    expect(second.out.at(-1)).toBe("automation run-due · store-backup-daily is not due — nothing to run");
  });

  it("refuses an id no row carries, naming the store, and dispatches nothing", async () => {
    const home = homeBehindOneRow();
    const injected = deps();
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-dialy"] }),
      deps: injected,
    });
    expect(code).toBe(2);
    expect(injected.dispatched).toEqual([]);
    expect(injected.diag[0]).toBe(
      "--recipe `store-backup-dialy`: no row in " +
        join(home, "live", "recipe", "definitions") +
        " carries that recipeId (2 row(s) parsed) — `slopweaver automation due` lists every one",
    );
  });

  it("refuses an empty --recipe through the same unmatched-id path rather than a second message", async () => {
    const home = homeBehindOneRow();
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home, tail: ["--recipe", ""] }), deps: injected });
    expect(code).toBe(2);
    expect(injected.dispatched).toEqual([]);
    expect(injected.diag[0]).toContain("--recipe ``: no row in ");
  });

  it("skips the named row, without running it, when another dispatcher's attempt is still live", async () => {
    const home = homeBehindOneRow();
    // The firing is asked of the cadence rather than written out: a cron expression is evaluated in the
    // machine's LOCAL time, so a literal instant here would pass in one timezone and seed the wrong record
    // in another.
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    unwrap(
      beginSlotAttempt({
        holder: "another-tick",
        holderPid: null,
        holderToken: "tok-other",
        home,
        leaseExpiresIso: "2026-09-09T03:00:00.000Z",
        nowIso: "2026-09-08T12:00:00.000Z",
        processAlive: () => true,
        recipeId: "store-backup-daily",
        slotIso,
      }),
    );
    const injected = deps();
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }),
      deps: injected,
    });
    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out).toContain(
      `recipe store-backup-daily · slot ${slotIso} · HELD · attempt 1 is running under another-tick until 2026-09-09T03:00:00.000Z`,
    );
  });

  it("dead-letters, rather than holding all day, a firing whose run-due holder process was killed", async () => {
    // The incident: a run-due took the backup's firing, was killed by its caller's `timeout`
    // before it settled, and every later tick read HELD until the lease ran out a cadence period later.
    const home = homeBehindOneRow();
    const slotIso = firingAt({ cadence: "0 * * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 4242,
        holderToken: "tok-killed",
        home,
        leaseExpiresIso: "2026-09-09T03:00:00.000Z",
        nowIso: "2026-09-08T12:00:00.000Z",
        processAlive: () => true,
        recipeId: "store-backup-daily",
        slotIso,
      }),
    );
    const probed: number[] = [];
    const injected = deps({
      processAlive: ({ pid }) => {
        probed.push(pid);
        return false;
      },
    });
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }),
      deps: injected,
    });

    // A read-write `verb-run` cannot prove whether the killed run wrote, so it is NOT blindly re-run.
    expect(injected.dispatched).toEqual([]);
    expect(probed).toEqual([4242]);
    expect(code).toBe(1);
    expect(injected.out).toContain(
      `recipe store-backup-daily · slot ${slotIso} · DEAD LETTER · attempt 1 was abandoned (holder pid 4242 ` +
        "is gone) and its outcome cannot be established rather than a blind re-run · HELD on finding " +
        `${failureFindingSlug({ attempt: 1, recipeId: "store-backup-daily", slotIso })} until its fix lands`,
    );
    expect(injected.registered.length).toBe(1);
    expect(injected.registered[0]!.join(" ")).toContain("holder pid 4242 is gone");
    const stored = unwrap(readSlotAttempt({ home, recipeId: "store-backup-daily", slotIso }))!;
    expect(stored.outcome).toEqual({
      detail:
        "attempt 1 under recipe run-due was abandoned (holder pid 4242 is gone) and left no receipt, and this " +
        "kind's destination takes no idempotency key, so nobody can say whether its effect landed",
      kind: "dead",
      reason: "OUTCOME_UNKNOWN",
      settledAtIso: "2026-09-08T12:05:00.000Z",
    });
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["store-backup-daily"]!.watermarkIso).toBe(slotIso);
  });

  it("runs the named row despite a sibling file that is not a definition, and still fails the tick for it", async () => {
    const home = homeWith({ rows: [{ recipeId: "broken" }, backupRow()] });
    const injected = deps();
    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "store-backup-daily"] }),
      deps: injected,
    });
    // The named row runs — a rejection has never blocked a dispatch — and the tick still exits non-zero,
    // exactly as the unnarrowed one would, so `run-due --recipe <id> || alert` fires on an unparseable store.
    expect(injected.dispatched).toEqual([BACKUP_ARGV]);
    expect(injected.diag.some((line) => line.includes("REJECTED"))).toBe(true);
    expect(code).toBe(1);
  });
});
