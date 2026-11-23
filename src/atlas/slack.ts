/**
 * The Slack atlas — what conversations exist, which of them this account can actually read, and which have
 * never been looked at. Pure: it reads structure rows and message observations that a caller has already
 * loaded, and makes no network call of its own.
 *
 * ## Why an atlas rather than another index
 *
 * The corpus (bronze → silver → gold → `store read`) answers questions about what people SAID. It cannot
 * answer "what is here", and more importantly it cannot answer "what have I never looked at" — because
 * absence leaves no record in an index. A channel nobody has read produces no rows, and no rows is
 * indistinguishable from a channel that does not exist. That invisibility is what this file removes.
 *
 * The pattern is ported from two atlases that already exist in a separate private repository — one over a
 * telemetry platform, one over a code-hosting platform. Two of its three ideas are taken directly:
 *
 *  - **Things accumulate; a measurement describes the last look.** A channel seen once stays in the map.
 *  - **The ledger is seeded complete-but-mostly-deferred**, not grown from empty. Every channel the
 *    workspace has is a row from the first run, most of them marked never-read. A map that grows only when
 *    somebody looks cannot tell "new" from "never checked".
 *
 * The third — a schema that refuses to parse an unearned `exhaustive` claim — is deliberately NOT taken.
 * It exists to stop a coverage FRACTION being inflated, and there is no fraction here: a channel is read up
 * to a point in time, so its coverage is a timestamp. A timestamp has no denominator to get wrong and
 * nothing to inflate, and it is the same value `slack read-thread --since` already consumes, so the atlas
 * and the re-read share one number rather than two that can disagree.
 *
 * ## Readable and read are independent, and conflating them is the failure
 *
 * `conversations.list` returns every channel in the workspace, not only the ones the account has joined —
 * measured, it lists public channels the account has never joined and can read anyway. So
 * "this channel exists", "I could read it" and "I have read it" are three different facts, and
 * the first two are far less correlated than they look: see {@link UnreadableReason} for the measurement
 * that corrected an assumption this file originally shipped with.
 *
 * The map is emphatically NOT permission. It is built with the owner's user token, which sees strictly more
 * than the bot does, so a caller acting AS the bot must check its own visibility rather than trusting a row
 * here.
 */
import type { StructureBronzeRow } from "../corpus/structures/types.js";

/** How much of a conversation this account has ever read. A timestamp, never a fraction — see the header. */
type ChannelCoverage =
  | {
      readonly kind: "never-read";
    }
  | {
      readonly kind: "read-to";
      /**
       * The newest message timestamp held for this conversation. Feed it straight to
       * `slack read-thread --since` — the two are deliberately the same value.
       */
      readonly ts: string;
    };

/**
 * Why a conversation cannot be read, when it cannot. `undefined` on {@link AtlasChannel.unreadableReason}.
 *
 * Two arms, and the two that were here BEFORE were both wrong. This is the correction that this whole file
 * existed to make possible, so it is written out rather than quietly fixed:
 *
 *  - **"not a member" was wrong.** Membership does not gate reading a PUBLIC channel. A user token holding
 *    `channels:history` reads public history whether or not the account has joined. PROVEN rather than
 *    reasoned: a thread in a channel whose `is_member` is false returned its messages with completeness
 *    `corroborated`, and `refresh` had already read such channels without a single refusal.
 *    The original brief asserted that a history call on an unjoined channel "would fail". It does not.
 *  - **"archived" was wrong.** Archived history is still fetchable — proven the same way, on an archived
 *    channel the account is not in. Archived means nothing NEW will arrive, which is a property of the
 *    conversation and not a permission. It stays as {@link AtlasChannel.isArchived}.
 */
