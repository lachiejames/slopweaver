import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { linearGaps, linearIngestResult } from "../../../../../cli/commands/refresh/tokenedJobsLinear.js";
import type { HistoryEventRow } from "../../../../../corpus/history/types.js";
import type { LinearActivity } from "../../../../../corpus/linear/fetch.js";
import { err, ok } from "../../../../../lib/result.js";

/** A crawl that produced nothing, with the two lists under test overridable. */
const activity = (over: Partial<LinearActivity> = {}): LinearActivity => ({
  customerNeeds: [],
  documents: [],
  historyRows: [],
  incomplete: [],
  initiativeUpdates: [],
  initiatives: [],
  issues: [],
  projectMilestones: [],
  projects: [],
  templates: [],
  warnings: [],
  ...over,
});

const HISTORY_ROW: HistoryEventRow = {
  actor: "u-1",
  changes: { toState: "In Progress" },
  container: "linear/ENG",
  eventId: "h-1",
  source: "linear",
  stream: "history",
  subjectId: "ENG-1",
  tsIso: "2026-09-01T00:00:00.000Z",
  version: 1,
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-linear-gaps-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("linearGaps", () => {
  it("is empty when every lane arrived and the history store took its rows", () => {
    expect(linearGaps({ incomplete: [], wrote: ok({ deduped: 0, written: 3 }) })).toEqual([]);
  });

  it("holds the pooled cursor for each lane that did not arrive whole", () => {
    expect(
      linearGaps({ incomplete: ["linear initiatives lane unavailable: boom"], wrote: ok({ deduped: 0, written: 0 }) }),
    ).toEqual([{ heldPerContainer: false, message: "linear initiatives lane unavailable: boom" }]);
  });

  it("makes a history-store write failure a gap, since movement is read from that store", () => {
    expect(linearGaps({ incomplete: [], wrote: err(["disk full"]) })).toEqual([
      { heldPerContainer: false, message: "history persist failed: disk full" },
    ]);
  });
});

describe("linearIngestResult", () => {
  const run = ({ crawl, at }: { crawl: LinearActivity; at: string }) =>
    linearIngestResult({
      activity: crawl,
      cursorIsolated: false,
      home: at,
      referencedWarnings: [],
      spendNote: "spend: 0 request(s)",
      tally: undefined,
    });

  it("carries a lane the crawl named incomplete out as a gap, never a warning", () => {
    const result = run({ at: home, crawl: activity({ incomplete: ["linear documents lane unavailable: x"] }) });
    expect(result.gaps.map((gap) => gap.message)).toEqual(["linear documents lane unavailable: x"]);
    expect(result.warnings).toEqual([]);
  });

  it("reports a clean crawl with no gaps and its advisory warnings intact", () => {
    const result = run({ at: home, crawl: activity({ warnings: ["comments overflowed on ENG-1"] }) });
    expect(result.gaps).toEqual([]);
    expect(result.warnings).toEqual(["comments overflowed on ENG-1"]);
  });

  // A real write failure rather than a constructed one: a home that is a FILE cannot hold the history store.
  it("turns a history store that could not be written into a gap", () => {
    const notADirectory = join(home, "home-is-a-file");
    writeFileSync(notADirectory, "");
    const result = run({ at: notADirectory, crawl: activity({ historyRows: [HISTORY_ROW] }) });
    expect(result.gaps.length).toBe(1);
    expect(result.gaps[0]!.message).toContain("history persist failed");
    expect(result.warnings).toEqual([]);
  });
});
