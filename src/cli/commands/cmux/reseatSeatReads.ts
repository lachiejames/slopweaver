/**
 * What a reseat pass reads of a live seat from the plan register: the one line `claude seat --session` would name
 * for it, and the plan it booted on.
 *
 * A leaf of `./reseatEffects.ts`, which wires them into the pass's effects. Both read the register through the
 * pass's own port, and a register that cannot be read answers as UNMEASURED or unresolved — never as a seat that
 * booted on nothing.
 */
import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";
import { judgeSeat, seatVerdictLine } from "../../../claude/seatAttest.js";
import { readOwnSeat } from "../../../claude/seatAttestRead.js";
import type { SeatBootPlan } from "../../../claude/seatBoot.js";
import { readChairPlansForSessions } from "../../../claude/seatBootRead.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";

/**
 * The plan `claude seat --session` would name for a session, as its one line.
 *
 * @param home the state home the plan register lives under
 * @param port where the plan register is read
 * @param sessionId the session whose seat is named
 * @returns the seat's verdict line, or the UNMEASURED line when the register could not be read
 */
export async function seatLineFor({
  home,
  port,
  sessionId,
}: {
  home: string;
  port: PlanRegisterPort;
  sessionId: string;
}): Promise<string> {
  const accounts = await readSpawnAccounts({ home, port });
  if (accounts.isErr() || accounts.value === undefined) {
    return "claude seat: UNMEASURED — the plan register could not be read";
  }
  const reading = readOwnSeat({ accounts: accounts.value, claudeHome: claudeHomeDir(), sessionId });
  return seatVerdictLine({ verdict: judgeSeat({ ambient: resolveAmbientCredential(), reading }) });
}

/**
 * What one live session booted on, read exactly as `fleet health` reads it — bound to the process start its registry
 * file records, so a pid a stranger inherited never lends it a reading.
 *
 * @param home the state home the plan register lives under
 * @param port where the plan register is read
 * @param session the live session's registry record
 * @returns the plan it booted on, or why that could not be resolved
 */
export async function readBootFor({
  home,
  port,
  session,
}: {
  home: string;
  port: PlanRegisterPort;
  session: SessionRecord;
}): Promise<SeatBootPlan> {
  const accounts = await readSpawnAccounts({ home, port });
  if (accounts.isErr() || accounts.value === undefined) {
    return { kind: "unresolved", why: "the plan register could not be read" };
  }
  const read = readChairPlansForSessions({
    accounts: accounts.value,
    sessions: [
      {
        pid: session.pid,
        sessionId: session.sessionId,
        ...(session.procStart === undefined ? {} : { procStart: session.procStart }),
      },
    ],
  });
  const own = read.sessions.find((one) => one.sessionId === session.sessionId);
  if (own === undefined) {
    return { kind: "unresolved", why: "its boot credential was not read" };
  }
  return own.plan;
}
