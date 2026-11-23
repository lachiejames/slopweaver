/**
 * The twelve source formatters: what each reading says, and the three rules every one of them keeps.
 *
 * The exact strings are the point. A formatter is the only thing between a typed reading and the sentence the owner
 * reads, so a change to one has to show up as a changed expectation here rather than as a page nobody
 * compared against anything.
 */
import { describe, expect, it } from "vitest";

import { narrativeSourceLines } from "../../../briefing/narrativeSources.js";
import { buildCeilingsReading } from "../../../capacity/ceilings.js";
import { textOfContent } from "../../../outbound/briefing/vocabulary.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type SupervisorTickSources, TICK_SOURCE_KINDS } from "../../../supervisor/tickTypes.js";

/** Every source `unavailable`, which is the base every case below overrides one field of. */
function unavailableSources(): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: `the ${kind} step did not run`,
      observedAtIso: "2026-09-15T01:00:00.000Z",
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/** The base, with one source replaced by a reading of the caller's shape. */
function sourcesWith({ kind, observation }: { kind: string; observation: unknown }): SupervisorTickSources {
  return { ...unavailableSources(), [kind]: observation } as unknown as SupervisorTickSources;
}

/** One source's whole line as plain text. */
function lineFor({ kind, observation }: { kind: string; observation: unknown }): string {
  const lines = narrativeSourceLines({ sources: sourcesWith({ kind, observation }) });
  return textOfContent({ content: lines.find((line) => line.kind === kind)!.content });
}

/** A `read` observation of one source's facts. */
function read({ facts, command }: { facts: unknown; command: string }): unknown {
  return {
    facts,
    observedAtIso: "2026-09-15T02:00:00.000Z",
    status: "read",
    witness: { command, exitCode: 0 },
  };
}

