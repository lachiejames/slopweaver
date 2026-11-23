/**
 * The chair gate — its verdict over every shape a pinned workspace can be in, and the shell that stands in front
 * of `supervisor tick-record` and `supervisor sweep-prompt`, driven over the frozen chair transcript.
 *
 * The shell also RESTORES, so the seams here include the send and the attempt ledger. Both are plain fake functions
 * passed in, never mocks — `.claude/rules/testing.md`; the fixtures and the driver are `./chairGateFixtures.ts`.
 */
import { describe, expect, it } from "vitest";

import { gateHome } from "../../../cli/commands/supervisor/chairGateRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import {
  type CallerChairReading,
  type ChairGateVerdict,
  type ChairRead,
  chairViolatesRequirement,
  judgeChair as judgeChairAgainst,
} from "../../../supervisor/chairGate.js";
import { type ChairRequirement, FABLE_CHAIR_REQUIREMENT } from "../../../supervisor/chairPolicy.js";
import { FILL_LANES, LEAN_LANES } from "../plans/laneFixtures.js";
import {
  BOTH_TABS,
  CMUX_SILENT,
  FABLE_CALLER,
  FABLE_ONLY,
  FABLE_WORKER,
  gate,
  METERED_NOW,
  OPUS_ONLY,
  OPUS_REQUIRED,
  OPUS_TAB,
  PINNED_WORKSPACE,
  type ResolvedChairRead,
} from "./chairGateFixtures.js";

/**
 * Judge under today's rule, Fable, which every case written before the lean shape asserts.
 *
 * @returns the verdict
 */
function judgeChair(args: { read: ChairRead; caller?: CallerChairReading | undefined }): ChairGateVerdict {
  return judgeChairAgainst({ ...args, requirement: FABLE_CHAIR_REQUIREMENT });
}

