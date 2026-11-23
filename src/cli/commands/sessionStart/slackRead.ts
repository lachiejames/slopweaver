/**
 * The Slack leg's one effectful read: a streaming prefilter over bronze, never a corpus load.
 *
 * ## Why this scans rather than retrieves, and why that is the whole design
 *
 * The retired ranked-bronze readers loaded the corpus into V8 and ranked it. On this real home that path is
 * not available and
 * never will be — `readCorpusDir` refuses with `CORPUS_HEAP_CEILING` (measured: a few
 * dozen files, nearly twice its 4.5 GB limit), which is why the store verbs select rows instead. A leg that called it
 * would inherit that refusal for a job that never needed retrieval.
 *
 * Session-start needs an exact-match prefilter on a handful of identifiers, which is a line-at-a-time scan
 * with constant heap. {@link ../../../corpus/corpusStore.readJsonlLines} is the only reader in this repo
 * allowed to touch a data-scale `.jsonl`, and it bounds the transient at one chunk plus one line whatever
 * the file's size — which matters here, because the compacted Slack window alone is several gigabytes.
 *
 * ## Two passes, because one cannot answer the question — and only two, because a third was not needed
 *
 * Pass one keeps only lines carrying the owner's own id, remembering the owner's latest message per thread so a row can say
 * when the owner last spoke. Pass two re-reads the same files keeping only lines whose thread is in that set, and
 * remembers the latest message per thread. The second pass cannot be folded into the first: the message
 * that decides a thread — somebody else's reply — carries the owner's id nowhere at all.
 *
 * ## Two consumers, one detector
 *
 * `session-start` reads {@link SlackRead.inputs}; `slopweaver slack owed` reads
 * {@link SlackRead.movementThreads} through `slackOwedThreads`. Both go through the same pure filter in
 * `sessionStart/slackLeg.ts`, so the standing read and the session list cannot disagree about a thread.
 * `slopweaver slack awaiting` reads {@link SlackRead.awaitingCandidates} — the same followed threads judged the
 * other way round, where the last person's word is the owner's — kept from pass two's own parse.
 *
 * **Both detectors ride pass one's single prefilter.** A message tagging the owner carries `<@ownerId>`, so it
 * already passes the `line.includes(ownerId)` gate that a scan for the owner's own messages had to run regardless.
 * Pass one therefore collects two things — the threads the owner SPOKE in, and the latest message TAGGING the owner per
 * thread — and the mention detector costs no additional walk over several gigabytes. A third pass was the obvious
 * shape and was not taken for exactly that reason.
 *
 * ## The two detectors are disjoint, by one rule rather than by care
 *
 * A thread the owner spoke in inside the window never becomes a mention row. That single suppression is both the
 * finding's has-the-owner-answered-since filter and the guarantee that one thread never produces two rows, since
 * the movement detector's threads are a subset of the spoken set. Quantified on a real corpus: a few dozen
 * distinct mention threads in the window, nearly all absent from the owner's top list, about a dozen
 * surviving this rule.
 *
 * ## The join key is `sourceId`, deliberately, and this is the redaction trap
 *
 * Bronze `raw.ts` and `raw.thread_ts` have their integer seconds replaced by a `[number]` placeholder, so a
 * thread key rebuilt from those fields is only the six-digit fraction — it works, and it collides. The
 * record's own `sourceId` carries the real `channel:ts` and is what this reads instead.
 *
 * ## An absent Slack corpus is an ordinary state; an unreadable one is not
 *
 * A home with no Slack bronze yields no threads and no reason, exactly as it should. A file that exists and
 * cannot be read carries the typed {@link ../../../lib/ingestError.IngestError} back to the verb, which
 * prints it beside the other legs' rows. That is the defect class `slopweaver audit run` shipped — a read
 * that refused, turned into an empty result by a `: []`, printed as `0 records` beside a report saying
 * several gigabytes — and the difference is that the reason travels with the empty answer.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { loadProfile } from "../../../profileStore.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import type { SlackAwaitingCandidate } from "../../../sessionStart/slackAwaiting.js";
import { type SlackMention, type SlackThread, slackLeg, slackMentionLeg } from "../../../sessionStart/slackLeg.js";
import { awaitingCandidatesOf } from "./slackAwaitingRead.js";
import { authorIsHuman, displayNameOf, type MemberFacts, memberIndex, selfBotIds } from "./slackPeople.js";
import type { SlackRow } from "./slackRow.js";
import { namesAnybody, tagsOwner, tagsUser } from "./slackRow.js";
import { latestPerThread, spokenInThreads } from "./slackScan.js";
import { ownerStartedThread, type ThreadFacts } from "./slackThreadFacts.js";

/** How much of a last message a row quotes. Long enough to recognise, short enough not to be a wall. */
const QUOTE_CHARS = 140;

