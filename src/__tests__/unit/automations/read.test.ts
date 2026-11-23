/**
 * The Automations reader's two liveness and readability edges: a sync run is live only while ITS process holds the
 * slot (a recycled pid refreshing the same source later is not it), and a sync-run ledger that will not list is
 * said as an issue rather than read as no hand-run syncs. A failure explanations register read in part speaks for no
 * firing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { explanationsOrIssue } from "../../../automations/cardExplanations.js";
import { readAutomations } from "../../../automations/read.js";
import { slotHeldByRun } from "../../../automations/readLedgers.js";
import { stateHomePaths } from "../../../stateHome.js";

const RUN_START = "2026-10-03T04:22:53.418Z";

/** No atlas questions loaded, and none that failed to. */
const NO_ATLAS = { issues: [], questions: new Map<string, string>() };

describe("slotHeldByRun", () => {
  it("is the run's own slot when the pid matches and the slot was taken before the run started", () => {
    const holders = [{ pid: 51063, startedAtIso: "2026-10-03T04:22:52.900Z" }];
    expect(slotHeldByRun({ holders, pid: 51063, startedAtIso: RUN_START })).toBe(true);
  });

  it("is not the run's slot when a recycled pid took the same source's slot after the run started", () => {
    const holders = [{ pid: 51063, startedAtIso: "2026-10-04T09:00:00.000Z" }];
    expect(slotHeldByRun({ holders, pid: 51063, startedAtIso: RUN_START })).toBe(false);
  });

  it("is not the run's slot when another pid holds it", () => {
    const holders = [{ pid: 7, startedAtIso: "2026-10-03T04:22:52.900Z" }];
    expect(slotHeldByRun({ holders, pid: 51063, startedAtIso: RUN_START })).toBe(false);
  });

  it("is not held when nothing holds the slot", () => {
    expect(slotHeldByRun({ holders: [], pid: 51063, startedAtIso: RUN_START })).toBe(false);
  });
});

describe("readAutomations over an unreadable sync-run ledger", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("says the ledger will not list instead of showing no hand-run syncs", () => {
    const home = mkdtempSync(join(tmpdir(), "automations-read-"));
    homes.push(home);
    mkdirSync(join(home, "live"), { recursive: true });
    writeFileSync(join(home, "live", "sync-runs"), "not a directory");

    const report = readAutomations({
      atlas: NO_ATLAS,
      deps: { holdsSlot: () => false, processAlive: () => false },
      home,
      nowIso: "2026-10-03T05:00:00.000Z",
    });

    expect(report.unscheduledSyncs).toEqual([]);
    expect(report.issues.filter((issue) => issue.includes("sync-run ledger"))).toHaveLength(1);
    expect(report.issues.find((issue) => issue.includes("sync-run ledger"))).toContain("will not list");
  });

  it("reads an absent ledger as no runs yet, with no issue", () => {
    const home = mkdtempSync(join(tmpdir(), "automations-read-"));
    homes.push(home);

    const report = readAutomations({
      atlas: NO_ATLAS,
      deps: { holdsSlot: () => false, processAlive: () => false },
      home,
      nowIso: "2026-10-03T05:00:00.000Z",
    });

    expect(report.unscheduledSyncs).toEqual([]);
    expect(report.issues.filter((issue) => issue.includes("sync-run ledger"))).toEqual([]);
    expect(report.rosterGap).toBe(null);
  });

  it("says the roster would not list, rather than reading it as zero scheduled", () => {
    const home = mkdtempSync(join(tmpdir(), "automations-read-"));
    homes.push(home);
    mkdirSync(join(home, "live", "recipe"), { recursive: true });
    writeFileSync(join(home, "live", "recipe", "definitions"), "not a directory");

    const report = readAutomations({
      atlas: NO_ATLAS,
      deps: { holdsSlot: () => false, processAlive: () => false },
      home,
      nowIso: "2026-10-03T05:00:00.000Z",
    });

    expect(report.cards).toEqual([]);
    expect(report.rosterGap).toContain("will not list");
    expect(report.issues).toContain(report.rosterGap);
  });

  it("reads a fresh home's absent readings, notes and relay stores as nothing yet, with no issue", () => {
    const home = mkdtempSync(join(tmpdir(), "automations-read-"));
    homes.push(home);

    const report = readAutomations({
      atlas: NO_ATLAS,
      deps: { holdsSlot: () => false, processAlive: () => false },
      home,
      nowIso: "2026-10-03T05:00:00.000Z",
    });

    expect(report.issues).toEqual([]);
  });

  it("says an atlas descriptor that would not load as an issue, never as an unnamed refresh alone", () => {
    const home = mkdtempSync(join(tmpdir(), "automations-read-"));
    homes.push(home);
    const issue = "the xero atlas descriptor would not load, so its refresh is not named: boom";

    const report = readAutomations({
      atlas: { issues: [issue], questions: new Map<string, string>() },
      deps: { holdsSlot: () => false, processAlive: () => false },
      home,
      nowIso: "2026-10-03T05:00:00.000Z",
    });

    expect(report.issues).toEqual([issue]);
  });
});

describe("explanationsOrIssue", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("speaks for no firing when a line is torn, since it may be a newer sentence for the same one", () => {
    const line = JSON.stringify({
      attempt: 1,
      recipeId: "error-tracking-batch-acme-admin",
      recordedIso: "2026-11-01T09:30:00.000Z",
      slotIso: "2026-11-01T09:00:00.000Z",
      why: "The mail sign-in expired, so reconnecting mail fixes it.",
    });
    const write = ({ text }: { text: string }): string => {
      const home = mkdtempSync(join(tmpdir(), "automations-explain-"));
      homes.push(home);
      const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      return home;
    };
    const wholeIssues: string[] = [];
    const tornIssues: string[] = [];

    const whole = explanationsOrIssue({ home: write({ text: `${line}\n` }), issues: wholeIssues });
    const torn = explanationsOrIssue({ home: write({ text: `${line}\n{torn\n` }), issues: tornIssues });

    expect(whole.get("error-tracking-batch-acme-admin")!.get("2026-11-01T09:00:00.000Z#1")).toBe(
      "The mail sign-in expired, so reconnecting mail fixes it.",
    );
    expect(wholeIssues).toEqual([]);
    expect(torn.size).toBe(0);
    expect(tornIssues).toEqual(["the failure explanations register has 1 unreadable line(s): 2"]);
  });
});
