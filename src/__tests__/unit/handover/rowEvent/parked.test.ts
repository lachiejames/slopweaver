/**
 * `applyRowEvent` on the two park events: a `parked` event is appended only while it names the run's holder, and a
 * `park-cleared` event only while it names the standing park's position over a journal it can read whole. A genuine
 * `mkdtempSync` round trip, every directory removed after the case that minted it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { unwrapErr } from "../../../../lib/result.js";
import { LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

describe("applyRowEvent on a `parked` event", () => {
  const LAUNCHED: RunEvent = {
    atIso: LATER,
    host: "claude-code",
    kind: "launched",
    pid: 4242,
    sessionId: "session-a",
    worktree: "/wt",
  };
  const parked = ({ sessionId = "session-a" } = {}): RunEvent => ({
    atIso: "2026-09-07T12:00:00.000Z",
    branch: "feat/x",
    kind: "parked",
    question: "Which slide order?",
    screenTail: "❯ ",
    sessionId,
    workspaceRef: "workspace:9",
    worktree: "/wt",
  });

  it("appends when the event names the run's holder", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED], slug: "a-row" });

    expect(applyRowEvent({ event: parked(), runsDir: dir, slug: "a-row" }).isOk()).toBe(true);
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).toContain('"kind":"parked"');
  });

  // A claim between park's read and its append left a park releasing nobody.
  it("refuses a park decided before another session claimed the run", () => {
    const dir = runsDir();
    const claimed: RunEvent = {
      atIso: "2026-09-07T11:30:00.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: 5151,
      sessionId: "session-b",
      why: "taking it over",
      worktree: "/wt",
    };
    seed({ dir, events: [STARTED, LAUNCHED, claimed], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: parked(), runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("the run is now held by session-b, not session-a");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"parked"');
  });

  it("refuses a park over a run no session holds", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: parked(), runsDir: dir, slug: "a-row" }));

    expect(error.message).toContain("no session holds this run now");
  });
});

describe("applyRowEvent on a `park-cleared` event", () => {
  const LAUNCHED: RunEvent = { atIso: LATER, kind: "launched", pid: 4242, sessionId: "session-a", worktree: "/wt" };
  const PARKED: RunEvent = {
    atIso: "2026-09-07T12:00:00.000Z",
    branch: "feat/x",
    kind: "parked",
    screenTail: "❯ ",
    sessionId: "session-a",
    wake: { atIso: "2026-09-07T12:30:00Z", kind: "at" },
    workspaceRef: "workspace:9",
    worktree: "/wt",
  };
  const cleared = ({ parkIndex }: { parkIndex: number }): RunEvent => ({
    atIso: "2026-09-07T13:00:00.000Z",
    kind: "park-cleared",
    parkIndex,
    why: "the row is done",
  });

  it("appends when it names the standing park's position", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED, PARKED], slug: "a-row" });

    expect(applyRowEvent({ event: cleared({ parkIndex: 2 }), runsDir: dir, slug: "a-row" }).isOk()).toBe(true);
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).toContain('"kind":"park-cleared"');
  });

  it("refuses one naming a position where no park stands, and writes nothing", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, LAUNCHED, PARKED], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: cleared({ parkIndex: 1 }), runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain("no park stands at position 1, so there is nothing this clears");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"park-cleared"');
  });

  // A line appended after the wake checked the park may re-open the row the clear retires.
  it("refuses one over a word this build predates, even naming the standing park, and writes nothing", () => {
    const dir = runsDir();
    const future = JSON.stringify({ atIso: "2026-09-07T12:45:00.000Z", kind: "some-future-kind" });
    const lines = [STARTED, LAUNCHED, PARKED].map((event) => JSON.stringify(event));
    writeFileSync(join(dir, "a-row.jsonl"), `${[...lines, future].join("\n")}\n`, "utf8");

    const error = unwrapErr(applyRowEvent({ event: cleared({ parkIndex: 2 }), runsDir: dir, slug: "a-row" }));

    expect(error.code).toBe("JOURNAL_INCOMPLETE");
    expect(error.message).toContain("clear a park on a journal with undecodable line(s) 4");
    expect(readFileSync(join(dir, "a-row.jsonl"), "utf8")).not.toContain('"kind":"park-cleared"');
  });
});