type UnreadableReason =
  /**
   * A private channel the account has not joined.
   *
   * Note this is currently unreachable on the owner's workspace, and that is itself informative: Slack does
   * not LIST private channels you are not in, so every private row in the map is one you are in — measured
   * across every private row. The arm stays because a shared or admin-scoped enumeration could produce it, and because the
   * alternative is a type that says readability can never fail.
   */
  | "private and not a member"
  /**
   * The stored row does not say whether the conversation is private, so nothing can be concluded.
   *
   * Unreachable through the current projection, which always writes `private`. It exists because the
   * alternative — reading silence as "public, therefore readable" — is a claim the capture does not
   * support, and because it keeps this file consistent with {@link flag}'s own rule that an absent
   * attribute is never read as permission. A review pass produced exactly that counterexample.
   */
  | "unknown: capture predates privacy capture";

/** One conversation, as the atlas holds it. */
export interface AtlasChannel {
  readonly id: string;
  readonly name: string | undefined;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
  /** Whether this account is in the channel — the field that decides whether history can be fetched. */
  readonly isMember: boolean;
  /**
   * Whether this account could read the channel's history right now.
   *
   * Kept as its own field rather than derived at each call site, because "can I read it" is the question
   * every caller actually has and re-deriving it from flags is where a caller gets it subtly wrong.
   */
  readonly readable: boolean;
  /** Why not, when `readable` is false. Absent when it is readable. */
  readonly unreadableReason?: UnreadableReason;
  readonly coverage: ChannelCoverage;
}

/**
 * What the corpus knows about HUDDLES — recorded calls, which are a different question from channels and
 * belong in the same map for the same reason channels do: absence leaves no trace anywhere else.
 *
 * `withTranscript` counts huddles whose notes name a transcript FILE, which is a strictly weaker claim than
 * "its words are in bronze" and is deliberately named so it cannot be misread as the stronger one.
 * `withWords` is the stronger claim, counted separately: the two used to be the same number by construction
 * — a transcript FILE's bytes are cookie-only, so the corpus could only ever hold the pointer — and they
 * differ, because the words come back inline on `files.info` under
 * `include_transcription=true` and the refresh stores them. A huddle can now name a transcript whose words
 * this corpus still does not hold (the call failed, or bronze predates the lane), so the gap between the two
 * counts is the thing worth seeing.
 */
export interface HuddleCensus {
  readonly total: number;
  /** Huddles whose notes name a transcript file id — a POINTER count, never a readability claim. */
  readonly withTranscript: number;
  /** Huddles whose WORDS are in bronze — the strong claim, and always ≤ {@link withTranscript}. */
  readonly withWords: number;
  /** Huddles Slack generated no transcript for at all. */
  readonly withoutTranscript: number;
  /** The oldest and newest huddle in the corpus, so a reader can see the window without walking it. */
  readonly earliestIso: string | undefined;
  readonly latestIso: string | undefined;
}

/**
 * One huddle, reduced to the two facts the census counts.
 *
 * A narrow row rather than a whole `CorpusRecord`, so the reader that produces it has to state what it read
 * off each bronze line instead of asserting a line IS a record. An unvalidated JSON object cast to
 * `CorpusRecord` compiles and lies; this shape cannot.
 */
export interface HuddleRow {
  readonly tsIso: string;
  /** The transcript file id the notes named, when they named one. */
  readonly transcriptFileId: string | undefined;
  /** True when this huddle's record carries the transcript's words, not just a pointer to their file. */
  readonly hasWords: boolean;
}

/**
 * One bronze window a scan could not read at all, and the reason it could not.
 *
 * Lives here, beside {@link HuddleRow}, because it is part of the same answer: a census and the shortfall
 * that qualifies it are one fact, and a renderer handed the first without the second cannot be honest.
 */
export interface UnreadableWindow {
  /** The window's filename, relative to the source's bronze directory. */
  readonly file: string;
  /** The failure as thrown, so a reader can tell a permission error from a corrupt file. */
  readonly message: string;
}

/**
 * Count the huddles bronze holds.
 *
 * @param huddles every huddle row read out of bronze
 * @returns the census
 *
 * @internal — exported for its own unit test; `slackAtlas` is the only caller.
 */
