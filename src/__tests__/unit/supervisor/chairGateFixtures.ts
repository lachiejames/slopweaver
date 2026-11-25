/**
 * The chair reads, metered readings and gate driver `chairGate.test.ts` judges, apart from its cases.
 *
 * Every read is a frozen value and every seam of the gate is a plain fake function, never a mock
 * (`.claude/rules/testing.md`); the reseated tab is judged from its real frozen transcript.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ChairGateDeps,
  type ChairGatePass,
  gateChairThenRun,
} from "../../../cli/commands/supervisor/chairGateRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import type { LaneShapeRead } from "../../../plans/laneShape.js";
import type { CallerChairReading, ChairRead } from "../../../supervisor/chairGate.js";
import type { ChairMeteredReading } from "../../../supervisor/chairMetered.js";
import { judgeChairTranscript } from "../../../supervisor/chairModel.js";
import type { ChairRequirement } from "../../../supervisor/chairPolicy.js";
import type { ChairRestoreOutcome } from "../../../supervisor/chairRestore.js";
import { FILL_LANES } from "../plans/laneFixtures.js";

/** The lean shape: exactly one Claude plan stands, so the chair must be on Opus. */
export const OPUS_REQUIRED: ChairRequirement = {
  kind: "claude",
  model: "opus",
  why: "exactly one Claude plan stands",
};

/** The resolved arm, so a fixture can be spread and narrowed without re-stating the union. */
export type ResolvedChairRead = Extract<ChairRead, { kind: "resolved" }>;

/** The pinned workspace's cmux id in every fixture below. */
export const PINNED_WORKSPACE = "WS-PINNED";

/** The real reseated chair's verdict, judged from its frozen transcript. */
export const OPUS_TAB = judgeChairTranscript({
  text: readFileSync(join(import.meta.dirname, "../../fixtures/supervisor/chair-fallback-a0000023.jsonl"), "utf8"),
});

/** The fresh Fable tab the owner opened beside it in the same workspace. */
const FABLE_TAB = judgeChairTranscript({
  text: JSON.stringify({
    message: { model: "claude-fable-5-1" },
    timestamp: "2026-09-15T21:04:22.000Z",
    type: "assistant",
  }),
});

/** The measured shape: both tabs live in the one pinned workspace. */
export const BOTH_TABS: ResolvedChairRead = {
  kind: "resolved",
  sessions: [
    { pid: 111, sessionId: "a0000023-0000-4000-8000-000000000026", verdict: OPUS_TAB },
    { pid: 222, sessionId: "a0000078-0000-4000-8000-000000000085", verdict: FABLE_TAB },
  ],
  directory: "/wt/fresh-supervisor-handoff-9271",
  location: { kind: "cmux", workspaceId: PINNED_WORKSPACE },
};

/** Only the Fable tab. */
export const FABLE_ONLY: ResolvedChairRead = { ...BOTH_TABS, sessions: [BOTH_TABS.sessions[1]!] };

/** Only the reseated Opus tab — the single-tab shape the restore is actually aimed at. */
export const OPUS_ONLY: ResolvedChairRead = { ...BOTH_TABS, sessions: [BOTH_TABS.sessions[0]!] };

/** The measured read: cmux hung, every call timing out at 15s. */
export const CMUX_SILENT: ChairRead = {
  cause: "cmux-unanswered",
  kind: "unresolved",
  why: "cmux workspaces could not be listed (window.list did not answer within 15000ms)",
};

/** The chair asking through that outage, on Fable, read by its own id, and named by the supervisor-pin record. */
export const FABLE_CALLER: CallerChairReading = {
  pin: { kind: "holder" },
  sessionId: "a0000014-0000-4000-8000-000000000015",
  verdict: FABLE_TAB,
};

/** A Fable worker in another workspace — on Fable, but not the session the supervisor-pin record names. */
export const FABLE_WORKER: CallerChairReading = {
  pin: { holderSessionId: "a0000023-0000-4000-8000-000000000026", kind: "other", seatLabel: "workspace:936" },
  sessionId: "9d1e0c55-0000-4000-8000-000000000001",
  verdict: FABLE_TAB,
};

/** A metered read that found every chair session on a plan organisation. */
const ALL_ON_PLANS: ChairMeteredReading = {
  kind: "measured",
  sessions: [
    {
      pid: 222,
      sessionId: "a0000078-0000-4000-8000-000000000085",
      verdict: { kind: "plan", newestIso: "2026-09-15T21:04:20.000Z" },
    },
  ],
  truncated: false,
  unprojected: 0,
};

