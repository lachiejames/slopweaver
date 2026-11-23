/**
 * The vocabulary every Slack evidence leg speaks: who the owner is, what one mention is, and how far a leg reached.
 *
 * Nothing here reads a file or calls a provider. It is the leaf that `./slackEvidenceRecord.ts`,
 * `./slackEvidenceScan.ts`, `./slackEvidenceLive.ts` and `./slackEvidence.ts` all stand on, so no leg has to
 * import another one just to name a value it returns.
 *
 * ## The honesty bound is the point of this module
 *
 * An absence is only ever true over a window. The corpus watermark says exactly how far the local half
 * reached, and it can stand a day behind the clock (measured at twenty-five hours) — so "no ask found" from the
 * corpus alone is not "never asked", it is "not asked before yesterday morning". {@link SlackCoverage} carries
 * that instant beside every answer so a caller can refuse to report the absence, exactly as
 * `../pane/sections/slackAsk.ts`'s `absenceReportable` refuses one it cannot bound.
 */

import type { SlackOwnerBotIdentity } from "../corpus/slack/ownerBot.js";
import type { AuthorRole, ConversationKind, MentionRun, TextSpan } from "./evidence.js";
import type { PrLinkRef } from "./prLink.js";

/**
 * Who the owner is and which ids are the owner's own bot, so a message's author can be placed in one of the three
 * roles that change what it can prove.
 *
 * Read from `profile.json` by the caller rather than here — this module stays pure of configuration, and
 * `../corpus/slack/ownerBot.ts` has already resolved the as-me lane back to the owner's user id at projection time,
 * so a message the owner sent through the bot arrives with `record.author` equal to {@link ownerSlackUserId}.
 */
export interface SlackIdentity {
  /** The owner's own Slack user id, from `profile.json`'s `slackBot.ownerUserId`. */
  readonly ownerSlackUserId: string;
  /** Slopweaver's own bot user ids, from `profile.json`'s `slackBot.selfUserIds`. */
  readonly selfUserIds: readonly string[];
  /**
   * The owner's as-me bot, for a RAW row no projection has resolved — the share's whole-thread read
   * (`./channelShareEvidence.ts`), where the owner's bot's reply would otherwise read as an app's. Absent when none is declared.
   */
  readonly ownerBot?: SlackOwnerBotIdentity;
}