export function huddleCensus({ huddles }: { huddles: readonly HuddleRow[] }): HuddleCensus {
  const stamps = huddles
    .map((huddle) => huddle.tsIso)
    .filter((ts) => ts.length > 0)
    .toSorted();
  const withTranscript = huddles.filter((huddle) => huddle.transcriptFileId !== undefined).length;
  return {
    earliestIso: stamps[0],
    latestIso: stamps[stamps.length - 1],
    total: huddles.length,
    withoutTranscript: huddles.length - withTranscript,
    withTranscript,
    withWords: huddles.filter((huddle) => huddle.hasWords).length,
  };
}

/** The whole map, plus the counts that make its shape legible without walking it. */
export interface SlackAtlas {
  readonly channels: readonly AtlasChannel[];
  /** The huddle census — absent from a map built before huddles were ingested, never zero-by-assumption. */
  readonly huddles: HuddleCensus;
  readonly counts: {
    readonly total: number;
    readonly readable: number;
    readonly unreadable: number;
    readonly everRead: number;
    /**
     * Readable, LIVE, and never looked at — the actionable population, matching {@link neverLookedAt}.
     *
     * Archived channels are not counted here. See {@link neverReadArchived}, which carries them so the
     * exclusion is stated rather than silent.
     */
    readonly readableNeverRead: number;
    /**
     * Readable and never looked at, but ARCHIVED — excluded from the actionable list.
     *
     * Reported rather than dropped: on the owner's workspace archived channels sat among the never-read
     * rows, so that omission going unmentioned would be exactly the silent-loss defect this
     * codebase refuses.
     */
    readonly neverReadArchived: number;
    /**
     * Of {@link readableNeverRead}, the ones the account has actually JOINED.
     *
     * The sharpest signal in the whole map: measured on the owner's workspace, the live never-read joined
     * channel was a critical-alerts channel the owner belongs to which had never been ingested at all. An
     * unjoined public channel nobody has read is mostly just the workspace being large; a JOINED one is a
     * real gap.
     *
     * The figure was higher before the coverage source was corrected — the extra channels had in fact been
     * ingested and were false positives of a thread-cursor proxy. See {@link readToByChannel}.
     */
    readonly neverReadJoined: number;
    /**
     * Rows that actually carried a membership attribute.
     *
     * Present because its ABSENCE is indistinguishable from "you are in nothing". Membership was fetched
     * and discarded by the projection until this feature landed, so a store written before it reads as zero
     * readable channels — which is technically what the data says and is not what is true. Callers compare
     * this against `total` and say so rather than presenting a stale map as a finding.
     */
    readonly membershipKnown: number;
  };
}

/**
 * Whether the map predates membership capture, and so cannot say what is readable.
 *
 * A whole-map judgement rather than a per-row one: a workspace where the owner genuinely belongs to nothing
 * is indistinguishable row-by-row from a store written before the projection kept `is_member`. What
 * separates them is that the old projection dropped the field for EVERY row, so zero-known-out-of-many is
 * the signature of staleness rather than of solitude.
 *
 * @param atlas the built atlas
 * @returns true when nothing in a non-empty map carries membership
 */
export function membershipUnknown({ atlas }: { atlas: SlackAtlas }): boolean {
  return atlas.counts.total > 0 && atlas.counts.membershipKnown === 0;
}

/**
 * Whether a structure row's attribute is exactly `true`.
 *
 * Strict rather than truthy, and the direction is deliberate everywhere it is used here: an absent or
 * unexpected value must read as "not a member" and "not readable", because the cost of guessing yes is a
 * caller sent at a conversation it cannot open.
 *
 * @param row the structure row
 * @param key the attribute name
 * @returns true only when the attribute is the boolean `true`
 */
function flag({ row, key }: { row: StructureBronzeRow; key: string }): boolean {
  return row.attrs[key] === true;
}

