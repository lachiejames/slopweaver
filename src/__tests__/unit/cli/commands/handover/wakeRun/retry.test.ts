/**
 * `handover wake --retry <nonce>`: the retry line a backoff deferral prints, the one park a retry reseats once the
 * backoff opens, and every attempt it refuses or leaves NOT YET for the next tick.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";

import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import {
  EXIT_DEFERRED,
  EXIT_ERROR,
  EXIT_EXPECTED_EMPTY,
  EXIT_OK,
  EXIT_USAGE,
} from "../../../../../../cli/exitCodes.js";
import { appendRunEvent } from "../../../../../../handover/runStore.js";
import { readWakeTurns, writeWakeTurns } from "../../../../../../handover/wakeTurnStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { FUTURE, green, NOW, PAST, RETRY_AFTER, record, spawnLine } from "./fixtures.js";
import { fakes, journalPath, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

/** The instant the harness parks a row at, which every park's turn key carries. */
const PARKED_AT = "2026-10-15T02:00:00.000Z";

describe("runHandoverWake", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("prints the retry instant and nonce on a backoff deferral, and --retry reseats only that park once it opens", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ slug: "held2", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    const code = await runHandoverWake({
      deps: fakes({ exitCode: EXIT_DEFERRED, recorded: tick }),
      rest: ["--home", home],
    });
    expect(code).toBe(EXIT_DEFERRED);
    expect(tick.out[1]).toBe(`    retry: slopweaver handover wake --retry n-1 (backoff opens ${RETRY_AFTER})`);

    const chair = record();
    const { code: retried, report } = await wakeJson({
      deps: fakes({ recorded: chair }),
      extra: ["--retry", "n-1"],
      recorded: chair,
    });
    expect([retried, chair.slept, chair.spawned]).toEqual([EXIT_OK, [5 * 60_000], ["held1"]]);
    expect(report.retry).toEqual({
      nonce: "n-1",
      parkedAtIso: "2026-10-15T02:00:00.000Z",
      parkIndex: 2,
      retryAfterIso: RETRY_AFTER,
      slug: "held1",
      waitedMs: 5 * 60_000,
    });
    expect([stillParked({ slug: "held1" }), stillParked({ slug: "held2" })]).toEqual([false, true]);
  });

  // A retry serves one park, so pruning the turn snapshot to it erased every other park's turns.
  it("keeps every other waking park's turns when a --retry rewrites the snapshot", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: record() }), rest: ["--home", home] });
    parkedRow({ slug: "a", wake: { atIso: FUTURE, kind: "at" } });
    parkedRow({ slug: "b", wake: { atIso: FUTURE, kind: "at" } });
    const turns = new Map([
      [`a:2:${PARKED_AT}`, { askedAtIso: "2026-10-15T03:00:00.000Z", readAtIso: "2026-10-15T03:00:00.000Z" }],
      [`b:2:${PARKED_AT}`, { readAtIso: "2026-10-15T03:01:00.000Z" }],
    ]);
    unwrap(writeWakeTurns({ home, turns }));
    const chair = record();
    const code = await runHandoverWake({ deps: fakes({ recorded: chair }), rest: ["--home", home, "--retry", "n-1"] });
    expect([code, chair.spawned, readWakeTurns({ home })]).toEqual([EXIT_OK, ["held1"], { kind: "read", turns }]);
  });

  // The board a retry scanned predates its wait, so a park that came due and was read by another
  // tick while it slept is on no list the retry holds — pruning to that list erased the turn just written.
  it("keeps a turn another tick wrote during the retry's wait, for a park its board never saw", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: record() }), rest: ["--home", home] });
    const turns = new Map([[`late:2:${PARKED_AT}`, { readAtIso: "2026-10-15T03:02:00.000Z" }]]);
    const chair = record();
    const base = fakes({ recorded: chair });
    const deps: HandoverWakeDeps = {
      ...base,
      sleep: async ({ ms }) => {
        await base.sleep({ ms });
        parkedRow({ slug: "late", wake: { kind: "checks", number: 9, repo: "o/r" } });
        unwrap(writeWakeTurns({ home, turns }));
      },
    };
    const code = await runHandoverWake({ deps, rest: ["--home", home, "--retry", "n-1"] });
    expect([code, chair.spawned, readWakeTurns({ home })]).toEqual([EXIT_OK, ["held1"], { kind: "read", turns }]);
  });

  // A turn the snapshot holds with no stamp at all is still a turn the retry read, never one to drop.
  it("keeps an empty turn a --retry read, beside the stamps it carries forward", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: record() }), rest: ["--home", home] });
    const turns = new Map([
      [`blank:2:${PARKED_AT}`, {}],
      [`read:2:${PARKED_AT}`, { readAtIso: "2026-10-15T03:02:00.000Z" }],
    ]);
    unwrap(writeWakeTurns({ home, turns }));
    const code = await runHandoverWake({
      deps: fakes({ recorded: record() }),
      rest: ["--home", home, "--retry", "n-1"],
    });
    expect([code, readWakeTurns({ home })]).toEqual([EXIT_OK, { kind: "read", turns }]);
  });

  // The retry's only park clears and the journal breaks while it sleeps; the retry resolved its nonce
  // from that journal, so it exits 1 rather than 3 off its gone target, with no other waking park on the board.
  it("exits 1 on a --retry whose park cleared while the wake journal broke during its wait", async () => {
    parkedRow({ slug: "gone", wake: { atIso: PAST, kind: "at" } });
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: record() }), rest: ["--home", home] });
    const recorded = record();
    const base = fakes({ recorded });
    const deps: HandoverWakeDeps = {
      ...base,
      sleep: async ({ ms }) => {
        await base.sleep({ ms });
        unwrap(appendRunEvent({ event: spawnLine({ kind: "dispatched", slug: "gone" }), runsDir, slug: "gone" }));
        writeFileSync(journalPath(), '{"kind":"attempt"\n');
      },
    };
    const code = await runHandoverWake({ deps, rest: ["--home", home, "--retry", "n-1"] });
    expect([code, recorded.slept, recorded.spawned]).toEqual([EXIT_ERROR, [5 * 60_000], []]);
    expect(recorded.diagnostics[0]).toContain("no park reseats until it is repaired");
  });

  it("refuses a --retry naming no attempt, one that is not a deferral, or one past the retry window", async () => {
    parkedRow({ slug: "done", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ slug: "later", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    await runHandoverWake({
      deps: fakes({ exitCodes: [0, EXIT_DEFERRED], recorded: tick, retryAfterIso: "2026-10-15T04:00:00.000Z" }),
      rest: ["--home", home],
    });
    const results = [];
    for (const nonce of ["n-9", "n-1", "n-2"]) {
      const recorded = record();
      const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home, "--retry", nonce] });
      results.push([code, recorded.diagnostics, recorded.slept, recorded.spawned]);
    }
    expect(results).toEqual([
      [EXIT_USAGE, ["handover wake --retry: no wake attempt carries the nonce n-9"], [], []],
      [
        EXIT_EXPECTED_EMPTY,
        ["handover wake --retry: wake attempt n-1 (done) ended spawned, so it is not a deferred reseat to retry"],
        [],
        [],
      ],
      [
        EXIT_DEFERRED,
        [
          "handover wake --retry: the backoff opens at 2026-10-15T04:00:00.000Z, past the 15-minute retry window; the next tick's wake judges later",
        ],
        [],
        [],
      ],
    ]);
  });

  // A dry run never sleeps, so before the backoff opens the reseat is still owed and it stops NOT YET.
  it("exits 4 on a --retry --dry-run before the backoff opens, sleeping and spawning nothing", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: tick }), rest: ["--home", home] });
    const chair = record();
    const code = await runHandoverWake({
      deps: fakes({ recorded: chair }),
      rest: ["--home", home, "--retry", "n-1", "--dry-run"],
    });
    expect([code, chair.diagnostics, chair.slept, chair.spawned, chair.out]).toEqual([
      EXIT_DEFERRED,
      [
        `handover wake --retry: dry run: would wait 300000ms for the backoff opening ${RETRY_AFTER}, then judge held1's park again; nothing was spawned`,
      ],
      [],
      [],
      [],
    ]);
    expect(stillParked({ slug: "held1" })).toBe(true);
  });

  // Once the backoff has opened, a dry run reports the spawn it would make, and is still NOT YET.
  it("exits 4 on a --retry --dry-run after the backoff opens, reporting would-spawn and spawning nothing", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    await runHandoverWake({
      deps: fakes({ exitCode: EXIT_DEFERRED, recorded: tick, retryAfterIso: NOW.toISOString() }),
      rest: ["--home", home],
    });
    const chair = record();
    const { code, report } = await wakeJson({
      deps: fakes({ recorded: chair }),
      extra: ["--retry", "n-1", "--dry-run"],
      recorded: chair,
    });
    expect([code, chair.slept, chair.spawned, report.rows.map((row) => row.action)]).toEqual([
      EXIT_DEFERRED,
      [],
      [],
      ["would-spawn"],
    ]);
    expect(stillParked({ slug: "held1" })).toBe(true);
  });

  // A retry over a park still standing that spawns nothing — here its checks read failed — is NOT YET.
  it("exits 4 on a --retry whose park's checks did not read, spawning nothing", async () => {
    parkedRow({ slug: "held1", wake: { kind: "checks", number: 30, repo: "o/r" } });
    const tick = record();
    await runHandoverWake({
      deps: fakes({ checks: { 30: green() }, exitCode: EXIT_DEFERRED, recorded: tick }),
      rest: ["--home", home],
    });
    const chair = record();
    const { code, report } = await wakeJson({
      deps: fakes({ checks: { 30: "error" }, recorded: chair }),
      extra: ["--retry", "n-1"],
      recorded: chair,
    });
    expect([code, chair.spawned, report.rows.map((row) => [row.judgement.kind, row.action])]).toEqual([
      EXIT_DEFERRED,
      [],
      [["unknown", "none"]],
    ]);
    expect(stillParked({ slug: "held1" })).toBe(true);
  });

  // A duplicate doc drops the park from the candidates while it still stands, so it is NOT YET.
  it("exits 4 on a --retry whose park a duplicate board doc leaves unjudged", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: tick }), rest: ["--home", home] });
    writeFileSync(
      join(home, "handovers", "held1-copy.md"),
      ["---", "slug: held1", "summary: a run", "status: in-progress", "---", "", "# held1", ""].join("\n"),
    );
    const chair = record();
    const code = await runHandoverWake({ deps: fakes({ recorded: chair }), rest: ["--home", home, "--retry", "n-1"] });
    expect([code, chair.diagnostics, chair.spawned]).toEqual([
      EXIT_DEFERRED,
      [
        "handover wake --retry: held1's park of 2026-10-15T02:00:00.000Z could not be judged (two board docs share the slug), so nothing was spawned and the next tick takes it",
      ],
      [],
    ]);
    expect(stillParked({ slug: "held1" })).toBe(true);
  });

  // A deferral whose settlement append failed leaves a bare attempt; the park may still be owed.
  it("exits 4 on a --retry of an attempt whose settlement was never journalled", async () => {
    parkedRow({ slug: "held1", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    await runHandoverWake({ deps: fakes({ exitCode: EXIT_DEFERRED, recorded: tick }), rest: ["--home", home] });
    const attemptOnly = readFileSync(journalPath(), "utf8")
      .split("\n")
      .filter((line) => line.includes('"kind":"attempt"'));
    writeFileSync(journalPath(), `${attemptOnly.join("\n")}\n`);
    const chair = record();
    const code = await runHandoverWake({ deps: fakes({ recorded: chair }), rest: ["--home", home, "--retry", "n-1"] });
    expect([code, chair.diagnostics, chair.slept, chair.spawned]).toEqual([
      EXIT_DEFERRED,
      [
        "handover wake --retry: wake attempt n-1 (held1) has no settlement, so its spawn is still running or its outcome was never journalled; the next tick judges the park",
      ],
      [],
      [],
    ]);
  });

  // A deferral whose backoff did not read is still owed, so its retry stops NOT YET, never done.
  it("exits 4 on a --retry of a deferral whose backoff instant did not read, and names the next tick", async () => {
    parkedRow({ slug: "unread-backoff", wake: { atIso: PAST, kind: "at" } });
    const tick = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ exitCode: EXIT_DEFERRED, recorded: tick }),
      retryAfter: () => err(["spawn-backoff.json is not JSON"]),
    };
    const { report } = await wakeJson({ deps, recorded: tick });
    expect([report.rows[0]!.retryAfterIso, report.rows[0]!.detail]).toEqual([
      undefined,
      "the spawn backoff deferred cmux spawn with exit 4; still parked; the spawn backoff did not read, so no retry instant: spawn-backoff.json is not JSON",
    ]);
    const chair = record();
    const code = await runHandoverWake({ deps: fakes({ recorded: chair }), rest: ["--home", home, "--retry", "n-1"] });
    expect([code, chair.diagnostics, chair.spawned]).toEqual([
      EXIT_DEFERRED,
      [
        "handover wake --retry: wake attempt n-1 (unread-backoff) was deferred with no retry instant read, so the next tick takes it",
      ],
      [],
    ]);
  });
});
