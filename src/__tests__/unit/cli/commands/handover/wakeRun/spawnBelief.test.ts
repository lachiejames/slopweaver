/**
 * `handover wake`'s belief in a reseat: the per-run spawn cap, a spawn that failed or left its seat open, and a
 * spawn it trusts only off its own `dispatched` line — never off a park something else cleared first.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import { WAKE_BOOT_SHARE } from "../../../../../../cli/commands/handover/wakeBootBudget.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { ChecksWakeObservation } from "../../../../../../handover/parkWake.js";
import { appendRunEvent } from "../../../../../../handover/runStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { AFTER, FUTURE, green, PAST, record, spawnLine } from "./fixtures.js";
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

  it(`attempts at most ${String(WAKE_BOOT_SHARE)} with no boot in flight, slug breaking a tie, and defers the rest`, async () => {
    const slugs = ["a1", "a2", "a3", "a4"];
    slugs.forEach((slug) => {
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_OK);
    expect(recorded.spawned).toEqual(["a1", "a2", "a3"]);
    expect(report.rows.map((row) => row.action)).toEqual(["spawned", "spawned", "spawned", "due-deferred"]);
    expect(stillParked({ slug: "a4" })).toBe(true);
  });

  // MEASURED: slug order gave every reseat to rows at the front of the alphabet that re-park on CI each
  // tick, and a row parked hours earlier further down it read `due-deferred` on every wake (`handover/wakeOrder.ts`).
  it("reseats the longest-due parks first, so a row re-parked this tick waits behind one parked hours ago", async () => {
    // A clock instant before every park, so each is due from its own park instant.
    const passed = { atIso: "2026-10-15T00:00:00Z", kind: "at" } as const;
    ["a1", "a2", "a3"].forEach((slug) => {
      parkedRow({ parkedAtIso: "2026-10-15T02:30:00.000Z", slug, wake: passed });
    });
    parkedRow({ parkedAtIso: "2026-10-15T01:30:00.000Z", slug: "why-starved", wake: passed });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_OK);
    expect(recorded.spawned).toEqual(["why-starved", "a1", "a2"]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["a1", "spawned"],
      ["a2", "spawned"],
      ["a3", "due-deferred"],
      ["why-starved", "spawned"],
    ]);
    expect(stillParked({ slug: "a3" })).toBe(true);
  });

  it("spends the budget on open pull requests' parks before older parks whose pull request closed", async () => {
    ["c1", "c2", "c3"].forEach((slug, index) => {
      parkedRow({
        parkedAtIso: "2026-10-14T00:00:00.000Z",
        slug,
        wake: { kind: "checks", number: index + 1, repo: "o/r" },
      });
    });
    parkedRow({
      parkedAtIso: "2026-10-15T01:30:00.000Z",
      slug: "open-draft",
      wake: { kind: "checks", number: 9, repo: "o/r" },
    });
    const recorded = record();
    const closed = { prState: "CLOSED" } as const;
    const deps = fakes({ checks: { 1: closed, 2: closed, 3: closed, 9: green() }, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect(recorded.spawned).toEqual(["open-draft", "c1", "c2"]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["c1", "spawned"],
      ["c2", "spawned"],
      ["c3", "due-deferred"],
      ["open-draft", "spawned"],
    ]);
  });

  // Oldest first would put a repoless doc's park at the front, where `cmux spawn` refuses it every
  // tick and it spends a reseat each time. It ranks last instead, and keeps its park.
  it("puts an older park whose doc names no repo behind every spawnable park", async () => {
    parkedRow({
      parkedAtIso: "2026-10-15T01:30:00.000Z",
      repo: null,
      slug: "z-no-repo",
      wake: { atIso: PAST, kind: "at" },
    });
    ["a1", "a2", "a3"].forEach((slug) => {
      parkedRow({ parkedAtIso: "2026-10-15T02:30:00.000Z", slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_OK);
    expect(recorded.spawned).toEqual(["a1", "a2", "a3"]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["a1", "spawned"],
      ["a2", "spawned"],
      ["a3", "spawned"],
      ["z-no-repo", "due-deferred"],
    ]);
    expect(stillParked({ slug: "z-no-repo" })).toBe(true);
  });

  // The wake judges every park before any reseat, to order them. A park on an open pull
  // request is read again at its turn, so a reseat earlier in the same run that moved that pull request counts.
  it("reads an open pull request's park again at its turn, so one an earlier reseat moved is not reseated", async () => {
    parkedRow({
      parkedAtIso: "2026-10-15T01:00:00.000Z",
      slug: "a-first",
      wake: { kind: "checks", number: 1, repo: "o/r" },
    });
    parkedRow({
      parkedAtIso: "2026-10-15T02:00:00.000Z",
      slug: "b-second",
      wake: { kind: "checks", number: 2, repo: "o/r" },
    });
    const recorded = record();
    const checks: Record<number, ChecksWakeObservation | "error"> = { 1: green(), 2: green() };
    const base = fakes({ checks, recorded });
    const deps: HandoverWakeDeps = {
      ...base,
      reseat: async (request) => {
        const outcome = await base.reseat(request);
        checks[2] = "error";
        return outcome;
      },
    };
    const { report } = await wakeJson({ deps, recorded });
    expect(recorded.spawned).toEqual(["a-first"]);
    expect(report.rows.map((row) => [row.slug, row.action, row.judgement.kind])).toEqual([
      ["a-first", "spawned", "due"],
      ["b-second", "none", "unknown"],
    ]);
  });

  // A closed pull request can be reopened, so a CLOSED read before any reseat is read again at its turn.
  it("reads a closed pull request's park again at its turn, so one reopened meanwhile is not reseated", async () => {
    parkedRow({
      parkedAtIso: "2026-10-15T01:00:00.000Z",
      slug: "a-first",
      wake: { kind: "checks", number: 1, repo: "o/r" },
    });
    parkedRow({
      parkedAtIso: "2026-10-15T02:00:00.000Z",
      slug: "b-closed",
      wake: { kind: "checks", number: 2, repo: "o/r" },
    });
    const recorded = record();
    const checks: Record<number, ChecksWakeObservation | "error"> = { 1: green(), 2: { prState: "CLOSED" } };
    const base = fakes({ checks, recorded });
    const deps: HandoverWakeDeps = {
      ...base,
      reseat: async (request) => {
        const outcome = await base.reseat(request);
        checks[2] = "error";
        return outcome;
      },
    };
    await wakeJson({ deps, recorded });
    expect(recorded.spawned).toEqual(["a-first"]);
  });

  it("counts a failed spawn against the cap, keeps it parked and exits 1", async () => {
    parkedRow({ slug: "fails", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ exitCode: 1, recorded }), recorded });
    expect(code).toBe(EXIT_ERROR);
    expect([report.attempted, report.rows[0]!.action, report.rows[0]!.detail]).toEqual([
      1,
      "spawn-failed",
      "cmux spawn ended exit 1; still parked",
    ]);
    expect(stillParked({ slug: "fails" })).toBe(true);
  });

  // A reseat whose pickup nothing saw submitted now fails loudly — and must not be reseated again
  // beside a seat that may be running it, which its own `dispatched` line prevents by clearing the park.
  it("never reseats a row whose failed spawn left its seat open and journalled the dispatch", async () => {
    parkedRow({ slug: "open", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps = fakes({ exitCode: EXIT_ERROR, leftOpen: true, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect(code).toBe(EXIT_ERROR);
    expect([report.rows[0]!.action, report.rows[0]!.detail]).toEqual([
      "spawn-failed",
      "cmux spawn ended exit 1; its dispatch cleared the park and the seat was left open — read it, never reseat it",
    ]);
    expect(stillParked({ slug: "open" })).toBe(false);

    const again = record();
    await runHandoverWake({ deps: fakes({ recorded: again }), rest: ["--home", home, "--json"] });
    expect(again.spawned).toEqual([]);
  });

  it("does not believe an exit 0 that journalled no dispatch", async () => {
    parkedRow({ slug: "silent", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ journals: [], recorded }), recorded });
    expect(code).toBe(EXIT_ERROR);
    expect(report.rows[0]!.detail).toBe("cmux spawn exited 0 but no `dispatched` line cleared the park; still parked");
  });

  it("does not believe an exit 0 whose park something other than a dispatch cleared first", async () => {
    const orders = [["abandoned"], ["abandoned", "dispatched"], ["started", "dispatched"]] as const;
    const reports = [];
    for (const [index, journals] of orders.entries()) {
      const slug = `dropped-${String(index)}`;
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
      const recorded = record();
      const { code, report } = await wakeJson({ deps: fakes({ journals, recorded }), recorded });
      reports.push([code, report.spawned, report.rows.find((row) => row.slug === slug)!.action]);
      rmSync(join(home, "handovers", `${slug}.md`));
    }
    expect(reports).toEqual(orders.map(() => [EXIT_ERROR, 0, "spawn-failed"]));
  });

  it("spawns nothing for a due park another session cleared during its read, and exits 3", async () => {
    parkedRow({ slug: "raced", wake: { kind: "checks", number: 4, repo: "o/r" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks: () => async () => {
        unwrap(
          appendRunEvent({ event: { atIso: AFTER, kind: "abandoned", why: "cancelled" }, runsDir, slug: "raced" }),
        );
        return ok({ mergeCommitOid: "m1", prState: "MERGED" });
      },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect([recorded.spawned, report.attempted, report.rows.map((row) => [row.action, row.detail])]).toEqual([
      [],
      0,
      [["none", "the park has cleared"]],
    ]);
  });

  it("spawns nothing when a replacement park sharing every field lands during the read", async () => {
    parkedRow({ slug: "replaced", wake: { kind: "checks", number: 5, repo: "o/r" } });
    const replacement = [
      { atIso: AFTER, kind: "launched", pid: 8, sessionId: "s-replaced", worktree: "/wt/replaced" },
      {
        atIso: "2026-10-15T02:00:00.000Z",
        branch: "replaced",
        kind: "parked",
        screenTail: "❯ ",
        sessionId: "s-replaced",
        wake: { atIso: FUTURE, kind: "at" },
        workspaceRef: "workspace:238",
        worktree: "/wt/replaced",
      },
    ] as const;
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      readChecks: () => async () => {
        for (const event of replacement) {
          unwrap(appendRunEvent({ event, runsDir, slug: "replaced" }));
        }
        return ok({ mergeCommitOid: "m1", prState: "MERGED" });
      },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, recorded.spawned, report.rows.map((row) => [row.action, row.detail])]).toEqual([
      EXIT_EXPECTED_EMPTY,
      [],
      [["none", "a later park (2026-10-15T02:00:00.000Z) replaced it"]],
    ]);
  });

  it("names why it did not believe a park cleared by something else", async () => {
    parkedRow({ slug: "dropped", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ journals: ["abandoned"], recorded }), recorded });
    expect(report.rows[0]!.detail).toBe(
      "cmux spawn exited 0 and the park cleared, but not first by a `dispatched` line, so nothing proves a seat came up",
    );
  });

  // A seat booted some other way clears the park after the claimed read; the attempt is journalled,
  // the park is read once more, and nothing is spawned beside that seat.
  it("spawns nothing when another seat clears the park after the claimed read", async () => {
    parkedRow({ slug: "beaten", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps: HandoverWakeDeps = {
      ...fakes({ recorded }),
      nonce: () => {
        unwrap(appendRunEvent({ event: spawnLine({ kind: "dispatched", slug: "beaten" }), runsDir, slug: "beaten" }));
        return "n-1";
      },
    };
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, recorded.spawned, report.rows[0]!.action, report.rows[0]!.detail]).toEqual([
      EXIT_EXPECTED_EMPTY,
      [],
      "none",
      "the park has cleared; nothing was spawned",
    ]);
  });
});