describe("the source formatters", () => {
  it("reports every source, in the recorder's own declaration order", () => {
    const lines = narrativeSourceLines({ sources: unavailableSources() as unknown as SupervisorTickSources });

    expect(lines.map((line) => line.kind)).toEqual([...TICK_SOURCE_KINDS]);
    expect(lines.length).toBe(12);
  });

  it("says a source was not read, and why, without exposing anything else", () => {
    expect(lineFor({ kind: "capacity", observation: unavailableSources()["capacity"] })).toBe(
      "machine: not read — the capacity step did not run · read at 2026-09-15T01:00:00.000Z by slopweaver capacity (no exit was watched)",
    );
  });

  it("renders the machine reading, calling the compressor the compressor and the disk the disk", () => {
    const line = lineFor({
      kind: "capacity",
      observation: read({
        command: "slopweaver machine capacity --json",
        facts: {
          diskFreeGb: 72.9,
          diskHoldFreeGb: 30,
          diskUsedPct: 93,
          dispatchBackoffSeconds: 0,
          dispatchCovering: 0,
          dispatchOpen: 0,
          dispatchSubject: "",
          hold: true,
          holdSubjects: ["memory", "cpu"],
          load1: 4.5,
          registeredWorktrees: 872,
          segmentsPct: 81,
          swapfileCount: 3,
          topForeignGb: 6.25,
          topForeignLabel: "Chrome",
        },
      }),
    });

    expect(line).toBe(
      "machine: holding on memory and cpu; load 4.50, memory compressor 81% full, 3 swapfile(s); disk 72.9 GB " +
        "free, holding below 30 GB; 872 registered worktree(s), cleared by `slopweaver worktree prune`; biggest " +
        "program that is not ours is Chrome at 6.3 GB · read at 2026-09-15T02:00:00.000Z by slopweaver " +
        "machine capacity --json (exit 0)",
    );
  });

  it("says the free GB alone, never a percentage, on a row journalled before the floor was", () => {
    const line = lineFor({
      kind: "capacity",
      observation: read({
        command: "slopweaver machine capacity --json",
        facts: {
          diskFreeGb: 150,
          diskUsedPct: 85,
          hold: false,
          holdSubjects: [],
          load1: 1,
          segmentsPct: 4,
          swapfileCount: 0,
          topForeignGb: 1,
          topForeignLabel: "Chrome",
        },
      }),
    });

    expect(line).toContain("; disk 150.0 GB free; biggest program");
    expect(line).not.toContain("85%");
  });

  it("drops both disk clauses when the captured report carried no such reading, rather than printing zero", () => {
    const line = lineFor({
      kind: "capacity",
      observation: read({
        command: "slopweaver machine capacity --json",
        facts: {
          hold: false,
          holdSubjects: [],
          load1: 1,
          segmentsPct: 4,
          swapfileCount: 0,
          topForeignGb: 1,
          topForeignLabel: "Chrome",
        },
      }),
    });

    expect(line).toBe(
      "machine: nothing holding; load 1.00, memory compressor 4% full, 0 swapfile(s); biggest program that " +
        "is not ours is Chrome at 1.0 GB; load-investigation coverage was not recorded in this older " +
        "supervisor check · read at 2026-09-15T02:00:00.000Z by slopweaver machine capacity --json (exit 0)",
    );
  });

  it("appends what is unused on every ceiling, and which binds, when the capture read its ceilings", () => {
    const ceilings = buildCeilingsReading({
      machine: { hold: false, holdSubjects: [], idlePct: null, load1: 11, loadHold: 22 },
      observedAtIso: "2026-09-15T02:00:00.000Z",
      plans: {
        claude: [
          {
            account: "plan-two@example.test",
            gauge: {
              alias: "plan-two",
              allowance: { kind: "weekly-window" },
              fiveHour: { resetAtIso: "2026-09-15T05:00:00.000Z", status: "allowed", utilization: 0.1 },
              observedAtIso: "2026-09-15T02:00:00.000Z",
              sevenDay: { resetAtIso: "2026-09-18T00:00:00.000Z", status: "allowed", utilization: 0.36 },
              usageLimitPercent: 100,
            },
            kind: "read",
          },
        ],
        claudeThresholds: DEFAULT_THRESHOLDS.claude,
        codex: [],
        codexRoutedAlias: null,
        problems: [],
      },
    });
    const line = lineFor({
      kind: "capacity",
      observation: read({
        command: "slopweaver machine capacity --json",
        facts: {
          ceilings,
          dispatchBackoffSeconds: 0,
          dispatchCovering: 0,
          dispatchOpen: 0,
          dispatchSubject: "",
          hold: false,
          holdSubjects: [],
          load1: 11,
          segmentsPct: 4,
          swapfileCount: 0,
          topForeignGb: 1,
          topForeignLabel: "Chrome",
        },
      }),
    });

    expect(line).toBe(
      "machine: nothing holding; load 11.00, memory compressor 4% full, 0 swapfile(s); biggest program that " +
        "is not ours is Chrome at 1.0 GB; unused now: machine 50% (load1 11/22), claude:plan-two 64% (seven-day " +
        "36/100 resets 2026-09-18T00:00Z); lowest machine · read at 2026-09-15T02:00:00.000Z by slopweaver " +
        "machine capacity --json (exit 0)",
    );
  });

  it("keeps the worktree count when the volume itself could not be read", () => {
    const line = lineFor({
      kind: "capacity",
      observation: read({
        command: "slopweaver machine capacity --json",
        facts: {
          hold: false,
          holdSubjects: [],
          load1: 1,
          registeredWorktrees: 12,
          segmentsPct: 4,
          swapfileCount: 0,
          topForeignGb: 1,
          topForeignLabel: "Chrome",
        },
      }),
    });

    expect(line).toContain("12 registered worktree(s), cleared by `slopweaver worktree prune`");
    expect(line).not.toContain("GB free");
  });

  it("renders the model plans, including where nothing can take a new session", () => {
    const line = lineFor({
      kind: "gauge",
      observation: read({
        command: "slopweaver gauge --json",
        facts: {
          nextAllModels: "plan-b",
          nextFable: null,
          plans: [
            {
              fablePct: 90,
              fableResetsIso: "2026-09-16T11:00:00.000Z",
              fiveHourPct: 12,
              fiveHourResetsIso: "2026-09-15T05:00:00.000Z",
              plan: "plan-a",
              resetsIso: "2026-09-18T00:00:00.000Z",
              weekPct: 61,
            },
          ],
          reactNowLines: [],
        },
      }),
    });

    expect(line).toBe(
      "model plans: plan-a 61% of the week resets 2026-09-18T00:00:00.000Z, 90% Fable resets 2026-09-16T11:00:00.000Z, " +
        "12% of five hours resets 2026-09-15T05:00:00.000Z; " +
        "the next all-models session goes to plan-b; the next Fable session goes to nowhere — none can take one " +
        "· read at 2026-09-15T02:00:00.000Z by slopweaver gauge --json (exit 0)",
    );
  });

  it("says an Ultra plan has no five-hour cap rather than dropping the plan from the briefing", () => {
    const line = lineFor({
      kind: "gauge",
      observation: read({
        command: "slopweaver gauge --json",
        facts: {
          nextAllModels: "plan-a",
          nextFable: "plan-a",
          plans: [{ fablePct: 0, plan: "plan-a", resetsIso: "2026-11-05T19:00:00.000Z", weekPct: 7 }],
          reactNowLines: [],
        },
      }),
    });

    expect(line).toBe(
      "model plans: plan-a 7% of the week resets 2026-11-05T19:00:00.000Z, 0% Fable, no five-hour cap; " +
        "the next all-models session goes to plan-a; the next Fable session goes to plan-a " +
        "· read at 2026-09-15T02:00:00.000Z by slopweaver gauge --json (exit 0)",
    );
  });

  it("appends every PLAN line even when the gauge's verbatim line wins the body — unread and paused included", () => {
    const line = lineFor({
      kind: "gauge",
      observation: {
        facts: {
          nextAllModels: "plan-a",
          nextFable: "plan-a",
          planLines: ["PLAN plan-a: week 40%", "PLAN plan-b: UNREAD — no login", "PLAN plan-c: PAUSED since x — y"],
          plans: [],
          reactNowLines: [],
        },
        observedAtIso: "2026-09-15T02:00:00.000Z",
        status: "read",
        verbatimLine: "acceptance: 1 of 3 plans read",
        witness: { command: "slopweaver gauge --json", exitCode: 0 },
      },
    });

    expect(line).toBe(
      "model plans: acceptance: 1 of 3 plans read; PLAN plan-a: week 40%; PLAN plan-b: UNREAD — no login; " +
        "PLAN plan-c: PAUSED since x — y · read at 2026-09-15T02:00:00.000Z by slopweaver gauge --json (exit 0)",
    );
  });

  it("renders every open pull request as a LINK, never as text shaped like a reference", () => {
    const lines = narrativeSourceLines({
      sources: sourcesWith({
        kind: "github",
        observation: read({
          command: "slopweaver github open --json",
          facts: {
            holdStanding: false,
            mainSha: "1a0985e4",
            pullRequests: [
              {
                draft: true,
                mergeable: "MERGEABLE",
                number: 728,
                repo: "acme/slopweaver",
                rollup: "PENDING",
                title: "project the recorded passes",
                url: "https://github.com/acme/slopweaver/pull/728",
              },
            ],
          },
        }),
      }),
    });
    const github = lines.find((line) => line.kind === "github")!;

    expect(github.content.filter((run) => run.kind === "link")).toEqual([
      {
        kind: "link",
        text: "acme/slopweaver#728 project the recorded passes",
        url: "https://github.com/acme/slopweaver/pull/728",
      },
    ]);
    expect(textOfContent({ content: github.content })).toContain("(draft) — MERGEABLE, checks PENDING");
  });

  it("prefers the verb's own line over re-composing one", () => {
    const line = lineFor({
      kind: "reconcile",
      observation: {
        ...(read({
          command: "slopweaver handover reconcile --json",
          facts: {
            alignedCount: 1,
            headline: "ignored",
            intakeClause: "ignored",
            misalignedCount: 0,
            rankedCount: 1,
            starvingCount: 0,
            staleAskCount: 0,
            unregisteredCount: 0,
          },
        }) as Record<string, unknown>),
        verbatimLine: "eleven runs ranked, none starving",
      },
    });

    expect(line).toBe(
      "board and intake: eleven runs ranked, none starving · read at 2026-09-15T02:00:00.000Z by slopweaver handover reconcile --json (exit 0)",
    );
  });

  it("renders a partial reading's facts AND what it could not see", () => {
    const line = lineFor({
      kind: "velocity",
      observation: {
        diagnostic: "yesterday's rows were unreadable",
        facts: { caution: "this is not a target", docsLandedToday: 7 },
        observedAtIso: "2026-09-15T02:00:00.000Z",
        status: "partial",
        witness: { command: "slopweaver velocity", exitCode: 0 },
      },
    });

    expect(line).toBe(
      "pace: read in part — 7 document(s) finished today — this is not a target (could not see: yesterday's " +
        "rows were unreadable) · read at 2026-09-15T02:00:00.000Z by slopweaver velocity (exit 0)",
    );
  });

  it("counts the three statuses so a rollup headline never has to parse prose back out", () => {
    const lines = narrativeSourceLines({
      sources: sourcesWith({ kind: "depth", observation: read({ command: "slopweaver depth", facts: { rows: [] } }) }),
    });

    expect(lines.filter((line) => line.status === "read").length).toBe(1);
    expect(lines.filter((line) => line.status === "unavailable").length).toBe(11);
  });
});

