/**
 * `handover wake`'s judgement of the board: which parks it considers at all, which of them are due on a clock or on
 * CI, and the unreadable doc, journal line or shared slug that stops a wake before any spawn.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { ChecksWakeObservation } from "../../../../../../handover/parkWake.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { FUTURE, PAST, record } from "./fixtures.js";
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

  it("reseats a past clock wake and believes it once the park cleared", async () => {
    parkedRow({ slug: "clock", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_OK);
    expect(recorded.spawned).toEqual(["clock"]);
    expect(report.rows.map((row) => [row.slug, row.judgement.kind, row.action])).toEqual([["clock", "due", "spawned"]]);
    expect(stillParked({ slug: "clock" })).toBe(false);
  });

  it("considers only parks carrying a wake, and exits 3 when none is due", async () => {
    parkedRow({ slug: "on-owner", wake: undefined });
    parkedRow({ slug: "later", wake: { atIso: FUTURE, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(report.rows.map((row) => [row.slug, row.judgement.kind, row.action])).toEqual([
      ["later", "not-due", "none"],
    ]);
    expect(recorded.spawned).toEqual([]);
  });

  it("wakes terminal red CI and a merged pull request, and never an unreadable one", async () => {
    parkedRow({ slug: "red", wake: { kind: "checks", number: 1, repo: "o/r" } });
    parkedRow({ slug: "merged", wake: { kind: "checks", number: 2, repo: "o/r" } });
    parkedRow({ slug: "unread", wake: { kind: "checks", number: 3, repo: "o/r" } });
    const red: ChecksWakeObservation = {
      checks: {
        baseRef: "main",
        checks: [{ kind: "check-run", name: "unit", state: "failed", url: undefined }],
        headSha: "abc",
        mergeable: "MERGEABLE",
        residue: [],
        rollupState: "FAILURE",
        supersededChecks: [],
        truncated: false,
      },
      prState: "OPEN",
    };
    const recorded = record();
    const deps = fakes({ checks: { 1: red, 2: { prState: "MERGED" }, 3: "error" }, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect(code).toBe(EXIT_OK);
    // Rows report in board order whatever order woke them (`handover/wakeOrder.ts` orders the reseats).
    expect(report.rows.map((row) => [row.slug, row.judgement.kind, row.action])).toEqual([
      ["merged", "due", "spawned"],
      ["red", "due", "spawned"],
      ["unread", "unknown", "none"],
    ]);
    expect(stillParked({ slug: "unread" })).toBe(true);
  });

  it("names UNKNOWN in its text output", async () => {
    parkedRow({ slug: "unread", wake: { kind: "checks", number: 3, repo: "o/r" } });
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ checks: { 3: "error" }, recorded }), rest: ["--home", home] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(recorded.out[0]).toBe(
      "  unread — parked on CI for o/r#3: UNKNOWN, none (o/r#3 could not be read: rate limited)",
    );
  });

  it("never wakes a due park whose journal carries a line it cannot read, and names it", async () => {
    parkedRow({ slug: "garbled", wake: { atIso: PAST, kind: "at" } });
    appendFileSync(join(runsDir, "garbled.jsonl"), '{"kind":"a-newer-kind-that-cleared-it"\n');
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect([recorded.spawned, report.rows, report.unreadable]).toEqual([[], [], ["garbled (journal)"]]);
  });

  it("wakes nothing while a board doc will not read, since it may share a waking row's slug", async () => {
    parkedRow({ slug: "clock", wake: { atIso: PAST, kind: "at" } });
    // Not a regular file, so the scan names it unreadable without ever learning what slug it carries.
    mkdirSync(join(home, "handovers", "clock-copy.md"));
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home, "--json"] });
    expect([code, recorded.spawned, recorded.out]).toEqual([EXIT_ERROR, [], []]);
    expect(recorded.diagnostics).toEqual([
      "handover wake: the board did not read — 1 board doc(s) would not read (clock-copy.md), and any of them may share a waking row's slug — fix them; no park wakes until they read",
    ]);
  });

  it("names the park each row judged by its journal position and instant, so a page can tell two parks apart", async () => {
    parkedRow({ parkedAtIso: "2026-10-15T02:30:00.000Z", slug: "clock", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ slug: "ci", wake: { kind: "checks", number: 3, repo: "o/r" } });
    const recorded = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: { 3: "error" }, recorded }),
      extra: ["--dry-run"],
      recorded,
    });
    expect(report.rows.map((row) => [row.slug, row.parkIndex, row.parkedAtIso])).toEqual([
      ["ci", 2, "2026-10-15T02:00:00.000Z"],
      ["clock", 2, "2026-10-15T02:30:00.000Z"],
    ]);
  });

  it("spawns nothing on a dry run and says what it would have done", async () => {
    parkedRow({ slug: "clock", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), extra: ["--dry-run"], recorded });
    expect(code).toBe(EXIT_OK);
    expect(recorded.spawned).toEqual([]);
    expect([report.dryRun, report.rows[0]!.action]).toEqual([true, "would-spawn"]);
    expect(stillParked({ slug: "clock" })).toBe(true);
  });

  it("never wakes a slug two docs share, and names it", async () => {
    parkedRow({ slug: "twice", wake: { atIso: PAST, kind: "at" } });
    parkedRow({ file: "twice-copy", slug: "twice", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect([report.duplicateSlugs, report.rows, recorded.spawned]).toEqual([["twice"], [], []]);
  });

  it("refuses an unknown flag before reading anything", async () => {
    const recorded = record();
    const code = await runHandoverWake({ deps: fakes({ recorded }), rest: ["--home", home, "--all"] });
    expect(code).toBe(EXIT_USAGE);
    expect(recorded.diagnostics.length).toBe(2);
    expect(recorded.diagnostics[0]).toBe("unknown flag: --all");
    expect(recorded.diagnostics[1]!.split("\n")[0]).toBe(
      "usage: slopweaver handover wake [--retry <nonce> | --settle-only] [--dry-run] [--home <dir>] [--json]",
    );
  });
});
