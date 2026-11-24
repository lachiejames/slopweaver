/**
 * `slopweaver supervisor tick-record` end to end over injected seams — the whole verb, not a restatement
 * of it.
 *
 * The seams are plain functions passed in, not mocks: the filesystem, stdin, the clock and the append are
 * each one closure the test supplies, so what runs here is the shipped `runSupervisorTickRecord`. This is the
 * shared harness every `tickRecord/` test file builds its run from; it moved here when `tickRecord.test.ts` was
 * split by behaviour, and it touches no disk.
 */
import { ok } from "#lib/result.js";
import type { ChairGateEvidence } from "../../../../../../cli/commands/supervisor/chairGateRun.js";
import type { SupervisorTickRecordDeps } from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { type SupervisorTickRow, TICK_SOURCE_KINDS } from "../../../../../../supervisor/tickTypes.js";
import { CLAUDE_FLEET } from "../../../../../chairSuccessorFixture.js";

/** A tick the chair gate read nothing for — these cases are about the recorder, not the cadence. */
export const NOT_READ: ChairGateEvidence = { kind: "not-read", why: "this fixture exercises the recorder" };

/** The owner's own words this fixture carries through the verb. */
export const OWNER_TEXT = "lets go with your lean — i don't want a second gate for #16324";

/**
 * Every source, `unavailable`.
 *
 * @returns one unavailable source entry per tick source kind, keyed by kind
 */
export function allUnavailable(): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/** A valid draft document. */
export const DRAFT = JSON.stringify({
  actions: [],
  handoff: "handoff-9226",
  judgements: [],
  sources: allUnavailable(),
  startedIso: "2026-09-10T12:00:00.000Z",
  tickId: "tick-226-2",
  workspace: "workspace:61",
});

/** A reconciliation document carrying one owner turn. */
export const RECONCILE = JSON.stringify({
  intake: {
    finding: {
      coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: "2026-09-09T12:00:00.000Z",
      turns: [
        {
          inGrace: false,
          turn: {
            lineNumber: 1654,
            pointer: "transcript:a1#t1",
            sessionId: "a1",
            source: "typed",
            text: OWNER_TEXT,
            timestamp: "2026-09-10T11:55:56.547Z",
            turnUuid: "t1",
          },
          witness: { kind: "row", witness: "derive-the-briefing-narrative-sections-from-the-ledgers" },
        },
      ],
    },
    kind: "read",
  },
});

/** The cadence reads every case shares: a not-read tick touches none of the first three. */
const CADENCE_READS = {
  readClaudeCode: () => {
    throw new Error("a not-read tick must never read Claude Code");
  },
  readChairPlans: () => {
    throw new Error("a not-read tick must never read a boot credential");
  },
  readChairCanon: () => {
    throw new Error("a not-read tick must never read the chair's boot or canon");
  },
  readCodexChairCanon: () => {
    throw new Error("a not-read tick must never read a Codex chair's canon");
  },
  // Every chair session one auto-compaction in, below the trial, so a case that never names it hands off on none.
  readChairAutoCompactions: ({ chair }) =>
    new Map(
      chair.kind === "resolved"
        ? chair.sessions.map(({ sessionId }) => [sessionId, { autoCompactions: 1, kind: "below-trial" } as const])
        : [],
    ),
  readPlanRegister: () => Promise.resolve(ok(CLAUDE_FLEET)),
  readClaudeSide: () => Promise.reject(new Error("a Claude plan never reads the ambient Claude side")),
  readCodexSeat: () => Promise.reject(new Error("a Claude plan never asks for a Codex seat")),
} satisfies Partial<SupervisorTickRecordDeps>;

/** What one run of the verb produced. */
export interface Capture {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly appended: SupervisorTickRow[];
  readonly deps: SupervisorTickRecordDeps;
}

/**
 * Build the injected seams over a fixed file table and a fixed clock.
 *
 * @param files the path-to-contents table the verb reads from
 * @param stdin what stdin yields
 * @returns the capture, with the deps to pass in
 */
export function capture({ files, stdin = "" }: { files: Readonly<Record<string, string>>; stdin?: string }): Capture {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const appended: SupervisorTickRow[] = [];
  return {
    appended,
    deps: {
      // Both gates are exercised in their own files; these cases are about the recorder, so both hatches are open.
      hatchOpen: () => true,
      loadHatchOpen: () => true,
      idleHatchOpen: () => true,
      recipeFailureHatchOpen: () => true,
      voiceHatchOpen: () => true,
      readVoiceUnread: () => ({ kind: "read", neverMarked: false, unparseable: [], words: [] }),
      approvedDraftHatchOpen: () => true,
      readApprovedDrafts: () => ({
        items: [],
        answers: new Map(),
        kind: "read",
        landings: { bound: [], unreadable: [] },
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      }),
      steerHatchOpen: () => true,
      readUnpickedSteers: () => Promise.resolve({ kind: "read", steers: [], undecodedRelays: 0 }),
      append: ({ row }) => {
        appended.push(row);
        return ok("/tmp/ledger/supervisor-ticks.jsonl");
      },
      now: () => "2026-09-10T12:20:00.000Z",
      readFile: ({ path }) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`${path}: no such file`);
        }
        return content;
      },
      ...CADENCE_READS,
      defaultHome: () => "/tmp/home",
      readStdin: () => stdin,
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}
