/**
 * `handleSubagentReport` — the second `read-only-subagent` call of `turn dispatch`. Every case runs over an
 * explicit temp home whose ask-lifecycle log is seeded through the production append helper, with a recording
 * clock passed through the `nowIso` seam, so the exit code, the persisted log and WHEN the clock was read are
 * all observable without the wall clock.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  handleSubagentReport,
  type SubagentReportClock,
} from "../../../../../cli/commands/turn/dispatchSubagentReport.js";
import {
  type AppendableAskLifecycleEvent,
  type AskLifecycleEvent,
  parseAskLifecycleLog,
} from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../../../live/ask/store.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" } as const;

const SUBAGENT_DECISION: RespondDecision = {
  confidence: "high",
  needs: [{ capabilityId: "fleet-status", reason: "check open PRs", requirement: "required" }],
  rationale: "a bounded investigation answers this",
  response: "respond",
  schemaVersion: 1,
  tier: "read-only-subagent",
  truthMode: "current",
};

const INLINE_DECISION: RespondDecision = { ...SUBAGENT_DECISION, needs: [], tier: "inline", truthMode: "none" };

const CAPTURED: AppendableAskLifecycleEvent = {
  ...ASK,
  kind: "captured",
  surface: "channel",
  tsIso: "2026-10-13T00:00:00.000Z",
  userId: "U0OWNER",
};

const VALID_REPORT = { observations: [{ author: "system", source: "gh pr list", text: "two PRs are open" }] };

/** A dispatched event of the given tier and lease, decided under {@link SUBAGENT_DECISION}. */
function dispatched({
  leaseExpiresAt,
  tier = "read-only-subagent",
}: {
  leaseExpiresAt: string;
  tier?: "read-only-subagent" | "fresh-visible-session";
}): AppendableAskLifecycleEvent {
  return {
    ...ASK,
    decision: SUBAGENT_DECISION,
    kind: "dispatched",
    leaseExpiresAt,
    tier,
    tsIso: "2026-10-13T00:00:01.000Z",
  };
}

/** A temp home whose lifecycle log holds `events`, plus a report file holding `reportText`. */
function fixture({ events, reportText }: { events: readonly AppendableAskLifecycleEvent[]; reportText: string }): {
  readonly home: string;
  readonly reportPath: string;
} {
  const home = mkdtempSync(join(tmpdir(), "sw-subagent-report-"));
  fixtureDirs.push(home);
  for (const event of events) {
    appendAskLifecycleEvent({ event, home });
  }
  const reportPath = join(home, "report.json");
  writeFileSync(reportPath, reportText, "utf8");
  return { home, reportPath };
}

/** A clock answering `instants` in order, recording every read so a test can count them. */
function recordingClock({ instants }: { instants: readonly string[] }): {
  readonly clock: SubagentReportClock;
  readonly reads: string[];
} {
  const reads: string[] = [];
  const clock: SubagentReportClock = () => {
    const instant = instants[reads.length]!;
    reads.push(instant);
    return instant;
  };
  return { clock, reads };
}

/** Every event the home's lifecycle log holds, in file order. */
function loggedEvents({ home }: { home: string }): readonly AskLifecycleEvent[] {
  return parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
}

/** Run the handler over a fixture with the given decision and clock. */
async function run({
  clock,
  decision = SUBAGENT_DECISION,
  home,
  reportPath,
}: {
  clock: SubagentReportClock;
  decision?: RespondDecision;
  home: string;
  reportPath: string;
}): Promise<number> {
  return handleSubagentReport({
    askIdentity: ASK,
    briefPath: join(home, "brief.json"),
    decision,
    decisionPath: join(home, "decision.json"),
    home,
    nowIso: clock,
    reportPath,
  });
}

const NOW = "2026-10-13T01:00:00.000Z";
const LATER = "2026-10-13T01:00:05.000Z";

