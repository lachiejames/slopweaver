/**
 * The residue of a `slopweaver slack tagged` document: every line naming what a leg did not see, so a reader
 * never takes the rows for more than they are. The first line is always that unread state is not exposed.
 *
 * Pure: the document (`./taggedDocument.ts`) decides the facts and passes them in; this only words them.
 */

import { type TaggedCorpusLeg, type TaggedLiveLeg, UNREAD_NOT_EXPOSED } from "./taggedTypes.js";

/**
 * The lines naming what the corpus leg read, and what it could not say.
 *
 * @param corpus the corpus leg
 * @param unreachedRows how many listed rows sit in a channel that records no reach of its own
 * @returns the lines, in reading order
 */
function corpusLines({ corpus, unreachedRows }: { corpus: TaggedCorpusLeg; unreachedRows: number }): string[] {
  if (corpus.kind === "unavailable") {
    return [corpus.reason];
  }
  const lines: string[] = [];
  if (corpus.unparsed > 0) {
    lines.push(
      `${String(corpus.unparsed)} corpus line(s) carrying your id did not parse as a message, so a tag may be missing`,
    );
  }
  if (corpus.newestIso === undefined) {
    lines.push("the Slack corpus names no newest message, so how far behind it runs is unknown");
  } else {
    lines.push(
      `the corpus reaches ${corpus.newestIso} — its pooled watermark, capped by the furthest any channel was crawled; each row's "no later word" holds only as far as its own channel was read`,
    );
  }
  if (corpus.channelReach.size === 0) {
    lines.push("the Slack corpus records no channel's own crawl cursor, so how far any channel was read is unknown");
  }
  if (unreachedRows > 0) {
    lines.push(
      `${String(unreachedRows)} listed tag(s) sit in a channel that records no reach of its own, so how far their "no later word" holds is unknown`,
    );
  }
  lines.push(
    "where the corpus BEGINS is not checked: a corpus backfilled for fewer days than the window lists only the tags it holds",
  );
  return lines;
}

/**
 * The lines naming what the live leg read.
 *
 * @param live the live leg
 * @returns the lines, in reading order
 */
function liveLines({ live }: { live: TaggedLiveLeg }): string[] {
  if (live.kind === "skipped") {
    return [
      "the live search was skipped (--corpus-only), so a tag newer than the corpus is not listed, and a reply of yours newer than it is not seen",
    ];
  }
  if (live.kind === "unavailable") {
    return [`the live search did not run: ${live.reason}`];
  }
  const lines = live.incomplete.map((why) => `the live search stopped short: ${why}`);
  lines.push(
    "live search collapses tags that sit close together, so two tags in one burst may show once until the corpus catches up",
  );
  if (live.authorless > 0) {
    lines.push(`${String(live.authorless)} live hit(s) named no author, an app post, and are not listed`);
  }
  return lines;
}

/**
 * The whole residue, in reading order: unread state first, then what went unread, then each leg, then the rules
 * every row is read under.
 *
 * @param corpus the corpus leg
 * @param live the live leg
 * @param tailUnreadFrom the instant after which nothing was read, when a tail of the window went unread
 * @param membersProblem why the members index could not tell a person from a bot, when it could not
 * @param unreachedRows how many listed rows sit in a channel that records no reach of its own
 * @param excludedNonHuman how many tags a non-person wrote
 * @param unknownAuthors how many listed rows have an author the members index does not know
 * @returns the lines
 */
export function taggedResidue({
  corpus,
  live,
  tailUnreadFrom,
  membersProblem,
  unreachedRows,
  excludedNonHuman,
  unknownAuthors,
}: {
  corpus: TaggedCorpusLeg;
  live: TaggedLiveLeg;
  tailUnreadFrom: string | null;
  membersProblem: string | null;
  unreachedRows: number;
  excludedNonHuman: number;
  unknownAuthors: number;
}): readonly string[] {
  const lines = [UNREAD_NOT_EXPOSED];
  if (tailUnreadFrom !== null) {
    lines.push(
      `nothing after ${tailUnreadFrom} was read — the corpus stops there and the live search did not run — so a tag after it is not listed`,
    );
  }
  if (membersProblem !== null) {
    lines.push(`${membersProblem}, so a bot's or an app's tag may be listed as a person's`);
  }
  lines.push(
    ...corpusLines({ corpus, unreachedRows }),
    ...liveLines({ live }),
    "answered means a later message of yours in the same thread, or anywhere in a one-to-one DM; a reply elsewhere or a reaction is not seen, and a row found only by live search with no reply found is unknown",
    "no later word from you holds up to the instant its row names; a reply after it is seen only when live search returns it, and one it collapsed is not",
    "a tag later edited out of its message may still be listed, from the copy the corpus took before the edit",
    "a group mention (@here, @channel, a user group) is not a tag of you and is not listed",
    `${String(excludedNonHuman)} tag(s) by a bot, an app, Slackbot or Slopweaver are excluded; an authorless bot post in the corpus is not even counted`,
  );
  if (unknownAuthors > 0) {
    lines.push(
      `${String(unknownAuthors)} listed tag(s) are by an author the members index does not know, shown by id — a Slack Connect partner, or an app the index never saw`,
    );
  }
  return lines;
}
