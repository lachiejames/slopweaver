/**
 * Slack permalinks inside a row's own text — a board row's question or reason, a hand step's where — so a
 * panel can open the thread the row is about. No register carries a thread field; the link is in the prose.
 */

/** A Slack permalink, greedy to the end of its query, without the punctuation prose wraps it in. */
const LINK_SHAPE = /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+(?:\?[A-Za-z0-9_.=&]+)?/g;

/** What prose puts after a link and Slack never does. */
const TRAILING = /[).,:;!?]+$/;

/**
 * Every Slack permalink in a piece of text, in order, each trimmed of trailing prose punctuation, distinct.
 *
 * @param text the row's own words
 * @returns the links, first the first mentioned
 */
export function slackLinksIn({ text }: { text: string }): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(LINK_SHAPE)) {
    const link = match[0].replace(TRAILING, "");
    if (!out.includes(link)) {
      out.push(link);
    }
  }
  return out;
}

/**
 * The channel a permalink is in, and the thread root's `ts` when the link names one (`thread_ts=`), so a
 * held draft — which carries `channel` and `threadTs` — can be matched to it. A link with no `thread_ts` is a
 * top-level message, and its own ts is the root; that ts is spelled in the permalink as `p<seconds><micros>`
 * with the dot dropped, so it is put back — an identifier's spelling, never an instant.
 *
 * @param link the permalink
 * @returns the channel and the root ts, or `undefined` for a string that is not a permalink
 */
export function threadKeyOf({
  link,
}: {
  link: string;
}): { readonly channel: string; readonly threadTs: string } | undefined {
  const match = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p([0-9]{10})([0-9]{6})(?:\?(.*))?$/.exec(
    link,
  );
  if (match === null) {
    return undefined;
  }
  // `.at` rather than an index: it types as possibly undefined under any tsconfig, and the query group
  // really is optional.
  const channel = match.at(1);
  const seconds = match.at(2);
  const micros = match.at(3);
  if (channel === undefined || seconds === undefined || micros === undefined) {
    return undefined;
  }
  const query = match.at(4);
  const threadTs = query === undefined ? undefined : /(?:^|&)thread_ts=([0-9]+\.[0-9]+)/.exec(query)?.at(1);
  if (threadTs !== undefined) {
    return { channel, threadTs };
  }
  return { channel, threadTs: `${seconds}.${micros}` };
}
