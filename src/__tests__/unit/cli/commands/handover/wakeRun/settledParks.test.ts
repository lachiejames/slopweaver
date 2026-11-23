/**
 * `handover wake` over parks no reseat could ever lift — a settled ask, a terminal row — which it clears without a
 * read or an attempt, and a paused row's park, which it skips; plus the live edits that keep such a park standing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { readRunJournal } from "../../../../../../handover/runStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, PAST, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

describe("runHandoverWake", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  /** Front matter for an ask already settled answered — the measured row shape `cmux spawn` refuses forever. */
  const SETTLED = ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: 3f9b7b58da"] as const;

  it("clears settled parks without a read or an attempt, so the live parks behind them get the cap", async () => {
    parkedRow({ front: SETTLED, slug: "a0-settled-checks", wake: { kind: "checks", number: 9, repo: "o/r" } });
    parkedRow({ front: SETTLED, slug: "a1-settled-clock", wake: { atIso: PAST, kind: "at" } });
    ["b1", "b2", "b3", "b4"].forEach((slug) => {
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const reads: number[] = [];
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks:
        () =>
        async ({ number }) => {
          reads.push(number);
          return ok({ mergeCommitOid: "m1", prState: "MERGED" });
        },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect(code).toBe(EXIT_OK);
    expect(report.rows.map((row) => [row.slug, row.judgement.kind, row.action])).toEqual([
      ["a0-settled-checks", "not-judged", "park-cleared"],
      ["a1-settled-clock", "not-judged", "park-cleared"],
      ["b1", "due", "spawned"],
      ["b2", "due", "spawned"],
      ["b3", "due", "spawned"],
      ["b4", "due", "due-deferred"],
    ]);
    expect([reads, recorded.spawned, report.attempted, report.cleared]).toEqual([[], ["b1", "b2", "b3"], 3, 2]);
    expect(report.rows[0]!.detail).toBe(
      "cleared without a reseat: the ask is settled answered, so cmux spawn refuses it on every wake",
    );
    expect([stillParked({ slug: "a0-settled-checks" }), stillParked({ slug: "a1-settled-clock" })]).toEqual([
      false,
      false,
    ]);
    const journal = unwrap(readRunJournal({ runsDir, slug: "a1-settled-clock" })).events;
    expect(journal.at(-1)).toEqual({
      atIso: NOW.toISOString(),
      kind: "park-cleared",
      parkIndex: 2,
      why: "the ask is settled answered, so cmux spawn refuses it on every wake",
    });
  });

  it("clears a park on a row whose status is terminal, and exits 0 with no attempt", async () => {
    parkedRow({ front: ["status: done"], slug: "shipped", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect([code, report.attempted, report.cleared, recorded.spawned]).toEqual([EXIT_OK, 0, 1, []]);
    expect(report.rows[0]!.detail).toBe(
      "cleared without a reseat: the row is done, so cmux spawn refuses it on every wake",
    );
    expect(stillParked({ slug: "shipped" })).toBe(false);
  });

  // The scan read `status: done`, and the doc went back to in-progress before the row was cleared.
  it("keeps a park whose row was edited live again between the scan and the clear, and writes nothing", async () => {
    parkedRow({ front: ["status: done"], slug: "reopened", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const docPath = join(home, "handovers", "reopened.md");
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks: () => {
        writeFileSync(docPath, readFileSync(docPath, "utf8").replace("status: done", "status: in-progress"));
        return async () => ok({ mergeCommitOid: "m1", prState: "MERGED" });
      },
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.rows[0]!.action, report.rows[0]!.detail, report.cleared, recorded.spawned]).toEqual([
      "none",
      "the row is no longer refused by cmux spawn, so its park stands",
      0,
      [],
    ]);
    expect(stillParked({ slug: "reopened" })).toBe(true);
  });

  // A second, live doc claiming the slug appeared after the scan; the park may be that row's.
  it("keeps a park whose slug a second doc claimed between the scan and the clear", async () => {
    parkedRow({ front: ["status: done"], slug: "claimed", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks: () => {
        writeFileSync(
          join(home, "handovers", "claimed-too.md"),
          ["---", "slug: claimed", "summary: a run", "status: in-progress", "---", "", "# claimed", ""].join("\n"),
        );
        return async () => ok({ mergeCommitOid: "m1", prState: "MERGED" });
      },
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.rows[0]!.action, report.rows[0]!.detail, report.cleared]).toEqual([
      "none",
      "2 board docs now carry the slug claimed",
      0,
    ]);
    expect(stillParked({ slug: "claimed" })).toBe(true);
  });

  it("skips a paused row's park without a read, an attempt or a write, and exits 3", async () => {
    parkedRow({
      front: ["status: paused", "pausedOn: Tobias"],
      slug: "paused",
      wake: { kind: "checks", number: 7, repo: "o/r" },
    });
    const recorded = record();
    const reads: number[] = [];
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks:
        () =>
        async ({ number }) => {
          reads.push(number);
          return ok({ mergeCommitOid: "m1", prState: "MERGED" });
        },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, reads, report.attempted, report.cleared]).toEqual([EXIT_EXPECTED_EMPTY, [], 0, 0]);
    expect(report.rows.map((row) => [row.judgement.kind, row.action])).toEqual([["not-judged", "paused-skipped"]]);
    expect(stillParked({ slug: "paused" })).toBe(true);
  });

  // The counterexample, kept as the intended behaviour: unpausing a settled ask lifts nothing, since
  // `cmux spawn` refuses the settlement whatever the pause says, so the park is as dead as any settled one.
  it("clears a paused row's park when the row is also settled, since no unpause could ever reseat it", async () => {
    parkedRow({
      front: ["kind: ask", "status: paused", "pausedOn: Tobias", "settlement: answered", "settlementWitness: abc"],
      slug: "paused-settled",
      wake: { atIso: PAST, kind: "at" },
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect([code, report.rows[0]!.action, report.attempted, recorded.spawned]).toEqual([
      EXIT_OK,
      "park-cleared",
      0,
      [],
    ]);
    expect(stillParked({ slug: "paused-settled" })).toBe(false);
  });

  it("writes nothing on a dry run over a settled park and says it would clear it", async () => {
    parkedRow({ front: SETTLED, slug: "settled", wake: { atIso: PAST, kind: "at" } });
    const before = readFileSync(join(runsDir, "settled.jsonl"), "utf8");
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), extra: ["--dry-run"], recorded });
    expect([code, report.rows[0]!.action, report.cleared]).toEqual([EXIT_OK, "would-clear", 1]);
    expect(readFileSync(join(runsDir, "settled.jsonl"), "utf8")).toBe(before);
  });

  it("names SKIPPED and the clear count in its text output", async () => {
    parkedRow({ front: SETTLED, slug: "settled", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home] });
    expect(code).toBe(EXIT_OK);
    expect(recorded.out).toEqual([
      "  settled — parked until 2026-10-15T03:00:00Z: SKIPPED, park-cleared (cleared without a reseat: the ask is settled answered, so cmux spawn refuses it on every wake)",
      "handover wake: 1 waking park(s), 0 due, 0 of 3 attempted, 0 reseated, 0 finished without a reseat, 1 cleared, 0 suspended on the owner's question",
    ]);
  });
});
