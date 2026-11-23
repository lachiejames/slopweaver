/**
 * `slopweaver session reach-grant` — record a bounded decision to reach ONE production-facing system with a
 * raw command (`admit/rawTools.ts`'s `production-cli` category).
 *
 * This is the escape hatch beside that refusal, in the one form that fits a rule about stopping: a JOURNAL
 * LINE, not an environment variable. `admit/reachGrant.ts` carries the reasoning; the short of it is that an
 * exported variable is ambient — it covers every later call in that shell silently — and leaves nobody
 * anything to read afterwards, which is the wrong shape when the mistake is visible to a real person.
 *
 * It refuses a blank reason, an unknown tool, and a tool that is not in the production-facing class, because
 * a grant that names neither a why nor a real subject is not a record of a decision. It deliberately does
 * NOT gate on the supervisor pin the way `./breakGlass.ts` does: any session can hit this block, so any
 * session must be able to record its way past it — a refusal whose escape only one session can perform is
 * the wedge every refusal in this repository is shaped to avoid.
 */
import { PRODUCTION_REACH_TOOLS } from "../../../admit/rawTools.js";
import { appendReachGrant, buildReachGrant } from "../../../admit/reachGrantStore.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/**
 * Validate the flags a grant needs, so the runner below stays a thin shell over one decision.
 *
 * Pure: it reads no environment and touches no disk — every refusal it can reach is a statement about the
 * arguments alone, which is what makes the three of them testable without a home or a session.
 *
 * @param tool the `--tool` value, already trimmed
 * @param reason the `--reason` value as given
 * @returns the validated pair, or the message to print and whether to print usage after it
 */
function validateGrantArgs({
  tool,
  reason,
}: {
  tool: string | undefined;
  reason: string | undefined;
}): Result<{ readonly tool: string; readonly reason: string }, { readonly message: string; readonly usage: boolean }> {
  if (tool === undefined || tool.length === 0) {
    return err({
      message: "session reach-grant: --tool is required — one grant opens exactly one tool",
      usage: true,
    });
  }
  if (!PRODUCTION_REACH_TOOLS.includes(tool)) {
    return err({
      message:
        `session reach-grant: \`${tool}\` is not in the production-facing class, so it needs no grant — ` +
        `that class is ${PRODUCTION_REACH_TOOLS.join(", ")}. Every other raw block takes SLOPWEAVER_ALLOW_RAW=1 inline.`,
      usage: false,
    });
  }
  if (reason === undefined || reason.trim().length === 0) {
    return err({
      message:
        "session reach-grant: --reason is required and must not be blank — a grant with no stated reason records nothing",
      usage: true,
    });
  }
  return ok({ reason: reason.trim(), tool });
}

/**
 * Run `session reach-grant`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionReachGrant(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "reach-grant" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "reach-grant" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "reach-grant" }) });
    return EXIT_USAGE;
  }
  const args = validateGrantArgs({
    reason: stringFlag({ name: "reason", parsed: parsed.value }),
    tool: stringFlag({ name: "tool", parsed: parsed.value })?.trim(),
  });
  if (args.isErr()) {
    logger.error({ msg: args.error.message });
    if (args.error.usage) {
      logger.error({ msg: sessionUsage({ verb: "reach-grant" }) });
    }
    return EXIT_USAGE;
  }
  const claudeSessionId = process.env[CLAUDE_CODE_SESSION_ID_ENV];
  if (claudeSessionId === undefined || claudeSessionId.length === 0) {
    logger.error({
      msg:
        `session reach-grant: ${CLAUDE_CODE_SESSION_ID_ENV} is not set — a grant is issued TO a session, and one ` +
        "recorded outside a live session could never be matched to the call it was meant to open",
    });
    return EXIT_ERROR;
  }
  const home = stringFlag({ name: "home", parsed: parsed.value });
  const grant = buildReachGrant({
    claudeSessionId,
    issuedAtIso: new Date().toISOString(),
    reason: args.value.reason,
    tool: args.value.tool,
  });
  appendReachGrant({ grant, ...(home === undefined ? {} : { home }) });
  logger.out({
    line:
      `session reach-grant: RECORDED for \`${grant.tool}\` — raw ${grant.tool} is open until ` +
      `${grant.expiresAtIso}, then it returns. Reason: ${grant.reason}`,
  });
  logger.out({
    line: `session reach-grant: this opens ${grant.tool} ALONE, journalled against this session, not an ambient override.`,
  });
  return EXIT_OK;
}

export const sessionReachGrantCommand = defineCommand({ run: runSessionReachGrant });
