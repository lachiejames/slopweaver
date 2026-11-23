/**
 * The pure halves of the supervisor-scratch verbs: the tick's reading list against tick-draft's own source
 * table, the bare-reference rewrite, and the carry's retention rule.
 */
import { describe, expect, it } from "vitest";

import { CARRIED_FILES, carrySummaryLines, planCarry } from "../../../../supervisor/scratch/carry.js";
import { FLEET_READINGS } from "../../../../supervisor/scratch/fleetReadings.js";
import { isRepoSlug, qualifyBareRefs } from "../../../../supervisor/scratch/qualifyRefs.js";
import {
  captureSummaryLines,
  isCompletedExit,
  isFailedEmptyReading,
  isTickLabel,
  LANDING_TIMEOUT_MS,
  type ReadingOutcome,
  readingFiles,
  readingProducer,
  tickDraftArgs,
  tickReadingProducer,
  tickReadings,
} from "../../../../supervisor/scratch/tickCapture.js";
import { DRAFTED_SOURCE_KINDS } from "../../../../supervisor/tickDraftShapes.js";

const READINGS = tickReadings({ loopSessionKey: "live-loop-a" });

/**
 * A clean outcome for every reading, as a capture into `/s/tick-4` would leave it.
 *
 * @returns one outcome per reading, each exited 0 with bytes written
 */
function cleanOutcomes(): ReadingOutcome[] {
  return READINGS.map((reading) => ({
    argv: reading.argv,
    bytes: 10,
    child: { durationMs: 40, exitCode: 0, kind: "exited" } as const,
    completed: true,
    exitCode: 0,
    name: reading.name,
    ...readingFiles({ reading }),
    ...(reading.draftSource === undefined ? {} : { draftSource: reading.draftSource }),
  }));
}

