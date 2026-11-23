/**
 * Which pull request a message is about, and who it tagged — the two exact questions the review-state read
 * asks of a Slack message, answered by matching rather than by inference.
 *
 * ## Why this matches the RAW payload and not the projected text
 *
 * MEASURED over the owner's own bronze corpus: of 13,161 Slack records that link a pull
 * request in the work repository, **3,927 (29.8%) carry the URL only in `raw`** and not in the projected
 * `text` at all. Slack's own link markup is `<url|label>`, and the projection resolves that to the LABEL
 * (`../corpus/slack/visibleProse.resolveSlackMarkup`) — so the moment somebody pastes a GitHub link and Slack
 * auto-labels it with the bare number, the URL is gone from `text` and survives only in the raw payload. Reproduce with:
 *
 *     grep -c "<owner>/<repo>/pull/" "$SLOPWEAVER_HOME"/corpus/bronze/slack/*.jsonl
 *
 * A detector reading `record.text` therefore reports "never raised in Slack" for nearly a third of the
 * messages that raised it, including messages whose visible prose is literally a review bump. That is not a
 * subtle probabilistic gap — it is a seam, and it is why {@link slackHaystack} concatenates the raw payload.
 *
 * ## Why a tag is structural and an `@handle` is not
 *
 * A literal `@handle` typed into prose is INERT: Slack keeps it as characters, it pings nobody, and it fires
 * no listener. Only a mention RUN (`<@U…>`, `<!subteam^S…>`) addresses a person. The owner's rule for this
 * read is exactly that distinction — a posted link is not a tag; a tag is an explicit mention of a person next
 * to the link — so {@link taggedIn} recognises the structural form ONLY. A looser reading belongs to a
 * different question ("was it raised with someone"), which `../pane/sections/slackAsk.ts` answers separately.
 *
 * Pure. No I/O, no clock.
 */

import { isRecord } from "../lib/parsers.js";
import type { MentionRun, TextSpan } from "./evidence.js";

/** One pull request a message referred to, as the link itself spells it. */
export interface PrLinkRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * A GitHub pull-request (or issue) link, in every spelling Slack stores.
 *
 * The scheme is optional because Slack drops it when it renders a bare link, and `issues` is accepted
 * alongside `pull` because GitHub itself serves a pull request under both paths — the Linear link-back
 * comment writes the `issues` form for a pull request, and a person quoting that comment carries it into
 * Slack. The trailing `(?!\d)` is the whole reason this is not a substring test: a link to a short number
 * occurs inside a link to a longer one that starts with the same digits, so without it a message about the
 * longer number is reported as being about the shorter.
 *
 * Every quantifier is bounded and none is nested, so the match cost is linear in the input.
 */
const PR_LINK = /github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})\/(?:pull|issues)\/(\d{1,12})(?!\d)/g;

/** A Slack mention RUN — a person (`<@U…>`/`<@W…>`) or a user group (`<!subteam^S…>`). Never a bare handle. */
const MENTION_RUN = /<@([UW][A-Z0-9]{1,30})>|<!subteam\^([S][A-Z0-9]{1,30})/g;

/**
 * The Slack id one mention-run match names — a person or a user group, whichever alternative matched.
 *
 * @param match one match of the mention-run pattern
 * @returns the person or group id, or undefined when neither alternative captured one
 */
function mentionIdOf({ match }: { match: RegExpMatchArray }): string | undefined {
  const [, person, group] = match;
  if (person !== undefined) {
    return person;
  }
  return group;
}

/**
 * Where the first of a message's pull-request links starts, or -1 when it links none — the offset a heading
 * is measured against.
 *
 * @param spans every link occurrence, in the order written, as {@link findPrLinkSpans} returns them
 * @returns the first link's start offset, or -1 for a message with no link of its own
 */
export function firstLinkStart({ spans }: { spans: readonly { readonly span: TextSpan }[] }): number {
  const [first] = spans;
  if (first === undefined) {
    return -1;
  }
  return first.span.start;
}

/**
 * Every pull request a message links, deduped, in first-seen order.
 *
 * @param haystack the text to scan — pass {@link slackHaystack}, not a projected body
 * @returns each distinct `owner/repo#number` the text links
 */
