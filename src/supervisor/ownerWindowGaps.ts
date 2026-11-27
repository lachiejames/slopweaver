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
 * stand as the whole window and read clean. Its gap names every session the record names, without picking one, so a
 * takeover refusal says whose turns went unread rather than only that the pin would not read.
 */
import { readSupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import type { SupervisorLink } from "./chain.js";
import { supervisorSessionLabel } from "./session.js";

/** The owner window over the chain: every link the journal holds, the home its pin lives in, and the floor. */
export interface ChainWindow {
  readonly chain: readonly SupervisorLink[];
  readonly home: string;
  readonly sinceIso: string;
}

/**
 * The gap an untrusted pin leaves, naming every session its record names so a chair knows whose turns went unread.
 * Those names never reach a chair read: an untrusted record proves neither which of them held the chair nor for how
 * long, so it is said as a candidate list rather than a tenure.
 */
function unreadablePinGap({ home }: { home: string }): readonly string[] {
  const pin = readSupervisorPinDisposition({ home });
  if (pin.kind !== "unreadable") {
    return [];
  }
  if (pin.named.length === 0) {
    return [`supervisor pin: ${pin.why}`];
  }
  const labels = pin.named.map((session) => supervisorSessionLabel({ session })).join(", ");
  return [
    `supervisor pin: ${pin.why}; it names ${labels}, but the unreadable record does not establish which session held the chair`,
  ];
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
  const pinGap = unreadablePinGap({ home });
  const rulingGap = rulingProblems.length === 0 ? [] : [`ruling archive: ${rulingProblems.join("; ")}`];
  const gaps = [...chainGap, ...pinGap, ...rulingGap, ...codexRefusals];
  return gaps.length === 0 ? undefined : gaps.join("; ");
}
