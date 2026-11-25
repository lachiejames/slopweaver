/**
 * The chair gate in front of a Codex chair: it steps aside, whether the CALLER is a Codex thread or the supervisor
 * PIN names one, because a Codex chair has no Claude transcript and no Fable requirement (AGENTS.md rule 5). The
 * pin case: judging the pinned workspace's Claude tabs there would read a co-located Claude tab
 * on Fable as a clean chair. Every seam is a plain fake function, never a mock — `.claude/rules/testing.md`.
 */
import { describe, expect, it } from "vitest";

import {
  type ChairGateDeps,
  type ChairGatePass,
  gateChairThenRun,
} from "../../../cli/commands/supervisor/chairGateRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import type { ChairRead } from "../../../supervisor/chairGate.js";
import { type RecordedChair, UNRESOLVED_CHAIR_RECORD } from "../../../supervisor/recordedChairHost.js";
import { FILL_LANES } from "../plans/laneFixtures.js";

/** A pinned workspace holding one Claude tab whose transcript would not read: the gate refuses it when it judges. */
const CLAUDE_TAB_BESIDE: ChairRead = {
  kind: "resolved",
  sessions: [
    { pid: 333, sessionId: "8f0e2a41-0000-4000-8000-000000000002", verdict: { kind: "unreadable", why: "x" } },
  ],
  directory: "/wt/codex-chair",
  location: { kind: "cmux", workspaceId: "WS-PINNED" },
};

/** What the gate did over its fakes. */
interface Gated {
  readonly code: number;
  readonly diagnostics: readonly string[];
  readonly ran: readonly ChairGatePass[];
  readonly reads: number;
}

/**
 * Run the gate over fakes, with the caller's environment and the recorded chair given.
 *
 * @param env the caller's environment, which carries its host
 * @param recorded the chair the pin or chain records name
 * @returns what the gate did
 */
async function gate({ env, recorded }: { env: Record<string, string>; recorded: RecordedChair }): Promise<Gated> {
  const ran: ChairGatePass[] = [];
  const diagnostics: string[] = [];
  let reads = 0;
  const deps: ChairGateDeps = {
    attemptsFor: () => 0,
    env,
    meteredHatchIsOpen: true,
    offFableHatchIsOpen: false,
    readCaller: () => undefined,
    // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
    readChair: async () => {
      reads += 1;
      return CLAUDE_TAB_BESIDE;
    },
    readLanes: () => Promise.resolve(FILL_LANES),
    // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
    readMetered: async () => ({ kind: "unmeasured", why: "no telemetry in a unit test" }),
    readRecordedChair: () => recorded,
    recordAttempt: () => undefined,
    // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
    sendToWorkspace: async () => ({ detail: "not sent", sent: false }),
    writeDiagnostic: (line) => diagnostics.push(line),
  };
  const code = await gateChairThenRun({
    argv: ["node", "slopweaver", "supervisor", "tick-record"],
    deps,
    run: (given) => {
      ran.push(given);
      return EXIT_OK;
    },
    verb: "tick-record",
  });
  return { code, diagnostics, ran, reads };
}

const CODEX_ID = "019a1a98-9b15-7482-8000-000000000001";
const PINNED_AT = "2026-11-05T03:00:00.000Z";
const CODEX_RECORDED: RecordedChair = {
  kind: "session",
  pinnedAtIso: PINNED_AT,
  session: { host: "codex", id: CODEX_ID },
};
const CLAUDE_RECORDED: RecordedChair = {
  kind: "session",
  pinnedAtIso: PINNED_AT,
  session: { host: "claude-code", id: "8f0e2a41" },
};
const CODEX_CALLER_LINE =
  "supervisor tick-record: chair gate not applied — this is a Codex-hosted chair, which has no Fable requirement " +
  "and spends no Anthropic organisation";

describe("gateChairThenRun — a Codex chair", () => {
  it("hands a recorded Codex chair's cadence its thread and measured floor, reading no Claude tab (4c)", async () => {
    const result = await gate({ env: { CODEX_THREAD_ID: CODEX_ID }, recorded: CODEX_RECORDED });

    expect(result.code).toBe(EXIT_OK);
    expect(result.reads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({
      canonFloor: { kind: "measured", pinnedAtIso: PINNED_AT },
      kind: "codex",
      threadId: CODEX_ID,
    });
    expect(result.diagnostics).toStrictEqual([
      "supervisor tick-record: chair gate not applied — the recorded chair is a Codex thread, so no Claude tab in " +
        "the pinned workspace is the chair",
    ]);
  });

  it("gives the same evidence when a Claude caller runs beside a recorded Codex chair", async () => {
    const result = await gate({ env: { CLAUDE_CODE_SESSION_ID: "8f0e2a41" }, recorded: CODEX_RECORDED });

    expect(result.reads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({
      canonFloor: { kind: "measured", pinnedAtIso: PINNED_AT },
      kind: "codex",
      threadId: CODEX_ID,
    });
  });

  it("names the floor unmeasured for a Codex caller nothing records, never inventing a boot instant", async () => {
    const result = await gate({ env: { CODEX_THREAD_ID: "t1" }, recorded: { kind: "absent" } });

    expect(result.code).toBe(EXIT_OK);
    expect(result.reads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({
      canonFloor: {
        kind: "unmeasured",
        why: "no supervisor pin or chain link records when this Codex thread took the chair",
      },
      kind: "codex",
      threadId: "t1",
    });
    expect(result.diagnostics).toStrictEqual([CODEX_CALLER_LINE]);
  });

  it("reads nothing for a Codex caller the records do not name, when they name a Claude chair", async () => {
    const result = await gate({ env: { CODEX_THREAD_ID: "t1" }, recorded: CLAUDE_RECORDED });

    expect(result.reads).toBe(0);
    expect(result.ran[0]!.evidence).toStrictEqual({
      kind: "not-read",
      why: "this Codex thread is not the chair the records name (Claude Code session 8f0e2a41)",
    });
    expect(result.diagnostics).toStrictEqual([CODEX_CALLER_LINE]);
  });

  it("steps aside with nothing on damaged records, even for a Codex caller (Codex 4c plan, property 2)", async () => {
    const recorded: RecordedChair = { kind: "unresolved", why: "1 line" };
    const fromClaude = await gate({ env: { CLAUDE_CODE_SESSION_ID: "8f0e2a41" }, recorded });
    const fromCodex = await gate({ env: { CODEX_THREAD_ID: CODEX_ID }, recorded });

    expect(fromClaude.reads).toBe(0);
    expect(fromClaude.ran[0]!.evidence).toStrictEqual({ kind: "not-read", why: `${UNRESOLVED_CHAIR_RECORD}: 1 line` });
    expect(fromClaude.diagnostics).toStrictEqual([
      `supervisor tick-record: chair gate not applied — ${UNRESOLVED_CHAIR_RECORD}`,
    ]);
    expect(fromCodex.ran[0]!.evidence).toStrictEqual({ kind: "not-read", why: `${UNRESOLVED_CHAIR_RECORD}: 1 line` });
  });

  it("judges the pinned workspace as before when the records name a Claude session", async () => {
    const result = await gate({ env: { CLAUDE_CODE_SESSION_ID: "8f0e2a41" }, recorded: CLAUDE_RECORDED });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.reads).toBe(1);
    expect(result.ran).toStrictEqual([]);
  });
});
