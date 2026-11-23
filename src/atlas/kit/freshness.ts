/**
 * Whether a stored answer may be quoted as current, and what to say when it may not.
 *
 * Platform-agnostic. Every atlas judges freshness the same way and differs only in its POLICY window, which
 * is why `windowMs` is a parameter rather than a constant a platform re-declares: both pre-kit atlases had
 * written the same 150 lines out separately before this module existed.
 *
 * A verdict here is a GATE rather than an annotation: only `current` may be presented as an answer, and a
 * caller displaying a control/risk/policy count to an auditor must check `mayQuoteAsCurrent` before it does.
 * The number is still printed when it is stale — suppressing it entirely would leave no answer at all
 * across a missed sync, and the predictable consequence is somebody finding the number a worse way. Printing
 * it as "historical as of" a date keeps the fact available while making it unusable as a current claim.
 *
 * A future timestamp is `indeterminate` rather than fresh: a negative age is not freshness, it is a broken
 * clock, and treating it as within-limit is how a machine whose clock ran ahead reports itself permanently
 * current.
 *
 * ## The window is the ATLAS's own, and there is only one of it
 *
 * The policy used to be a count of DAYS with a kit fallback of seven, and each atlas declared its own
 * separately from anything else it said about freshness. **The owner's ruling** replaces both
 * halves: the unit is the same duration vocabulary the corpus uses (`lib/duration.ts` — `30m`, `4h`,
 * `7d`), the default is four hours, and an atlas that wants another one declares `freshnessWindow` on its
 * DESCRIPTOR. So a cell judgement and an estate sweep read the same number out of the same field, which is
 * the property the generation clock needed and is worth exactly as much here.
 *
 * ## A bounded live read counts as fresh
 *
 * Call 2 of the same ruling. {@link assessFreshness} takes `liveReadAt` — when a bounded live read last
 * observed this surface against the provider itself — and a live read inside the window makes the verdict
 * `current` however old the stored sync is. That is not a leniency: the claim being quoted rests on the live
 * read, so the stored sync's age cannot change whether it is true. `kit/freshnessWindow.ts` carries the
 * ladder that decides when to take one.
 */

import { renderDuration } from "../../lib/duration.js";
import { DEFAULT_ATLAS_FRESHNESS_WINDOW_MS } from "./freshnessWindow.js";

/** What a stored answer may be used for. */
const FRESHNESS_VERDICTS = ["current", "historical", "never-synced", "indeterminate"] as const;

type FreshnessVerdict = (typeof FRESHNESS_VERDICTS)[number];

/** The freshness of one stored answer, and the reasons behind the verdict. */
export interface FreshnessAssessment {
  readonly verdict: FreshnessVerdict;
  /** `true` only for `current`. The one field a caller should branch on before printing a number. */
  readonly mayQuoteAsCurrent: boolean;
  readonly lastSuccessAt: string | null;
  /** `null` when there is no success to measure, or when its timestamp could not be read. */
  readonly ageMs: number | null;
  /** The policy window this verdict was reached under, in milliseconds. */
  readonly windowMs: number;
  /** Why, in English, ready to print. */
  readonly notes: readonly string[];
}

/** The cases where age cannot be computed at all: never synced, an unreadable stamp, or a future one. */
function assessRecordedTime({
  lastSuccessAt,
  nowMs,
  windowMs,
}: {
  lastSuccessAt: string | null;
  nowMs: number;
  windowMs: number;
}): FreshnessAssessment | null {
  const base = { lastSuccessAt, mayQuoteAsCurrent: false, windowMs };
  if (lastSuccessAt === null) {
    return {
      ...base,
      ageMs: null,
      notes: ["this surface has never synced successfully, so there is no answer to give"],
      verdict: "never-synced",
    };
  }
  const parsed = Date.parse(lastSuccessAt);
  if (!Number.isFinite(parsed)) {
    return {
      ...base,
      ageMs: null,
      notes: [`the recorded sync time ${lastSuccessAt} is not a readable timestamp, so its age cannot be judged`],
      verdict: "indeterminate",
    };
  }
  const ageMs = nowMs - parsed;
  if (ageMs < 0) {
    return {
      ...base,
      ageMs,
      notes: [
        `the recorded sync time ${lastSuccessAt} is in the future, so this machine's clock disagrees with it`,
        "refusing to call it current — a negative age satisfies any age limit, which would read as permanently fresh",
      ],
      verdict: "indeterminate",
    };
  }
  return null;
}

/**
 * Whether a bounded live read is recent enough to carry the answer on its own.
 *
 * A future or unreadable live-read stamp answers `false` for the same reason a future sync time is
 * `indeterminate`: a negative age satisfies every window, so treating one as a fresh live read would make a
 * broken clock look like a permanently current answer.
 *
 * @param liveReadAt when a bounded live read last observed the provider, or `null` when none has
 * @param nowMs the current time in epoch milliseconds
 * @param windowMs the policy window the read must fall inside
 * @returns true when the live read is inside the window
 */