describe("judgeChair", () => {
  it("refuses the measured workspace, naming the Opus tab and its fallback and leaving the Fable tab out", () => {
    const verdict = judgeChair({ read: BOTH_TABS });

    expect(verdict).toStrictEqual({
      detail: "1 of 2 session(s) in the pinned workspace are off Fable, 0 unread",
      kind: "refused",
      lines: [
        "  session a0000023-0000-4000-8000-000000000026 (pid 111): OFF FABLE — on claude-opus-4-8 as of " +
          "2026-09-15T20:58:32.701Z; a safeguard fallback switched it from " +
          "claude-fable-5-1 to claude-opus-4-8 at 2026-09-15T19:23:30.360Z (category cyber)",
      ],
    });
  });

  it("is clean when every session in the pinned workspace is on Fable", () => {
    expect(judgeChair({ read: FABLE_ONLY })).toStrictEqual({ kind: "clean" });
    expect(chairViolatesRequirement({ read: FABLE_ONLY, requirement: FABLE_CHAIR_REQUIREMENT })).toBe(false);
    expect(chairViolatesRequirement({ read: BOTH_TABS, requirement: FABLE_CHAIR_REQUIREMENT })).toBe(true);
  });

  it("refuses when it cannot see: no pinned workspace, or no Claude session inside it", () => {
    expect(
      judgeChair({ read: { cause: "no-chair", kind: "unresolved", why: "no workspace is pinned" } }),
    ).toStrictEqual({
      detail: "the chair could not be read: no workspace is pinned",
      kind: "refused",
      lines: [],
    });
    expect(judgeChair({ read: { ...BOTH_TABS, sessions: [] } })).toMatchObject({ kind: "refused" });
  });

  it("judges the caller when cmux did not answer, passing an on-Fable session as caller-only", () => {
    const verdict = judgeChair({ caller: FABLE_CALLER, read: CMUX_SILENT });

    expect(verdict).toStrictEqual({
      kind: "caller-only",
      note:
        "chair gate: cmux did not answer (cmux workspaces could not be listed (window.list did not answer within " +
        "15000ms)), so only this session was judged — session a0000014-0000-4000-8000-000000000015: on " +
        "claude-fable-5-1 as of 2026-09-15T21:04:22.000Z. Any other tab in the pinned workspace went unseen this tick.",
    });
  });

  it("still refuses an off-Fable caller when cmux did not answer, naming the caller", () => {
    const verdict = judgeChair({
      caller: { pin: { kind: "holder" }, sessionId: "a0000023-0000-4000-8000-000000000026", verdict: OPUS_TAB },
      read: CMUX_SILENT,
    });

    expect(verdict).toStrictEqual({
      detail:
        "cmux did not answer (cmux workspaces could not be listed (window.list did not answer within 15000ms)), " +
        "and this session, the one read without it, is not on Fable",
      kind: "refused",
      lines: [
        "  this session a0000023-0000-4000-8000-000000000026: OFF FABLE — on claude-opus-4-8 as of " +
          "2026-09-15T20:58:32.701Z; a safeguard fallback switched it from " +
          "claude-fable-5-1 to claude-opus-4-8 at 2026-09-15T19:23:30.360Z (category cyber)",
      ],
    });
  });

  it("still refuses an unread caller when cmux did not answer", () => {
    const verdict = judgeChair({
      caller: {
        pin: { kind: "holder" },
        sessionId: "s9",
        verdict: { kind: "unreadable", why: "no transcript was found for this session" },
      },
      read: CMUX_SILENT,
    });

    expect(verdict).toMatchObject({
      kind: "refused",
      lines: ["  this session s9: model UNREAD — no transcript was found for this session"],
    });
  });

  it("refuses an on-Fable caller the supervisor-pin record does not name, so a Fable worker cannot stand in for the chair", () => {
    const verdict = judgeChair({ caller: FABLE_WORKER, read: CMUX_SILENT });

    expect(verdict).toStrictEqual({
      detail:
        "cmux did not answer (cmux workspaces could not be listed (window.list did not answer within 15000ms)), " +
        "and nothing outside cmux binds this session to the chair: the supervisor-pin record names session " +
        "a0000023-0000-4000-8000-000000000026 (workspace:936)",
      kind: "refused",
      lines: [
        "  this session 9d1e0c55-0000-4000-8000-000000000001: on claude-fable-5-1 as of 2026-09-15T21:04:22.000Z",
      ],
    });
  });

  it("refuses an on-Fable caller when no supervisor pin is recorded at all", () => {
    const verdict = judgeChair({ caller: { ...FABLE_CALLER, pin: { kind: "unrecorded" } }, read: CMUX_SILENT });

    expect(verdict).toMatchObject({
      detail:
        "cmux did not answer (cmux workspaces could not be listed (window.list did not answer within 15000ms)), " +
        "and nothing outside cmux binds this session to the chair: no supervisor pin is recorded",
      kind: "refused",
    });
  });

  it("never asks the caller when cmux answered and no chair was pinned, nor with no caller to ask", () => {
    const noChair: ChairRead = { cause: "no-chair", kind: "unresolved", why: "no workspace is pinned" };

    expect(judgeChair({ caller: FABLE_CALLER, read: noChair })).toStrictEqual({
      detail: "the chair could not be read: no workspace is pinned",
      kind: "refused",
      lines: [],
    });
    expect(
      judgeChair({
        caller: FABLE_CALLER,
        read: { cause: "cmux-error", kind: "unresolved", why: "cmux workspace.list failed (internal_error): boom" },
      }),
    ).toStrictEqual({
      detail: "the chair could not be read: cmux workspace.list failed (internal_error): boom",
      kind: "refused",
      lines: [],
    });
    expect(judgeChair({ caller: undefined, read: CMUX_SILENT })).toStrictEqual({
      detail:
        "the chair could not be read: cmux workspaces could not be listed (window.list did not answer within 15000ms)",
      kind: "refused",
      lines: [],
    });
  });

  it("judges the pinned workspace, never the caller, when cmux answered", () => {
    expect(judgeChair({ caller: FABLE_CALLER, read: OPUS_ONLY }).kind).toBe("refused");
  });

  it("refuses an unread transcript rather than calling it Fable", () => {
    const read: ResolvedChairRead = {
      ...BOTH_TABS,
      sessions: [{ pid: 9, sessionId: "s9", verdict: { kind: "unreadable", why: "no transcript was found" } }],
    };

    expect(judgeChair({ read })).toStrictEqual({
      detail: "0 of 1 session(s) in the pinned workspace are off Fable, 1 unread",
      kind: "refused",
      lines: ["  session s9 (pid 9): model UNREAD — no transcript was found"],
    });
  });
});

