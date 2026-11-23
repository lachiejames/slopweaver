/**
 * Reading and writing the agent-tool ban file — the effectful half of {@link ./agentToolBan}.
 *
 * Both sides are SYNCHRONOUS and swallow their own I/O failures, because the reader is a `PreToolUse` hook:
 * an unreadable file must make the gate inert, never make it throw in front of a tool call. Same owner-only
 * permissions as the supervisor-pin record beside it — this file names live sessions.
 */
import { mkdirSync, readFileSync } from "node:fs";

import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import {
  type AgentToolBanFile,
  type AgentToolBanRecord,
  parseAgentToolBans,
  withAgentToolBan,
} from "./agentToolBan.js";

/** Owner-only permissions, matching `./sessionStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The ban file's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/agent-tool-bans.json`
 */
function agentToolBansPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).agentToolBansJson;
}

/**
 * Every recorded ban, or an empty file when there is none this reader can trust.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the parsed file — empty for an absent, unreadable or malformed one
 */
export function readAgentToolBans({ home }: { home?: string } = {}): AgentToolBanFile {
  try {
    return parseAgentToolBans({ text: readFileSync(agentToolBansPath(home === undefined ? {} : { home }), "utf8") });
  } catch {
    return { bans: [] };
  }
}

/**
 * Record or clear ONE session's ban, leaving every other session's alone and dropping expired rows.
 *
 * @param claudeSessionId the session to record or clear
 * @param record the row to write, or `undefined` to clear this session's ban
 * @param nowIso the instant to judge expiry against
 * @param home the state home (defaults to the resolved home)
 * @returns the file as it now stands on disk
 */
export function writeAgentToolBan({
  claudeSessionId,
  record,
  nowIso,
  home,
}: {
  claudeSessionId: string;
  record: AgentToolBanRecord | undefined;
  nowIso: string;
  home?: string;
}): AgentToolBanFile {
  const scoped = home === undefined ? {} : { home };
  const next = withAgentToolBan({ claudeSessionId, file: readAgentToolBans(scoped), nowIso, record });
  mkdirSync(stateHomePaths(scoped).sessions, { mode: DIR_MODE, recursive: true });
  writeFileAtomic({
    contents: `${JSON.stringify(next, null, 2)}\n`,
    dirMode: DIR_MODE,
    fileMode: FILE_MODE,
    path: agentToolBansPath(scoped),
  });
  return next;
}
