/**
 * A verdict about ONE answer, composed by a session that did not write it.
 *
 * ## Why a verdict is an input rather than something the door computes
 *
 * The owner has asked for this four separate times: it is hard to tell when you are wrong but easy to tell
 * when someone else is, so the self checker is a different agent. Rule 2 forbids this program spawning that agent — no invisible model runner, anywhere — so the
 * reviewer cannot be something the door calls. It has to be a second visible session, and what reaches the
 * door is the artifact that session composed.
 *
 * That is the same shape `turn answer` already proves: a session composes, a verb validates. The door's job
 * here is not to judge the answer. It is to refuse to send one whose verdict is missing, stale, self-issued,
 * or bad — which is a set of checkable facts, not a judgement.
 *
 * ## What makes it checkable rather than a rubber stamp
 *
 * A verdict that could be attached to any answer would be decoration. Three fields stop that:
 *
 * - **`answerDigest`** binds it to the exact bytes reviewed. Edit the answer after review and the binding
 *   breaks, which is the point — a verdict for a previous draft is worse than none, because it reads as
 *   diligence.
 * - **`authorSession` and `reviewerSession`** must DIFFER. This does not authenticate either one; the wire
 *   carries no session identity anything here could verify (see `.claude/rules/cross-session-messages.md`).
 *   What it does is make grading your own homework something a session has to state in a field rather than
 *   do silently — and a stated lie is auditable in a way a silent one is not.
 * - **`claims`** turns "is this good?" into a list of things each of which is supported or is not.
 *
 * ## No confidence percentage, deliberately
 *
 * The owner's rule: a percentage of confidence an AI calculates for itself is always misleading and a bad
 * idea. So there is no score here and no threshold expressed as one. The bar is
 * structural — every material claim classified, and no unresolved high-impact claim — which is a property a
 * reader can check by looking, rather than a number they have to trust.
 */

import type { ImageFailureReason, TargetState } from "../visualEvidence/types.js";

/** How well the evidence backs one claim. `unverifiable` is a real answer, not a failure to try. */
type ClaimSupport = "supported" | "unsupported" | "unverifiable";

/**
 * How much the answer rests on this claim.
 *
 * Two values rather than a scale, because the only decision it drives is binary — does an unresolved one
 * block the send — and a finer scale would invite the reviewer to split the difference on exactly the
 * claims where splitting the difference is the failure.
 */
type ClaimImpact = "high" | "low";

/**
 * What a claim's truth depends on, declared by the REVIEWER — the one party that knows where it looked.
 *
 * `answer` means the claim is settled by the answer's own bytes and by sources that cannot change behind it:
 * an internal contradiction, a count against a table, a citation's shape, a rule about the composed text.
 * `live` means it rests on something that can move without the answer moving — provider state, a thread, a
 * URL's contents, a file at a path, anything read from the world at review time.
 *
 * The distinction decides HOW a later round carries a settled claim instead of re-deriving it. An `answer`
 * claim is carried as SETTLED — the previous support is evidence the next round may reuse once it has checked
 * that the bytes it rests on did not move. A `live` claim is never carried as settled, because an unchanged
 * answer is not an unchanged world; it is carried as a RE-READ instead, when the reviewer also wrote
 * {@link ReviewedClaim.readCommand} and {@link ReviewedClaim.readAtIso}, so the next round re-runs one read
 * rather than rediscovering that the claim exists, what settles it and how to look. Measured before the
 * carry shipped, 93% of every re-review round re-covered ground the previous round had already settled; measured
 * again with the settled carry shipped, 1,501 of 1,913 claims rested on live state and the
 * median verdict settled seven high-impact live claims that the next round derived again from nothing
 * (`../live/turn/reviewRounds.ts` carries the repro).
 *
 * Absent is deliberately legal and means `live`. A reviewer that does not declare gets no settled reuse,
 * which is the correct failure direction, and a verdict written against an older packet stays readable.
 */
type ClaimRestsOn = "answer" | "live";