/**
 * Build the atlas from structure rows and whatever has been read.
 *
 * Seeded from the ROWS, not from the observations — that inversion is the point. Every channel the
 * workspace has becomes a row here on the first run, most of them `never-read`, so "what have I not looked
 * at" is answerable immediately rather than accumulating as work happens.
 *
 * `readTo` should be the MERGE of every coverage source — see {@link mergeReadTo}. Passing only the thread
 * cursors is wrong for any channel without threads, and was wrong in practice.
 *
 * @param rows the Slack structure rows, as `refresh` wrote them
 * @param readTo the newest message timestamp held per conversation id, for those with any
 * @param huddles the huddle rows bronze holds, for the census
 * @returns the map and its counts
 */
export function slackAtlas({
  rows,
  readTo,
  huddles,
}: {
  rows: readonly StructureBronzeRow[];
  readTo: ReadonlyMap<string, string>;
  huddles: readonly HuddleRow[];
}): SlackAtlas {
  const latest = latestPerChannel({ rows });
  const channels = latest.map((row) => toChannel({ readTo, row })).toSorted((a, b) => a.id.localeCompare(b.id));
  const membershipKnown = latest.filter((row) => row.attrs["isMember"] !== undefined).length;
  return {
    channels,
    huddles: huddleCensus({ huddles }),
    counts: {
      everRead: channels.filter((c) => c.coverage.kind === "read-to").length,
      membershipKnown,
      neverReadArchived: channels.filter((c) => c.readable && c.coverage.kind === "never-read" && c.isArchived).length,
      neverReadJoined: channels.filter(
        (c) => c.readable && c.coverage.kind === "never-read" && !c.isArchived && c.isMember,
      ).length,
      readable: channels.filter((c) => c.readable).length,
      readableNeverRead: channels.filter((c) => c.readable && c.coverage.kind === "never-read" && !c.isArchived).length,
      total: channels.length,
      unreadable: channels.filter((c) => !c.readable).length,
    },
  };
}

/**
 * Why a channel cannot be read, or `undefined` when it can.
 *
 * Privacy is the only real gate — see {@link UnreadableReason} for the evidence that membership and
 * archival are not. Silence about privacy is NOT read as public: a row that predates privacy capture
 * supports no readability claim at all, which is the same conservatism {@link flag} states.
 *
 * @param isPrivate whether the newest capture says the channel is private
 * @param privacyKnown whether that capture carried the attribute at all
 * @param isMember whether the account is in the channel
 * @returns the reason it cannot be read, or undefined
 */
function unreadableReasonFor({
  isPrivate,
  privacyKnown,
  isMember,
}: {
  isPrivate: boolean;
  privacyKnown: boolean;
  isMember: boolean;
}): UnreadableReason | undefined {
  if (!privacyKnown) {
    return "unknown: capture predates privacy capture";
  }
  return isPrivate && !isMember ? "private and not a member" : undefined;
}

/**
 * One row per channel — the newest capture of each.
 *
 * The structure store APPENDS a row per hydration rather than replacing, so a channel captured five times
 * has five rows. Measured on the owner's store the moment this feature added a field: every channel held
 * more than one row, because changing the projection changed each row's fingerprint and every channel was
 * written afresh. Counting rows therefore counted each channel once per capture — and worse, the OLD rows predate membership, so a naive pass would have mixed "not a member" from a
 * stale capture with "member" from a current one for the same channel.
 *
 * This is the store's own doctrine applied rather than quoted: things accumulate, and a measurement
 * describes the LAST look. `fetchedAtIso` is ISO-8601 and therefore sorts lexicographically, so the newest
 * capture wins by string comparison with no date parsing.
 *
 * @param rows every structure row, of any kind
 * @returns the newest row per channel id, in no particular order
 */
function latestPerChannel({ rows }: { rows: readonly StructureBronzeRow[] }): readonly StructureBronzeRow[] {
  const newest = new Map<string, StructureBronzeRow>();
  for (const row of rows) {
    if (row.kind !== "channel") {
      continue;
    }
    const held = newest.get(row.sourceId);
    if (held === undefined || row.fetchedAtIso > held.fetchedAtIso) {
      newest.set(row.sourceId, row);
    }
  }
  return [...newest.values()];
}

/**
 * Project one structure row into an atlas channel.
 *
 * @param row the structure row
 * @param readTo the newest timestamp held per conversation id
 * @returns the atlas channel
 */
