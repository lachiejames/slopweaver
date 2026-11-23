/**
 * The gate list an ANSWER send passes through, composed in one place, and what a verdict recorded about the
 * attached pictures — the half of the answer-send path that decides WHAT the door asks, never whether it sends.
 *
 * Split out of `./posterAnswer.ts`, which offers the answer to the door and sends it; that module imports
 * {@link answerGates} at its one door offer and {@link verdictImageObservations} where it settles attachments.
 */

import { answerQualityGate } from "../../admit/answerQualityGate.js";
import type { DeclinedAtlasReading } from "../../admit/declinedAtlasGate.js";
import { DEFAULT_GATES } from "../../admit/door.js";
import type { AttachedReviewImage } from "../../admit/imageObservationCoverage.js";
import { imageObservationGate } from "../../admit/imageObservationCoverage.js";
import { recordExactVoicePainPoints } from "../../admit/painPoint.js";
import type { ReviewVerdict } from "../../admit/reviewVerdict.js";
import type { DoorGate } from "../../admit/types.js";
import type { VoiceLaneInput } from "../../admit/voiceProfileGate.js";
import { type ReplyContext, type ReplyJudgement, withholdGate } from "../../admit/withhold.js";
import { installedTreeRoot } from "../../lib/pluginRoot.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import { ownerUserIdFromProfile } from "../../profileStore.js";
import { answerDigestOf } from "./answerDigest.js";
import { deterministicAnswerGates } from "./answerPreflight.js";
import { availableSkills } from "./skillCatalogue.js";

/**
 * The gates an ANSWER send passes, composed in one place.
 *
 * The reviewer gate sits BESIDE the whitelist gate rather than replacing it: one answers "may this person
 * be replied to", the other "has anybody but the author read this". Both must pass, and neither subsumes
 * the other. The core-deliverable gate is a third, orthogonal question — "does this answer hand back the
 * artifact its question asked for" — which a verdict cannot settle, because a reviewer that never looked
 * for the artifact returns `clean` without lying (measured: six such rounds in a row).
 *
 * Two more read the answer's own bytes against the monitor incident, and they are separate
 * questions rather than one: `../../admit/realArtifactGate.ts` asks whether an answer standing on a picture
 * the session DREW either links the real thing or says why it could not, and `../../admit/skillLoadGate.ts`
 * asks whether it loaded any procedure at all on a subject the skill catalogue plainly owns. The catalogue
 * is discovered HERE, at the gate list, for the same reason the owner is read here: the question "what could
 * this worker have loaded" is settled once, at the moment the list is built.
 *
 * The asker-tag gate is the last, and it is the only one about the answer's DELIVERY rather than its
 * contents: an answer nobody is notified of has not reached the person it was written for, however true it
 * is. `../../admit/askerTagGate.ts` carries the thread that measured it.
 *
 * The owner is read from `profile.json` HERE rather than passed in, for the reason `./posterFrame.ts`'s
 * `ownerTag` gives for its own single read: the one question this gate asks about the owner — "is the asker the owner?"
 * — is settled once, at the moment the gate list is built, so nothing can disagree with itself later.
 *
 * The VOICE gate is no longer composed here. It is a member of `./answerPreflight.ts`'s one shared list, so
 * the check that refuses this send is the same object that already refused the spawn of a reviewer over
 * these bytes — the seven-round deadlock measured in that module's header is what moved it. The rules and
 * the prose are still read at this moment, because the pain-point ledger below wants the findings whatever
 * the door decides next.
 *
 * @param answer the composed answer about to be sent
 * @param atlasReadings one grading per atlas the answer's blind spots named
 * @param attached the bytes in hand, each bound to its path and digest, that the image gate judges
 * @param home the resolved state home holding `profile.json`
 * @param judge the reply judgement the whitelist gate consults
 * @param mentions every mention key this send already resolved, key → Slack user id
 * @param reply the context this send is judged in — its asker and surface decide the tag duty
 * @param verdict the reviewing session's verdict, or `undefined` — which refuses rather than skips
 * @param voice the operator's exact rules over this answer's prose, read by the caller before anything settled
 * @returns the ordered gate list for this send
 */
export function answerGates({
  answer,
  atlasReadings,
  attached,
  home,
  judge,
  mentions,
  reply,
  verdict,
  voice,
}: {
  answer: AnswerFormAnswer;
  atlasReadings: readonly DeclinedAtlasReading[];
  attached: readonly AttachedReviewImage[];
  home: string;
  judge: ReplyJudgement;
  mentions: ResolvedMentions;
  reply: ReplyContext;
  verdict: ReviewVerdict | undefined;
  voice: VoiceLaneInput;
}): readonly DoorGate[] {
  // The bot's OWN answer is the lane `PainPointLane`'s `as-bot` arm exists for, and it was the one lane
  // still not writing one — the gate judged the answer and then forgot it, so the composing brief only ever
  // learned from what the operator wrote under their own name. Recorded whatever the door decides next: the
  // observation is about how this composer writes, not about whether this answer should go out.
  if (voice.findings.length > 0) {
    recordExactVoicePainPoints({ findings: voice.findings, home, lane: "as-bot", tsIso: new Date().toISOString() });
  }
  // An unset owner is absence by design (no profile names one yet), carried as the `undefined` the gate takes.
  const owner = ownerUserIdFromProfile({ home });
  let ownerUserId: string | undefined;
  if (owner !== null) {
    ownerUserId = owner;
  }
  return [
    ...DEFAULT_GATES,
    withholdGate({ judge }),
    // The same list `turn review` runs before it spawns a reviewer — one definition, so a pre-flight can
    // never pass something this door then refuses. See `./answerPreflight.ts` for why both run it, and for
    // the seven-round deadlock that moved the VOICE gate into that list rather than leaving it here.
    ...deterministicAnswerGates({
      answer,
      askedBy: reply.askedBy,
      atlasReadings,
      mentions,
      ownerUserId,
      question: reply.question,
      skills: availableSkills({ home, repoRoot: installedTreeRoot({ importMetaUrl: import.meta.url }) }),
      surface: reply.surface,
      voice: voice.gate,
    }),
    answerQualityGate({ answerDigest: answerDigestOf({ answer }), verdict }),
    // Composed even when no verdict arrived: `answerQualityGate` already refuses an unreviewed answer, and
    // an answer released on that gate's token must still not carry a picture nobody has looked at. Judged
    // against the digests of the bytes in hand, never against the answer — `images` are path strings, so
    // the answer digest a verdict binds to cannot see a picture being swapped at a reviewed path.
    imageObservationGate({ attached, observations: verdictImageObservations({ verdict }) }),
  ];
}

/**
 * What the reviewer recorded about the attached pictures. None when no verdict arrived — nobody reviewed
 * anything, and `answerQualityGate` refuses that send on its own — and none when the verdict left
 * `imageObservations` out, which `ReviewVerdict.imageObservations` defines as the empty list.
 *
 * @param verdict the reviewing session's verdict, or `undefined` when none arrived
 * @returns the recorded observations, or the empty list for either absence
 */
export function verdictImageObservations({
  verdict,
}: {
  verdict: ReviewVerdict | undefined;
}): NonNullable<ReviewVerdict["imageObservations"]> {
  if (verdict == null) {
    return [];
  }
  const { imageObservations } = verdict;
  if (imageObservations == null) {
    return [];
  }
  return imageObservations;
}
