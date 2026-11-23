/**
 * WHICH sessions have declared that they may not spawn a sub-agent — the scoping fact
 * `../admit/agentToolBanGuard.ts` needs and a `PreToolUse` hook cannot afford to derive.
 *
 * ## Why this exists at all
 *
 * A load incident: one ask worker ran nineteen sub-agents against a brief that said never spawn a
 * sub-agent, each stuck 43 minutes on its PreToolUse hooks, while the machine sat at load 100-146 against a
 * hold of 22. The owner's ask: a worker whose brief forbids sub-agents is refused the Agent tool by a
 * PreToolUse hook in that session, so the rule is a gate, not prose.
 *
 * ## The ban is DECLARED, never inferred, and that is a deliberate narrowing
 *
 * It would be easy to infer one from a dispatch's `execution.mode` — `continuous-drain` briefs render "it
 * must never block on a native subagent call" (`../live/turn/brief.ts`). That inference is WRONG and would
 * break an owner ruling: that sentence binds the LISTENER, which must never stop reading the stream, while
 * `skills/loop-bot/SKILL.md` makes the detective fan-out mandatory for the worker the listener dispatched —
 * spawn N Haiku sub-agents IN PROCESS, with N counted off the probe and never chosen, on the owner's own
 * ruling. Inferring the ban from the mode would refuse the fan-out the owner asked for.
 *
 * So a ban exists only where something WROTE one, it names the brief clause it came from, and an
 * unregistered session is untouched. Being unregistered can only ever make the gate inert.
 *
 * ## The limit, stated rather than discovered
 *
 * A Claude Code `PreToolUse` payload carries `session_id`, `tool_name`, `tool_input`, `cwd` and
 * `transcript_path` and NOTHING that marks a sidechain — `isSidechain` lives on the transcript record
 * (`../transcripts/record.ts`), not on the hook payload. So a ban is a ban on the SESSION, and it cannot
 * express "the parent may spawn, a detective may not". `src/detective/brief.ts`'s flat-fan-out prohibition
 * ("You never spawn another agent. The fan-out is FLAT") therefore stays prose, and saying so here is more
 * honest than claiming a gate that does not reach it.
 *
 * Pure: text in, a record out. The file lives in `./agentToolBanStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";

/** One session that has declared it may not spawn a sub-agent, and where that prohibition came from. */
export interface AgentToolBanRecord {
  /** The `CLAUDE_CODE_SESSION_ID` of the banned session — what a hook payload is matched against. */
  readonly claudeSessionId: string;
  /** The brief clause, doc or ruling that forbids it — printed in the refusal so the agent can weigh it. */
  readonly why: string;
  /** When the ban was recorded. */
  readonly recordedAtIso: string;
  /**
   * When it stops applying. A session id is a uuid and is not reused in practice, but a record that outlives
   * every process that could clear it would wedge a future session on a stale file — the same
   * generation-binding reasoning as `../live/turn/workerSessionStore.ts`'s `leaseExpiresAt`.
   */
  readonly expiresAtIso: string;
}

/** Every recorded ban, keyed by session — one file, so a hook makes one read. */
export interface AgentToolBanFile {
  readonly bans: readonly AgentToolBanRecord[];
}

/** Parse one ban row, refusing anything that is not completely one. */
function parseRow({ value }: { value: unknown }): AgentToolBanRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const claudeSessionId = value["claudeSessionId"];
  const why = value["why"];
  const recordedAtIso = value["recordedAtIso"];
  const expiresAtIso = value["expiresAtIso"];
  if (
    typeof claudeSessionId !== "string" ||
    claudeSessionId.trim().length === 0 ||
    typeof why !== "string" ||
    typeof recordedAtIso !== "string" ||
    typeof expiresAtIso !== "string"
  ) {
    return undefined;
  }
  return { claudeSessionId, expiresAtIso, recordedAtIso, why };
}

/**
 * Parse the ban file. A row that is not completely a record is DROPPED rather than failing the whole read:
 * one corrupt row must not make every other session's declared ban vanish.
 *
 * @param text the file's contents
 * @returns the rows it could read, empty for absent, malformed or wholly unreadable text
 */
export function parseAgentToolBans({ text }: { text: string }): AgentToolBanFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { bans: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["bans"])) {
    return { bans: [] };
  }
  const bans: AgentToolBanRecord[] = [];
  for (const value of parsed["bans"]) {
    const row = parseRow({ value });
    if (row !== undefined) {
      bans.push(row);
    }
  }
  return { bans };
}

/**
 * The live ban for one session, or `undefined` when it has none.
 *
 * @param file the parsed ban file
 * @param claudeSessionId the session id from the hook payload — a blank one never matches, so a payload
 *   missing the field is inert
 * @param nowIso the instant to judge expiry against
 * @returns the row, or `undefined` when none is registered or the only one has expired
 */
export function liveAgentToolBan({
  file,
  claudeSessionId,
  nowIso,
}: {
  file: AgentToolBanFile;
  claudeSessionId: string;
  nowIso: string;
}): AgentToolBanRecord | undefined {
  if (claudeSessionId.trim().length === 0) {
    return undefined;
  }
  return file.bans.find((row) => row.claudeSessionId === claudeSessionId && row.expiresAtIso > nowIso);
}

/**
 * The file as it should be written after recording or clearing one session's ban: every OTHER session's live
 * row, plus the new one when there is one. Expired rows are dropped on every write, so the file cannot grow
 * without bound.
 *
 * @param file the parsed file as it stands
 * @param claudeSessionId the session being recorded or cleared
 * @param nowIso the instant to judge expiry against
 * @param record the new row, or `undefined` to clear this session's ban
 * @returns the file to write
 */
export function withAgentToolBan({
  file,
  claudeSessionId,
  nowIso,
  record,
}: {
  file: AgentToolBanFile;
  claudeSessionId: string;
  nowIso: string;
  record: AgentToolBanRecord | undefined;
}): AgentToolBanFile {
  const kept = file.bans.filter((row) => row.claudeSessionId !== claudeSessionId && row.expiresAtIso > nowIso);
  return { bans: record === undefined ? kept : [...kept, record] };
}