/** One Slack message that linked a pull request, with everything a row and a verdict need. */
export interface SlackMention {
  /** `owner/repo#number`, the key a caller groups by. */
  readonly prKey: string;
  readonly atIso: string;
  readonly permalink: string;
  readonly channel: string;
  /** Who posted it, as a Slack user id when the record carries one. */
  readonly authorId: string;
  /** The Slack ids this message structurally tagged — people (`U`/`W`) and groups (`S`). */
  readonly tagged: readonly string[];
  /** Which leg saw it: the local corpus, or the live search that covers the corpus's blind window. */
  readonly leg: "corpus" | "live";
  /**
   * `channel:ts` — the message's own identity, and the key the two legs are merged on.
   *
   * NOT the permalink, and it is why this field exists: the live leg's permalink carries
   * a `?thread_ts=…` query string and the corpus leg's does not, so a merge keyed on the permalink never
   * collides and every message both legs saw is counted twice — two asks for one message, nine for six.
   * Worse than the count, the corpus copy is the only one that can read `bot_profile`,
   * and it was supposed to WIN that collision; never colliding silently defeated the app-posted-as-itself
   * rule for every message both legs found. A query string is navigation, not identity.
   */
  readonly messageKey: string;
  /** `channel:rootTs` — the thread it was written in, which is what makes a later message a reply to it. */
  readonly threadKey: string;
  /**
   * How this message reaches the pull request: it LINKS it (in its words, a quote or an unfurl), or it is a
   * reply in a thread where another message does and links no pull request itself — see
   * `./reviewConversation.ts`. A `thread` mention is conversation, never evidence it was mentioned.
   */
  readonly association: "linked" | "thread";
  /** On a `thread` reply, the pull requests its thread's root reaches, quotes included — see `./evidence.ts`. Empty otherwise. */
  readonly threadPrKeys: readonly string[];
  /** The author's own visible words, whole — never a quoted attachment, and never truncated. */
  readonly authoredText: string;
  /** Where THIS pull request is linked inside {@link authoredText}. Empty when only a quote linked it. */
  readonly linkSpans: readonly TextSpan[];
  /** How many DISTINCT pull requests {@link authoredText} links, which decides whether recipients are scoped. */
  readonly authoredPrCount: number;
  /** Where the MESSAGE's first pull-request link sits in {@link authoredText}, or -1 when it links none. */
  readonly firstLinkAt: number;
  /** Whether the corpus copies of this message disagree with nothing to order them — see `./evidence.ts`. */
  readonly versionsDisagree: boolean;
  /** The pull requests the messages this one quotes link, as `owner/repo#number` — see `./evidence.ts`. */
  readonly quotedPrKeys: readonly string[];
  /** Every mention run in {@link authoredText}, with its offset. */
  readonly mentions: readonly MentionRun[];
  readonly authorRole: AuthorRole;
  readonly conversation: ConversationKind;
  /**
   * Whether it was posted in a DIRECT message, where the conversation itself names the audience.
   *
   * It is why this field exists: four of the owner's own open pull requests had been
   * put in front of a named colleague in a DM with no `<@…>` run anywhere in the message — because in a DM
   * you do not tag the person you are already talking to. A tag-only rule reported all four as "nobody has
   * been asked", and one of them had already been answered with ":approved: with one comment".
   */
  readonly isDirectMessage: boolean;
  /** In a direct message, the counterpart's Slack user id when it could be read; empty otherwise. */
  readonly counterpartId: string;
  /** A short excerpt, so a human reading `--json` can see what the message actually said. */
  readonly excerpt: string;
  /**
   * A visible session's reading of this message about this pull request, when one is recorded and still
   * quotes the message's words. `./readingMerge.ts`'s `askDecisionFor` answers with it before the classifier.
   */
  readonly reading?: MentionReading;
}

/** What a visible session decided one message proves about one pull request, and the line it read. */
export type MentionReading =
  | { readonly verdict: "ask"; readonly recipients: readonly string[]; readonly quote: string }
  | { readonly verdict: "non-ask"; readonly why: string; readonly quote: string };

/**
 * One conversation read EXHAUSTIVELY around a live search hit, over the window the corpus does not cover.
 *
 * It is what stops a single live hit being read as proof the exhaustive leg is behind: the hit was an
 * anchor, everything Slack could have collapsed against it has since been read, and `../review/reviewState.ts`'s
 * `absenceBounded` is told so. What such a window does NOT claim is in `./slackNeighbourhood.ts`'s own
 * header — it is per-conversation and top-level-plus-active-threads, never "the window holds nothing else".
 */
export interface NeighbourhoodWindow {
  readonly channelId: string;
  /** The window's start — the corpus watermark, which is exactly where the local half stops. */
  readonly fromIso: string;
  /** The window's end — when the walk was taken. */
  readonly throughIso: string;
}

/** One reply in a shared post's thread, as the thread read returned it. */
export interface ShareThreadReply {
  readonly messageKey: string;
  readonly atIso: string;
  readonly authorRole: AuthorRole;
  /** When Slack says it was last edited — absent on a message never edited. A key is not a version. */
  readonly editedAtIso?: string;
}

/** A shared post's whole thread, read at one instant. */
export interface ShareThreadRead {
  /** When the thread was read — the instant its absence of a reply holds through. */
  readonly readAtIso: string;
  /** Every message in it but the root. */
  readonly replies: readonly ShareThreadReply[];
  /** When Slack says the root — the owner's post — was last edited; absent when it never was. */
  readonly rootEditedAtIso?: string;
}

