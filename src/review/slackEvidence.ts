/**
 * What Slack can say about a pull request, once both legs have spoken.
 *
 * The corpus leg is `./slackEvidenceScan.ts` and the live leg is `./slackEvidenceLive.ts`. This module holds
 * only the fold that puts the two together, and that is the whole reason it can say what a disagreement
 * between them means without either leg importing the other. Nothing here decides what an ask MEANS — that is
 * `./reviewState.ts`.
 */

import type { SlackMention } from "./slackEvidenceTypes.js";

/**
 * The counterpart id to keep when both legs saw one message.
 *
 * The corpus leg never learns a direct message's other participant, so its empty string is an absence rather
 * than an answer, and the live leg's id fills it. An empty result means neither leg could name one.
 *
 * @param corpus the corpus copy, which is authoritative for everything else
 * @param live the live copy, when the search leg saw the same message
 * @returns the counterpart id, or the empty string when neither leg names one
 */
function mergedCounterpart({ corpus, live }: { corpus: SlackMention; live: SlackMention | undefined }): string {
  if (corpus.counterpartId !== "") {
    return corpus.counterpartId;
  }
  return live === undefined ? "" : live.counterpartId;
}

/**
 * Merge the two legs, keeping one row per message.
 *
 * `channel:ts` is the identity — never the permalink. The same message found by both legs is one mention,
 * and the CORPUS copy wins a collision: it carries the raw payload, so only it can tell an app post from a
 * human one, and a live copy that wrongly read as a human ask is exactly the false positive this ordering
 * prevents. The counterpart id the live leg alone can name is recovered by {@link mergedCounterpart}.
 *
 * It is why the key is the message and not the link: keyed on the permalink these legs NEVER collided,
 * because the live leg's permalink carries a `?thread_ts=…` query string and the corpus leg's does not.
 * Pull requests reported two asks for one message, or nine for six — and, far worse than the count, the
 * corpus copy never won a collision it never had, so the ordering this comment describes did nothing at all
 * for every message both legs saw.
 *
 * @param corpus what the local scan found
 * @param live what the live search found and survived judgement
 * @returns the union, newest first
 */
export function mergeMentions({
  corpus,
  live,
}: {
  corpus: readonly SlackMention[];
  live: readonly SlackMention[];
}): readonly SlackMention[] {
  const byMessage = new Map<string, SlackMention>();
  for (const mention of live) {
    byMessage.set(`${mention.prKey}|${mention.messageKey}`, mention);
  }
  for (const mention of corpus) {
    const key = `${mention.prKey}|${mention.messageKey}`;
    const seen = byMessage.get(key);
    // A copy that cannot name its author never REPLACES one that can. A pin's record is the same message
    // spelled `channel:pin:ts`, with no author and no raw payload, and file order used to decide whether it
    // overwrote the message record — turning the owner's ask into `other-human`. Found by a fallback review.
    if (mention.authorId === "" && seen !== undefined && seen.authorId !== "") {
      // The CONVERSATION still comes from the corpus copy: it is container-derived, so a pin knows it sits in
      // the owner's own bot DM exactly as well as the message does, and the live leg cannot know that at all.
      byMessage.set(key, { ...seen, conversation: mention.conversation });
      continue;
    }
    // A copy that reaches the pull request only through its THREAD never replaces one that LINKS it: the live
    // copy is the newer text, and a corpus copy that dropped the link cannot speak for what it now says. The
    // two copies disagree, so the message reads `undecided`. Found by a fallback review, where an older
    // linkless copy's thread ask displaced an edited live copy that retracted it.
    if (mention.association === "thread" && seen?.association === "linked") {
      byMessage.set(key, {
        ...seen,
        authorRole: mention.authorRole,
        conversation: mention.conversation,
        versionsDisagree: seen.authoredText !== mention.authoredText || seen.versionsDisagree,
      });
      continue;
    }
    // FIELDS are merged rather than one record chosen, because each leg knows something the other cannot.
    // The corpus carries the raw payload, so only it can say whether the app posted as itself; the live
    // leg gets Slack's own `channel` object, so only it can name a direct message's counterpart.
    byMessage.set(key, { ...mention, counterpartId: mergedCounterpart({ corpus: mention, live: seen }) });
  }
  return [...byMessage.values()].toSorted((a, b) => b.atIso.localeCompare(a.atIso));
}
