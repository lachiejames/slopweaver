/**
 * The gate's verdict on one `relay_steer` call, and the wire it forms: shut with the sentence the model is handed, or
 * accepted with what its lines show. Split from `relayAttempt.ts` to keep it under the line cap.
 */
import type { DiscussFirstWire } from "../../lib/discussFirst";
import { type GateEntry, offeredSince, relayVerdict } from "../../lib/relayGate";
import type { RelayWorkspace } from "../../lib/relayWorkspace";
import type { CandidateRulingWire, TalkRelayWire } from "../../lib/talkRelayRequestWire";
import type { TriageRulingWire } from "../../lib/triageWords";
import type { CheckInVerdict } from "./talkToolRunArgs";

/**
 * A heard-only relay's line, in the slot the voice's reading fills. It names no read. Measured: the slot drew
 * "(dropped — the voice read context_pack, web_search, code_mode, collaboration …)", the tools it read after the
 * owner spoke, on every relay, and it was taken for the voice reciting a tool inventory. The reads stay on the wire
 * and in `talk log`.
 */
export const HEARD_ONLY_SAY = "(dropped: only the owner's words were sent)";

/** What the gate made of one `relay_steer` call: shut with the sentence the model is handed, or the wire to post. */
export type RelayAccept =
  | { readonly kind: "shut"; readonly why: string }
  | {
      readonly kind: "accepted";
      readonly wire: TalkRelayWire;
      /** The owner's words since the last relay, which the relay's lines show. */
      readonly heard: string;
      /** The voice's reading as the lines show it, or why it was dropped. */
      readonly shownSay: string;
    };

/**
 * The gate's verdict on one `relay_steer` call, and the wire it forms. After a read, only the owner's words travel: the
 * voice's reading is not sent at all, and the line says why.
 *
 * @param log the session's record up to this call
 * @param standing third-party data the session carries from its start
 * @param say the voice's reading of the owner's steer
 * @param about the card the owner's words began over, or a check-in's act key when they are a verdict on one
 * @param alsoAnswers the other Queue cards the owner's words answer, each already held to what this call served them
 * @param picture the frame the relay carries, or why none
 * @param turnId the id this relay's turn is claimed under
 * @param checkIn the check-in the owner's words are a verdict on, when they are one
 * @param candidateRuling the workstream candidate the owner's words rule on, when they do
 * @param triageRuling the owner's verdict and label on the card a triage pass has open, when their words rule it
 * @param workspace whose work the owner's words are, as the page placed them, or `undefined` to state none
 * @param discussFirst the discuss-first question this relay puts, or carries the owner's ask past, when it names a team fix
 * @param micAhead the owner's microphone was audible after their latest words reached the page, so speech is in flight
 *   (`micAheadOfWords`, `site/lib/voiceTurnTaking.ts`): the relay is `cut` whatever the log says, never the reverse
 * @returns shut with the gate's sentence, or the wire to post and what its lines show
 */
export function acceptRelay({
  log,
  micAhead,
  standing,
  say,
  about,
  alsoAnswers,
  picture,
  turnId,
  checkIn,
  candidateRuling,
  triageRuling,
  workspace,
  discussFirst,
}: {
  log: readonly GateEntry[];
  micAhead: boolean;
  standing: readonly string[];
  say: string;
  about: string;
  alsoAnswers: readonly string[];
  picture: TalkRelayWire["screen"];
  turnId: string;
  checkIn: CheckInVerdict | undefined;
  candidateRuling: CandidateRulingWire | undefined;
  triageRuling: TriageRulingWire | undefined;
  workspace: RelayWorkspace | undefined;
  discussFirst: DiscussFirstWire | undefined;
}): RelayAccept {
  const verdict = relayVerdict({ log, standing });
  if (verdict.kind === "shut") {
    return { kind: "shut", why: verdict.why };
  }
  // The tray's newest offer since the last relay rides in every mode, heard-only included: it is the exact text the
  // owner reacted to, which the page recorded as it landed, and their words beside it say what they made of it.
  const offered = offeredSince({ log });
  let readsAfter: readonly string[] = [];
  let shownSay = say;
  if (verdict.mode.kind === "heard-only") {
    readsAfter = verdict.mode.readsAfter;
    shownSay = HEARD_ONLY_SAY;
  }
  const wire: TalkRelayWire = {
    about,
    heard: verdict.heard,
    heardTail: micAhead ? "cut" : verdict.heardTail,
    readsAfter,
    screen: picture,
    turnId,
    ...(verdict.mode.kind === "full" ? { say } : {}),
    ...(alsoAnswers.length === 0 ? {} : { alsoAnswers }),
    ...(checkIn === undefined ? {} : { covers: checkIn.covers }),
    ...candidateRuling,
    ...triageFields({ ruling: triageRuling }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(offered === undefined ? {} : { offered }),
    ...(discussFirst === undefined ? {} : { discussFirst }),
  };
  return { heard: verdict.heard, kind: "accepted", shownSay, wire };
}

/**
 * A triage ruling's wire fields: the verdict, the label only when the owner gave one, and the feedback only when they named it.
 *
 * @returns the fields to spread into the wire, none when the relay carries no triage ruling
 */
function triageFields({
  ruling,
}: {
  ruling: TriageRulingWire | undefined;
}): Pick<TalkRelayWire, "feedback" | "triage" | "label"> {
  if (ruling === undefined) {
    return {};
  }
  const label = ruling.label === undefined ? {} : { label: ruling.label };
  const feedback = ruling.feedback === undefined ? {} : { feedback: ruling.feedback };
  return { triage: ruling.verdict, ...label, ...feedback };
}