/** The metered chair's read: on Fable, and its newest requests resolved no organisation. */
export const METERED_NOW: ChairMeteredReading = {
  kind: "measured",
  sessions: [
    {
      pid: 222,
      sessionId: "a0000038-0000-4000-8000-000000000041",
      verdict: {
        dollars: 7.38025375,
        firstIso: "2026-09-17T13:39:02.089Z",
        kind: "metered-now",
        lastIso: "2026-09-17T13:40:58.040Z",
        requests: 4,
      },
    },
  ],
  truncated: false,
  unprojected: 0,
};

/** What one gated invocation did. */
interface Gated {
  readonly code: number;
  readonly ran: readonly ChairGatePass[];
  readonly reads: number;
  /** How many times the caller's own session was read. */
  readonly callerReads: number;
  /** How many times the metered telemetry was read. */
  readonly meteredReads: number;
  readonly diagnostics: readonly string[];
  /** Every `/model` line the gate typed, and where. */
  readonly sends: readonly { readonly workspaceId: string; readonly text: string }[];
  /** Every attempt it recorded. */
  readonly recorded: readonly { readonly key: string; readonly workspaceId: string }[];
}

/** What the fake seams answer: every field a case may vary. */
interface GateSeams {
  read: ChairRead;
  caller?: CallerChairReading;
  lanes?: LaneShapeRead;
  argv?: readonly string[];
  env?: Record<string, string>;
  offFableHatchIsOpen?: boolean;
  meteredHatchIsOpen?: boolean;
  metered?: ChairMeteredReading;
  attempts?: number;
  outcome?: ChairRestoreOutcome;
}

/** What the fake seams saw, counted and appended as the gate calls them. */
interface SeenBySeams {
  reads: number;
  callerReads: number;
  meteredReads: number;
  readonly diagnostics: string[];
  readonly sends: { workspaceId: string; text: string }[];
  readonly recorded: { key: string; workspaceId: string }[];
}

/**
 * The gate's seams as plain fakes answering fixed values, each recording what it was asked into `seen`.
 *
 * @param read the chair read every `readChair` call answers
 * @param caller the caller's own session, read only when cmux did not answer
 * @param lanes the plan lanes the gate judges the requirement from
 * @param attempts how many restore sends have already answered every key
 * @param outcome what each restore send answers
 * @returns the deps, and the record they write into
 */
function recordingGateDeps({
  read,
  env = { CLAUDE_CODE_SESSION_ID: "a0000023-0000-4000-8000-000000000026", CMUX_WORKSPACE_ID: PINNED_WORKSPACE },
  offFableHatchIsOpen = false,
  meteredHatchIsOpen = false,
  metered = ALL_ON_PLANS,
  attempts = 0,
  outcome = { detail: "submitted to WS-PINNED", sent: true },
  caller,
  lanes = FILL_LANES,
}: GateSeams): { deps: ChairGateDeps; seen: SeenBySeams } {
  const seen: SeenBySeams = { callerReads: 0, diagnostics: [], meteredReads: 0, reads: 0, recorded: [], sends: [] };
  const deps: ChairGateDeps = {
    attemptsFor: () => attempts,
    env,
    meteredHatchIsOpen,
    offFableHatchIsOpen,
    readCaller: () => {
      seen.callerReads += 1;
      return caller;
    },
    readRecordedChair: () => ({ kind: "absent" }),
    readChair: () => {
      seen.reads += 1;
      return Promise.resolve(read);
    },
    readLanes: () => Promise.resolve(lanes),
    readMetered: () => {
      seen.meteredReads += 1;
      return Promise.resolve(metered);
    },
    recordAttempt: ({ key, workspaceId }) => seen.recorded.push({ key, workspaceId }),
    sendToWorkspace: ({ text, workspaceId }) => {
      seen.sends.push({ text, workspaceId });
      return Promise.resolve(outcome);
    },
    writeDiagnostic: (line) => seen.diagnostics.push(line),
  };
  return { deps, seen };
}

/**
 * Drive the gate over a fixed read, recording whether the verb ran and what it typed.
 *
 * @param argv the verb's argv, a `tick-record` with a draft unless a case names another
 * @returns what happened
 */
export async function gate({
  argv = ["node", "slopweaver", "supervisor", "tick-record", "--draft", "d.json"],
  ...seams
}: GateSeams): Promise<Gated> {
  const ran: ChairGatePass[] = [];
  const { deps, seen } = recordingGateDeps(seams);
  const code = await gateChairThenRun({
    argv,
    deps,
    run: (given) => {
      ran.push(given);
      return EXIT_OK;
    },
    verb: "tick-record",
  });
  return { ...seen, code, ran };
}