/**
 * The friction line is where a dead producer used to read as healthy. Once, the verb behind it
 * reported `hasGap: false` — true, and true only because nothing had written a report for days — and
 * this formatter turned that into "nothing waiting". Both clauses of that sentence were accurate and the
 * quiet one was the one that mattered, so the three cases below pin which sentence each reading produces.
 */
describe("the friction formatter", () => {
  it("says a review is waiting when the hand-off was missed", () => {
    const line = lineFor({
      kind: "friction",
      observation: read({
        command: "slopweaver reflect friction-review --json",
        facts: { hasGap: true, isStale: false, newestReport: "2026-09-20" },
      }),
    });

    expect(line).toContain("a review is waiting to be published; newest report 2026-09-20");
  });

  it("says nothing is waiting when the hand-off is current and the producer is alive", () => {
    const line = lineFor({
      kind: "friction",
      observation: read({
        command: "slopweaver reflect friction-review --json",
        facts: { hasGap: false, isStale: false, newestReport: "2026-09-20" },
      }),
    });

    expect(line).toContain("nothing waiting; newest report 2026-09-20");
  });

  it("names the stopped producer rather than 'nothing waiting' when the gap is closed by starvation", () => {
    const line = lineFor({
      kind: "friction",
      observation: read({
        command: "slopweaver reflect friction-review --json",
        facts: { hasGap: false, isStale: true, newestReport: "2026-09-03" },
      }),
    });

    expect(line).toContain(
      "nothing has written a review for days — the producer has stopped; newest report 2026-09-03",
    );
    expect(line).not.toContain("nothing waiting");
  });

  it("never calls the producer alive on a row from before the staleness check existed", () => {
    const line = lineFor({
      kind: "friction",
      observation: read({
        command: "slopweaver reflect friction-review --json",
        facts: { hasGap: false, newestReport: "2026-09-20" },
      }),
    });

    expect(line).toContain(
      "nothing waiting; newest report 2026-09-20; whether anything still writes reviews was not checked then",
    );
  });
});
