/**
 * The console's live channel window (`./channelView.ts`) as lines for a terminal, what `slack channel-view` prints
 * without `--json`. Held apart from the document's shaping, which is what the console reads.
 */
import type { ChannelViewDocument, ChannelViewFile } from "./channelView.js";
import type { VisibleSlackAuthor } from "./types.js";

/** Who wrote a message, for the text rendering: the member's name when bronze has it, else what Slack gave. */
function authorLabel({ author, names }: { author: VisibleSlackAuthor; names: ReadonlyMap<string, string> }): string {
  if (author.userId !== undefined) {
    const named = names.get(author.userId);
    if (named === undefined) {
      return author.userId;
    }
    return named;
  }
  if (author.username !== undefined) {
    return author.username;
  }
  if (author.botId !== undefined) {
    return author.botId;
  }
  return "(no author)";
}

/** One file, as the text rendering says it. */
function fileLine({ file }: { file: ChannelViewFile }): string {
  const label = file.name === undefined ? file.id : `${file.id} ${file.name}`;
  if (file.shown === "picture") {
    return `    [picture ${label} → ${file.sha256}]`;
  }
  const detail = file.detail === undefined ? "" : `: ${file.detail}`;
  return `    [file ${label} — ${file.reason}${detail}]`;
}

/**
 * The document as lines for a terminal: a heading naming the channel and when it was read, then each message oldest
 * first with its files beneath it.
 *
 * @param names member id → display name, off member bronze
 * @returns the lines, in print order
 */
export function channelViewTextLines({
  document,
  names,
}: {
  document: ChannelViewDocument;
  names: ReadonlyMap<string, string>;
}): readonly string[] {
  const heading = `#${document.name} (${document.channel}) read live at ${document.observedAtIso}`;
  const lines = [document.earlierWithheld ? `${heading} — earlier messages not shown` : heading];
  for (const message of document.messages) {
    const replies = message.replyCount === 0 ? "" : ` [${String(message.replyCount)} replies]`;
    lines.push(`${message.tsIso}  ${authorLabel({ author: message.author, names })}: ${message.text}${replies}`);
    lines.push(...message.files.map((file) => fileLine({ file })));
    if (message.reactions.length > 0) {
      lines.push(
        `    [${message.reactions.map((reaction) => `:${reaction.name}: ${String(reaction.count)}`).join("  ")}]`,
      );
    }
  }
  return lines;
}