export function findPrLinks({ haystack }: { haystack: string }): readonly PrLinkRef[] {
  const seen = new Set<string>();
  const found: PrLinkRef[] = [];
  for (const match of haystack.matchAll(PR_LINK)) {
    const [, owner = "", repo = "", digits = ""] = match;
    const key = `${owner}/${repo}#${digits}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found.push({ number: Number(digits), owner, repo });
  }
  return found;
}

/**
 * Whether a message links one exact pull request.
 *
 * @param haystack the text to scan — pass {@link slackHaystack}
 * @param ref the pull request to look for
 * @returns whether that exact pull request is linked
 */
export function linksPrExactly({ haystack, ref }: { haystack: string; ref: PrLinkRef }): boolean {
  return findPrLinks({ haystack }).some(
    (link) => link.number === ref.number && link.owner === ref.owner && link.repo === ref.repo,
  );
}

/**
 * Every Slack id a message structurally tagged — people and user groups alike, deduped, first-seen order.
 *
 * A group id is returned beside the people rather than dropped: `@platform` next to a pull-request link IS an
 * explicit ask, it simply reaches a set rather than a person, and a caller that must address one human can
 * tell the two apart by the leading letter (`U`/`W` a person, `S` a group).
 *
 * @param haystack the text to scan — pass {@link slackHaystack}
 * @returns the tagged Slack ids
 */
export function taggedIn({ haystack }: { haystack: string }): readonly string[] {
  const found: string[] = [];
  for (const match of haystack.matchAll(MENTION_RUN)) {
    const id = mentionIdOf({ match });
    if (id !== undefined && !found.includes(id)) {
      found.push(id);
    }
  }
  return found;
}

/**
 * Everything a Slack corpus record can say about itself, as one string to match against.
 *
 * The raw payload comes FIRST and is the load-bearing half — see this module's own note on the 29.8%
 * measurement. The projected text is appended rather than trusted alone, so a record written before `raw` was
 * retained still matches on whatever its projection kept.
 *
 * @param record the corpus record's own fields — `raw` as stored, `text` as projected
 * @returns one string carrying both, for {@link findPrLinks} and {@link taggedIn}
 */
export function slackHaystack({ record }: { record: { readonly raw?: unknown; readonly text: string } }): string {
  const raw = isRecord(record.raw) ? JSON.stringify(record.raw) : "";
  return `${raw}\n${record.text}`;
}

/**
 * The author's OWN visible words — never a quoted attachment, never the raw payload.
 *
 * {@link slackHaystack} deliberately flattens the whole raw payload because 29.8% of linking messages carry
 * the URL only there, and that is right for DISCOVERY. It is wrong for attribution: an unfurled attachment
 * quoting somebody else's message is not the quoting author's words. MEASURED: a bump message the owner
 * walked through carries no GitHub link in its own text at all and reaches the matcher purely through
 * `attachments[].fallback`, so a rule reading the haystack attributes a link the owner never wrote to them.
 *
 * Slack's own `text` on the raw payload is the authored half; the projection is the fallback for a record
 * written before `raw` was retained.
 *
 * @param record the corpus record's own fields
 * @returns the author's visible text, empty when neither half carries any
 */
export function authoredTextOf({ record }: { record: { readonly raw?: unknown; readonly text: string } }): string {
  const raw = isRecord(record.raw) ? record.raw["text"] : undefined;
  return typeof raw === "string" ? raw : record.text;
}

/**
 * Every pull-request link in a string, WITH where it sits — the offsets a recipient is scoped by.
 *
 * Unlike {@link findPrLinks} this keeps every occurrence rather than deduping, because a message can link
 * the same pull request in a struck-out ask and again in the body it kept, and only the positions tell those
 * apart.
 *
 * @param text the string to scan — the AUTHORED text, not a haystack
 * @returns one entry per occurrence, in the order written
 */
export function findPrLinkSpans({
  text,
}: {
  text: string;
}): readonly { readonly ref: PrLinkRef; readonly span: TextSpan }[] {
  const found: { readonly ref: PrLinkRef; readonly span: TextSpan }[] = [];
  for (const match of text.matchAll(PR_LINK)) {
    const [whole = "", owner = "", repo = "", digits = ""] = match;
    found.push({
      ref: { number: Number(digits), owner, repo },
      span: { end: match.index + whole.length, start: match.index, text: whole },
    });
  }
  return found;
}

/**
 * Every mention run in a string, WITH where it sits — so a tag can be scoped to the line it was written on.
 *
 * @param text the string to scan — the AUTHORED text, not a haystack
 * @returns one entry per occurrence, in the order written, duplicates kept
 */
export function mentionRunsIn({ text }: { text: string }): readonly MentionRun[] {
  const found: MentionRun[] = [];
  for (const match of text.matchAll(MENTION_RUN)) {
    const id = mentionIdOf({ match });
    if (id !== undefined) {
      found.push({ id, span: { end: match.index + match[0].length, start: match.index, text: match[0] } });
    }
  }
  return found;
}