/** One claim the answer makes, and what the reviewer found when they went looking. */
export interface ReviewedClaim {
  readonly text: string;
  readonly support: ClaimSupport;
  readonly impact: ClaimImpact;
  /** Where the reviewer looked. Required for `supported` — a bare "yes" is not a review. */
  readonly evidence?: string;
  /** What this claim's truth depends on. Absent means {@link ClaimRestsOn}'s `live`: never carried settled. */
  readonly restsOn?: ClaimRestsOn;
  /**
   * The exact query or command that read the live state this claim rests on — a `slopweaver` verb with its
   * arguments, a search string, a URL — runnable by the next round as written. Measured: live
   * evidence averaged 508 characters of prose that usually NAMED its read, and two extractors written against
   * it both misclassified evidence that plainly did; a field is the only shape a later round can re-run. A
   * `live` claim carrying this and {@link readAtIso} is carried forward as a re-read; one without is
   * rediscovered from nothing. Present only together with {@link readAtIso} — the parser refuses one alone.
   */
  readonly readCommand?: string;
  /** The instant that read ran, ISO 8601, so the next round knows how stale the previous read is. */
  readonly readAtIso?: string;
}

/** The reviewer's overall finding, kept separate from the per-claim detail it must agree with. */
export type ReviewOutcome = "clean" | "broken" | "incomplete";

/**
 * What a reviewer saw when it opened ONE attached image, bound to that image's own bytes.
 *
 * ## The measured gap, and why a claim could not close it
 *
 * The bot posted two full-page Datadog screenshots into the owner's DM, unreadable
 * as thumbnails, one photographed before its panel had rendered. Six review rounds passed it clean. Round
 * 4's reviewer DID open a PNG and wrote this, verbatim — `support: supported`, `impact: low`:
 *
 * > "the two attached datadog screenshots show what the present-state claims say they show"
 *
 * It was right. It asked whether the picture backed the claim and answered correctly, because the facet
 * sidebar it read its numbers from had rendered fine. It never asked whether a human could READ the
 * picture in Slack, because {@link ReviewedClaim} has no vocabulary for that question and the packet did
 * not put it. And the verdict had no field for what a reviewer saw in an image at all — so "opened it" and
 * "read the path and moved on" were byte-identical in the record, and nothing downstream could tell them
 * apart.
 *
 * ## Bound to the BYTES, which is what a claim about an image could never be
 *
 * `answerDigestOf` (`../live/turn/posterAnswer.ts`) hashes `JSON.stringify(answer)` and an answer's
 * `images` are path strings, so the reviewed answer digest covers the PATHS and never the picture. Replace
 * the PNG at a reviewed path and every verdict about it still binds. {@link artifactDigest} is what closes
 * that: coverage is checked against the digests of the bytes the send is actually carrying, so a swapped
 * image is a `stale` observation rather than a covered one.
 *
 * **It is an attestation, not proof that eyes saw pixels** — the same limit
 * `../visualEvidence/types.ts`'s `ImageRecord` states about itself. Nothing here authenticates the
 * reviewing session or watches it open a file. What it buys is that the claim is bound to specific bytes,
 * checkable against them, and refusable — so a wrong one is visible afterwards instead of absent.
 */
export interface ReviewedImage {
  /** The attachment's path, exactly as the answer's `images` names it. Half of the coverage pair. */
  readonly path: string;
  /** `sha256:<64 hex>` over the image's bytes, as the review packet printed it. The other half. */
  readonly artifactDigest: string;
  /** Concrete content actually visible — values, labels, the query string. Never "looks fine". */
  readonly observedContent: string;
  /** Whether the thing the answer's claim rests on had RENDERED in this picture. */
  readonly targetState: TargetState;
  /** Whether a reader can check the claim at the size Slack renders the preview — not zoomed, not opened. */
  readonly legible: boolean;
  /** Whether the context that claim needs — axes, query, time range — is still in frame. */
  readonly contextRetained: boolean;
  /** Which closed reason this image is unfit for. Required when any of the three fields above says it is. */
  readonly unfitReason?: ImageFailureReason;
}

/**
 * One rule the answer breaks, as the reviewer found it — the rule and the field, never the words.
 *
 * Split into two fields rather than left as a sentence for the reason `./voiceProfileGate.ts` states about
 * its own findings: `./ledger.ts` records every finding's summary in the door ledger (`door_event`), and a
 * free-prose violation line is how the offending sentence ends up copied into it. A rule name
 * and a path are enough to act on and carry none of the message.
 */
export interface ReviewedVoiceViolation {
  /** The rule as section 9 of the packet NAMED it, copied rather than paraphrased. */
  readonly rule: string;
  /** Which rendered string broke it — `lead`, `body[2].runs[0]`, `grounding.read[0].label`. */
  readonly path: string;
}

