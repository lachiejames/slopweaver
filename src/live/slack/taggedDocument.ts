/**
 * The `slopweaver slack tagged` document — every recent Slack message that tagged the owner, newest first,
 * each with its permalink, merged from the local corpus and a live search of the tail the corpus has not
 * ingested yet.
 *
 * ## Why two legs, and why neither is the answer on its own
 *
 * The corpus lags the clock — MEASURED by `./searchMessages.ts`, a twenty-five-hour blind window —
 * and the newest tags are the ones the owner is asking about. Slack's search sees that tail, but collapses matches that
 * sit close together by documentation, so a burst of tags in one thread can come back as one hit. The corpus
 * holds every copy it ingested. A row is therefore keyed on the message's own identity, `channel:ts`, and a
 * message both legs found is one row marked `both`. The corpus `sourceId` is NOT that identity for a reply
 * (`C:rootTs:reply:ts`), which is why the reader keys on `messageKeyOf` rather than on the id itself.
 *
 * ## `answered` is asymmetric on purpose
 *
 * `true` means a later message of the owner's sits in the same thread (or, for a one-to-one DM, the same conversation),
 * seen in either leg. `false` is only ever said of a corpus row, and means no such reply up to that row's own
 * horizon — the earliest of how far its channel was crawled, the corpus's newest message and the run's instant.
 * The corpus holds every copy it ingested, so that much is a fact. A reply after it is seen only when live search
 * returns one, and search collapsing proximate matches means not finding it proves nothing, so every `false` is
 * printed with its horizon. A row found by live search alone with no reply found is `null`.
 *
 * ## Unread state is not exposed, and the document says so on every run
 *
 * Neither the corpus nor Slack's search carries whether the owner has SEEN a message, so every row is listed read or
 * not. That sentence is the residue's first line (`./taggedResidue.ts`), on a zero-row document too: the question
 * that asked for this verb was about unread tags, and the one thing this verb cannot say is which ones.
 *
 * Pure: no clock, no filesystem, no network. The reader (`cli/commands/slack/taggedRead.ts`) supplies resolved
 * candidates, so nothing here imports a CLI type. Rendering is `./taggedRender.ts`.
 */

import { taggedResidue } from "./taggedResidue.js";
import type {
  OwnerTrail,
  SlackTaggedDocument,
  SlackTaggedRow,
  TaggedCandidate,
  TaggedCorpusLeg,
  TaggedLiveLeg,
} from "./taggedTypes.js";

/**
 * The room a row names: `a direct message` for a DM, `#name` for a named channel, the id otherwise.
 *
 * @param channelId the conversation id
 * @param channelName the name the record carried, when it carried one
 * @returns the room label
 */
function roomLabel({ channelId, channelName }: { channelId: string; channelName: string | undefined }): string {
  if (channelId.startsWith("D")) {
    return "a direct message";
  }
  if (channelName === undefined || channelName.length === 0) {
    return channelId;
  }
  return channelName.startsWith("#") ? channelName : `#${channelName}`;
}

/**
 * Whether either trail holds a word of the owner's later than one tag.
 *
 * @param candidate the tag
 * @param trails every trail the legs produced
 * @returns true when a later message of the owner's sits in the thread, or anywhere in a one-to-one DM
 */
function answeredSince({ candidate, trails }: { candidate: TaggedCandidate; trails: readonly OwnerTrail[] }): boolean {
  return trails.some((trail) => {
    const inThread = trail.byThread.get(candidate.threadKey);
    if (inThread !== undefined && inThread > candidate.ownTs) {
      return true;
    }
    const inDm = trail.byDm.get(candidate.channelId);
    return inDm !== undefined && inDm > candidate.ownTs;
  });
}

/** One merged candidate and where it came from. */
interface Merged {
  readonly candidate: TaggedCandidate;
  readonly source: SlackTaggedRow["source"];
}

/**
 * Merge both legs' candidates on the message's identity, the corpus copy winning — its permalink has no
 * `?thread_ts=` query and its author was resolved against the same index either way.
 *
 * @param corpus the corpus leg's candidates
 * @param live the live leg's candidates
 * @returns one entry per message
 */
function mergeCandidates({
  corpus,
  live,
}: {
  corpus: readonly TaggedCandidate[];
  live: readonly TaggedCandidate[];
}): readonly Merged[] {
  const merged = new Map<string, Merged>();
  for (const candidate of corpus) {
    merged.set(candidate.messageKey, { candidate, source: "corpus" });
  }
  for (const candidate of live) {
    const held = merged.get(candidate.messageKey);
    if (held === undefined) {
      merged.set(candidate.messageKey, { candidate, source: "live" });
    } else if (held.source === "corpus") {
      merged.set(candidate.messageKey, { candidate: held.candidate, source: "both" });
    }
  }
  return [...merged.values()];
}

