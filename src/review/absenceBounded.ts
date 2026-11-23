/**
 * When an absence of Slack evidence may be reported as one — the corpus watermark against the pull request, and
 * the live leg against the watermark. Split from `./reviewState.ts`, which composes it into the Slack answer.
 */
import { calendarInstantMs, type SlackCoverage } from "./slackEvidenceTypes.js";

/**
 * Whether an ABSENCE of Slack evidence may be reported as an absence at all.
 *
 * **Only the CORPUS leg can establish a `no`.** The rule is stated as a rule
 * rather than a patch, because a live leg that under-counts by design cannot carry an absence.
 *
 * Slack's `search.messages` collapses proximate matches by documentation — "when a search query matches
 * multiple messages in close proximity to one another, only one match will be returned" — and WHICH one it
 * returns is not stable. Measured on one pull request: two messages minutes apart in the same channel both
 * linked it, the search returned one, and a later identical query returned the OTHER. The verb saw the
 * message that carried no mention run, and reported "nobody has been asked" about a pull request the owner
 * had asked two named people to review that morning. `liveRan` does not reach the
 * clock, and a leg that under-counts by design can never carry an absence.
 *
 * So the live leg contributes POSITIVE findings only, and the exhaustive line-by-line corpus scan — which
 * has no collapsing — is what a `no` rests on. Two consequences, both deliberate:
 *
 *  - A stale corpus now yields `unknown` where it used to yield `no`. That is the honest answer, and it
 *    makes `slopweaver refresh --source slack` the thing that buys a confident absence.
 *  - **A live match NEWER than the corpus watermark proves the window is behind**, whatever the watermark
 *    comparison says, so it forces `unknown` on its own. The read checks itself rather than trusting a
 *    stamp.
 *
 * ## The one thing a read-around changes, and the one it does not
 *
 * The second bullet is about the live leg's UNDER-COUNT, not about the watermark, so it is repairable
 * without a refresh: `./slackNeighbourhood.ts` goes back to the hit's own conversation and reads it
 * exhaustively over the corpus's blind window, which is what `./slackEvidenceTypes.ts`'s `liveBeyondCorpus` consults before it
 * answers. A hit nothing read around still forces `unknown`.
 *
 * The rule itself is unchanged. A read-around window is ONE CONVERSATION over one window, and the third
 * refusal below — a corpus that does not reach the pull request's own last activity — is a claim about
 * every conversation there is. No number of windows adds up to it, so it stands as the owner set
 * it, and widening it is the owner's ruling to change rather than this module's.
 *
 * @param coverage how far each Slack leg reached
 * @param prUpdatedAtIso when the pull request was last active
 * @param liveFoundBeyondCorpus whether the live leg saw a message the corpus window cannot contain and
 *   nothing read around it
 * @returns whether an absence is reportable, why not when it is not, and the watermark when the corpus is
 *   provably behind — the two refusals a sync settles
 */
export function absenceBounded({
  coverage,
  prUpdatedAtIso,
  liveFoundBeyondCorpus,
}: {
  coverage: SlackCoverage;
  prUpdatedAtIso: string;
  liveFoundBeyondCorpus: boolean;
}): { readonly bounded: boolean; readonly why: string; readonly staleThroughIso?: string } {
  const through = coverage.corpusThroughIso;
  if (through === undefined) {
    return { bounded: false, why: "the Slack corpus has never been ingested, so nothing here can carry an absence" };
  }
  // Compared as INSTANTS: the corpus stamps milliseconds (`…:22.000Z`) and GitHub does not (`…:22Z`), and as
  // strings `.` sorts before `Z`, so one instant written both ways read as the corpus falling short of it. A
  // watermark that is not an instant cannot be "stale since" anything, so it is judged before either refusal
  // that names one.
  const throughMs = calendarInstantMs({ iso: through });
  const activeMs = calendarInstantMs({ iso: prUpdatedAtIso });
  if (Number.isNaN(throughMs)) {
    return {
      bounded: false,
      why: `the Slack corpus watermark "${through}" is not an instant, so nothing here can carry an absence`,
    };
  }
  // The watermark a row DATES by is the parsed instant in canonical UTC, never the stored string: a reader slices
  // it to the minute and appends `Z`, so an offset-bearing `…T00:30:00+10:00` would print ten hours late.
  const throughUtc = new Date(throughMs).toISOString();
  // Before the activity guard on purpose: a message newer than the watermark proves the corpus behind on its
  // own, so the dated claim stands whatever this pull request's own timestamp reads.
  if (liveFoundBeyondCorpus) {
    return {
      bounded: false,
      staleThroughIso: throughUtc,
      why:
        `the live search found a message newer than the corpus watermark ${through}, which proves the ` +
        "exhaustive leg is behind — run `slopweaver refresh --source slack` before trusting an absence",
    };
  }
  if (Number.isNaN(activeMs)) {
    return {
      bounded: false,
      why: `this pull request's activity "${prUpdatedAtIso}" is not an instant, so no watermark can be said to reach it`,
    };
  }
  if (throughMs >= activeMs) {
    return { bounded: true, why: "" };
  }
  return {
    bounded: false,
    staleThroughIso: throughUtc,
    why:
      `the Slack corpus ends ${through} but this pull request was active at ${prUpdatedAtIso}. Slack's own ` +
      "search collapses proximate matches, so only the corpus can carry an absence — refresh it",
  };
}
