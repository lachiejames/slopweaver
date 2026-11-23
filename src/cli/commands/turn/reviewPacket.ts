/*
 * Composing one round's reviewer packet, and writing the record that round is known by.
 *
 * Split from the open mode because the two answer different questions: this file decides WHAT the reviewer
 * reads and what the round inherits, while `./reviewOpen.js` decides when a reviewer is booted and in what
 * order the boot, the record and the pickup happen. Neither reading mode imports this file.
 */
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { JudgementProfile } from "../../../live/turn/judgementProfile.js";
import {
  REVIEW_RECORD_SCHEMA_VERSION,
  type ReviewRecord,
  reviewerPacket,
  reviewPartyName,
} from "../../../live/turn/review.js";
import type { ReviewPacketImage } from "../../../live/turn/reviewImages.js";
import { type CarriedForward, carriedForwardOf } from "../../../live/turn/reviewRounds.js";
import {
  previousAnswerChanges,
  readReviewRecord,
  readVerdictFile,
  reviewPaths,
  writeReview,
} from "../../../live/turn/reviewStore.js";
import type { FreshVisibleSessionRef } from "../../../live/turn/tier.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import type { ReviewSubject } from "./reviewSubject.js";

/*
 * Written as an early return rather than `profile?.voice.principles ?? []` because `no-silent-fallback`
 * refuses the `??`, and oxlint's `prefer-nullish-coalescing` refuses both the ternary and the let-reassign
 * spelling of the same idea — a returning statement is what satisfies both gates (`resolveHome`,
 * `src/cli/optionParsers.ts`, carries the measurement). An absent profile is a turn with no mined voice,
 * which is a real state and not an error, so the empty list is named here rather than inline at the call.
 */
function voicePrinciplesOf({ profile }: { profile: JudgementProfile | undefined }): readonly string[] {
  if (profile === undefined) {
    return [];
  }
  return profile.voice.principles;
}

/**
 * What the incoming round inherits from the one it replaces, read BEFORE anything is archived or overwritten.
 *
 * The outgoing record is where the round number comes from, and the verdict still sitting at the fixed path is
 * where the unresolved claims come from — but only when it is that reviewer's OWN verdict, which is exactly
 * what `readVerdictFile` classifies. A `superseded` file belongs to a round further back and is not evidence
 * about the round now ending.
 *
 * @param askIdentity which ask's outgoing round to read
 * @param home the state home the review lives under
 * @returns the round number and claims the incoming round carries forward
 */
export function inheritedRound({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): CarriedForward {
  const outgoing = readReviewRecord({ askIdentity, home });
  if (outgoing === undefined) {
    return carriedForwardOf({ outgoing: undefined, previousVerdict: undefined });
  }
  const read = readVerdictFile({ record: outgoing });
  return carriedForwardOf({
    outgoing,
    previousVerdict: read.kind === "present" ? read.verdict : undefined,
  });
}

/**
 * Compose the packet this round's reviewer reads.
 *
 * Its own function so {@link recordReview} stays the record it writes: composing is seventeen inputs and
 * writing is two, and holding both in one body is what pushed it past the length a reader keeps.
 *
 * @param answer the composed answer being reviewed
 * @param answerDigest the digest the verdict must bind to
 * @param home the resolved state home, for reading the previous round's answer
 * @param images the resolved attachment inventory
 * @param inherited what the previous round settled and left open
 * @param reviewerSession how this reviewer is named in the record
 * @param spawnedAt when this round's reviewer was booted, for the packet's clock
 * @param subject the ask, its brief and the decision that dispatched it
 * @param verdictPath where the reviewer must write
 * @returns the packet text
 */
function packetFor({
  answer,
  answerDigest,
  home,
  images,
  inherited,
  reviewerSession,
  spawnedAt,
  subject,
  verdictPath,
}: {
  answer: AnswerFormAnswer;
  answerDigest: string;
  home: string;
  images: readonly ReviewPacketImage[];
  inherited: CarriedForward;
  reviewerSession: string;
  spawnedAt: string;
  subject: ReviewSubject;
  verdictPath: string;
}): string {
  const { ownerDirectives = [], profile } = subject.brief.routingInput;
  return reviewerPacket({
    answer,
    answerDigest,
    askIdentity: subject.askIdentity,
    askPermalink: subject.askPermalink,
    authorSession: subject.authorSession,
    briefPath: subject.briefPath,
    carriedReads: inherited.carriedReads,
    carriedSettled: inherited.carriedSettled,
    carriedUnresolved: inherited.carriedUnresolved,
    changes: previousAnswerChanges({ answer, askIdentity: subject.askIdentity, home, inherited }),
    clock: { reviewStartedAt: inherited.reviewStartedAt, spawnedAt },
    decision: subject.decision,
    images,
    ownerDirectiveCount: ownerDirectives.length,
    question: subject.brief.question,
    reviewerSession,
    round: inherited.round,
    verdictPath,
    voicePrinciples: voicePrinciplesOf({ profile }),
  });
}

/** Persist the packet and the record for a booted reviewer — BEFORE its pickup line, so a fast reviewer never reads a path that is not there yet. */
export function recordReview({
  answer,
  answerDigest,
  answerPath,
  home,
  images,
  inherited,
  reviewer,
  spawnedAt,
  subject,
}: {
  answer: AnswerFormAnswer;
  answerDigest: string;
  answerPath: string;
  home: string;
  images: readonly ReviewPacketImage[];
  inherited: CarriedForward;
  reviewer: FreshVisibleSessionRef;
  spawnedAt: string;
  subject: ReviewSubject;
}): void {
  const paths = reviewPaths({ askIdentity: subject.askIdentity, home });
  const reviewerSession = reviewPartyName({ role: "reviewer", session: reviewer });
  const record: ReviewRecord = {
    ...subject.askIdentity,
    answerDigest,
    answerPath,
    authorSession: subject.authorSession,
    carriedUnresolved: inherited.carriedUnresolved,
    packetPath: paths.packet,
    reviewer,
    reviewerSession,
    reviewStartedAt: inherited.round === 1 ? spawnedAt : inherited.reviewStartedAt,
    round: inherited.round,
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    spawnedAt,
    verdictPath: paths.verdict,
  };
  writeReview({
    home,
    packet: packetFor({
      answer,
      answerDigest,
      home,
      images,
      inherited,
      reviewerSession,
      spawnedAt,
      subject,
      verdictPath: paths.verdict,
    }),
    record,
  });
}
