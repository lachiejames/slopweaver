/**
 * The cmux-send-supervisor guard's runner: read the `PreToolUse` payload, decide it against the recorded
 * supervisor pin, and return the exit code (2 = block, 0 = allow).
 *
 * FAILS OPEN on everything it cannot resolve — a malformed payload, no registered pin. This is a workflow
 * trip-wire (AGENTS.md rule 3: "a block confirms you were wrong, its absence means nothing"), not a security
 * boundary, and a bug here that failed CLOSED would block ordinary `cmux send` traffic across the whole
 * fleet.
 *
 * Every reader is injected, so the whole decision path is unit-tested without a mock — same shape as
 * `./sessionDepthWarningRunner.ts`.
 */
import type { SupervisorPinRecord } from "../sessions/supervisorPin.js";
import { readSupervisorPin } from "../sessions/supervisorPinStore.js";
import { readBashSessionCommand } from "./bashToolCommandPayload.js";
import { cmuxSendSupervisorRefusal } from "./cmuxSendSupervisorGuard.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/**
 * Run the guard over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param readPin resolves the recorded supervisor pin (defaults to the real store)
 * @returns the exit code (2 block, 0 allow)
 */
export async function runCmuxSendSupervisorGuard({
  readStdin: read,
  writeError,
  readPin = readSupervisorPin,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  readPin?: () => SupervisorPinRecord | undefined;
}): Promise<number> {
  const parsed = await readBashSessionCommand({ readStdin: read });
  if (parsed === undefined) {
    return EXIT_ALLOW;
  }
  const refusal = cmuxSendSupervisorRefusal({
    callerSessionId: parsed.sessionId,
    command: parsed.command,
    pin: readPin(),
  });
  if (refusal === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${refusal}\n`);
  return EXIT_BLOCK;
}