/** How far each Slack leg actually reached, so an absence can be scoped rather than asserted. */
export interface SlackCoverage {
  /**
   * The corpus watermark — the newest instant the local half is known to cover.
   *
   * Undefined, never an empty string, when the corpus has never been ingested. The two are different facts
   * and only one of them can bound an absence, so the type keeps them apart rather than letting a sentinel
   * quietly compare as "older than everything".
   */
  readonly corpusThroughIso: string | undefined;
  /**
   * The whole thread under each channel post of the owner's that links a pull request, read at walk time, by thread key.
   * A reply there need not link anything, which is why neither search leg can see it, and the read is the whole thread
   * rather than a search, which is why it can carry the absence of one. Empty when the live leg did
   * not run; a thread that would not read is absent rather than empty.
   */
  readonly shareThreads: Readonly<Record<string, ShareThreadRead>>;
  /** Whether the live search leg ran at all. */
  readonly liveRan: boolean;
  /**
   * The conversations this run went back and read around a live hit in, and over what window.
   *
   * Empty when the live leg did not run, when the corpus has never been ingested (there is no window to
   * name), or when every walk refused — a walk that could not complete contributes nothing here rather than
   * a shorter window, because a half-read window carries no claim at all.
   */
  readonly neighbourhoods: readonly NeighbourhoodWindow[];
  /** Everything neither leg can see, stated rather than implied. */
  readonly residue: readonly string[];
}

/**
 * The key a mention is grouped under.
 *
 * @param ref the pull request
 * @returns `owner/repo#number`
 */
export function prKeyOf({ ref }: { ref: PrLinkRef }): string {
  return `${ref.owner}/${ref.repo}#${String(ref.number)}`;
}

/**
 * The message's own identity, `channel:ts`, read off the corpus's structured source id.
 *
 * `../corpus/slack/project.ts` writes `channel:ts` for a top-level message and
 * `channel:threadTs:reply:ts` for a reply, both unredacted — which is what makes this recoverable offline
 * even though hygiene rewrites `raw.thread_ts` to a placeholder. A shape this does not recognise falls back
 * to the whole id, which is still stable and still collides with itself.
 *
 * @param sourceId the corpus record's own source id
 * @returns `channel:ts`
 * @internal
 */
export function messageKeyOfSourceId({ sourceId }: { sourceId: string }): string {
  const parts = sourceId.split(":");
  const [channel = "", second = "", marker = "", fourth = ""] = parts;
  if (parts.length === 2) {
    return `${channel}:${second}`;
  }
  // A REPLY names its thread root second and its own instant fourth; a PIN names the pinned message's own
  // instant third. Both are the same message a live search would return, and a key that kept either shape
  // verbatim would never collide with the live leg's `channel:ts` — the pin case was found by a Codex
  // review, which built a pinned message that survived the merge twice.
  if (marker === "reply" && fourth !== "") {
    return `${channel}:${fourth}`;
  }
  if (second === "pin" && marker !== "") {
    return `${channel}:${marker}`;
  }
  // Everything else — a file, a bookmark, a canvas, a huddle chunk — is a different OBJECT rather than a
  // different spelling of one message, so it keeps its own identity and merges with nothing.
  return sourceId;
}

/**
 * The conversation a LIVE mention's own identity names.
 *
 * Only meaningful for a mention whose `leg` is `live`: that leg mints `channel:ts` itself, so the first
 * segment is always the conversation id. A CORPUS mention's key may be a whole source id
 * ({@link messageKeyOfSourceId} keeps one verbatim for a file, a bookmark or a canvas), and splitting one of
 * those answers with a segment that is not a conversation at all.
 *
 * @param messageKey a live mention's `channel:ts`
 * @returns the conversation id, or the whole key when it carries no separator
 * @internal
 */
export function channelIdOfMessageKey({ messageKey }: { messageKey: string }): string {
  const at = messageKey.indexOf(":");
  if (at < 0) {
    return messageKey;
  }
  return messageKey.slice(0, at);
}

/** One live search candidate, already fetched, awaiting the same exact judgement the corpus leg applies. */
export interface LiveCandidate {
  readonly permalink: string;
  /** Slack's own `ts` for the message, which with the channel id is its identity. */
  readonly ts: string;
  readonly channelName: string;
  /** The conversation id. A leading `D` is Slack's own marker for a direct message. */
  readonly channelId: string;
  readonly userId: string;
  readonly tsIso: string;
  readonly text: string;
}