/**
 * How far back a run looks. Fourteen days is what the leg's yield measurements were taken over.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const WINDOW_DAYS = 14;

/**
 * What one Slack read produced, including why it produced nothing when it did.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface SlackRead {
  /**
   * Whether the read could see what it set out to. `unavailable` when no owner id is declared or a file
   * could not be read — never an empty `complete`, which would read as "nothing is owed". `incomplete` when
   * the read ran but a line belonging to a thread it follows could not be parsed, so a reply may be missing
   * from what it reports.
   */
  readonly status: "complete" | "incomplete" | "unavailable";
  /** Every thread that moved without the owner, BEFORE the non-human filter — `slackOwedThreads` applies it. */
  readonly movementThreads: readonly SlackThread[];
  /** Every thread the owner spoke in, as `slack awaiting` judges it — BEFORE any selection; `slackAwaitingThreads` applies it. */
  readonly awaitingCandidates: readonly SlackAwaitingCandidate[];
  /** The threads that survived, already mapped to ranker input. */
  readonly inputs: readonly RankInput[];
  /** How many threads the owner spoke in, so the verb can say what fraction became rows. */
  readonly threadsSpokenIn: number;
  /** How many of those moved on without the owner, before the non-human filter. */
  readonly movedWithoutOwner: number;
  /** How many threads tagged the owner inside the window, before the has-the-owner-answered rule. */
  readonly threadsTagging: number;
  /** How many of those the owner has not spoken in since, before the non-human filter. */
  readonly taggedWithoutOwner: number;
  /** What this leg could not see, in the words the verb prints. */
  readonly couldNotSee: readonly string[];
  /** The typed reason the leg produced nothing, present ONLY when a file could not be read. */
  readonly refusal?: IngestError;
  /** Present when the run's `--deadline` stopped the scan part-way, so nothing it read is reported. */
  readonly cut?: true;
}

/** Why a Slack leg the deadline stopped reports nothing: half a scan would read as threads that never moved. */
export const SLACK_CUT_SHORT_LINE =
  "not read, your Slack threads: the bronze scan stopped at this run's --deadline, so the list is cut short";

/**
 * Every Slack bronze file in the home, oldest name first.
 *
 * @param home the state home to read
 * @returns the absolute paths, or the typed reason the directory could not be listed
 */
export function slackFiles({ home }: { home: string }): { paths: readonly string[] } | { refusal: IngestError } {
  const dir = bronzeSourceDir({ home, source: "slack" });
  const listed = safeFs({ execute: () => readdirSync(dir), operation: "readdir", path: dir });
  if (listed.isErr()) {
    // An absent directory is a home with no Slack corpus, which is an ordinary state rather than a failure.
    if (listed.error.code === "ENOENT") {
      return { paths: [] };
    }
    return { refusal: listed.error };
  }
  return {
    paths: listed.value
      .filter((name) => name.endsWith(".jsonl"))
      .toSorted()
      .map((name) => join(dir, name)),
  };
}

/**
 * An empty leg carrying the reason it produced nothing. Always `unavailable`: every caller is a read that
 * could not see, and an absent Slack corpus never reaches here — it is an ordinary, complete empty read.
 *
 * @param reason the sentence the verb prints under `could not see:`
 * @param refusal the typed error, when a read actually failed rather than a declaration being absent
 * @returns the empty read
 */
function emptyRead({ reason, refusal }: { reason: string; refusal?: IngestError }): SlackRead {
  return {
    awaitingCandidates: [],
    couldNotSee: [reason],
    inputs: [],
    movedWithoutOwner: 0,
    movementThreads: [],
    status: "unavailable",
    taggedWithoutOwner: 0,
    threadsSpokenIn: 0,
    threadsTagging: 0,
    ...(refusal === undefined ? {} : { refusal }),
  };
}