function toChannel({ row, readTo }: { row: StructureBronzeRow; readTo: ReadonlyMap<string, string> }): AtlasChannel {
  const isMember = flag({ key: "isMember", row });
  const isArchived = flag({ key: "archived", row });
  const isPrivate = flag({ key: "private", row });
  const privacyKnown = row.attrs["private"] !== undefined;
  const ts = readTo.get(row.sourceId);
  // Privacy is the only gate — see {@link UnreadableReason} for the evidence that membership and archival
  // are not. A row missing `private` reads as public and therefore readable, which is the safe direction
  // here for once: over-reporting readability costs a failed call the caller sees, whereas under-reporting
  // it hides every unjoined public conversation, each one genuinely available.
  const reason: UnreadableReason | undefined = unreadableReasonFor({ isMember, isPrivate, privacyKnown });
  return {
    // A cursor for a conversation this account CANNOT read is not evidence it was read — it is a leftover,
    // and reporting it as `read-to` is the exact falsifier this feature declared: an atlas that says "I have
    // read this" about something it cannot open. A review pass produced that counterexample against an
    // earlier version, which reported coverage independently of readability and counted it in `everRead`.
    coverage: reason !== undefined || ts === undefined ? { kind: "never-read" } : { kind: "read-to", ts },
    id: row.sourceId,
    isArchived,
    isMember,
    isPrivate,
    name: row.identity.name,
    readable: reason === undefined,
    ...(reason !== undefined ? { unreadableReason: reason } : {}),
  };
}

/**
 * The newest timestamp per conversation, read out of Slack permalinks.
 *
 * This is the TRUE coverage signal: every ingested record carries its own permalink, which encodes both the
 * conversation and the timestamp, so "what have I actually got" needs no interpretation of record bodies.
 * It exists because the thread-cursor store alone was wrong — see {@link readToByChannel}.
 *
 * Timestamps compare as seconds-then-fraction rather than as floats, matching `live/slack/selection.ts`: a
 * Slack `ts` needs sixteen significant digits, which is where a double starts rounding two adjacent
 * messages together.
 *
 * @param permalinks any iterable of Slack archive URLs; anything unparseable is skipped
 * @returns the newest timestamp seen per conversation id
 */
export function readToFromPermalinks({ permalinks }: { permalinks: Iterable<string> }): ReadonlyMap<string, string> {
  const newest = new Map<string, string>();
  for (const link of permalinks) {
    const match = PERMALINK.exec(link);
    if (match === null) {
      continue;
    }
    const channel = match[1]!;
    const ts = `${match[2]!}.${match[3]!}`;
    const held = newest.get(channel);
    if (held === undefined || isAfterTs({ anchor: held, ts })) {
      newest.set(channel, ts);
    }
  }
  return newest;
}

/** A Slack archive permalink: the conversation id, then the timestamp with its dot stripped. */
const PERMALINK = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/;

/**
 * Combine several read-to maps, keeping the newest timestamp for each conversation.
 *
 * Two sources disagree in both directions, so neither alone is right: bronze holds what `refresh` ingested,
 * and the thread cursors hold replies a targeted read pulled in. Taking the max is the only combination that
 * cannot report a channel as less-read than it is.
 *
 * @param maps the read-to maps to merge, in any order
 * @returns one map holding the newest timestamp seen for each conversation
 */
export function mergeReadTo({ maps }: { maps: readonly ReadonlyMap<string, string>[] }): ReadonlyMap<string, string> {
  const newest = new Map<string, string>();
  for (const map of maps) {
    for (const [channel, ts] of map) {
      const held = newest.get(channel);
      if (held === undefined || isAfterTs({ anchor: held, ts })) {
        newest.set(channel, ts);
      }
    }
  }
  return newest;
}

