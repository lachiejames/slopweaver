/**
 * What of the owner window a turn count could not read — said, so a gap never counts as "the owner said nothing".
 *
 * Three gaps: a supervisor pin that is there and will not read, a ruling archive that would not read, and a Codex
 * chair inside the window, whose rollout no reader opens yet (slice 4b-ii). The chain turn read skips a Codex chair, so without this a window held only by Codex
 * counted zero turns and read clean. A Claude chair whose transcript will not read stays out of
 * this line: the chain read returns it as `unreadChairs` (`./intakeRead.ts`), which a reader discloses.
 *
 * A damaged pin is a gap, never absence: read as absent, a mixed-shape Codex pin let an older Claude chain link
 * stand as the whole window and read clean.
 */
import { readSupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import { CODEX_CHAIR_UNREAD, codexChairsInWindow, type SupervisorLink } from "./chain.js";
import { pinAsLink } from "./intakeScope.js";
import { supervisorSessionLabel } from "./session.js";

/** The owner window over the chain: every link the journal holds, the home its pin lives in, and the floor. */
export interface ChainWindow {
  readonly chain: readonly SupervisorLink[];
  readonly home: string;
  readonly sinceIso: string;
}

/**
 * The window's gaps as one line, or nothing when the whole window read: what of the ruling archive would not read,
 * then every Codex chair holding the pin at or after the floor, the live pin's included, as `codexChairsInWindow`
 * judges it on tenures — a retaken or malformed-instant Codex chair would otherwise read as zero turns.
 *
 * @returns every gap joined, or `undefined` when there is none
 */
export function ownerWindowGaps({
  home,
  chain,
  sinceIso,
  rulingProblems,
}: ChainWindow & { rulingProblems: readonly string[] }): string | undefined {
  const pinned = pinAsLink({ home });
  const codex = codexChairsInWindow({ links: [...chain, ...pinned], pinned, sinceIso }).map(
    (link) => `chair ${supervisorSessionLabel({ session: link.session })}: ${CODEX_CHAIR_UNREAD}`,
  );
  const pin = readSupervisorPinDisposition({ home });
  const pinGap = pin.kind === "unreadable" ? [`supervisor pin: ${pin.why}`] : [];
  const rulingGap = rulingProblems.length === 0 ? [] : [`ruling archive: ${rulingProblems.join("; ")}`];
  const gaps = [...pinGap, ...rulingGap, ...codex];
  return gaps.length === 0 ? undefined : gaps.join("; ");
}