describe("judgeChair — the lean shape, one Claude plan standing", () => {
  it("passes an Opus chair, the reseated tab included", () => {
    expect(judgeChairAgainst({ read: OPUS_ONLY, requirement: OPUS_REQUIRED })).toStrictEqual({ kind: "clean" });
  });

  it("refuses a Fable chair, naming it off Opus — the top model is what lean stops spending", () => {
    expect(judgeChairAgainst({ read: FABLE_ONLY, requirement: OPUS_REQUIRED })).toStrictEqual({
      detail: "1 of 1 session(s) in the pinned workspace are off Opus, 0 unread",
      kind: "refused",
      lines: [
        "  session a0000078-0000-4000-8000-000000000085 (pid 222): OFF OPUS — on claude-fable-5-1 as of " +
          "2026-09-15T21:04:22.000Z",
      ],
    });
    expect(chairViolatesRequirement({ read: FABLE_ONLY, requirement: OPUS_REQUIRED })).toBe(true);
    expect(chairViolatesRequirement({ read: OPUS_ONLY, requirement: OPUS_REQUIRED })).toBe(false);
  });

  it("passes an Opus caller when cmux did not answer", () => {
    const verdict = judgeChairAgainst({
      caller: { pin: { kind: "holder" }, sessionId: "s1", verdict: OPUS_TAB },
      read: CMUX_SILENT,
      requirement: OPUS_REQUIRED,
    });

    expect(verdict.kind).toBe("caller-only");
  });

  it("refuses every chair when no Claude plan stands, whatever it is on", () => {
    const requirement: ChairRequirement = { kind: "claude-unavailable", why: "no Claude plan stands" };

    expect(judgeChairAgainst({ read: FABLE_ONLY, requirement })).toStrictEqual({
      detail: "no Claude plan stands — write the handoff and leave the chair to a host whose plan stands",
      kind: "refused",
      lines: [],
    });
  });
});

describe("gateChairThenRun", () => {
  it("refuses the reseated chair in the four-line shape, naming the hatch and the same-tick handoff", async () => {
    const result = await gate({ read: BOTH_TABS });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.ran).toStrictEqual([]);
    expect(result.diagnostics[0]!).toContain(
      "supervisor tick-record: slopweaver supervisor tick-record|sweep-prompt blocked because",
    );
    expect(result.diagnostics[2]!).toContain("SLOPWEAVER_ALLOW_OFF_FABLE_CHAIR=1");
    expect(result.diagnostics.some((line) => line.includes("OFF FABLE — on claude-opus-4-8"))).toBe(true);
    expect(result.diagnostics.some((line) => line.includes("--model fable"))).toBe(true);
  });

  it("runs the verb when the chair is on Fable, handing it the chair read so nothing reads the chair twice", async () => {
    const result = await gate({ read: FABLE_ONLY });

    expect(result.code).toBe(EXIT_OK);
    expect(result.ran).toStrictEqual([
      {
        argv: ["node", "slopweaver", "supervisor", "tick-record", "--draft", "d.json"],
        evidence: { chair: FABLE_ONLY, kind: "read", lanes: FILL_LANES },
      },
    ]);
    expect(result.reads).toBe(1);
    expect(result.meteredReads).toBe(1);
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.sends).toStrictEqual([]);
  });

  it("still reads the chair when both hatches are open, and skips the telemetry only the metered question reads", async () => {
    const result = await gate({ meteredHatchIsOpen: true, offFableHatchIsOpen: true, read: BOTH_TABS });

    expect(result.code).toBe(EXIT_OK);
    expect(result.reads).toBe(1);
    expect(result.meteredReads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({ chair: BOTH_TABS, kind: "read", lanes: FILL_LANES });
    expect(result.sends).toStrictEqual([]);
  });

  it("still asks the metered question when only the off-Fable hatch is open", async () => {
    const result = await gate({ metered: METERED_NOW, offFableHatchIsOpen: true, read: BOTH_TABS });

    expect(result.reads).toBe(1);
    expect(result.meteredReads).toBe(1);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.sends).toStrictEqual([]);
  });

  it("under the lean shape, types /model opus into a Fable chair and never /model fable", async () => {
    const result = await gate({ lanes: LEAN_LANES, read: FABLE_ONLY });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.sends).toStrictEqual([{ text: "/model opus", workspaceId: PINNED_WORKSPACE }]);
    expect(result.recorded).toStrictEqual([
      { key: "a0000078-0000-4000-8000-000000000085@2026-09-15T21:04:22.000Z>opus", workspaceId: PINNED_WORKSPACE },
    ]);
    expect(result.diagnostics.some((line) => line.includes("--model opus"))).toBe(true);
  });

  it("under the lean shape, runs the verb for an Opus chair and hands it the lanes", async () => {
    const result = await gate({ lanes: LEAN_LANES, read: OPUS_ONLY });

    expect(result.code).toBe(EXIT_OK);
    expect(result.ran[0]!.evidence).toStrictEqual({ chair: OPUS_ONLY, kind: "read", lanes: LEAN_LANES });
    expect(result.sends).toStrictEqual([]);
  });

  it("holds the chair to Fable on an unreadable register, and says why", async () => {
    const result = await gate({
      lanes: { kind: "unreadable", why: "the plan register could not be read (x)" },
      read: OPUS_ONLY,
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.diagnostics[0]!).toBe(
      "supervisor tick-record: plan lanes unread, so the chair is held to Fable — the plan register could not be read (x)",
    );
    expect(result.sends).toStrictEqual([{ text: "/model fable", workspaceId: PINNED_WORKSPACE }]);
  });

  it("never gates --help", async () => {
    const result = await gate({ argv: ["node", "slopweaver", "supervisor", "tick-record", "--help"], read: BOTH_TABS });

    expect(result.code).toBe(EXIT_OK);
    expect(result.reads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({ kind: "not-read", why: "a usage read is never gated" });
    expect(result.meteredReads).toBe(0);
    expect(result.callerReads).toBe(0);
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.sends).toStrictEqual([]);
  });
});