describe("handleSubagentReport — refusals before the tier runs", () => {
  it("refuses a decision whose tier is not read-only-subagent with 1, even over a live lease and a valid report", async () => {
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" })];
    const { home, reportPath } = fixture({ events: seeded, reportText: JSON.stringify(VALID_REPORT) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, decision: INLINE_DECISION, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
    expect(loggedEvents({ home })).toEqual(seeded);
  });

  it("refuses with 1 when the ask was captured but never dispatched", async () => {
    const { home, reportPath } = fixture({ events: [CAPTURED], reportText: JSON.stringify(VALID_REPORT) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
    expect(loggedEvents({ home })).toEqual([CAPTURED]);
  });

  it("refuses with 1 when the open dispatch is a fresh-visible-session one, not a subagent", async () => {
    const seeded = [
      CAPTURED,
      dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z", tier: "fresh-visible-session" }),
    ];
    const { home, reportPath } = fixture({ events: seeded, reportText: JSON.stringify(VALID_REPORT) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
  });

  it("refuses with 1 when the dispatch was already ended by a lease-expired event", async () => {
    const ended: AskLifecycleEvent = { ...ASK, kind: "lease-expired", tsIso: "2026-10-13T00:30:00.000Z" };
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" }), ended];
    const { home, reportPath } = fixture({ events: seeded, reportText: JSON.stringify(VALID_REPORT) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
    expect(loggedEvents({ home })).toEqual(seeded);
  });

  it("refuses with 1 when the report file does not exist", async () => {
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" })];
    const { home } = fixture({ events: seeded, reportText: "" });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath: join(home, "absent.json") })).toBe(1);
    expect(reads).toEqual([]);
  });

  it("refuses with 1 when the report is not JSON", async () => {
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" })];
    const { home, reportPath } = fixture({ events: seeded, reportText: "{ not json" });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
    expect(loggedEvents({ home })).toEqual(seeded);
  });

  it("refuses with 1 when the report's JSON fails the evidence schema", async () => {
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2099-01-01T00:00:00.000Z" })];
    const refused = { observations: [{ author: "robot", source: "gh pr list", text: "two PRs are open" }] };
    const { home, reportPath } = fixture({ events: seeded, reportText: JSON.stringify(refused) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([]);
    expect(loggedEvents({ home })).toEqual(seeded);
  });
});

describe("handleSubagentReport — the tier runs against the recorded lease", () => {
  it("accepts a lease one millisecond after the clock with 0 and refuses one AT the clock with 1", async () => {
    const liveSeed = [CAPTURED, dispatched({ leaseExpiresAt: "2026-10-13T01:00:00.001Z" })];
    const live = fixture({ events: liveSeed, reportText: JSON.stringify(VALID_REPORT) });
    const liveClock = recordingClock({ instants: [NOW, LATER] });
    const atSeed = [CAPTURED, dispatched({ leaseExpiresAt: "2026-10-13T01:00:00.000Z" })];
    const at = fixture({ events: atSeed, reportText: JSON.stringify(VALID_REPORT) });
    const atClock = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock: liveClock.clock, home: live.home, reportPath: live.reportPath })).toBe(0);
    expect(await run({ clock: atClock.clock, home: at.home, reportPath: at.reportPath })).toBe(1);
    expect(liveClock.reads).toEqual([NOW]);
    expect(loggedEvents({ home: live.home })).toEqual(liveSeed);
    expect(atClock.reads).toEqual([NOW, LATER]);
  });

  it("records one lease-expired event stamped with the clock's SECOND read, proving it is sampled at append time", async () => {
    const seeded = [CAPTURED, dispatched({ leaseExpiresAt: "2026-10-13T00:00:00.000Z" })];
    const { home, reportPath } = fixture({ events: seeded, reportText: JSON.stringify(VALID_REPORT) });
    const { clock, reads } = recordingClock({ instants: [NOW, LATER] });

    expect(await run({ clock, home, reportPath })).toBe(1);
    expect(reads).toEqual([NOW, LATER]);
    expect(loggedEvents({ home })).toEqual([
      ...seeded,
      { ...ASK, kind: "lease-expired", tsIso: "2026-10-13T01:00:05.000Z" },
    ]);
  });
});
