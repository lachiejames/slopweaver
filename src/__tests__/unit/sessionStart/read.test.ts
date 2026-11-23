import { describe, expect, it } from "vitest";

import { holderLivenessOf } from "../../../cli/commands/sessionStart/read.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { SessionRoster } from "../../../measurement/sessions.js";
import type { Measured } from "../../../measurement/status.js";
import { measured, unmeasurable } from "../../../measurement/status.js";

const started = ({ atIso }: { atIso: string }): RunEvent => ({
  atIso,
  branch: "a-branch",
  docHash: "0123456789abcdef",
  kind: "started",
});

/** A journal whose launch names a Claude Code session, which is the only host the registry can judge. */
const launchedBy = ({ sessionId }: { sessionId: string }): readonly RunEvent[] => [
  started({ atIso: "2026-08-30T00:00:00.000Z" }),
  {
    atIso: "2026-08-30T00:00:01.000Z",
    host: "claude-code",
    kind: "launched",
    pid: 4242,
    sessionId,
    worktree: "/repos/a-worktree",
  },
  { atIso: "2026-08-31T00:00:00.000Z", kind: "question", question: "which reading?" },
];

/** A roster that proves exactly the ids given, with nothing it could not account for. */
const rosterOf = ({ liveIds }: { liveIds: readonly string[] }): Measured<SessionRoster> =>
  measured({ value: { blindSpots: [], liveIds: new Set(liveIds), refused: [] } });

/** A Codex open-file scan that must never be consulted for these Claude Code writers. */
function neverCodex(): never {
  throw new Error("codexThread consulted for a Claude Code writer");
}

describe("holderLivenessOf", () => {
  it("calls a writer live when the registry proves its session is", () => {
    const liveness = holderLivenessOf({
      codexThread: neverCodex,
      events: launchedBy({ sessionId: "session-a" }),
      roster: rosterOf({ liveIds: ["session-a"] }),
    });
    expect(liveness).toStrictEqual({ kind: "live" });
  });

  it("calls a writer DEAD when the registry decoded fully and does not hold its session", () => {
    const liveness = holderLivenessOf({
      codexThread: neverCodex,
      events: launchedBy({ sessionId: "session-a" }),
      roster: rosterOf({ liveIds: ["session-b"] }),
    });
    expect(liveness).toStrictEqual({ kind: "dead" });
  });

  it("withholds a verdict when the registry could not be read, rather than guessing death", () => {
    const liveness = holderLivenessOf({
      codexThread: neverCodex,
      events: launchedBy({ sessionId: "session-a" }),
      roster: unmeasurable<SessionRoster>({ why: "the sessions directory could not be listed" }),
    });
    expect(liveness).toStrictEqual({
      kind: "unknown",
      why: "the live-session registry could not be read — the sessions directory could not be listed",
    });
  });

  it("has nothing to ask about when the journal names no writer at all", () => {
    expect(
      holderLivenessOf({
        codexThread: neverCodex,
        events: [started({ atIso: "2026-08-30T00:00:00.000Z" })],
        roster: rosterOf({ liveIds: [] }),
      }),
    ).toBeUndefined();
  });
});
