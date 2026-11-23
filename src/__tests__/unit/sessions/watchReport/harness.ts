/*
 * What the test files over the supervisor's per-session view share: the event and inventory-row builders, the instant
 * most cases read as now, and the unmapped row several cases start from. It moved here when one test file was split by
 * behaviour.
 */
import type { CmuxWorkspaceSummary } from "../../../../cmux/client.js";
import type { CmuxEvent } from "../../../../cmux/events.js";
import type { SessionWatchRow } from "../../../../sessions/watchReport.js";

/**
 * One event, with everything but the fields under test defaulted.
 *
 * @returns the event, with its cwd derived from the workspace id
 */
export function event({
  name,
  workspaceId,
  atIso,
  seq,
}: {
  name: string;
  workspaceId: string;
  atIso: string;
  seq: number;
}): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: `/repo/${workspaceId}`,
    id: `e${String(seq)}`,
    name,
    occurredAtIso: atIso,
    phase: "received",
    seq,
    sessionId: undefined,
    surfaceId: undefined,
    toolName: undefined,
    workspaceId,
  };
}

/**
 * One inventory row for a workspace.
 *
 * @returns the row, with its current directory derived from the title
 */
export function workspace({ workspaceId, title }: { workspaceId: string; title: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/repo/${title}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title,
    windowId: "W",
    workspaceId,
    workspaceRef: "workspace:1",
  };
}

export const NOW: string = "2026-08-23T01:00:00.000Z";

/** An unmapped, quiet row with no title — the case whose name has to carry its own flag. */
export const UNMAPPED_ROW: SessionWatchRow = {
  attentionKind: undefined,
  cwd: "/repo/gone",
  host: undefined,
  lastActivityAtIso: "2026-10-09T10:13:00.000Z",
  lastEventName: "agent.hook.PreToolUse",
  manager: undefined,
  mapped: false,
  openedAtIso: undefined,
  quietMinutes: 47,
  sessionId: undefined,
  sessionTitle: undefined,
  signal: "silent",
  title: undefined,
  toolCalls: 36,
  workspaceId: "37CC9FE8",
  workspaceRef: undefined,
};
