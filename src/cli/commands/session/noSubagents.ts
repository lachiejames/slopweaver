/**
 * `slopweaver session no-subagents` — declare, from inside a session, that its own brief forbids sub-agents,
 * so the `Agent`/`Task` PreToolUse gate refuses one.
 *
 * A worker whose brief forbids sub-agents is refused the Agent tool by a PreToolUse hook in that session, so the
 * rule is a gate, not prose. This is the
 * writer; `../../../admit/agentToolBanGuard.ts` is the reader.
 *
 * It is DECLARED rather than inferred, and only this session can declare it — `--why` carries the brief
 * clause that forbids it, which the refusal prints back so the agent can weigh the exception rather than
 * only see a wall. `../../../sessions/agentToolBan.ts`'s header has why no execution mode is read here.
 *
 * Effectful shell only; the record and its expiry are `../../../sessions/agentToolBan.ts`.
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { AgentToolBanRecord } from "../../../sessions/agentToolBan.js";
import { writeAgentToolBan } from "../../../sessions/agentToolBanStore.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

export const SESSION_NO_SUBAGENTS_USAGE =
  'usage: slopweaver session no-subagents --why "<the brief clause that forbids it>" [--hours <n>] [--home <dir>]\n' +
  "       slopweaver session no-subagents --clear [--home <dir>]\n" +
  "  Declare that THIS session's brief forbids sub-agents. The Agent/Task PreToolUse gate then refuses one\n" +
  "  in this session, printing --why back with the escape hatch, so the rule is a gate rather than prose.\n" +
  "  Only this session can declare or clear its own ban; it expires after --hours (default 12) so a record\n" +
  "  cannot outlive every process able to clear it.";

/** How long a declared ban stands before it lapses, when the caller names no window. */
const DEFAULT_BAN_HOURS = 12;

const FLAGS: FlagSpec = { boolean: ["clear"], string: ["why", "hours", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const SESSION_NO_SUBAGENTS_FLAG_NAMES: readonly string[] = ["--clear", "--home", "--hours", "--why"];

/**
 * Parse `session no-subagents`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseSessionNoSubagentsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** The `--hours` window as milliseconds, falling back to the default for anything that is not a positive number. */
function windowMs({ hours }: { hours: unknown }): number {
  const parsed = typeof hours === "string" ? Number(hours) : DEFAULT_BAN_HOURS;
  const usable = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BAN_HOURS;
  return usable * 60 * 60 * 1000;
}

/**
 * Run `session no-subagents` — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4)
 * @param env the environment this session's own id is detected from
 * @param nowMs the clock the record and its expiry are stamped from
 * @returns `EXIT_OK` on a recorded or cleared ban, `EXIT_USAGE` on a bad flag or a missing `--why`, and
 *   `EXIT_ERROR` when this process is not a visible Claude Code session and so has no id to scope a ban to
 */
export function runSessionNoSubagentsWithDeps({
  argv,
  env,
  nowMs,
}: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  nowMs: number;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SESSION_NO_SUBAGENTS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSessionNoSubagentsArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, SESSION_NO_SUBAGENTS_USAGE].forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const detected = detectSupervisorSession({ env });
  if (detected.kind !== "active" || detected.session.host !== "claude-code") {
    logger.error({
      msg: "session no-subagents: this process is not a visible Claude Code session, so there is no session id to scope a ban to — run it from inside the session whose brief forbids sub-agents",
    });
    return EXIT_ERROR;
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const claudeSessionId = detected.session.id;
  const nowIso = new Date(nowMs).toISOString();
  if (values["clear"] === true) {
    writeAgentToolBan({ claudeSessionId, home, nowIso, record: undefined });
    logger.out({ line: `session no-subagents: cleared — session ${claudeSessionId} may spawn sub-agents again` });
    return EXIT_OK;
  }
  const why = values["why"];
  if (typeof why !== "string" || why.trim().length === 0) {
    logger.error({ msg: "session no-subagents: --why is required — name the brief clause that forbids it" });
    logger.error({ msg: SESSION_NO_SUBAGENTS_USAGE });
    return EXIT_USAGE;
  }
  const record: AgentToolBanRecord = {
    claudeSessionId,
    expiresAtIso: new Date(nowMs + windowMs({ hours: values["hours"] })).toISOString(),
    recordedAtIso: nowIso,
    why: why.trim(),
  };
  writeAgentToolBan({ claudeSessionId, home, nowIso, record });
  logger.out({
    line: `session no-subagents: recorded — the Agent tool is refused in session ${claudeSessionId} until ${record.expiresAtIso} (${record.why})`,
  });
  return EXIT_OK;
}

/**
 * Run the `session no-subagents` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — see {@link runSessionNoSubagentsWithDeps}
 */
export function runSessionNoSubagents(argv: readonly string[]): number {
  return runSessionNoSubagentsWithDeps({ argv, env: process.env, nowMs: Date.now() });
}

export const sessionNoSubagentsCommand = defineCommand({ run: runSessionNoSubagents });
