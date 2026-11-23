/**
 * `slopweaver cmux stop` — tell a peer seat to stop what is costing the fleet, WITHOUT blocking on it.
 *
 * `slopweaver perf` names the seat and the hook; this is the lever, and the
 * two halves are deliberately separate verbs so a chair that has decided can act in one call.
 *
 * Three properties, each of them the reason this is a verb rather than `cmux send --interrupt "stop"`:
 *
 * - **It does not wait.** `SessionHarness.interrupt` (cmux: one Escape) returns at once; it does not poll the
 *   screen for the interrupt taking effect, and neither does this. A chair that blocked on a peer's
 *   interrupt would be doing the thing this exists to stop — one slow seat holding the whole fleet.
 * - **`--why` is one line, and it is OPTIONAL.** An interrupt with no explanation leaves the seat's next
 *   turn guessing at what happened, which is how a stopped seat simply restarts the same work; a `--why`
 *   arrives as the seat's next line. Sending it is `cmux send`'s own path, so it reports ACCEPTED vs
 *   QUEUED exactly as that verb does.
 * - **It refuses the pinned supervisor**, like every other write into a session. That box is the one the
 *   owner types into (`cmux/supervisorWorkspace.ts`), and interrupting it mid-sentence is worse than
 *   sending into it.
 *
 * There is no `pause` here and that is deliberate: cmux exposes no pause primitive, and a "pause" built out
 * of an interrupt plus a standing instruction would be a state nothing can read back — a seat reporting
 * itself paused while running is the failure class `AGENTS.md` rule 6 exists to prevent. Stopping the turn
 * and saying why is the honest version of the same act.
 */
import { supervisorSendRefusal } from "../../../cmux/supervisorWorkspace.js";
import { describeSendDisposition } from "../../../cmux/turnBusy.js";
import { logger } from "../../../lib/logger.js";
import { parseHarnessFlag, withNamedSessionHarness } from "../../../sessionHarness/harnessChoice.js";
import type { HarnessTarget, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxVerb, stringFlag } from "./core.js";

/** The seat a caller named, `--workspace` first, then the positional. */
function namedSeat({
  flagged,
  positional,
}: {
  flagged: string | undefined;
  positional: string | undefined;
}): string | undefined {
  if (flagged !== undefined) {
    return flagged;
  }
  return positional;
}

/** A stop with no reason: interrupt the running turn and say so, without waiting to watch it land. */
async function interruptOnly({ harness, target }: { harness: SessionHarness; target: HarnessTarget }): Promise<number> {
  const interrupted = await harness.interrupt({ target });
  if (interrupted.isErr()) {
    logger.error({ msg: `cmux stop: ${interrupted.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({
    line: `cmux stop: interrupted ${target.session.handle} — not waiting for it to take effect; read the screen if you need the witness`,
  });
  return EXIT_OK;
}

/**
 * Run `cmux stop`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxStop(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "stop" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const ref = namedSeat({ flagged: stringFlag({ name: "workspace", parsed }), positional: parsed.positionals[0] });
  if (ref === undefined) {
    logger.error({ msg: "cmux stop: name the seat — a workspace ref or id, positionally or as --workspace" });
    logger.error({ msg: cmuxUsage({ verb: "stop" }) });
    return EXIT_USAGE;
  }
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed }) });
  if (harnessName.isErr()) {
    logger.error({ msg: `cmux stop: ${harnessName.error}` });
    logger.error({ msg: cmuxUsage({ verb: "stop" }) });
    return EXIT_USAGE;
  }
  const why = stringFlag({ name: "why", parsed });
  const surfaceId = stringFlag({ name: "surface", parsed });
  return withNamedSessionHarness({
    name: harnessName.value,
    body: async ({ harness }): Promise<number> => {
      const resolved = await harness.resolve({
        handle: ref,
        ...(surfaceId === undefined ? {} : { endpointId: surfaceId }),
      });
      if (resolved.isErr()) {
        logger.error({ msg: `cmux stop: ${resolved.error.message}` });
        return EXIT_ERROR;
      }
      const target = resolved.value;
      const { session } = target;
      const refused = supervisorSendRefusal({
        callerWorkspaceId: process.env["CMUX_WORKSPACE_ID"],
        target: { pinned: session.pinned, title: session.title, workspaceId: session.id, workspaceRef: session.handle },
      });
      if (refused !== undefined) {
        logger.error({ msg: `cmux stop: ${refused.message}` });
        return EXIT_ERROR;
      }
      if (why === undefined) {
        return interruptOnly({ harness, target });
      }
      // Delivery `now` IS the interrupt-then-say-why sequence, delay and submit included.
      const sent = await harness.message({ delivery: "now", target, text: why });
      if (sent.isErr()) {
        logger.error({ msg: `cmux stop: ${sent.error.message}` });
        return EXIT_ERROR;
      }
      const { disposition, interrupted } = sent.value;
      logger.out({ line: describeSendDisposition({ disposition, interrupted, workspaceRef: session.handle }) });
      return EXIT_OK;
    },
  });
}

export const cmuxStopCommand = defineCommand({ run: runCmuxStop });