describe("gateChairThenRun — cmux does not answer", () => {
  it("runs the verb for an on-Fable caller, printing that only it was judged, and types nothing", async () => {
    const result = await gate({ caller: FABLE_CALLER, read: CMUX_SILENT });

    expect(result.code).toBe(EXIT_OK);
    expect(result.callerReads).toBe(1);
    expect(result.ran).toStrictEqual([
      {
        argv: ["node", "slopweaver", "supervisor", "tick-record", "--draft", "d.json"],
        evidence: { chair: CMUX_SILENT, kind: "read", lanes: FILL_LANES },
      },
    ]);
    expect(result.diagnostics[0]!).toContain("supervisor tick-record: chair gate: cmux did not answer");
    expect(result.diagnostics[0]!).toContain("Any other tab in the pinned workspace went unseen this tick.");
    expect(result.sends).toStrictEqual([]);
  });

  it("refuses an off-Fable caller under the off-Fable hatch, and types nothing into a cmux that is not answering", async () => {
    const result = await gate({
      caller: { pin: { kind: "holder" }, sessionId: "a0000023-0000-4000-8000-000000000026", verdict: OPUS_TAB },
      read: CMUX_SILENT,
    });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.ran).toStrictEqual([]);
    expect(result.diagnostics[2]!).toContain("SLOPWEAVER_ALLOW_OFF_FABLE_CHAIR=1");
    expect(result.diagnostics.some((line) => line.includes("this session a0000023"))).toBe(true);
    expect(result.sends).toStrictEqual([]);
  });

  it("refuses a Fable worker the supervisor-pin record does not name, never running the verb", async () => {
    const result = await gate({ caller: FABLE_WORKER, read: CMUX_SILENT });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.callerReads).toBe(1);
    expect(result.ran).toStrictEqual([]);
    expect(result.diagnostics[0]!).toContain("nothing outside cmux binds this session to the chair");
    expect(result.sends).toStrictEqual([]);
  });

  it("refuses as before when this process carries no Claude Code session to read", async () => {
    const result = await gate({ read: CMUX_SILENT });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.callerReads).toBe(1);
    expect(result.diagnostics[0]!).toContain("the chair could not be read: cmux workspaces could not be listed");
  });

  it("never reads the caller when cmux answered", async () => {
    const result = await gate({ caller: FABLE_CALLER, read: OPUS_ONLY });

    expect(result.callerReads).toBe(0);
    expect(result.code).toBe(EXIT_ERROR);
  });

  it("never reads the caller when cmux answered with no pinned chair, and still refuses", async () => {
    const result = await gate({
      caller: FABLE_CALLER,
      read: { cause: "no-chair", kind: "unresolved", why: "no workspace is pinned" },
    });

    expect(result.callerReads).toBe(0);
    expect(result.code).toBe(EXIT_ERROR);
  });

  it("never reads the caller when the off-Fable hatch is open", async () => {
    const result = await gate({ caller: FABLE_CALLER, offFableHatchIsOpen: true, read: CMUX_SILENT });

    expect(result.callerReads).toBe(0);
    expect(result.code).toBe(EXIT_OK);
  });
});