describe("tickReadings", () => {
  it("feeds every tick-draft source from exactly one JSON reading", () => {
    expect(DRAFTED_SOURCE_KINDS.length).toBeGreaterThan(0);
    const fed = DRAFTED_SOURCE_KINDS.map((kind) => READINGS.filter((reading) => reading.draftSource === kind));
    expect(fed.map((readings) => readings.length)).toEqual(DRAFTED_SOURCE_KINDS.map(() => 1));
    expect(fed.flat().map((reading) => reading.format)).toEqual(DRAFTED_SOURCE_KINDS.map(() => "json"));
  });

  it("runs the fleet readings, in their own order, after the seat's watch, depth and standing readings", () => {
    expect(FLEET_READINGS.length).toBeGreaterThan(0);
    const names = READINGS.map((reading) => reading.name);
    const start = names.indexOf("standing") + 1;
    expect(names.slice(start, start + FLEET_READINGS.length)).toEqual(FLEET_READINGS.map((reading) => reading.name));
    expect(names.indexOf("watch-report")).toBeLessThan(names.indexOf("fleet-why"));
  });

  it("fires each plan-health card straight after the read it judges: Claude after the gauge, Codex after the route", () => {
    const names = READINGS.map((reading) => reading.name);
    const start = names.indexOf("gauge-report");
    expect(names.slice(start, start + 4)).toEqual(["gauge-report", "claude-plans", "codex-route", "codex-plans"]);
    expect(READINGS.slice(start + 1, start + 4).map((reading) => reading.argv)).toEqual([
      ["monitor", "check", "--only", "claude-plan-unusable", "--fire", "--by-session", "supervisor", "--json"],
      ["codex", "route", "--json"],
      ["monitor", "check", "--only", "codex-plan-signed-out", "--fire", "--by-session", "supervisor", "--json"],
    ]);
  });

  it("names every reading once, so no two write the same file", () => {
    const names = READINGS.map((reading) => reading.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("rechecks open hand steps immediately before both sign-in monitors fire, so a retired card is held, not re-posted", () => {
    const names = READINGS.map((reading) => reading.name);
    const recheck = READINGS[names.indexOf("hand-recheck")]!;
    expect(names.slice(names.indexOf("hand-recheck"), names.indexOf("hand-recheck") + 3)).toEqual([
      "hand-recheck",
      "turn-sign-ins",
      "sign-in-walls",
    ]);
    expect(READINGS[names.indexOf("turn-sign-ins")]!.argv).toEqual([
      "monitor",
      "check",
      "--only",
      "turn-signed-out",
      "--fire",
      "--by-session",
      "supervisor",
      "--json",
    ]);
    expect(recheck.argv).toEqual(["hand", "recheck", "--by-session", "supervisor", "--json"]);
    expect(recheck.completedExits).toEqual([0, 3]);
  });

  it("fires both stopped-recipe monitors every tick, the card first, after the sign-in walls and before fleet health", () => {
    const names = READINGS.map((reading) => reading.name);
    const start = names.indexOf("sign-in-walls");
    expect(names.slice(start, start + 4)).toEqual([
      "sign-in-walls",
      "recipe-stopped",
      "recipe-repairing",
      "fleet-health",
    ]);
    const fired = ["recipe-stopped", "recipe-repairing"].map((name) => READINGS[names.indexOf(name)]!);
    expect(fired.map((reading) => [reading.argv, reading.format, tickReadingProducer({ reading })])).toEqual([
      [
        ["monitor", "check", "--only", "recipe-stopped", "--fire", "--by-session", "supervisor", "--json"],
        "json",
        "monitor check recipe-stopped",
      ],
      [
        ["monitor", "check", "--only", "recipe-repairing", "--fire", "--by-session", "supervisor", "--json"],
        "json",
        "monitor check recipe-repairing",
      ],
    ]);
  });

  it("fires the console sync failure monitor every tick, right after fleet health", () => {
    const names = READINGS.map((reading) => reading.name);
    const reading = READINGS[names.indexOf("console-sync-failed")]!;
    expect(names[names.indexOf("fleet-health") + 1]).toBe("console-sync-failed");
    expect([reading.argv, reading.format, tickReadingProducer({ reading })]).toEqual([
      ["monitor", "check", "--only", "console-sync-failed", "--fire", "--by-session", "supervisor", "--json"],
      "json",
      "monitor check console-sync-failed",
    ]);
  });

  it("reads Queue currency after every fired monitor and the snooze wake, so it sees this tick's settles", () => {
    const names = READINGS.map((reading) => reading.name);
    const currency = READINGS[names.indexOf("currency")]!;
    expect([currency.argv, tickReadingProducer({ reading: currency })]).toEqual([
      ["handover", "currency", "--json"],
      "handover currency",
    ]);
    expect(
      ["hand-recheck", "recipe-stopped", "recipe-repairing", "fleet-health", "meeting-prep", "snooze-wake"].map(
        (name) => names.indexOf(name) < names.indexOf("currency"),
      ),
    ).toEqual([true, true, true, true, true, true]);
  });

  it("files the fleet health pass under its monitor's own producer, the one a monitor hand's facts are read from", () => {
    const fleetHealth = READINGS.find((reading) => reading.name === "fleet-health")!;
    expect(tickReadingProducer({ reading: fleetHealth })).toBe("monitor check fleet-unhealthy");
  });

  it("records each host's token burn as JSON under the producer the Fleet page reads it by", () => {
    const burn = READINGS.find((reading) => reading.name === "fleet-burn")!;
    expect([burn.argv, burn.format, tickReadingProducer({ reading: burn })]).toEqual([
      ["fleet", "burn", "--json"],
      "json",
      "fleet burn",
    ]);
  });

  it("reads the freshness report as JSON, beside the due report the broken-automation lines join it to", () => {
    const names = READINGS.map((reading) => reading.name);
    const freshness = READINGS[names.indexOf("freshness")]!;
    expect([freshness.argv, freshness.format, tickReadingProducer({ reading: freshness })]).toEqual([
      ["automation", "freshness", "--json"],
      "json",
      "automation freshness",
    ]);
    expect(names.indexOf("freshness")).toBe(names.indexOf("recipe-due") + 1);
  });

  it("explains the fleet only after the three readings it judges as one tick have landed", () => {
    const names = READINGS.map((reading) => reading.name);
    const why = READINGS[names.indexOf("fleet-why")]!;
    expect([why.argv, why.format, tickReadingProducer({ reading: why })]).toEqual([
      ["fleet", "why", "--minutes", "60", "--json"],
      "json",
      "fleet why",
    ]);
    expect(
      ["watch-report", "capacity", "seat-ceiling"].map((name) => names.indexOf(name) < names.indexOf("fleet-why")),
    ).toEqual([true, true, true]);
  });

  it("wakes due parks right after close-done frees seats and before the watch reads the fleet", () => {
    const names = READINGS.map((reading) => reading.name);
    const start = names.indexOf("close-done");
    expect(names.slice(start, start + 3)).toEqual(["close-done", "handover-wake", "watch"]);
    const wake = READINGS[start + 1]!;
    expect([
      wake.argv,
      wake.format,
      wake.completedExits,
      wake.timeoutMs,
      wake.draftSource,
      tickReadingProducer({ reading: wake }),
    ]).toEqual([["handover", "wake", "--json"], "json", [0, 1, 3, 4], 2_250_000, undefined, "handover wake"]);
  });

  it("reads the withheld Queue cards as JSON, keeping an exit-1 document, on the shared reading budget", () => {
    const refusals = READINGS.find((reading) => reading.name === "queue-refusals")!;
    expect([
      refusals.argv,
      refusals.format,
      refusals.completedExits,
      refusals.timeoutMs,
      refusals.draftSource,
      tickReadingProducer({ reading: refusals }),
    ]).toEqual([["queue", "refusals", "--json"], "json", [0, 1], undefined, undefined, "queue refusals"]);
  });

  it("reads the cards stopping the owner's work as JSON, after every monitor that marks one fired", () => {
    const names = READINGS.map((reading) => reading.name);
    const stopping = READINGS.find((reading) => reading.name === "queue-stopping")!;
    expect([
      stopping.argv,
      stopping.format,
      stopping.completedExits,
      stopping.timeoutMs,
      tickReadingProducer({ reading: stopping }),
    ]).toEqual([["queue", "stopping", "--json"], "json", [0, 1], undefined, "queue stopping"]);
    expect(
      ["automation-held", "recipe-stopped"].map((name) => names.indexOf(name) < names.indexOf("queue-stopping")),
    ).toEqual([true, true]);
  });

  it("takes no landing reading unless the seat names the repositories it lands", () => {
    expect(READINGS.filter((reading) => reading.name.startsWith("landing"))).toEqual([]);
  });

  it("reads landing last, the press read then the drafts read, as JSON, on the longest budget", () => {
    const readings = tickReadings({ landingRepos: ["o/a", "o/b"], loopSessionKey: "k" });
    const landing = readings.slice(-2);
    const selection = ["github", "landing", "--repo", "o/a,o/b", "--author", "@me", "--if-due"];
    expect(landing.map((reading) => reading.name)).toEqual(["landing", "landing-drafts"]);
    expect(landing.map((reading) => reading.argv)).toEqual([
      [...selection, "--press", "--register", "--json"],
      [...selection, "--drafts-only", "--register", "--json"],
    ]);
    expect(landing.map((reading) => reading.format)).toEqual(["json", "json"]);
    expect(landing.map((reading) => reading.timeoutMs)).toEqual([LANDING_TIMEOUT_MS, LANDING_TIMEOUT_MS]);
    expect(readings.length).toBe(READINGS.length + 2);
  });

  it("keeps the drafts slice out of the readings ledger and only it, so the console never shows it as the landing", () => {
    const readings = tickReadings({ bumpDriveRepos: ["o/a"], landingRepos: ["o/a"], loopSessionKey: "k" });
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.filter((reading) => reading.ledgered === false).map((reading) => reading.name)).toEqual([
      "landing-drafts",
    ]);
  });

  it("drives each named repository's bumps in its OWN reading after landing, each under its own producer", () => {
    const readings = tickReadings({
      bumpDriveRepos: ["o/a", "o/b"],
      landingRepos: ["o/a", "o/b"],
      loopSessionKey: "k",
    });
    const drives = readings.slice(-2);

    expect(readings.at(-3)!.name).toBe("landing-drafts");
    expect(drives.map((reading) => reading.name)).toEqual(["bump-drive-o-a", "bump-drive-o-b"]);
    expect(drives.map((reading) => reading.argv)).toEqual([
      ["github", "bump-drive", "--repo", "o/a", "--json"],
      ["github", "bump-drive", "--repo", "o/b", "--json"],
    ]);
    expect(drives.map((reading) => tickReadingProducer({ reading }))).toEqual([
      "github bump-drive o/a",
      "github bump-drive o/b",
    ]);
    expect(drives.map((reading) => [reading.format, reading.timeoutMs])).toEqual([
      ["json", LANDING_TIMEOUT_MS],
      ["json", LANDING_TIMEOUT_MS],
    ]);
  });

  it("takes no bump-drive reading when the tick drives no repository", () => {
    const readings = tickReadings({ landingRepos: ["o/a"], loopSessionKey: "k" });
    expect(readings.filter((reading) => reading.argv[1] === "bump-drive")).toEqual([]);
  });

  it("passes the loop session key to depth and standing", () => {
    const depth = READINGS.find((reading) => reading.name === "depth")!;
    expect(depth.argv).toEqual(["session", "depth", "--loop-session-key", "live-loop-a", "--json"]);
  });
});

describe("isCompletedExit", () => {
  it("takes a diagnostic's finding exit as a whole document, and a plain verb's non-zero as a failure", () => {
    const reconcile = READINGS.find((reading) => reading.name === "reconcile")!;
    const listen = READINGS.find((reading) => reading.name === "listen")!;
    const velocity = READINGS.find((reading) => reading.name === "velocity")!;
    expect([0, 1, 2, null].map((exitCode) => isCompletedExit({ exitCode, reading: reconcile }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([3, 1].map((exitCode) => isCompletedExit({ exitCode, reading: listen }))).toEqual([true, false]);
    expect([0, 1, null].map((exitCode) => isCompletedExit({ exitCode, reading: velocity }))).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("isFailedEmptyReading", () => {
  const watchReport = READINGS.find((reading) => reading.name === "watch-report")!;
  const blocked = READINGS.find((reading) => reading.name === "blocked")!;

  it("declares only the two watch readings and the dispatch sweep as ones that must always print", () => {
    expect(READINGS.filter((reading) => reading.retryWhenEmpty === true).map((reading) => reading.name)).toEqual([
      "watch",
      "watch-report",
      "turn-dispatch-sweep",
    ]);
  });

  it("calls an exit-0 watch with nothing on stdout a failed reading", () => {
    expect(isFailedEmptyReading({ bytes: 0, exitCode: 0, reading: watchReport })).toBe(true);
  });

  it("keeps a watch that printed, or one that failed some other way, out of the empty case", () => {
    expect(isFailedEmptyReading({ bytes: 3_072, exitCode: 0, reading: watchReport })).toBe(false);
    expect(isFailedEmptyReading({ bytes: 0, exitCode: 1, reading: watchReport })).toBe(false);
    expect(isFailedEmptyReading({ bytes: 0, exitCode: null, reading: watchReport })).toBe(false);
  });

  it("never calls an empty reading failed when its verb may legitimately print nothing", () => {
    expect(isFailedEmptyReading({ bytes: 0, exitCode: 3, reading: blocked })).toBe(false);
  });
});

describe("readingFiles", () => {
  it("gives a JSON reading a .json file and a text reading a .txt, each with its own .err", () => {
    expect(readingFiles({ reading: READINGS.find((reading) => reading.name === "capacity")! })).toEqual({
      errFile: "capacity.err",
      file: "capacity.json",
    });
    expect(readingFiles({ reading: READINGS.find((reading) => reading.name === "hold")! })).toEqual({
      errFile: "hold.err",
      file: "hold.txt",
    });
  });
});

describe("isTickLabel", () => {
  it("accepts a plain label and refuses anything that could leave the directory", () => {
    expect(["4", "t270-4", "a_b"].map((tick) => isTickLabel({ tick }))).toEqual([true, true, true]);
    expect(["", "../x", "a/b", ".hidden", "-x"].map((tick) => isTickLabel({ tick }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("tickDraftArgs", () => {
  it("supplies every source in tick-draft's own order when every reading came back clean", () => {
    const args = tickDraftArgs({ capturedIso: "C", dir: "/s/tick-4", readings: cleanOutcomes(), startedIso: "S" });
    expect(args).toEqual([
      "--started",
      "S",
      "--captured",
      "C",
      "--capacity",
      "/s/tick-4/capacity.json",
      "--seat-ceiling",
      "/s/tick-4/seat-ceiling.json",
      "--gauge",
      "/s/tick-4/gauge-report.json",
      "--listener",
      "/s/tick-4/listen.json",
      "--reconcile",
      "/s/tick-4/reconcile.json",
      "--watch",
      "/s/tick-4/watch-report.json",
      "--close-done",
      "/s/tick-4/close-done.json",
      "--recipe-due",
      "/s/tick-4/recipe-due.json",
      "--velocity",
      "/s/tick-4/velocity.json",
      "--friction",
      "/s/tick-4/friction.json",
    ]);
  });

  it("leaves out a source whose reading did not complete or wrote nothing", () => {
    const readings = cleanOutcomes().map((outcome) => {
      if (outcome.name === "capacity") {
        return { ...outcome, completed: false, exitCode: 1 };
      }
      if (outcome.name === "velocity") {
        return { ...outcome, bytes: 0 };
      }
      return outcome;
    });
    const args = tickDraftArgs({ capturedIso: "C", dir: "/s", readings, startedIso: "S" });
    expect(args.includes("--capacity")).toBe(false);
    expect(args.includes("--velocity")).toBe(false);
    expect(args.includes("--gauge")).toBe(true);
  });
});

describe("captureSummaryLines", () => {
  it("names each reading that did not exit 0, and the flags", () => {
    const readings = cleanOutcomes().map((outcome) =>
      outcome.name === "standing"
        ? { ...outcome, child: { durationMs: 9, exitCode: 3, kind: "exited" } as const, completed: false, exitCode: 3 }
        : outcome,
    );
    const lines = captureSummaryLines({
      capture: {
        capturedIso: "C",
        dir: "/s/tick-4",
        readings,
        startedIso: "S",
        tick: "4",
        tickDraftArgs: tickDraftArgs({ capturedIso: "C", dir: "/s/tick-4", readings, startedIso: "S" }),
      },
    });
    expect(lines[0]).toBe(
      `supervisor tick-capture: tick 4 — ${String(READINGS.length - 1)} of ${String(READINGS.length)} readings completed, 10 of 10 tick-draft sources supplied, S → C`,
    );
    expect(lines[1]).toBe("  standing: exit 3 — see /s/tick-4/standing.err");
    expect(lines[2]).toBe("  0 readings appended to the readings ledger as tick-4");
  });

  it("names a reading its budget killed as timed out, never as a bare missing exit code", () => {
    const readings = cleanOutcomes().map((outcome) =>
      outcome.name === "velocity"
        ? {
            ...outcome,
            child: { durationMs: 120_004, kind: "timed-out", signal: "SIGKILL", timeoutMs: 120_000 } as const,
            completed: false,
            exitCode: null,
          }
        : outcome,
    );
    const lines = captureSummaryLines({
      capture: { capturedIso: "C", dir: "/s/tick-4", readings, startedIso: "S", tick: "4", tickDraftArgs: [] },
    });
    expect(lines[1]).toBe("  velocity: timed out after 120s (killed) — see /s/tick-4/velocity.err");
  });

  it("counts the readings that reached the ledger", () => {
    const readings = cleanOutcomes().map((outcome) =>
      outcome.name === "velocity" ? { ...outcome, readingId: "2026-09-16T01:02:00.000Z-velocity" } : outcome,
    );
    const lines = captureSummaryLines({
      capture: {
        capturedIso: "C",
        dir: "/s/tick-4",
        readings,
        startedIso: "S",
        tick: "4",
        tickDraftArgs: tickDraftArgs({ capturedIso: "C", dir: "/s/tick-4", readings, startedIso: "S" }),
      },
    });
    expect(lines[1]).toBe("  1 readings appended to the readings ledger as tick-4");
  });
});

describe("readingProducer", () => {
  it("is the verb words before the first flag", () => {
    expect(readingProducer({ argv: ["claude", "gauge", "--json"] })).toBe("claude gauge");
    expect(readingProducer({ argv: ["session", "depth", "--loop-session-key", "k", "--json"] })).toBe("session depth");
    expect(readingProducer({ argv: ["velocity", "--json"] })).toBe("velocity");
  });

  it("is the whole argv when it carries no flag", () => {
    expect(readingProducer({ argv: ["claude", "gauge"] })).toBe("claude gauge");
  });

  it("names every JSON tick reading distinctly, so two readings never share a ledger producer", () => {
    const producers = tickReadings({ loopSessionKey: "k" })
      .filter((reading) => reading.format === "json")
      .map((reading) => tickReadingProducer({ reading }));
    expect(producers.length).toBeGreaterThan(0);
    expect(new Set(producers).size).toBe(producers.length);
  });
});

describe("qualifyBareRefs", () => {
  it("qualifies adjacent references in one pass — the case the script's sed needed a second pass for", () => {
    expect(qualifyBareRefs({ line: "see #1,#2 and (#345)", repo: "o/r" })).toEqual({
      count: 3,
      line: "see o/r#1,o/r#2 and (o/r#345)",
    });
  });

  it("qualifies a reference at the very start of a line", () => {
    expect(qualifyBareRefs({ line: "#7 landed", repo: "o/r" })).toEqual({ count: 1, line: "o/r#7 landed" });
  });

  it("leaves a qualified reference, a dotted repo, an anchor, a path and an entity alone", () => {
    const line = 'x/y#1 my.repo#2 foo_bar#3 a-b#4 /pull/9#5 &#39; #L12 "#abc"';
    expect(qualifyBareRefs({ line, repo: "o/r" })).toEqual({ count: 0, line });
  });
});

describe("isRepoSlug", () => {
  it("accepts owner/name and refuses anything else", () => {
    expect(["o/r", "lachiejames/slopweaver"].map((repo) => isRepoSlug({ repo }))).toEqual([true, true]);
    expect(["o", "o/r/x", "/r", "o/"].map((repo) => isRepoSlug({ repo }))).toEqual([false, false, false, false]);
  });
});

describe("planCarry", () => {
  it("carries only the allowlist and counts what it left behind", () => {
    const report = planCarry({
      dryRun: false,
      entries: [
        { bytes: 100, name: "form.json" },
        { bytes: 20, name: "shell.txt" },
        { bytes: 5000, name: "reconcile270-4.json" },
        { bytes: 300, name: "tick.sh" },
        { bytes: 0, name: "archive" },
      ],
      from: "/a",
      to: "/b",
    });
    expect(CARRIED_FILES).toEqual(["form.json", "open-pages.json", "shell.txt"]);
    expect(report.files).toEqual([
      { bytes: 100, name: "form.json", status: "carried" },
      { bytes: 0, name: "open-pages.json", status: "absent" },
      { bytes: 20, name: "shell.txt", status: "carried" },
    ]);
    expect(report.leftBehind).toEqual({ bytes: 5300, entries: 3 });
  });

  it("says what a dry run would do", () => {
    const report = planCarry({ dryRun: true, entries: [{ bytes: 1, name: "form.json" }], from: "/a", to: "/b" });
    expect(carrySummaryLines({ report })[0]).toBe(
      "supervisor scratch-carry: would carry 1 of 3 inherited files from /a to /b",
    );
  });
});
