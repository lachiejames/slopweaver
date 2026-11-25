/**
 * `session standing`'s chair read: which Claude sessions sit in the pinned supervisor chat, judged off their
 * transcripts, given the pids the report's one cmux listing found for it.
 *
 * The pids are every one cmux REPORTED for the tab, attributed or listed (`./standingWorkspaces.ts` § `workspacePids`), and the
 * sessions are bound to them through the same registry and process-table filter the chair gate takes
 * (`../../../supervisor/chairRecords.ts`), so the two never disagree about who is in the chair.
 */
import { readProcessStarts } from "../../../fleet/processStarts.js";
import { readLaneShapes } from "../../../plans/laneShapeRead.js";
import { planRegisterPort } from "../../../plans/port.js";
import { type ChairRead, chairSessionLine } from "../../../supervisor/chairGate.js";
import { type ChairRequirement, chairRequirement } from "../../../supervisor/chairPolicy.js";
import { CODEX_PIN_HAS_NO_CLAUDE_CHAIR, claudeHomeDir } from "../../../supervisor/chairRead.js";
import { type BoundChairSessions, readBoundChairSessions } from "../../../supervisor/chairRecords.js";
import {
  type RecordedChairHost,
  UNMEASURED_CHAIR_HOST,
  UNRESOLVED_CHAIR_RECORD,
} from "../../../supervisor/recordedChairHost.js";

/** Judges the Claude sessions among the pinned workspace's pids — a seam, so a test reads a frozen transcript. */
export type StandingChairReader = (options: { readonly pids: readonly number[] }) => BoundChairSessions;

/**
 * The production reader: the operator's own `~/.claude` registry, bound by the live process table.
 *
 * @param pids every pid cmux reported for the pinned workspace
 * @returns the judged sessions, or why the table or the registry would not read
 */
export function productionStandingChairReader({ pids }: { readonly pids: readonly number[] }): BoundChairSessions {
  return readBoundChairSessions({ claudeHome: claudeHomeDir(), pids, readStarts: readProcessStarts });
}

/**
 * The chair read `session standing` judges: no pinned chat, the pinned chat's sessions, or why the process table
 * or the session registry would not say which sessions those are.
 *
 * A pin naming a Codex thread reads unresolved, never judged: a Claude tab in that workspace is not the chair, and
 * judging one would report a Codex chair's model off a session beside it. Records too damaged to
 * name the host read unresolved the same way, never as a Claude chair.
 *
 * @param workspaces the pinned chat's directory, cmux id and pids, off the one listing this report took
 * @param readChair judges the Claude sessions among the pinned workspace's pids
 * @param pinHost the recorded chair's host (`readRecordedChairHost`), undefined when none is recorded
 * @returns the chair read
 */
export function standingChairRead({
  workspaces,
  readChair,
  pinHost,
}: {
  readonly workspaces: {
    readonly supervisorCwd: string | undefined;
    readonly supervisorWorkspaceId: string | undefined;
    readonly supervisorPids: readonly number[];
  };
  readonly readChair: StandingChairReader;
  readonly pinHost: RecordedChairHost | undefined;
}): ChairRead {
  if (workspaces.supervisorCwd === undefined) {
    return { cause: "no-chair", kind: "unresolved", why: "no pinned supervisor chat is open" };
  }
  if (pinHost === "codex") {
    return { cause: "codex-chair", kind: "unresolved", why: CODEX_PIN_HAS_NO_CLAUDE_CHAIR };
  }
  if (pinHost === "unresolved") {
    return { cause: "chair-record-unread", kind: "unresolved", why: UNRESOLVED_CHAIR_RECORD };
  }
  // With no pin record and no chain link, nothing measured says which session holds the chair: a screen, a process
  // tree or an open Codex rollout proves a session exists, never that it owns the chair.
  if (pinHost === undefined) {
    return { cause: "chair-host-unmeasured", kind: "unresolved", why: UNMEASURED_CHAIR_HOST };
  }
  const judged = readChair({ pids: workspaces.supervisorPids });
  if (judged.kind === "unresolved") {
    return judged;
  }
  // `session standing` never restores anything, so an id the listing did not carry is reported as the empty
  // string rather than guessed at — `chairRestore.ts` compares it and an empty one can never equal a caller's.
  let workspaceId = "";
  if (workspaces.supervisorWorkspaceId !== undefined) {
    workspaceId = workspaces.supervisorWorkspaceId;
  }
  return {
    directory: workspaces.supervisorCwd,
    kind: "resolved",
    location: { kind: "cmux", workspaceId },
    sessions: judged.sessions,
  };
}

/**
 * What the chair must be on, from the plan lanes of the home `session standing` reports on (`chairPolicy.ts`).
 *
 * @param home the resolved state home, whose plan register decides the lanes
 * @param nowMs the instant the lanes are judged at, epoch milliseconds
 * @returns the chair's requirement; an unreadable register keeps today's Fable rule
 */
export async function standingChairRequirement({
  home,
  nowMs,
}: {
  readonly home: string;
  readonly nowMs: number;
}): Promise<ChairRequirement> {
  const lanes = await readLaneShapes({ home, nowIso: new Date(nowMs).toISOString(), read: planRegisterPort().read });
  return chairRequirement({ lanes });
}

/**
 * The chair's lines under the supervisor's: why no Claude chair runs, or one line per session judged against the
 * model the lanes require.
 *
 * @param chair the chair read
 * @param requirement what the chair must be on
 * @returns the indented lines, empty when a Claude chair was required but not resolved
 */
export function standingChairLines({
  chair,
  requirement,
}: {
  readonly chair: ChairRead;
  readonly requirement: ChairRequirement;
}): readonly string[] {
  if (requirement.kind === "claude-unavailable") {
    return [`  chair: ${requirement.why}`];
  }
  if (chair.kind !== "resolved") {
    return [];
  }
  return chair.sessions.map((reading) => `  chair ${chairSessionLine({ reading, required: requirement.model })}`);
}