/**
 * What the reviewer did about voice, as a field rather than as one claim among claims.
 *
 * ## The measured gap this closes
 *
 * Section 9 of the packet names the owner's rules one per line, and asks the reviewer
 * to make voice "one more MATERIAL claim". That is still the right instruction and it stays. What it cannot
 * do is make the ANSWER checkable: a reviewer that read every rule against every rendered string and a
 * reviewer that classified a claim reading `the answer obeys every voice rule above` without opening one
 * produce verdicts that are byte-identical in the record, so nothing downstream can tell them apart — the
 * same shape {@link ReviewedImage} was introduced to close for attachments, and for the same reason.
 *
 * It is an attestation, not proof a reviewer looked. Nothing here authenticates the reviewing session. What
 * it buys is that not looking has to be STATED in a field — `pathsChecked` empty, or the whole field absent —
 * rather than being indistinguishable from looking, which is what `./answerQualityGate.ts` then refuses on.
 */
export interface ReviewedVoice {
  /** How many named rules section 9 put in front of this reviewer. Zero is a real answer — no profile loaded. */
  readonly rulesChecked: number;
  /**
   * Which of the answer's own rendered strings were read against them, by PATH.
   *
   * The grounding's evidence labels and `couldNotSee` text belong here alongside the lead, the index and the
   * body: they render in the Details fold and are authored prose like everything else. Measured,
   * five of eight violations in one posted answer were in that evidence trail and none was in the lead.
   */
  readonly pathsChecked: readonly string[];
  /** One entry per rule the answer breaks. Empty means every rule above was checked and none fired. */
  readonly violations: readonly ReviewedVoiceViolation[];
}

/** What a reviewing session hands the door about one answer. */
export interface ReviewVerdict {
  readonly schemaVersion: 1;
  /** sha256 of the exact answer text reviewed, `sha256:<64 hex>`. */
  readonly answerDigest: string;
  readonly authorSession: string;
  readonly reviewerSession: string;
  readonly claims: readonly ReviewedClaim[];
  readonly outcome: ReviewOutcome;
  /**
   * One {@link ReviewedImage} per attached image, in any order.
   *
   * Absent means the empty list, for the same reason {@link ClaimRestsOn}'s absence means `live`: a verdict
   * written against an older packet stays readable, and the failure direction is the correct one. An answer
   * carrying no images then has exact coverage by construction, while an image-bearing answer whose verdict
   * predates this field acquires a missing-coverage finding at the send boundary rather than passing
   * silently. Requiring it would refuse harmless text-only verdicts without covering one more image.
   */
  readonly imageObservations?: readonly ReviewedImage[];
  /**
   * What the reviewer did about voice.
   *
   * Absent is legal so a verdict written against an older packet still parses, and it is NOT read as "no
   * violations" — `./answerQualityGate.ts` raises its own finding on the absence. That is the opposite
   * default to {@link imageObservations}, deliberately: an answer with no images genuinely has nothing to
   * observe, while every answer that reaches the door has rendered strings in it, so silence about voice is
   * always a reviewer that did not say, never a subject that was not there.
   */
  readonly voice?: ReviewedVoice;
  /**
   * What the reviewer judged about DELETING the answer this one supersedes.
   *
   * Absent means no reviewer looked, and the supersession is refused on that
   * (`../live/turn/supersession/eligibility.ts`'s `UNREVIEWED`). It is the same default as
   * {@link imageObservations} in shape and the opposite one in effect: an absent list there means a covered
   * answer, and absence here means a delete that does not happen. The asymmetry is the act — an unobserved
   * image is a gap in a record, an unreviewed delete is a message nobody can restore.
   *
   * It is on the VERDICT rather than on the answer form because the form is what the answering session
   * wrote, and a turn authorising its own destructive act is the thing this field exists to prevent. The
   * form's `supersedes` says what the composer INTENDS; this says a second session looked at both messages
   * and agrees. Both must name the same timestamp or nothing is deleted.
   */
  readonly supersession?: ReviewedSupersession;
}

/**
 * A reviewer's judgement about one supersession — the second of the two independent declarations a delete
 * needs.
 *
 * `warranted: false` is a real finding rather than an absent one, and it is worth carrying: a reviewer that
 * looked at both messages and concluded the follow-up is ADDITIVE has answered the question, and the
 * journal records that answer. Collapsing it into absence would make "nobody checked" and "checked, and no"
 * the same row.
 */
export interface ReviewedSupersession {
  /** The exact message the reviewer opened and judged — it must match the answer form's own `supersedes`. */
  readonly targetTs: string;
  /** Whether removing it is warranted: does the new answer REPLACE a central claim of that one? */
  readonly warranted: boolean;
  /** Why, in the reviewer's own words. Journalled on both arms, so a refusal is as legible as a delete. */
  readonly reason: string;
}