/**
 * Newest tag first, then permalink ascending, so two runs over the same inputs print the same order.
 *
 * @param a one row
 * @param b another row
 * @returns the comparator's sign
 */
function byNewest({ a, b }: { a: SlackTaggedRow; b: SlackTaggedRow }): number {
  if (a.taggedAtIso !== b.taggedAtIso) {
    return a.taggedAtIso > b.taggedAtIso ? -1 : 1;
  }
  if (a.permalink === b.permalink) {
    return 0;
  }
  return a.permalink < b.permalink ? -1 : 1;
}

/**
 * The earliest of several instants, every one an ISO 8601 string in UTC so they compare as text.
 *
 * @param instants the instants to compare, at least one
 * @returns the earliest
 */
function earliest({ instants }: { instants: readonly [string, ...string[]] }): string {
  return instants.reduce((min, one) => (one < min ? one : min));
}

/**
 * The newest instant a `false` answered flag holds to, over the whole corpus: its newest message, or the run's
 * own instant when that is earlier, since nothing after it was read.
 *
 * @param corpus the corpus leg
 * @param nowIso the run's own instant
 * @returns the horizon, or null when the corpus names none or could not be read
 */
function corpusHorizon({ corpus, nowIso }: { corpus: TaggedCorpusLeg; nowIso: string }): string | null {
  if (corpus.kind !== "read" || corpus.newestIso === undefined) {
    return null;
  }
  return earliest({ instants: [corpus.newestIso, nowIso] });
}

/**
 * One merged candidate as a row, its horizon capped by how far its own channel was crawled.
 *
 * @param merged the candidate and its source
 * @param trails every trail the legs produced
 * @param channelReach channel id → that channel's own crawl cursor
 * @param horizon the corpus-wide horizon, or null when it names none
 * @returns the row
 */
function rowOf({
  merged,
  trails,
  channelReach,
  horizon,
}: {
  merged: Merged;
  trails: readonly OwnerTrail[];
  channelReach: ReadonlyMap<string, string>;
  horizon: string | null;
}): SlackTaggedRow {
  const { candidate, source } = merged;
  let answered: boolean | null = answeredSince({ candidate, trails });
  if (!answered && source === "live") {
    answered = null;
  }
  const reach = channelReach.get(candidate.channelId);
  let answeredThroughIso: string | null = null;
  if (source !== "live" && reach !== undefined && horizon !== null) {
    answeredThroughIso = earliest({ instants: [reach, horizon] });
  }
  return {
    answered,
    answeredThroughIso,
    authorId: candidate.authorId,
    authorKnown: candidate.authorKnown,
    authorName: candidate.authorName,
    channelId: candidate.channelId,
    permalink: candidate.permalink,
    room: roomLabel({ channelId: candidate.channelId, channelName: candidate.channelName }),
    source,
    taggedAtIso: candidate.tsIso,
    text: candidate.text,
  };
}

/**
 * What the live leg's state reads as on the document.
 *
 * @param live the live leg
 * @returns the coverage label
 */
function liveLabel({ live }: { live: TaggedLiveLeg }): SlackTaggedDocument["coverage"]["live"] {
  if (live.kind === "read") {
    return live.incomplete.length === 0 ? "read" : "incomplete";
  }
  return live.kind;
}

/**
 * Whether part of the window is one nothing read: the corpus stops before the run's instant and the live search,
 * the leg that reads that tail, did not run. Any gap counts — a minute of it is as unread as a week.
 *
 * @param corpus the corpus leg
 * @param live the live leg
 * @param nowIso the run's own instant
 * @returns true when a tail of the window went unread
 */
function tailUnread({
  corpus,
  live,
  nowIso,
}: {
  corpus: TaggedCorpusLeg;
  live: TaggedLiveLeg;
  nowIso: string;
}): boolean {
  return corpus.kind === "read" && corpus.newestIso !== undefined && corpus.newestIso < nowIso && live.kind !== "read";
}

/**
 * The document status: unavailable when the corpus could not be read; incomplete when either leg lost something
 * it set out to read, the corpus names no newest message or no channel's own crawl cursor, a listed row's channel
 * records no cursor, a tail of the window went unread, or the members index could not tell a person from a bot;
 * complete otherwise. So `--corpus-only` is complete only when the corpus already reaches the run's instant.
 *
 * @param corpus the corpus leg
 * @param live the live leg
 * @param nowIso the run's own instant
 * @param membersProblem why the members index could not be read, when it could not
 * @param unreachedRows how many listed rows sit in a channel that records no reach of its own
 * @returns the status
 */
