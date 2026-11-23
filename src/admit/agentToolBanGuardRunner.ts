/**
 * The Agent-tool gate's runner: read the `PreToolUse` payload, decide it against the recorded bans, and
 * return the exit code (2 = block, 0 = allow).
 *
 * FAILS OPEN on everything it cannot resolve — a malformed payload, no `session_id`, an unreadable home.
 * This is a workflow trip-wire (AGENTS.md rule 3: "a block confirms you were wrong, its absence means
 * nothing"), not a security boundary, and a bug here that failed CLOSED would refuse the Agent tool across
 * the whole fleet at once — including the detective fan-out `skills/loop-bot` makes mandatory.
 *
 * Every reader is injected, so the whole decision path is unit-tested without a mock — same shape as
 * `./cmuxSendSupervisorGuardRunner.ts`.
 */
import { isRecord } from "../lib/parsers.js";
import { type AgentToolBanFile } from "../sessions/agentToolBan.js";
import { readAgentToolBans } from "../sessions/agentToolBanStore.js";
import { agentToolRefusal } from "./agentToolBanGuard.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/** The ambient variable this gate's register row names. */
const HATCH_ENV = "SLOPWEAVER_ALLOW_SUBAGENT";

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param nowIso the instant to judge a ban's expiry against
 * @param env the environment the escape hatch is read from
 * @param readBans resolves the recorded bans (defaults to the real store)
 * @returns the exit code (2 block, 0 allow)
 */
export async function runAgentToolBanGuard({
  readStdin,
  writeError,
  nowIso,
  env,
  readBans = readAgentToolBans,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  nowIso: string;
  env: Record<string, string | undefined>;
  readBans?: () => AgentToolBanFile;
}): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return EXIT_ALLOW; // fail open: a malformed payload must never wedge a tool call
  }
  const toolName = isRecord(payload) ? payload["tool_name"] : undefined;
  const claudeSessionId = isRecord(payload) ? payload["session_id"] : undefined;
  if (typeof toolName !== "string" || typeof claudeSessionId !== "string") {
    return EXIT_ALLOW;
  }
  // Read as a local and OR it in, never as a parameter default: `hatch-release` refuses a default
  // initialiser, because a caller passing its own argument would silently close a hatch it must only widen.
  const hatchOpen = env[HATCH_ENV] === "1";
  const refusal = agentToolRefusal({ claudeSessionId, file: readBans(), hatchOpen, nowIso, toolName });
  if (refusal === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${refusal}\n`);
  return EXIT_BLOCK;
}
