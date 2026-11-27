/**
 * What of the owner window a turn count could not read — said, so a gap never counts as "the owner said nothing".
 *
 * Four gaps: a chain journal line that will not decode, a supervisor pin that is there and will not read, a ruling
 * archive that would not read, and a Codex
 * chair inside the window whose rollout would not read whole (`./codexChairRead.ts` names why: no recorded home, no
 * rollout, two rollouts for one thread, a line it cannot place). A Codex chair whose rollout DID read contributes its
 * turns and no gap here. A Claude chair whose transcript will not read stays out of this line: the chain read returns
 * it as `unreadChairs` (`./intakeRead.ts`), which a reader discloses.
 *
 * A damaged pin is a gap, never absence: read as absent, a mixed-shape Codex pin let an older Claude chain link
 * stand as the whole window and read clean.
 */
import { readSupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import type { SupervisorLink } from "./chain.js";

/** The owner window over the chain: every link the journal holds, the home its pin lives in, and the floor. */
export interface ChainWindow {
  readonly chain: readonly SupervisorLink[];
  readonly home: string;
  readonly sinceIso: string;
}

/**
 * The window's gaps as one line, or nothing when the whole window read: a torn chain journal, an unreadable pin, what
 * of the ruling archive would not read, then every Codex chair in the window whose rollout would not read whole. All
 * of them at once, so one gap never hides which chair another one names.
 *
 * @param home the state home, where the pin lives
 * @param chainProblems each chain-journal line that would not decode
 * @param rulingProblems what of the ruling archive would not read
 * @param codexRefusals `chair codex:<id>: <why>` for each Codex chair whose rollout would not read
 * @returns every gap joined, or `undefined` when there is none
 */
export function ownerWindowGaps({
  home,
  chainProblems,
  rulingProblems,
  codexRefusals,
}: {
  home: string;
  chainProblems: readonly string[];
  rulingProblems: readonly string[];
  codexRefusals: readonly string[];
}): string | undefined {
  const chainGap =
    chainProblems.length === 0
      ? []
      : [`the supervisor chain journal would not read cleanly: ${chainProblems.join("; ")}`];
  const pin = readSupervisorPinDisposition({ home });
  const pinGap = pin.kind === "unreadable" ? [`supervisor pin: ${pin.why}`] : [];
  const rulingGap = rulingProblems.length === 0 ? [] : [`ruling archive: ${rulingProblems.join("; ")}`];
  const gaps = [...chainGap, ...pinGap, ...rulingGap, ...codexRefusals];
  return gaps.length === 0 ? undefined : gaps.join("; ");
}
