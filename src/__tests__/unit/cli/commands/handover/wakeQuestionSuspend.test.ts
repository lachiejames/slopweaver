/**
 * The suspension append's precondition: the wake's judgement holds only while the park it judged still stands at
 * that instant and no lifting line landed past the journal length it judged at.
 */
import { describe, expect, it } from "vitest";

import { judgementStale } from "../../../../../cli/commands/handover/wakeQuestionSuspend.js";
import type { RunEvent } from "../../../../../handover/ledger.js";

const QUESTION = "Keep the backup key wrapped?";
const PARKED_ISO = "2026-10-04T03:00:00.000Z";

const STARTED: RunEvent = { atIso: "2026-10-04T01:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const LAUNCHED: RunEvent = {
  atIso: "2026-10-04T01:00:01.000Z",
  kind: "launched",
  pid: 1,
  sessionId: "s",
  worktree: "/wt",
};
const ASKED: RunEvent = { atIso: "2026-10-04T02:00:00.000Z", kind: "question", question: QUESTION };
const PARKED: RunEvent = {
  atIso: PARKED_ISO,
  branch: "b",
  kind: "parked",
  question: QUESTION,
  screenTail: "❯ ",
  sessionId: "s",
  wake: { kind: "checks", number: 7, repo: "acme/widgets" },
  workspaceRef: "workspace:1",
  worktree: "/wt",
};
const BASE: readonly RunEvent[] = [STARTED, LAUNCHED, ASKED, PARKED];

describe("judgementStale", () => {
  it("holds when the judged park stands and nothing landed past the judged length", () => {
    expect(judgementStale({ events: BASE, judgedLength: 4, parkedAtIso: PARKED_ISO })).toBe(undefined);
  });

  it("refuses when the standing park is another instant than the one judged", () => {
    expect(judgementStale({ events: BASE, judgedLength: 4, parkedAtIso: "2026-10-04T03:30:00.000Z" })).toBe(
      "the park the wake judged no longer stands",
    );
  });

  it("refuses a lifting line that landed past the judged length", () => {
    const answered: RunEvent = { answer: "yes", atIso: "2026-10-04T04:00:00.000Z", kind: "answered" };
    expect(judgementStale({ events: [...BASE, answered], judgedLength: 4, parkedAtIso: PARKED_ISO })).toBe(
      "a answered line landed while the wake judged the park",
    );
  });
});
