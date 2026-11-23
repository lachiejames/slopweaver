/**
 * `slopweaver talk supervisor` — their recent turns and the pinned supervisor's replies, for the console voice.
 *
 * The voice's `read_supervisor` tool runs this, so the voice can pick up the owner↔supervisor conversation
 * where it is instead of starting cold. Which session is the chair is the pin's
 * answer (`resolveIntakeScope`, the same route `supervisor intake` takes), never a guess from a workspace
 * title; `--session` names one explicitly. What is kept and how it is capped is `src/talk/supervisorWindow.ts`.
 */
import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readTail, transcriptPathFor } from "../../../sessions/liveSessionStore.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { resolveIntakeScope } from "../../../supervisor/intakeScope.js";
import { type TalkError, TalkErrors } from "../../../talk/errors.js";
import {
  SUPERVISOR_TAIL_BYTES,
  type SupervisorWindow,
  supervisorWindowOf,
  tailLines,
} from "../../../talk/supervisorWindow.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSupervisorArgs, talkHomeOf } from "./args.js";
import { TALK_SUPERVISOR_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "supervisor", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The pinned chair's transcript tail, as whole lines. */
export interface SupervisorTail {
  readonly sessionId: string;
  /** Every whole, non-empty line of the tail, in file order. */
  readonly lines: readonly string[];
  /** Whether the tail began at the start of the transcript, so no earlier turn went unread. */
  readonly fromStart: boolean;
}

/**
 * The pinned chair's transcript tail — split out so `talk history` searches the same lines `talk supervisor`
 * windows, from the same pin, rather than resolving the chair a second way.
 *
 * @param claudeHome the `~/.claude` whose `projects/` holds the chair's transcript
 * @param home the Slopweaver home the supervisor pin is read from
 * @param session an explicit Claude session id, or `undefined` to follow the pin
 * @returns the tail, or why there is none
 */
export function readSupervisorTail({
  claudeHome,
  home,
  session,
}: {
  claudeHome: string;
  home: string;
  session: string | undefined;
}): Result<SupervisorTail, TalkError> {
  const scope = resolveIntakeScope({ claudeHome, home, sessionId: session, sinceIso: undefined });
  if (scope.isErr()) {
    return err(TalkErrors.supervisorUnresolved({ why: supervisorCoreErrorLines({ error: scope.error }) }));
  }
  const { sessionId } = scope.value;
  const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId });
  if (path === undefined) {
    return err(TalkErrors.transcriptMissing({ sessionId }));
  }
  let text: string;
  try {
    text = readTail({ maxBytes: SUPERVISOR_TAIL_BYTES, path });
  } catch (cause: unknown) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  const fromStart = Buffer.byteLength(text) < SUPERVISOR_TAIL_BYTES;
  return ok({ fromStart, lines: tailLines({ fromStart, text }), sessionId });
}

/**
 * The window the verb prints, read from one Claude home — split from the runner so a test can hand it a
 * throwaway `~/.claude` instead of the operator's own.
 *
 * @param claudeHome the `~/.claude` whose `projects/` holds the chair's transcript
 * @param home the Slopweaver home the supervisor pin is read from
 * @param session an explicit Claude session id, or `undefined` to follow the pin
 * @param maxBytes the ceiling on the serialised answer
 * @returns the window, or why there is none
 */
export function readSupervisorWindow({
  claudeHome,
  home,
  session,
  maxBytes,
}: {
  claudeHome: string;
  home: string;
  session: string | undefined;
  maxBytes: number;
}): Result<SupervisorWindow, TalkError> {
  return readSupervisorTail({ claudeHome, home, session }).map((tail) =>
    supervisorWindowOf({ fromStart: tail.fromStart, lines: tail.lines, maxBytes, sessionId: tail.sessionId }),
  );
}

/** How much of the chair's conversation a continuity read keeps: every turn of a busy day, not the voice's 12 KiB page. */
const CONTINUITY_SUPERVISOR_BYTES = 64 * 1024;

/**
 * The current supervisor chat for a continuity read (`src/talk/continuity.ts`), or why it could not be read —
 * the one place `talk offer`, `talk recent` and `talk pack` take their typed turns from.
 *
 * @param home the Slopweaver home the supervisor pin is read from
 * @returns the chat, newest first, or the reason as text
 */
export function supervisorForContinuity({ home }: { home: string }): SupervisorWindow | string {
  // Evaluated outside `readContinuity`'s own guard, and a throw here would fail the call's mint.
  try {
    const read = readSupervisorWindow({
      claudeHome: claudeHomeDir(),
      home,
      maxBytes: CONTINUITY_SUPERVISOR_BYTES,
      session: undefined,
    });
    if (read.isErr()) {
      return read.error.message;
    }
    return read.value;
  } catch (cause) {
    return `the supervisor chat read threw: ${String(cause)}`;
  }
}

/**
 * Run the `talk supervisor` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkSupervisor(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_SUPERVISOR_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSupervisorArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_SUPERVISOR_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = readSupervisorWindow({
    claudeHome: claudeHomeDir(),
    home: talkHomeOf({ home: args.home }),
    maxBytes: args.maxBytes,
    session: args.session,
  });
  if (read.isErr()) {
    logger.error({ msg: `talk supervisor: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const window = read.value;
  if (args.json) {
    logger.out({ line: JSON.stringify(window) });
    return EXIT_OK;
  }
  logger.out({
    line: `talk supervisor: ${window.sessionId.slice(0, 8)}, ${String(window.exchanges.length)} turn(s), ${String(window.omitted)} older omitted`,
  });
  window.exchanges.forEach((exchange) => {
    logger.out({ line: `  ${exchange.atIso} ${exchange.who}: ${exchange.text.split("\n")[0]!.slice(0, 160)}` });
  });
  return EXIT_OK;
}

export const talkSupervisorCommand = defineCommand({ run: runTalkSupervisor });
