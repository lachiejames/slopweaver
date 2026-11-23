/**
 * Measure the owner's voice length register from the Slack messages they sent — the pure core of `profile voice
 * measure`.
 *
 * The voice profile is inferred from the connected
 * Slack messages, never asked. So a Slack refresh runs this (`../cli/commands/refresh/voiceLeg.ts`) and connecting
 * Slack fills the Alignment page's voice section with no verb typed.
 *
 * ## Which messages are the owner's
 *
 * The logical latest version of every Slack `message` or `comment` record whose author is the owner's Slack user id,
 * minus what the owner did not type:
 *
 * - **An app-attributed post** (`raw.bot_id` or `raw.app_id` non-empty). A message Slopweaver sends as the owner with
 *   the owner's user token carries the owner's `user` beside the app's `bot_id` (`../outbound/slack/asMeAuthorship.ts`),
 *   and me-to-me rewrites the owner's bot's own posts to the owner's id (`../corpus/slack/ownerBot.ts`). Both are the
 *   fleet's words, and nearly every em-dash in the owner's sent history was one of them
 *   (`../admit/voiceProfileGate.ts`). `app_id` is the conservative half: no fixture here proves every app-id-only
 *   payload is not the owner's, so its count is reported apart.
 * - **A system subtype.** Only no subtype, `file_share`, `me_message` and a reply's `thread_broadcast` are kept; the
 *   top-level `message` copy of a broadcast is the same words a second time.
 * - **No authored words.** Counted from `raw.text` alone, never `record.text`, which carries reaction and file
 *   summaries and Block Kit prose the owner did not type (`../corpus/slack/project.ts`).
 *
 * `client_msg_id` is not required: it is optional on Slack's own type and an API client can supply one, so it
 * proves neither. Slack markup is counted as stored, so the numbers stay comparable with the register's
 * historical whole-message measurement.
 *
 * ## The cohorts
 *
 * Every kept message enters `slack/all-sent`; one in a `D…` channel enters `slack-dm/aggregate` too — an overlapping
 * calibration subset, not a partition. Those are the keys the register already carries, so a write replaces them.
 * An empty population yields NO cohort: absence stays "not measured", never zero.
 */
import { latestWins, recordIdentity } from "../corpus/latestRecords.js";
import type { CorpusRecord } from "../corpus/types.js";
import { proseWordCount } from "../outbound/voice/proseWords.js";
import type { VoiceCohort } from "../store/profile/types.js";

/** The subtypes a message the owner typed can carry. A `thread_broadcast` is kept only on the reply. */
const AUTHORED_SUBTYPES: ReadonlySet<string> = new Set(["file_share", "me_message", "thread_broadcast"]);

/** Where a measured cohort says its numbers came from. */
export const VOICE_MEASURE_SOURCE =
  "Slack bronze raw.text; latest owner-authored message/comment; whitespace tokens containing a letter or digit";

/** What a measured cohort says its numbers do not cover. */
export const VOICE_MEASURE_QUALIFICATION =
  "Current bronze coverage only; excludes app-attributed posts (bot_id or app_id, which includes what Slopweaver " +
  "sent as the owner), system subtypes, files-only or empty authored text, and top-level thread-broadcast copies; " +
  "an edited message is counted once, as the version the corpus's logical-latest view keeps; Slack markup is " +
  "counted as stored.";

/**
 * Every message the measurement saw, and why each one it did not count was left out.
 *
 * @internal — named outside this module only through {@link SlackVoiceMeasurement}'s `counts`.
 */
export interface VoiceMeasureCounts {
  /** Every version of a message or comment authored as the owner that reached the core. */
  readonly ownerMessageVersions: number;
  /** Versions a later version of the same message replaced. */
  readonly supersededVersions: number;
  /** Messages counted into `slack/all-sent`. */
  readonly eligibleAllSent: number;
  /** Of those, messages in a direct-message channel, counted into `slack-dm/aggregate` too. */
  readonly eligibleDm: number;
  /** Left out: an app posted it (`bot_id`), Slopweaver's as-the-owner sends included. */
  readonly excludedAppBotId: number;
  /** Left out: an app is attributed (`app_id`) with no `bot_id`. */
  readonly excludedAppId: number;
  /** Left out: the top-level channel copy of a reply the owner also sent to the channel. */
  readonly excludedBroadcastCopy: number;
  /** Left out: a system subtype (a join, an edit wrapper, a bot message). */
  readonly excludedSubtype: number;
  /** Left out: the stored payload carries no `text` string. */
  readonly excludedNoRawText: number;
  /** Left out: the text holds no word (a file alone, an emoji alone). */
  readonly excludedNoProseWords: number;
}

/** What one measurement produced: the cohorts to write, and the counts behind them. */
export interface SlackVoiceMeasurement {
  readonly cohorts: readonly VoiceCohort[];
  readonly counts: VoiceMeasureCounts;
}

/** Why one latest message was left out, or `kept` with its word count. */
type Classified =
  | { readonly kind: "kept"; readonly words: number }
  | {
      readonly kind: "excluded";
      readonly why: "appBotId" | "appId" | "broadcastCopy" | "subtype" | "noRawText" | "noProseWords";
    };

