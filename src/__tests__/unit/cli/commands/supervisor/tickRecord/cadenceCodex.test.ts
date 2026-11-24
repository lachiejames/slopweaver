/**
 * A Codex chair's hand-off cadence as the recorder prints it (slice 4c): judged on its canon from the instant its
 * record took the chair, and never through a Claude tab — the harness's Claude readers throw if asked.
 */
import { describe, expect, it } from "vitest";

import { recordedChairDecision } from "../../../../../../cli/commands/supervisor/chairGateRecorded.js";
import type { ChairGateEvidence } from "../../../../../../cli/commands/supervisor/chairGateRun.js";
import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import {
  CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED,
  CODEX_CHAIR_BUDGET_UNMEASURED,
  CODEX_CHAIR_CLI_UNMEASURED,
} from "../../../../../../supervisor/codexChairCadence.js";
import { UNRESOLVED_CHAIR_RECORD } from "../../../../../../supervisor/recordedChairHost.js";
import { allUnavailable, capture, RECONCILE } from "./harness.js";

const THREAD = "019a1a98-9b15-7482-8000-000000000001";

/** The two notes every Codex verdict carries, as the recorder prints them. */
const UNMEASURED = [
  `supervisor tick-record: chair cadence: Codex thread ${THREAD}: ${CODEX_CHAIR_BUDGET_UNMEASURED}`,
  `supervisor tick-record: chair cadence: Codex thread ${THREAD}: ${CODEX_CHAIR_CLI_UNMEASURED}`,
  `supervisor tick-record: chair cadence: Codex thread ${THREAD}: ${CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED}`,
];

/** A draft whose gauge routes a Fable spawn to plan-three. */
const GAUGED = JSON.stringify({
  actions: [],
  handoff: "handoff-9004c",
  judgements: [],
  sources: {
    ...allUnavailable(),
    gauge: {
      facts: {
        nextAllModels: "plan-three",
        nextChair: "plan-three",
        nextFable: "plan-three",
        plans: [
          { fablePct: 10, fiveHourPct: 5, plan: "plan-three", resetsIso: "2026-09-30T07:00:00.000Z", weekPct: 40 },
        ],
        reactNowLines: [],
      },
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "read",
      witness: { command: "slopweaver claude gauge --json", exitCode: 0 },
    },
  },
  startedIso: "2026-09-10T12:00:00.000Z",
  tickId: "tick-4c-1",
  workspace: "workspace:61",
});

/** The gate's read of a Codex chair whose pin took the chair at `pinnedAtIso`. */
function codexChair({ pinnedAtIso }: { pinnedAtIso: string }): ChairGateEvidence {
  return { canonFloor: { kind: "measured", pinnedAtIso }, kind: "codex", threadId: THREAD };
}

describe("a Codex chair's cadence, as the recorder prints it", () => {
  it("hands off a Codex chair 40h on canon main has since changed, reading canon from its pin instant", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const asked: string[] = [];
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readCodexChairCanon: ({ bootedIso }) => {
        asked.push(bootedIso);
        return {
          bootedIso,
          changed: [
            {
              committedIso: "2026-09-09T10:00:00Z",
              sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
              subject: "S (#1)",
            },
          ],
          kind: "measured",
        };
      },
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: codexChair({ pinnedAtIso: "2026-09-08T20:20:00.000Z" }),
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toStrictEqual(["2026-09-08T20:20:00.000Z"]);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      'supervisor tick-record:   - this chair booted 2026-09-08T20:20:00.000Z, 40h ago — at or past 36h — and origin/main has since changed its loaded canon (skills/supervisor, .claude/rules, AGENTS.md) in 1 commit(s), newest 34e48e7b7 "S (#1)"',
      "supervisor tick-record:   route currently picks plan-three for a Fable spawn; the successor boots the current Claude Code on whatever plan routing picks.",
      "supervisor tick-record:   Record this tick, write the handoff, then `slopweaver cmux spawn <handoff slug> --driver claude --model fable` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.",
      ...UNMEASURED,
    ]);
  });

  it("stays when the Codex chair took the pin an hour ago, still naming its budget and CLI UNMEASURED", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readCodexChairCanon: ({ bootedIso }) => ({ bootedIso, changed: [], kind: "measured" }),
    };

    await runSupervisorTickRecord({
      deps,
      evidence: codexChair({ pinnedAtIso: "2026-09-10T11:20:00.000Z" }),
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(run.diagnostics).toStrictEqual(UNMEASURED);
    expect(run.appended.length).toBe(1);
  });

  it("names the canon UNMEASURED and never reads git when no record says when the thread took the chair", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });

    await runSupervisorTickRecord({
      deps: run.deps,
      evidence: {
        canonFloor: {
          kind: "unmeasured",
          why: "no supervisor pin or chain link records when this Codex thread took the chair",
        },
        kind: "codex",
        threadId: THREAD,
      },
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(run.diagnostics).toStrictEqual([
      `supervisor tick-record: chair cadence: session ${THREAD}: whether its loaded canon is stale is UNMEASURED — no supervisor pin or chain link records when this Codex thread took the chair`,
      ...UNMEASURED,
    ]);
    expect(run.appended.length).toBe(1);
  });

  it("names the cadence UNMEASURED with the cause when the pin's own instant will not parse (Codex c1-02)", async () => {
    const run = capture({ files: { "d.json": GAUGED, "r.json": RECONCILE } });
    const decision = recordedChairDecision({
      caller: { kind: "active", session: { host: "codex", id: THREAD } },
      recorded: { kind: "unresolved", why: "the supervisor pin carries an instant that does not parse" },
    });
    expect(decision.kind).toBe("step-aside");

    await runSupervisorTickRecord({
      deps: run.deps,
      evidence: (decision as Extract<typeof decision, { kind: "step-aside" }>).evidence,
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(run.diagnostics).toStrictEqual([
      `supervisor tick-record: chair cadence: not judged, so it is UNMEASURED — ${UNRESOLVED_CHAIR_RECORD}: the supervisor pin carries an instant that does not parse`,
    ]);
    expect(run.appended.length).toBe(1);
  });
});
