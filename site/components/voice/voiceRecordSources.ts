/**
 * The record channels the voice's Queue answer reads, each with the reader its tile already uses: one table, so the
 * page's subscriptions (`./useVoiceReadings.ts`) and the fresh read a Queue tool makes (`./freshVoiceRecord.ts`) can
 * never disagree on which slug or which reader makes a reading. The slugs are the server's too
 * (`../../lib/voiceRecordRead.ts`), so the route reads exactly what this table parses.
 *
 * The voice reads the record, never the page's loaded copy.
 */
import { VOICE_RECORD_SLUGS } from "../../lib/voiceRecordRead";
import { readWorkstreamsReading } from "../../lib/workstreamsReading";
import { readBoard, readHandSteps } from "../live/read";
import { readAutonomy } from "../live/readAutonomy";
import { readCardDeferrals } from "../live/readCardDeferrals";
import { readCardLandings } from "../live/readCardLandings";
import { readCurrencyReading } from "../live/readCurrency";
import { readImportQuestions } from "../live/readImportQuestions";
import { readLandingReading } from "../live/readLanding";
import { readParkedReviews } from "../live/readReviewDrafts";
import { readReviewers } from "../live/readReviewers";
import { readParkedDrafts } from "../live/readSlackDrafts";
import { readStandingAsks } from "../live/readStandingAsks";
import { readSteeredCards } from "../live/readSteeredCards";
import { readHeldDrafts } from "../live/readThread";
import type { LiveState } from "../live/useLive";

/**
 * Each reading the Queue answer takes, keyed as `ActionItemReadings` keys it, with its live slug and reader. `steers`
 * is the `talk steers` reading the steer overlay is rebuilt from, not the overlay itself.
 */
export const VOICE_RECORD_SOURCES = {
  acts: { read: readAutonomy, slug: VOICE_RECORD_SLUGS.acts },
  board: { read: readBoard, slug: VOICE_RECORD_SLUGS.board },
  currency: { read: readCurrencyReading, slug: VOICE_RECORD_SLUGS.currency },
  deferrals: { read: readCardDeferrals, slug: VOICE_RECORD_SLUGS.deferrals },
  drafts: { read: readHeldDrafts, slug: VOICE_RECORD_SLUGS.drafts },
  hands: { read: readHandSteps, slug: VOICE_RECORD_SLUGS.hands },
  imports: { read: readImportQuestions, slug: VOICE_RECORD_SLUGS.imports },
  landing: { read: readLandingReading, slug: VOICE_RECORD_SLUGS.landing },
  posts: { read: readParkedDrafts, slug: VOICE_RECORD_SLUGS.posts },
  reviewers: { read: readReviewers, slug: VOICE_RECORD_SLUGS.reviewers },
  reviews: { read: readParkedReviews, slug: VOICE_RECORD_SLUGS.reviews },
  spoken: { read: readCardLandings, slug: VOICE_RECORD_SLUGS.spoken },
  standing: { read: readStandingAsks, slug: VOICE_RECORD_SLUGS.standing },
  steers: { read: readSteeredCards, slug: VOICE_RECORD_SLUGS.steers },
  workstreams: {
    read: (payload: unknown) => readWorkstreamsReading({ payload }),
    slug: VOICE_RECORD_SLUGS.workstreams,
  },
} as const;

/** The sources, by key. */
export type VoiceRecordSources = typeof VOICE_RECORD_SOURCES;

/** One fresh read of every source: each its own state, a source that could not be read `not-measured` with why. */
export type VoiceRecord = {
  readonly [K in keyof VoiceRecordSources]: LiveState<NonNullable<ReturnType<VoiceRecordSources[K]["read"]>>>;
};