/**
 * The nearest-rank percentile of an ascending list: the smallest value at least `percentile` of the list sits at or
 * under.
 *
 * @param sorted the values, ascending
 * @param percentile the fraction, `0.5` for the median
 * @returns the value, or `undefined` for an empty list
 */
export function nearestRank({
  sorted,
  percentile,
}: {
  sorted: readonly number[];
  percentile: number;
}): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

/** A raw payload field as a non-empty string, or `undefined`. */
function rawString({ raw, key }: { raw: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Decide whether one latest message is the owner's typed words, and how many. */
function classify({ record }: { record: CorpusRecord }): Classified {
  const raw = record.raw;
  if (raw === undefined) {
    return { kind: "excluded", why: "noRawText" };
  }
  if (rawString({ key: "bot_id", raw }) !== undefined) {
    return { kind: "excluded", why: "appBotId" };
  }
  if (rawString({ key: "app_id", raw }) !== undefined) {
    return { kind: "excluded", why: "appId" };
  }
  const subtype = rawString({ key: "subtype", raw });
  if (subtype === "thread_broadcast" && record.kind === "message") {
    return { kind: "excluded", why: "broadcastCopy" };
  }
  if (subtype !== undefined && !AUTHORED_SUBTYPES.has(subtype)) {
    return { kind: "excluded", why: "subtype" };
  }
  const text = raw["text"];
  if (typeof text !== "string") {
    return { kind: "excluded", why: "noRawText" };
  }
  const words = proseWordCount({ text });
  if (words === 0) {
    return { kind: "excluded", why: "noProseWords" };
  }
  return { kind: "kept", words };
}

/** One cohort over a population's word counts, or none for an empty population. */
function cohortOf({
  words,
  surface,
  cohort,
  nowIso,
}: {
  words: readonly number[];
  surface: string;
  cohort: string;
  nowIso: string;
}): VoiceCohort[] {
  const sorted = words.toSorted((a, b) => a - b);
  const median = nearestRank({ percentile: 0.5, sorted });
  const p75 = nearestRank({ percentile: 0.75, sorted });
  const p90 = nearestRank({ percentile: 0.9, sorted });
  if (median === undefined || p75 === undefined || p90 === undefined) {
    return [];
  }
  return [
    {
      ceilingWords: null,
      cohort,
      measuredAt: nowIso,
      medianWords: median,
      p75Words: p75,
      p90Words: p90,
      qualification: VOICE_MEASURE_QUALIFICATION,
      sampleCount: sorted.length,
      source: VOICE_MEASURE_SOURCE,
      surface,
    },
  ];
}

/** Whether a record is a Slack message or reply authored as the owner. */
function isOwnerMessage({ record, ownerUserId }: { record: CorpusRecord; ownerUserId: string }): boolean {
  return (
    record.source === "slack" &&
    (record.kind === "message" || record.kind === "comment") &&
    record.author === ownerUserId
  );
}

/**
 * Measure the owner's Slack length cohorts from the records they authored.
 *
 * @param records Slack records in canonical bronze read order; any not the owner's are ignored
 * @param ownerUserId the owner's Slack user id
 * @param nowIso the instant the measurement is stamped with
 * @returns the cohorts to write (none for an empty population) and every count behind them
 */
export function measureSlackVoice({
  records,
  ownerUserId,
  nowIso,
}: {
  records: Iterable<CorpusRecord>;
  ownerUserId: string;
  nowIso: string;
}): SlackVoiceMeasurement {
  const latest = new Map<string, CorpusRecord>();
  let versions = 0;
  for (const record of records) {
    if (!isOwnerMessage({ ownerUserId, record })) {
      continue;
    }
    versions += 1;
    const key = recordIdentity({ record });
    const incumbent = latest.get(key);
    if (incumbent === undefined || latestWins({ candidate: record, incumbent })) {
      latest.set(key, record);
    }
  }
  const excluded = { appBotId: 0, appId: 0, broadcastCopy: 0, noProseWords: 0, noRawText: 0, subtype: 0 };
  const allSent: number[] = [];
  const dm: number[] = [];
  for (const record of latest.values()) {
    const verdict = classify({ record });
    if (verdict.kind === "excluded") {
      excluded[verdict.why] += 1;
      continue;
    }
    allSent.push(verdict.words);
    if (record.container.startsWith("slack/D")) {
      dm.push(verdict.words);
    }
  }
  return {
    cohorts: [
      ...cohortOf({ cohort: "all-sent", nowIso, surface: "slack", words: allSent }),
      ...cohortOf({ cohort: "aggregate", nowIso, surface: "slack-dm", words: dm }),
    ],
    counts: {
      eligibleAllSent: allSent.length,
      eligibleDm: dm.length,
      excludedAppBotId: excluded.appBotId,
      excludedAppId: excluded.appId,
      excludedBroadcastCopy: excluded.broadcastCopy,
      excludedNoProseWords: excluded.noProseWords,
      excludedNoRawText: excluded.noRawText,
      excludedSubtype: excluded.subtype,
      ownerMessageVersions: versions,
      supersededVersions: versions - latest.size,
    },
  };
}