function liveReadCarriesIt({
  liveReadAt,
  nowMs,
  windowMs,
}: {
  liveReadAt: string | null;
  nowMs: number;
  windowMs: number;
}): boolean {
  if (liveReadAt === null) {
    return false;
  }
  const parsed = Date.parse(liveReadAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const ageMs = nowMs - parsed;
  return ageMs >= 0 && ageMs <= windowMs;
}

/**
 * How old the stored sync is, or `null` when there is none or its stamp cannot be read.
 *
 * @param lastSuccessAt the stored sync time, or `null` when this surface has never synced
 * @param nowMs the current time in epoch milliseconds
 * @returns the age in milliseconds, or `null` when there is nothing readable to age
 */
function storedAgeMs({ lastSuccessAt, nowMs }: { lastSuccessAt: string | null; nowMs: number }): number | null {
  if (lastSuccessAt === null) {
    return null;
  }
  const parsed = Date.parse(lastSuccessAt);
  return Number.isFinite(parsed) ? nowMs - parsed : null;
}

/**
 * Judge a stored sync whose time is known to be readable and not in the future.
 *
 * Split out of {@link assessFreshness} so the live-read rung and the unjudgeable cases stay visible at the
 * top of that function rather than being read past to reach the ordinary path.
 *
 * @param ageMs how old the stored sync is, already computed against the caller's clock
 * @param lastSuccessAt the stored sync time, quoted back in every note
 * @param latestAttemptFailed whether the most recent attempt failed, whatever the last success says
 * @param windowMs the policy window
 * @returns the verdict, the age it rests on, and the notes to print
 */
function assessStoredSync({
  ageMs,
  lastSuccessAt,
  latestAttemptFailed,
  windowMs,
}: {
  ageMs: number;
  lastSuccessAt: string;
  latestAttemptFailed: boolean;
  windowMs: number;
}): FreshnessAssessment {
  const base = { ageMs, lastSuccessAt, windowMs };
  if (latestAttemptFailed) {
    return {
      ...base,
      mayQuoteAsCurrent: false,
      notes: [
        `the latest attempt failed, so this is what the last SUCCESSFUL sync saw on ${lastSuccessAt}`,
        "it is not a current answer, however recent it looks",
      ],
      verdict: "historical",
    };
  }
  if (ageMs > windowMs) {
    return {
      ...base,
      mayQuoteAsCurrent: false,
      notes: [
        `last synced ${lastSuccessAt}, which is past the ${renderDuration({ ms: windowMs })} window set as policy`,
        "the window is a policy rather than anything the data implies",
      ],
      verdict: "historical",
    };
  }
  return { ...base, mayQuoteAsCurrent: true, notes: [], verdict: "current" };
}

/**
 * Judge whether a stored answer is current, historical, absent, or unjudgeable.
 *
 * @param lastSuccessAt when this source last synced successfully, or `null` if it never has
 * @param latestAttemptFailed whether the most recent attempt failed, whatever the last success says
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @param windowMs the policy window; defaults to the four hours the owner's ruling sets
 * @param liveReadAt when a bounded live read last observed the provider directly, if one has
 * @returns the verdict, the age it rests on, and the notes to print
 */
export function assessFreshness({
  lastSuccessAt,
  latestAttemptFailed,
  nowMs,
  windowMs = DEFAULT_ATLAS_FRESHNESS_WINDOW_MS,
  liveReadAt = null,
}: {
  lastSuccessAt: string | null;
  latestAttemptFailed: boolean;
  nowMs: number;
  windowMs?: number;
  liveReadAt?: string | null;
}): FreshnessAssessment {
  // Tested before anything else, including the never-synced case: a bounded live read is an answer against
  // the provider itself, so a surface that has never had a stored sync at all still has a current answer
  // when one was just read live.
  if (liveReadCarriesIt({ liveReadAt, nowMs, windowMs })) {
    return {
      ageMs: storedAgeMs({ lastSuccessAt, nowMs }),
      lastSuccessAt,
      mayQuoteAsCurrent: true,
      notes: [
        `this rests on a bounded live read inside ${renderDuration({ ms: windowMs })}, not on the stored generation`,
      ],
      verdict: "current",
      windowMs,
    };
  }
  const unjudgeable = assessRecordedTime({ lastSuccessAt, nowMs, windowMs });
  if (unjudgeable !== null) {
    return unjudgeable;
  }
  // Safe: `assessRecordedTime` above already returned null only when `lastSuccessAt` is non-null and parses.
  return assessStoredSync({
    ageMs: nowMs - Date.parse(lastSuccessAt!),
    lastSuccessAt: lastSuccessAt!,
    latestAttemptFailed,
    windowMs,
  });
}

/**
 * The qualifier a number must carry when it is not current.
 *
 * @param assessment the verdict to label
 * @returns a bracketed qualifier, or an empty string when the answer is current
 */
export function historicalQualifier({ assessment }: { assessment: FreshnessAssessment }): string {
  if (assessment.mayQuoteAsCurrent) {
    return "";
  }
  if (assessment.lastSuccessAt === null) {
    return " [never synced]";
  }
  return ` [historical as of ${assessment.lastSuccessAt}]`;
}
