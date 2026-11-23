/**
 * The pure decision behind the Agent-tool gate: given the calling session's id and the recorded bans, decide
 * whether this session declared that it may not spawn a sub-agent, and render the refusal if it did.
 *
 * The rule is a gate, not prose: a worker whose brief forbids sub-agents is refused the Agent tool by a
 * PreToolUse hook in that session. The ban itself is
 * DECLARED rather than inferred, and `../sessions/agentToolBan.ts`'s header carries why inferring one from a
 * dispatch's execution mode would refuse the detective fan-out the owner rules FOR.
 *
 * Read against the recorded file, never a live lookup: a `PreToolUse` hook cannot afford a socket hop, and
 * the same reasoning `../sessions/supervisorPin.ts` states applies unchanged.
 */
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { hatchRefusal } from "../hatch/render.js";
import type { EscapeHatch } from "../hatch/types.js";
import { type AgentToolBanFile, liveAgentToolBan } from "../sessions/agentToolBan.js";

/** The tool names Claude Code uses for a native sub-agent dispatch. */
const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(["Agent", "Task"]);

/** This gate's own register row — the refusal text is the register's, never this module's. */
const HATCH: EscapeHatch = ESCAPE_HATCHES.find((hatch) => hatch.id === "session-subagent")!; // registry-owned

/**
 * Whether a tool call is a native sub-agent dispatch.
 *
 * @param toolName the payload's `tool_name`
 * @returns whether this call would start a sub-agent
 */
export function isSubagentTool({ toolName }: { toolName: string }): boolean {
  return SUBAGENT_TOOL_NAMES.has(toolName);
}

/**
 * Decide one `PreToolUse` payload against the recorded bans.
 *
 * INERT when the session has no live ban, which is every session that never declared one — the same
 * failure-open shape every guard built on a session-scoped record has.
 *
 * @param toolName the payload's `tool_name`
 * @param claudeSessionId the calling session's own id, from the hook payload
 * @param file the recorded bans
 * @param nowIso the instant to judge expiry against
 * @param hatchOpen whether the operator already opened this gate's escape hatch for this call
 * @returns the refusal message, or `undefined` to allow
 */
export function agentToolRefusal({
  toolName,
  claudeSessionId,
  file,
  nowIso,
  hatchOpen,
}: {
  toolName: string;
  claudeSessionId: string;
  file: AgentToolBanFile;
  nowIso: string;
  hatchOpen: boolean;
}): string | undefined {
  if (hatchOpen || !isSubagentTool({ toolName })) {
    return undefined;
  }
  const ban = liveAgentToolBan({ claudeSessionId, file, nowIso });
  if (ban === undefined) {
    return undefined;
  }
  return hatchRefusal({ detail: `this session's brief says: ${ban.why}`, hatch: HATCH });
}