/**
 * Whether one live mention sits inside a conversation the run went back and read exhaustively.
 *
 * The test is the whole of what a window claims: the SAME conversation, and an instant inside the window's
 * own bounds. A hit in a conversation nothing walked, or past where the walk was taken, is not covered by
 * any of them — see `./absenceBounded.ts`'s `absenceBounded` for what that then costs the answer.
 *
 * @param mention the mention to place, whose `leg` must be `live` for its key to name a conversation
 * @param neighbourhoods every window this run may claim
 * @returns whether one of them covers it
 */
function mentionReadAround({
  mention,
  neighbourhoods,
}: {
  mention: SlackMention;
  neighbourhoods: readonly NeighbourhoodWindow[];
}): boolean {
  const channelId = channelIdOfMessageKey({ messageKey: mention.messageKey });
  const atMs = calendarInstantMs({ iso: mention.atIso });
  return neighbourhoods.some(
    (window) =>
      window.channelId === channelId &&
      atMs >= calendarInstantMs({ iso: window.fromIso }) &&
      atMs <= calendarInstantMs({ iso: window.throughIso }),
  );
}

/**
 * Whether the live leg saw a message the corpus window cannot contain AND nothing went back to read around.
 *
 * One such message used to be proof, on its own, that the exhaustive leg is behind — stronger than any
 * watermark comparison, and why `./absenceBounded.ts`'s `absenceBounded` takes it as its own reason to refuse an absence. What
 * it really proves is narrower: the live search UNDER-COUNTS by collapsing proximate matches, so a hit in
 * the corpus's blind window may have siblings nobody has seen.
 *
 * `./slackNeighbourhood.ts` removes exactly that, and only that. When the run went back and read the hit's
 * own conversation exhaustively over the corpus's blind window, the collapsed siblings are no longer
 * unseen — they were fetched, judged by the same matcher, and are among the `mentions` passed here. So a hit
 * inside a read-around window stops forcing `unknown`, and a hit outside every window still forces it.
 *
 * The OTHER refusal in `./absenceBounded.ts`'s `absenceBounded` is untouched: a window is per-conversation,
 * so no number of them adds up to "nobody asked anywhere", and a corpus that does not reach the pull request's own last activity
 * still cannot carry an absence.
 *
 * @param mentions every message either leg found
 * @param coverage how far each leg reached, the read-around windows included
 * @returns whether a live-only message postdates the corpus watermark with no window covering it
 */
export function liveBeyondCorpus({
  mentions,
  coverage,
}: {
  mentions: readonly SlackMention[];
  coverage: SlackCoverage;
}): boolean {
  const through = coverage.corpusThroughIso;
  if (through === undefined) {
    return mentions.some((mention) => mention.leg === "live");
  }
  // As instants, never strings: the corpus and the live leg spell one instant in different shapes, and a
  // lexical `>` calls a full date-time later than its bare date on the same day. A NaN on either side compares false,
  // so a time that is not an instant — a day no calendar has included — is never proof the corpus is behind.
  const throughMs = calendarInstantMs({ iso: through });
  return mentions.some(
    (mention) =>
      mention.leg === "live" &&
      calendarInstantMs({ iso: mention.atIso }) > throughMs &&
      !mentionReadAround({ mention, neighbourhoods: coverage.neighbourhoods }),
  );
}

/**
 * An ISO timestamp's instant, or `NaN` when it is not one. `Date.parse` alone is too generous three ways, each
 * a stale claim the reading never had: it rolls a date no calendar has over (a day past the end of February parses as a day in March),
 * reads a time with no zone in the HOST's zone, and takes free text. So only a date, or a date-time carrying
 * `Z` or an offset, is one, and the day is checked as WRITTEN, before any offset moves it.
 *
 * @returns epoch milliseconds, or `NaN`
 */
export function calendarInstantMs({ iso }: { iso: string }): number {
  const ms = Date.parse(iso);
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(iso);
  if (Number.isNaN(ms) || day === null) {
    return Number.NaN;
  }
  const [, year, month, date] = day;
  // `setUTCFullYear`, never `Date.UTC`: the latter reads a year 0–99 as 1900–1999, so 0000-02-29 would fail.
  const probe = new Date(0);
  probe.setUTCFullYear(Number(year), Number(month) - 1, Number(date));
  if (probe.getUTCMonth() !== Number(month) - 1 || probe.getUTCDate() !== Number(date)) {
    return Number.NaN;
  }
  return ms;
}