describe("gateChairThenRun — the metered chair", () => {
  it("refuses a Fable chair spending a metered organisation, in the four-line shape with the dollars", async () => {
    const result = await gate({ metered: METERED_NOW, read: FABLE_ONLY });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.ran).toStrictEqual([]);
    expect(result.diagnostics[0]!).toContain(
      "supervisor tick-record: slopweaver supervisor tick-record|sweep-prompt blocked because",
    );
    expect(result.diagnostics[2]!).toContain("SLOPWEAVER_ALLOW_METERED_CHAIR=1");
    expect(result.diagnostics[4]!).toBe(
      "supervisor tick-record:   session a0000038-0000-4000-8000-000000000041 (pid 222): METERED — $7.38 across 4 " +
        "request(s), 2026-09-17T13:39:02.089Z..2026-09-17T13:40:58.040Z; org UNRESOLVED, email UNRESOLVED (a " +
        "Console credential resolves no claude.ai identity — that absence is the signal)",
    );
    expect(result.diagnostics.some((line) => line.includes("cmux spawn <handoff slug> --model fable"))).toBe(true);
    expect(result.sends).toStrictEqual([]);
  });

  it("runs the verb over a metered chair when the metered hatch is open, printing no refusal", async () => {
    const result = await gate({ metered: METERED_NOW, meteredHatchIsOpen: true, read: FABLE_ONLY });

    expect(result.code).toBe(EXIT_OK);
    expect(result.meteredReads).toBe(0);
    expect(result.diagnostics).toStrictEqual([]);
  });

  it("prints an unmeasured read and runs the verb, because a remote oracle's silence is not a refusal", async () => {
    const result = await gate({
      metered: { kind: "unmeasured", why: "Datadog credentials are not usable" },
      read: FABLE_ONLY,
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.ran.length).toBe(1);
    expect(result.diagnostics).toStrictEqual([
      "supervisor tick-record: metered check: UNMEASURED — Datadog credentials are not usable",
    ]);
  });

  it("never asks the metered question of a chair the Fable question already refused", async () => {
    const result = await gate({ metered: METERED_NOW, read: OPUS_ONLY });

    expect(result.meteredReads).toBe(0);
    expect(result.diagnostics.some((line) => line.includes("SLOPWEAVER_ALLOW_OFF_FABLE_CHAIR=1"))).toBe(true);
  });

  it("steps aside for a Codex-hosted chair without reading the telemetry", async () => {
    const result = await gate({ env: { CODEX_THREAD_ID: "t1" }, metered: METERED_NOW, read: FABLE_ONLY });

    expect(result.code).toBe(EXIT_OK);
    expect(result.meteredReads).toBe(0);
  });
});