function statusOf({
  corpus,
  live,
  nowIso,
  membersProblem,
  unreachedRows,
}: {
  corpus: TaggedCorpusLeg;
  live: TaggedLiveLeg;
  nowIso: string;
  membersProblem: string | null;
  unreachedRows: number;
}): SlackTaggedDocument["status"] {
  if (corpus.kind === "unavailable") {
    return "unavailable";
  }
  const liveLost = live.kind === "unavailable" || (live.kind === "read" && live.incomplete.length > 0);
  // A corpus naming no newest message, or no channel's own cursor, cannot say how far it reaches, so nothing it
  // lacks can be read as absent — and a row whose channel records no cursor has a `false` bounded by nothing.
  const reachUnknown = corpus.newestIso === undefined || corpus.channelReach.size === 0 || unreachedRows > 0;
  const lost = corpus.unparsed > 0 || liveLost || reachUnknown || membersProblem !== null;
  return lost || tailUnread({ corpus, live, nowIso }) ? "incomplete" : "complete";
}

/**
 * Merge both legs into rows, newest first, keeping only tags a person wrote — and none at all when the corpus
 * could not be read, since the live leg alone is never presented as the whole picture.
 *
 * @param corpus the corpus leg
 * @param live the live leg
 * @param horizon the corpus-wide horizon a `false` may hold to, or null when it names none
 * @returns the rows, and how many merged tags a non-person wrote
 */
function rowsOf({ corpus, live, horizon }: { corpus: TaggedCorpusLeg; live: TaggedLiveLeg; horizon: string | null }): {
  rows: readonly SlackTaggedRow[];
  excludedNonHuman: number;
} {
  const trails = [...(corpus.kind === "read" ? [corpus.trail] : []), ...(live.kind === "read" ? [live.trail] : [])];
  const merged = mergeCandidates({
    corpus: corpus.kind === "read" ? corpus.candidates : [],
    live: live.kind === "read" ? live.candidates : [],
  });
  const people = merged.filter((one) => one.candidate.authorIsHuman);
  const excludedNonHuman = merged.length - people.length;
  if (corpus.kind !== "read") {
    return { excludedNonHuman, rows: [] };
  }
  const rows = people
    .map((one) => rowOf({ channelReach: corpus.channelReach, horizon, merged: one, trails }))
    .toSorted((a, b) => byNewest({ a, b }));
  return { excludedNonHuman, rows };
}

/**
 * Build the document both legs produced.
 *
 * @param corpus the corpus leg
 * @param live the live leg
 * @param nowIso the run's own instant
 * @param windowDays how many days back both legs looked
 * @param sinceIso the window's start
 * @param membersProblem why the Slack members index is absent or unreadable, null when it read cleanly — a bot
 *   the index does not know is then indistinguishable from a person, so the run cannot be complete
 * @returns the document, `unavailable` with zero rows when the corpus could not be read — the live leg alone is
 *   never presented as the whole picture
 */
export function slackTaggedDocument({
  corpus,
  live,
  nowIso,
  windowDays,
  sinceIso,
  membersProblem,
}: {
  corpus: TaggedCorpusLeg;
  live: TaggedLiveLeg;
  nowIso: string;
  windowDays: number;
  sinceIso: string;
  membersProblem: string | null;
}): SlackTaggedDocument {
  const horizon = corpusHorizon({ corpus, nowIso });
  const { rows, excludedNonHuman } = rowsOf({ corpus, horizon, live });
  const unknownAuthors = rows.filter((row) => !row.authorKnown).length;
  const unreachedRows = rows.filter((row) => row.source !== "live" && row.answeredThroughIso === null).length;
  const tailUnreadFrom = tailUnread({ corpus, live, nowIso }) ? horizon : null;
  return {
    counts: {
      excludedNonHuman,
      listed: rows.length,
      unanswered: rows.filter((row) => row.answered === false).length,
      unknownAuthors,
    },
    coverage: {
      answeredThroughIso: horizon,
      corpusNewestIso: corpus.kind === "read" && corpus.newestIso !== undefined ? corpus.newestIso : null,
      live: liveLabel({ live }),
      residue: taggedResidue({
        corpus,
        excludedNonHuman,
        live,
        membersProblem,
        tailUnreadFrom,
        unknownAuthors,
        unreachedRows,
      }),
      sinceIso,
      windowDays,
    },
    observedAtIso: nowIso,
    producer: "slack tagged",
    rows,
    status: statusOf({ corpus, live, membersProblem, nowIso, unreachedRows }),
  };
}