/**
 * Collapse the per-THREAD reply cursors into one read-to timestamp per conversation.
 *
 * **This is a PARTIAL signal and must never be the only one** — the defect that taught us so is worth
 * keeping written down. The cursor store only gains an entry when a channel has THREADED replies, so a
 * channel of top-level-only messages never appears in it. Alert channels are exactly that shape, and the
 * atlas duly reported alert channels the owner is a member of as "never read" when `refresh` had
 * already ingested some of them. Pair it with {@link readToFromPermalinks} via {@link mergeReadTo}.
 *
 * @param cursors the `<channel>:<threadTs>` → last-seen-reply map, as stored
 * @returns the newest timestamp seen per conversation id
 */
export function readToByChannel({ cursors }: { cursors: ReadonlyMap<string, string> }): ReadonlyMap<string, string> {
  const newest = new Map<string, string>();
  for (const [key, ts] of cursors) {
    const colon = key.indexOf(":");
    if (colon <= 0 || ts.length === 0) {
      continue;
    }
    const channel = key.slice(0, colon);
    const held = newest.get(channel);
    if (held === undefined || isAfterTs({ anchor: held, ts })) {
      newest.set(channel, ts);
    }
  }
  return newest;
}

/**
 * Whether one Slack timestamp is strictly after another, compared as digit strings so no width rounds.
 *
 * @param ts the candidate timestamp
 * @param anchor the timestamp to beat
 * @returns true when `ts` is the later moment
 */
function isAfterTs({ ts, anchor }: { ts: string; anchor: string }): boolean {
  const [aSec = "", aFrac = ""] = ts.split(".");
  const [bSec = "", bFrac = ""] = anchor.split(".");
  const secWidth = Math.max(aSec.length, bSec.length);
  const aS = aSec.padStart(secWidth, "0");
  const bS = bSec.padStart(secWidth, "0");
  if (aS !== bS) {
    return aS > bS;
  }
  const fracWidth = Math.max(aFrac.length, bFrac.length);
  return aFrac.padEnd(fracWidth, "0") > bFrac.padEnd(fracWidth, "0");
}

/**
 * The channels worth looking at that nobody has looked at — the atlas's answer to its own coverage question.
 *
 * **Archived channels are excluded, and joined ones sort first.** Both rules come from running this against
 * the real workspace rather than from taste: archived channels sat throughout the unfiltered list, and the
 * channels the owner had actually joined and that were still live were buried among them. A list where the
 * useful answer is a fraction of the rows is a report, not a tool — which is precisely the failure this feature declared as
 * its own falsifier, so it is fixed rather than argued with.
 *
 * Archived is the right thing to drop because nothing new will ever arrive in one: a channel that is closed
 * and was never read is not work anybody will do. It is NOT silently dropped — the count travels in
 * {@link SlackAtlas.counts.neverReadArchived} and the renderer states it, because an omission nobody
 * mentions is the defect class this codebase refuses everywhere else.
 *
 * @param atlas the built atlas
 * @returns the live, readable, never-read channels — joined first, then by id
 */
export function neverLookedAt({ atlas }: { atlas: SlackAtlas }): readonly AtlasChannel[] {
  return atlas.channels
    .filter((c) => c.readable && c.coverage.kind === "never-read" && !c.isArchived)
    .toSorted((a, b) => Number(b.isMember) - Number(a.isMember) || a.id.localeCompare(b.id));
}

/**
 * Conversations this account cannot open, with the reason — the answer to "you were tagged somewhere you
 * cannot read".
 *
 * @param atlas the built atlas
 * @returns the unreadable channels, in the atlas's own order
 */
export function unreadable({ atlas }: { atlas: SlackAtlas }): readonly AtlasChannel[] {
  return atlas.channels.filter((c) => !c.readable);
}

/**
 * Look one conversation up by id.
 *
 * Exists so a caller asking "can I read this before I try" performs a lookup rather than re-deriving
 * readability from flags, which is the place that judgement drifts.
 *
 * @param atlas the built atlas
 * @param channelId the conversation id
 * @returns the channel, or undefined when the map has never seen it
 */
export function atlasChannel({ atlas, channelId }: { atlas: SlackAtlas; channelId: string }): AtlasChannel | undefined {
  return atlas.channels.find((c) => c.id === channelId);
}
