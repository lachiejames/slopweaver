/** The one status rule a `supervisor chair-watch` pass reports (`src/supervisor/chairWatch.ts`). */
import { describe, expect, it } from "vitest";

import {
  type ChairWatchChair,
  type ChairWatchReport,
  chairWatchStatus,
  reportWithoutAddresses,
} from "../../../supervisor/chairWatch.js";
import { chairWatchLines } from "../../../supervisor/chairWatchLines.js";

const SYNTHETIC_ADDRESS = "seat-1@example.test";

describe("reportWithoutAddresses", () => {
  const report: ChairWatchReport = {
    chair: { kind: "unresolved", why: `pin names ${SYNTHETIC_ADDRESS}` },
    notes: [`the plan register is not usable: row plan-one has email ${SYNTHETIC_ADDRESS}`],
    observedAtIso: "2026-11-27T11:00:00.000Z",
    overrides: [],
    readings: [],
    reasons: ["plan-one's seven-day window is at 97%"],
    status: "unmeasured",
    successor: { target: { kind: "none", why: `register refused ${SYNTHETIC_ADDRESS}` } },
    usage: { gaps: [`app said ${SYNTHETIC_ADDRESS}`], plans: [], sessions: [] },
  };

  it("replaces an address in every free-text field and keeps the rest", () => {
    expect(JSON.stringify(report)).toContain(SYNTHETIC_ADDRESS);
    const scrubbed = reportWithoutAddresses({ report });
    expect(JSON.stringify(scrubbed)).not.toContain(SYNTHETIC_ADDRESS);
    expect(scrubbed.notes).toEqual(["the plan register is not usable: row plan-one has email <account>"]);
    expect(scrubbed.successor).toEqual({ target: { kind: "none", why: "register refused <account>" } });
    expect(scrubbed.chair).toEqual({ kind: "unresolved", why: "pin names <account>" });
    expect(scrubbed.usage.gaps).toEqual(["app said <account>"]);
    expect(scrubbed.reasons).toEqual(["plan-one's seven-day window is at 97%"]);
  });

  it("replaces an address in the owner's hold reason and every other line a reader or the JSON sees", () => {
    const typed: ChairWatchReport = {
      ...report,
      hold: { reason: `pause ${SYNTHETIC_ADDRESS}`, sinceIso: "2026-11-27T10:00:00.000Z" },
      overrides: [`release for ${SYNTHETIC_ADDRESS}`],
      readings: [
        {
          alias: "plan-one",
          chair: true,
          reading: `week 44% (${SYNTHETIC_ADDRESS})`,
          state: "measured",
          vendor: "claude",
        },
      ],
      reasons: [`plan-one (${SYNTHETIC_ADDRESS}) is at 97%`],
      status: "held",
      usage: {
        gaps: [],
        plans: [{ alias: "plan-one", appTokens: 12, modelHostReading: `host said ${SYNTHETIC_ADDRESS}` }],
        sessions: [{ mismatch: `asked ${SYNTHETIC_ADDRESS}`, sessionId: "s-1" }],
      },
    };
    expect(JSON.stringify(typed)).toContain(`pause ${SYNTHETIC_ADDRESS}`);
    const scrubbed = reportWithoutAddresses({ report: typed });
    expect(JSON.stringify(scrubbed)).not.toContain(SYNTHETIC_ADDRESS);
    expect(scrubbed.hold).toEqual({ reason: "pause <account>", sinceIso: "2026-11-27T10:00:00.000Z" });
    expect(scrubbed.overrides).toEqual(["release for <account>"]);
    expect(scrubbed.readings.map((reading) => reading.reading)).toEqual(["week 44% (<account>)"]);
    expect(scrubbed.reasons).toEqual(["plan-one (<account>) is at 97%"]);
    expect(scrubbed.usage.plans).toEqual([
      { alias: "plan-one", appTokens: 12, modelHostReading: "host said <account>" },
    ]);
    expect(scrubbed.usage.sessions).toEqual([{ mismatch: "asked <account>", sessionId: "s-1" }]);
    expect(chairWatchLines({ report: scrubbed }).join("\n")).toContain("pause <account>");
  });
});

const APP_CHAIR: ChairWatchChair = { appSessionId: "app-1", kind: "app", sessionIds: ["a0000032"] };
const CMUX_CHAIR: ChairWatchChair = { kind: "cmux", sessionIds: ["a0000032"], workspaceId: "WS" };
const CODEX_CHAIR: ChairWatchChair = { kind: "codex", threadId: "thread-1" };
const UNRESOLVED: ChairWatchChair = { kind: "unresolved", why: "no pinned supervisor workspace" };
const HOLD = { reason: "mid-demo", sinceIso: "2026-11-27T11:00:00.000Z" } as const;

describe("chairWatchStatus", () => {
  it("reports stay for a measured chair with no reason to hand off", () => {
    expect(chairWatchStatus({ cadence: "stay", chair: APP_CHAIR, hold: undefined })).toBe("stay");
  });

  it("reports hand-off for an app chair the cadence says to hand off, with no hold", () => {
    expect(chairWatchStatus({ cadence: "hand-off", chair: APP_CHAIR, hold: undefined })).toBe("hand-off");
  });

  it("reports held when the owner's hold stands over a hand-off verdict", () => {
    expect(chairWatchStatus({ cadence: "hand-off", chair: APP_CHAIR, hold: HOLD })).toBe("held");
  });

  it("reports unsupported for a cmux chair the cadence says to hand off, hold or not", () => {
    expect(chairWatchStatus({ cadence: "hand-off", chair: CMUX_CHAIR, hold: undefined })).toBe("unsupported");
    expect(chairWatchStatus({ cadence: "hand-off", chair: CMUX_CHAIR, hold: HOLD })).toBe("unsupported");
  });

  it("reports unsupported for a Codex chair the cadence says to hand off", () => {
    expect(chairWatchStatus({ cadence: "hand-off", chair: CODEX_CHAIR, hold: undefined })).toBe("unsupported");
  });

  it("reports unmeasured when the cadence could not judge, whatever the chair", () => {
    expect(chairWatchStatus({ cadence: "unmeasured", chair: APP_CHAIR, hold: undefined })).toBe("unmeasured");
  });

  it("reports unmeasured for an unresolved chair even on a hand-off verdict", () => {
    expect(chairWatchStatus({ cadence: "hand-off", chair: UNRESOLVED, hold: undefined })).toBe("unmeasured");
  });

  it("reports stay for a staying chair even while a hold stands", () => {
    expect(chairWatchStatus({ cadence: "stay", chair: CMUX_CHAIR, hold: HOLD })).toBe("stay");
  });
});