/**
 * The empty leg for a scan that did not finish: the deadline stopped it, or a corpus file could not be read.
 *
 * @param outcome what stopped the scan
 * @returns the empty read, carrying `cut` or the typed refusal
 */
function unscanned({ outcome }: { outcome: { cut: true } | { refusal: IngestError } }): SlackRead {
  if ("cut" in outcome) {
    return { ...emptyRead({ reason: SLACK_CUT_SHORT_LINE }), cut: true };
  }
  return emptyRead({
    reason: `your Slack threads are not here, a corpus file could not be read: ${outcome.refusal.message}`,
    refusal: outcome.refusal,
  });
}

/**
 * Read the Slack corpus and turn the threads that moved without the owner into ranker input.
 *
 * @param home the state home to read
 * @param nowIso the run's own instant, supplied rather than read
 * @param stopWhen asked between chunks of the scan — `session-start`'s `--deadline`; a scan it stops reports nothing
 * @returns the leg's input, or an empty leg carrying the typed reason it could not run
 */
export function readSlackThreads({
  home,
  nowIso,
  stopWhen,
}: {
  home: string;
  nowIso: string;
  stopWhen?: () => boolean;
}): SlackRead {
  const ownerId = loadProfile({ home })?.slackBot?.ownerUserId;
  if (ownerId === undefined || ownerId.length === 0) {
    return emptyRead({
      reason:
        "your Slack threads are not here: profile.json declares no `slackBot.ownerUserId`, so nothing can tell your own messages from anybody else's",
    });
  }
  const listed = slackFiles({ home });
  if ("refusal" in listed) {
    return emptyRead({
      reason: `your Slack threads are not here, the corpus could not be listed: ${listed.refusal.message}`,
      refusal: listed.refusal,
    });
  }
  const sinceIso = new Date(Date.parse(nowIso) - WINDOW_DAYS * 86_400_000).toISOString();
  const touched = spokenInThreads({ ownerId, paths: listed.paths, sinceIso, stopWhen });
  if ("cut" in touched || "refusal" in touched) {
    return unscanned({ outcome: touched });
  }
  const scanned = latestPerThread({ keys: new Set(touched.spoken.keys()), ownerId, paths: listed.paths, stopWhen });
  if ("cut" in scanned || "refusal" in scanned) {
    return unscanned({ outcome: scanned });
  }
  const members = memberIndex({ home });
  const selfIds = selfBotIds({ home });
  const threads = threadsOf({ facts: scanned.facts, members, ownerId, ownerLatest: touched.spoken, selfIds });
  const mentions = mentionsOf({ members, selfIds, spoken: touched.spoken, tagged: touched.tagged });
  const unparsed = touched.unparsed + scanned.unparsed;
  const lostLines =
    unparsed === 0
      ? []
      : [
          `${String(unparsed)} corpus line(s) in a thread you follow, or carrying your id, did not parse as a message, so a reply or a message of yours may be missing from what is listed`,
        ];
  return {
    couldNotSee: [
      ...lostLines,
      `your Slack rows are the corpus's own copy, ${WINDOW_DAYS} days back, and nothing was re-read live — somebody may have replied for you since`,
    ],
    awaitingCandidates: awaitingCandidatesOf({ facts: scanned.facts, members, ownerId, selfIds }),
    inputs: [...slackLeg({ nowIso, threads }), ...slackMentionLeg({ mentions, nowIso })],
    movedWithoutOwner: threads.length,
    movementThreads: threads,
    status: unparsed === 0 ? "complete" : "incomplete",
    taggedWithoutOwner: mentions.length,
    threadsSpokenIn: touched.spoken.size,
    threadsTagging: touched.tagged.size,
  };
}

/**
 * Turn the mentions pass one held into the pure sub-leg's own input shape.
 *
 * **One suppression rule, and it does two jobs.** A thread the owner SPOKE in inside the window is dropped here:
 * that is the finding's has-the-owner-answered-since filter, and it is simultaneously what guarantees the two
 * detectors are disjoint, since the movement detector's threads are a subset of the spoken set. A second
 * timestamp comparison would be a second thing to keep in sync with it for no extra truth — the mention is
 * itself inside the window, so any answer to it is too.
 *
 * @param tagged the latest message tagging the owner per thread
 * @param spoken every thread the owner spoke in inside the window, keyed to the owner's latest message there
 * @param members the members index
 * @param selfIds Slopweaver's own declared bot ids
 * @returns one mention per thread the owner was tagged in and has not spoken in since
 */
