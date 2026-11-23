/**
 * The effectful half of `org-health`: read the incident snapshot and the hand register, then judge.
 *
 * Both reads are local — the snapshot row `org-health read` published in the local store (`../orgHealth/port.ts`),
 * and the register the owner's Done is recorded in — so a pass opens no provider connection. The live read is
 * the verb's, run by the supervisor tick just before this. A store that cannot be reached reads `unmeasurable`, never
 * `clear`.
 */
import type { OrgHealthPort } from "../orgHealth/port.js";

import { readHeldKeys } from "./heldKeys.js";
import { evaluateOrgHealth, ORG_HEALTH } from "./orgHealth.js";
import type { MonitorReading } from "./types.js";

/**
 * Read and evaluate `org-health`.
 *
 * @param home the state home the snapshot is selected by and the hand register lives under
 * @param nowMs the instant to judge at — `--now` replays a past pass exactly
 * @param port the store the snapshot is read from
 * @returns the reading; a snapshot or register that could not be read is `unmeasurable`, never `clear`
 */
export async function readOrgHealth({
  home,
  nowMs,
  port,
}: {
  home: string;
  nowMs: number;
  port: OrgHealthPort;
}): Promise<MonitorReading> {
  const held = readHeldKeys({ definition: ORG_HEALTH, home });
  if (held.isErr()) {
    return { because: held.error, monitorId: "org-health", state: "unmeasurable" };
  }
  return evaluateOrgHealth({ ...held.value, nowMs, snapshot: await port.readSnapshot({ home }) });
}
