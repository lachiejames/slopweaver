/**
 * The lane shape's one effectful read: the plan register through its port, judged at one instant.
 *
 * Every consumer (the chair gate, `plans list`, the idle-capacity gate) reads through here or through
 * `laneShapeReadOf`, so an unreadable register reaches all of them as the same `unreadable` arm and each keeps
 * today's fill behaviour on it, saying why, rather than one consumer switching on silence while another does not
 * (`./laneShape.ts`).
 */
import { type LaneShapeRead, laneShapeReadOf } from "./laneShape.js";
import type { PlanRegisterRead } from "./port.js";

/**
 * Read and judge both lanes.
 *
 * @param home the Slopweaver home whose register is read
 * @param nowIso the observation instant
 * @param read the register port's read, injected so a test reads a register it built
 * @returns the judged lanes, or why the register could not be read or judged
 */
export async function readLaneShapes({
  home,
  nowIso,
  read,
}: {
  home: string;
  nowIso: string;
  read: PlanRegisterRead;
}): Promise<LaneShapeRead> {
  const snapshot = await read({ home });
  if (snapshot.isErr()) {
    return { kind: "unreadable", why: `the plan register could not be read (${snapshot.error.message})` };
  }
  return laneShapeReadOf({ nowIso, plans: snapshot.value.plans });
}