function mentionsOf({
  tagged,
  spoken,
  members,
  selfIds,
}: {
  tagged: ReadonlyMap<string, SlackRow>;
  spoken: ReadonlyMap<string, SlackRow>;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): readonly SlackMention[] {
  const mentions: SlackMention[] = [];
  for (const [key, row] of tagged) {
    if (spoken.has(key)) {
      continue;
    }
    // Both segments exist because `threadKeyOf` built this key from exactly two non-empty ones.
    const segments = key.split(":");
    mentions.push({
      authorIsHuman: authorIsHuman({ author: row.author, members, selfIds }),
      authorName: displayNameOf({ author: row.author, members }),
      channelId: segments[0]!,
      mentionedIso: row.tsIso,
      permalink: row.url,
      pullRequests: row.pullRequests,
      text: row.text.replaceAll("\n", " ").trim().slice(0, QUOTE_CHARS),
      threadTs: segments[1]!,
      ...(row.channelName === undefined ? {} : { channelName: row.channelName }),
    });
  }
  return mentions;
}

/**
 * Turn the latest message per thread into the pure leg's own input shape.
 *
 * Only threads whose last word is somebody else's survive: a thread the owner closed the owner is not waiting on
 * anybody, and counting it would make the leg's yield a measure of how much the owner talks.
 *
 * **`mentionsOwner` reads the AUTHORED text, and reading the projected one was a live scoring defect.**
 * It was `row.text.includes(\`<@\${ownerId}>\`)`, and the projection never carries a mention run —
 * measured, 170 records to zero (see {@link SlackRow.authoredText}). So the field answered false for every
 * channel message ever, `addressesOwner` is `mentionsOwner || channelId.startsWith("D")`, and the whole
 * `addressed`/`asked` ladder therefore fired for direct messages alone from the day the leg shipped. The same
 * holds for `ownerLatestTagsLastAuthor`, read off the owner's latest row's authored text against the last author's id.
 *
 * **A thread with no owner row of the owner's is skipped, explicitly.** `latest` is keyed by the very threads
 * `ownerLatest` holds, so that cannot happen; a candidate that ever did would have no "you last spoke"
 * instant to report, and inventing one is worse than dropping it.
 *
 * @param facts each thread's facts from pass two, whose `latest` is the last message seen
 * @param ownerLatest the owner's latest message per thread, from pass one
 * @param ownerId the owner's own Slack id
 * @param members the members index, read once for both detectors
 * @param selfIds Slopweaver's own declared bot ids, from `profile.json`
 * @returns one thread per row that moved without the owner
 */
function threadsOf({
  facts,
  ownerLatest,
  ownerId,
  members,
  selfIds,
}: {
  facts: ReadonlyMap<string, ThreadFacts>;
  ownerLatest: ReadonlyMap<string, SlackRow>;
  ownerId: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): readonly SlackThread[] {
  const threads: SlackThread[] = [];
  for (const [key, { latest: row, ownerWords }] of facts) {
    if (row.author === ownerId) {
      continue;
    }
    const mine = ownerLatest.get(key);
    if (mine === undefined) {
      continue;
    }
    // Both segments exist because `threadKeyOf` built this key from exactly two non-empty ones.
    const segments = key.split(":");
    threads.push({
      channelId: segments[0]!,
      lastAuthorIsHuman: authorIsHuman({ author: row.author, members, selfIds }),
      lastAuthorIsSelf: selfIds.has(row.author),
      lastAuthorName: displayNameOf({ author: row.author, members }),
      lastIso: row.tsIso,
      lastNamesAnybody: namesAnybody({ row }),
      lastText: row.text.replaceAll("\n", " ").trim().slice(0, QUOTE_CHARS),
      mentionsOwner: tagsOwner({ ownerId, row }),
      ownerLastIso: mine.tsIso,
      ownerLatestTagsLastAuthor: tagsUser({ row: mine, userId: row.author }),
      ownerStartedThread: ownerStartedThread({ ownerWords }),
      permalink: row.url,
      threadTs: segments[1]!,
      ...(row.channelName === undefined ? {} : { channelName: row.channelName }),
    });
  }
  return threads;
}