describe("gateChairThenRun — the restore", () => {
  it("types `/model fable` into its OWN workspace and records the attempt, before it refuses", async () => {
    const result = await gate({ read: OPUS_ONLY });

    expect(result.sends).toStrictEqual([{ text: "/model fable", workspaceId: PINNED_WORKSPACE }]);
    expect(result.recorded).toStrictEqual([
      { key: "a0000023-0000-4000-8000-000000000026@2026-09-15T19:23:30.360Z", workspaceId: PINNED_WORKSPACE },
    ]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.ran).toStrictEqual([]);
  });

  it("says the restore was SENT and that this tick still refuses, never that the chair is back on Fable", async () => {
    const result = await gate({ read: OPUS_ONLY });
    const sent = result.diagnostics.find((line) => line.includes("RESTORE SENT"))!;

    expect(sent).toContain("`/model fable` has been typed into this workspace");
    expect(sent).toContain("THIS tick still refuses");
    expect(sent).toContain("Nothing is owed to the owner");
    expect(result.diagnostics.some((line) => line.includes("cmux spawn <handoff slug> --model fable"))).toBe(true);
  });

  it("never types into a workspace that is not this process's own", async () => {
    const result = await gate({ env: { CMUX_WORKSPACE_ID: "WS-SOMEBODY-ELSE" }, read: OPUS_ONLY });

    expect(result.sends).toStrictEqual([]);
    expect(result.recorded).toStrictEqual([]);
    expect(result.diagnostics.some((line) => line.includes("NO RESTORE: this process runs in workspace"))).toBe(true);
    expect(result.code).toBe(EXIT_ERROR);
  });

  it("never types when this process is outside cmux altogether", async () => {
    const result = await gate({ env: {}, read: OPUS_ONLY });

    expect(result.sends).toStrictEqual([]);
    expect(result.diagnostics.some((line) => line.includes("no CMUX_WORKSPACE_ID"))).toBe(true);
  });

  it("stops sending once the same fallback has been answered twice, and leads with the handoff", async () => {
    const result = await gate({ attempts: 2, read: OPUS_ONLY });

    expect(result.sends).toStrictEqual([]);
    expect(result.recorded).toStrictEqual([]);
    const refused = result.diagnostics.find((line) => line.includes("NO RESTORE"))!;
    expect(refused).toContain("2 restore send(s) have already answered this same fallback");
    expect(refused).toContain("2026-09-15T19:23:30.360Z");
  });

  it("never types over an UNREAD transcript, which a model switch cannot repair", async () => {
    const read: ResolvedChairRead = {
      ...BOTH_TABS,
      sessions: [{ pid: 9, sessionId: "s9", verdict: { kind: "unreadable", why: "no transcript was found" } }],
    };

    const result = await gate({ read });

    expect(result.sends).toStrictEqual([]);
    expect(result.diagnostics.some((line) => line.includes("no session in the pinned workspace is off Fable"))).toBe(
      true,
    );
  });

  it("says so and falls through to the handoff when the send itself failed", async () => {
    const result = await gate({ outcome: { detail: "cmux could not be reached", sent: false }, read: OPUS_ONLY });

    expect(result.recorded.length).toBe(1);
    const failed = result.diagnostics.find((line) => line.includes("RESTORE FAILED"))!;
    expect(failed).toContain("cmux could not be reached");
    expect(result.diagnostics.some((line) => line.includes("cmux spawn <handoff slug> --model fable"))).toBe(true);
  });
});

describe("gateHome", () => {
  const HOME = "/h/env";

  it("is the environment's home when argv names none", () => {
    expect(gateHome({ argv: ["node", "slopweaver", "supervisor", "sweep-prompt"], home: HOME })).toBe(HOME);
  });

  it("is the verb's --home, in either spelling", () => {
    expect(gateHome({ argv: ["node", "sw", "supervisor", "tick-record", "--home", "/h/a"], home: HOME })).toBe("/h/a");
    expect(gateHome({ argv: ["node", "sw", "supervisor", "tick-record", "--home=/h/b"], home: HOME })).toBe("/h/b");
  });

  it("reads a verb's parsed tail too, where --home is the second token", () => {
    expect(gateHome({ argv: ["close", "--home", "/h/target", "--dir", "/s/tick"], home: HOME })).toBe("/h/target");
  });

  it("is the LAST home named, the one a repeated flag leaves the verb on", () => {
    const argv = ["node", "sw", "supervisor", "tick-record", "--home", "/h/a", "--home=/h/b"];

    expect(gateHome({ argv, home: HOME })).toBe("/h/b");
  });

  it("never reads another flag as the value of a dangling --home", () => {
    expect(gateHome({ argv: ["node", "sw", "supervisor", "tick-record", "--home", "--draft"], home: HOME })).toBe(HOME);
  });
});
