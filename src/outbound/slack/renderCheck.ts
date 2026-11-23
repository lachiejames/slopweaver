/**
 * The RECEIPT half of the as-me lane — what Slack actually stored, read back and checked.
 *
 * Formatting defects in the owner's own lane are a class to fix. Two measured instances, both of the same
 * shape: something a reader was meant to see as
 * a MENTION or as EMPHASIS reached them as literal punctuation. `@jonahy-acme` posted as plain text, and
 * `*setTaskUrgency integration test:*` posted with its asterisks showing.
 *
 * **Why this is a read-back and not another form gate.** A form gate can only judge what a composer wrote.
 * These two defects are decided by how SLACK PARSES what we sent, and the parse differs by lane: inside a
 * `rich_text` block, mrkdwn is inert and styling has to be a typed run, while a plain `--body` string IS
 * parsed and the same characters become real styling. So the only place the question "does a reader see a
 * mention here" has one honest answer for both lanes is Slack's own stored copy of the message. That is
 * what this reads.
 *
 * **It runs AFTER the send and can never fail one.** The message is already published by the time anything
 * here has an opinion, so every path fails OPEN: an unreadable read-back reports that it could not check,
 * never that the send went wrong. This is the deliberate opposite of `./publicCardGate.ts`, which fails
 * closed because it runs BEFORE the wire and a wrong guess there is a message nobody wanted.
 *
 * **One defect class IS decidable before the wire in the `--body` lane: a broken angle-bracket link.**
 * Whether `*x*` becomes bold is Slack's call; whether `<url|label <url|#1>>` parses is not — Slack cannot
 * parse a link nested in another's label, whatever else it decides. MEASURED: exactly that
 * posted as the owner in #dev-team (`C0SYN000002`/`1790243252.027999`), a thread reply the top-level-only
 * render proof never saw, and this receipt called it clean because it knew no link shape at all. So
 * {@link plainMarkupIssues} refuses the malformed string before the wire, {@link payloadRenderIssues} is the
 * one pre-wire entry point for both forms. The receipt deliberately learned no link shape: three review passes
 * each found a WELL-FORMED message Slack stores the same way as a failed parse (an escaped `&lt;` around a
 * link, a URL ending in an encoded pipe), and a heuristic that refuses good sends inside the render proof is
 * worse than the pre-wire refusal that already stops this defect before anything is sent.
 */

import type { RichTextElement } from "@slack/types";

import { opensWithQuoteMarker } from "./blockquote.js";
import type { SlackDripMessagePayload } from "./types.js";

/** A plain object, as the only thing worth descending into. Narrower than `object` so an array takes the array branch. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A handle-shaped token that Slack did NOT turn into a mention.
 *
 * The leading boundary is what keeps `someone@example.com` and a `user@host` out of it: an `@` with a word
 * character, a dot or another `@` in front of it is part of something else. Two characters minimum after
 * the `@`, because a lone `@` in prose is punctuation rather than an attempt at addressing anybody.
 *
 * The TRAILING lookahead is a scoped npm package, and it is measured rather than defensive: a Slack handle
 * cannot contain a `/` and a scoped package always carries one straight after its scope, so `@xmldom` in
 * `bump @xmldom/xmldom` is a package name every time and a handle never. The owner's own review
 * asks end on one. `@xmldom/xmldom` closes a ten-PR message that was SENT (`C0SYN000006`/`1787942086.747699`),
 * `@clerk/clerk-react` closes a text that was APPROVED, and without this the door refuses the owner's own
 * approved words before the wire and pushes the composer at a `voice-rules` grant.
 *
 * It forbids a further NAME character as well as the slash, and that half is not decoration: a bare
 * `(?!\/)` is satisfied by BACKTRACKING, so the engine gives back the `m` and reports `@xmldo` instead —
 * a worse refusal than the one being removed. Repro:
 * `node -e 'console.log(/(?<![\w.@-])@[a-z][a-z0-9._-]+(?!\/)/i.exec("bump @xmldom/xmldom"))'` prints
 * `@xmldo`; the shipped pattern prints `null`.
 *
 * The residue, stated: prose spelling a real handle as `@jonah/something` stops being flagged. Nobody
 * writes that, and the shape it replaces was measured wrong twice on the owner's own messages.
 */
const UNRESOLVED_HANDLE = /(?<![\w.@-])@[a-z][a-z0-9._-]+(?![a-z0-9._-]|\/)/i;

/**
 * Mrkdwn emphasis that did not become styling — a marker pair around at least one visible character.
 *
 * Each arm requires the CLOSING marker too, so an ordinary asterisk, a snake_case identifier or a lone
 * backtick in prose is not a hit. `_` additionally demands a non-word character before the opening marker,
 * which is what keeps `some_field_name` out of it while still catching a real `_emphasis_`.
 */
const LITERAL_MARKUP: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\*[^*\n]+\*/, what: "*bold*" },
  { pattern: /(?<![\w])_[^_\n]+_(?![\w])/, what: "_italic_" },
  { pattern: /`[^`\n]+`/, what: "`code`" },
];

/**
 * Every visible, non-code `text` element in a stored message's blocks, in document order.
 *
 * Walks structurally rather than knowing which block types exist, for the same reason
 * `./typedRunsOnly.ts` does: the thing being inspected is a `rich_text` `text` element wherever one occurs.
 * Two node kinds are skipped, and both would otherwise produce false positives:
 *
 *  1. **`rich_text_preformatted`** — a code block is literal by request, so asterisks in one are correct.
 *  2. **a `code`-styled element** — the same, one span wide.
 */
function literalTextElements({ node, into }: { node: unknown; into: string[] }): void {
  if (Array.isArray(node)) {
    node.forEach((child) => {
      literalTextElements({ into, node: child });
    });
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const type = typeof node["type"] === "string" ? node["type"] : undefined;
  if (type === "rich_text_preformatted") {
    return;
  }
  if (type === "text") {
    const style = node["style"];
    const isCode = isRecord(style) && style["code"] === true;
    const text = node["text"];
    if (!isCode && typeof text === "string") {
      into.push(text);
    }
    return;
  }
  Object.values(node).forEach((child) => {
    literalTextElements({ into, node: child });
  });
}

/**
 * The opening text of every top-level line of a `rich_text` block a reader sees starting with a literal `> `,
 * in document order.
 *
 * The same criterion and the same REACH the renderer converts on (`./blockquote.ts`): a block's own
 * `rich_text_section` children only, so a list item or a table cell — which cannot hold a quote, and which the
 * renderer deliberately leaves as text — is never reported. Read structurally because a
 * stored message arrives as `unknown`. MEASURED on the bot's no-fold correction
 * `C0SYN000002`/`1790224958.879279`, whose first section opened `"> Confirming the FE commit isn't the cause."`.
 */
function literalQuoteLines({ node }: { node: unknown }): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => literalQuoteLines({ node: child }));
  }
  if (!isRecord(node) || node["type"] === "table") {
    return [];
  }
  const elements = node["elements"];
  if (node["type"] === "rich_text" && Array.isArray(elements)) {
    return elements.flatMap((element) => topLevelQuoteLine({ element }));
  }
  return Object.values(node).flatMap((child) => literalQuoteLines({ node: child }));
}

/** One direct child of a `rich_text` block: its opening text when it is a section a reader sees opening `> `. */
function topLevelQuoteLine({ element }: { element: unknown }): readonly string[] {
  if (!isRecord(element) || element["type"] !== "rich_text_section" || !Array.isArray(element["elements"])) {
    return [];
  }
  const section = { elements: element["elements"].filter(isRichTextElement), type: "rich_text_section" as const };
  const first = section.elements.find((inline) => inline.type !== "text" || inline.text.trim() !== "");
  return opensWithQuoteMarker({ section }) && first?.type === "text" ? [first.text] : [];
}

/** Whether a stored node has the `type` a rich-text inline element carries, and a string `text` when it is a text element. */
function isRichTextElement(value: unknown): value is RichTextElement {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return false;
  }
  return value["type"] !== "text" || typeof value["text"] === "string";
}

/**
 * What a reader will see wrong in a message Slack has already stored.
 *
 * Every sentence is written to be true in BOTH positions this runs in — before the wire against the blocks
 * we are about to post, and after it against the blocks Slack stored. So none of them says "stored", which
 * would be a lie in the first position and is the tense an earlier draft got wrong.
 *
 * @param blocks a message's `blocks`, either as rendered for sending or as `conversations.history` returned them
 * @returns one sentence per defect, in document order; empty when the message renders as intended
 */
export function storedRenderIssues({ blocks }: { blocks: readonly unknown[] }): readonly string[] {
  const texts: string[] = [];
  literalTextElements({ into: texts, node: blocks });
  const issues: string[] = literalQuoteLines({ node: blocks }).map(
    (line) =>
      `${JSON.stringify(line)} shows a literal "> " to a reader rather than a quote. Inside a \`rich_text\` block ` +
      "only a `rich_text_quote` draws the quote bar, which the renderer builds from a line opening with `> ` " +
      "(`./blockquote.ts`).",
  );
  for (const text of texts) {
    const handle = UNRESOLVED_HANDLE.exec(text);
    if (handle !== null) {
      issues.push(
        `${JSON.stringify(handle[0])} is plain text rather than a mention, so nobody is notified by it. ` +
          'Use a typed `{"type":"mention"}` run, or a raw `<@U…>` in `--body`.',
      );
    }
    for (const { pattern, what } of LITERAL_MARKUP) {
      const found = pattern.exec(text);
      if (found !== null) {
        issues.push(
          `${JSON.stringify(found[0])} shows its ${what} markers to a reader rather than becoming ` +
            "styling. Inside a `rich_text` block mrkdwn is inert, so styling has to be a typed run " +
            "(`bold`, `italic`, `code`) instead of characters around the text.",
        );
      }
    }
  }
  return issues;
}

/**
 * Where Slack's angle-bracket markup opens: a link, a mailto, a user or group mention, a channel, or a special
 * `<!…>` command. A mention and a channel need a real Slack id after the sigil, and `<!` one of Slack's own
 * keywords, so prose such as `a<@b`, `<#3 in the queue` or `<!-- note` is never an opener.
 */
const MARKUP_OPENER =
  /<(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Mm][Aa][Ii][Ll][Tt][Oo]:|@[UWB][A-Z0-9]{2,}|#[CGD][A-Z0-9]{2,}|!(?:here|channel|everyone|subteam\^|date\^|usergroup\^))/g;

/**
 * Every angle-bracket link in a plain `--body` string that Slack cannot parse, before it is sent.
 *
 * Only an OPENER Slack itself would read as markup starts a span, so `<3`, `x < y`, `<br>` and `a<@b` are text.
 * From there the rule is the one Slack's parser applies: the span ends at the first `>`, and a `<` or a
 * newline before it means the span never closed. That rejects exactly the nested shape the linkifier used to
 * manufacture — `<url|add the package <url|label>>` — and an unclosed `<url|label`, and never touches the
 * well-formed `<url|title #N>` that `slack voice-rules` prescribes for a PR mention.
 *
 * A code span is NOT exempt: Slack parses `<…>` inside backticks and stores a code-styled link, so a broken
 * link there renders just as broken.
 *
 * @param text the exact string the `plain` payload would send
 * @returns one sentence per malformed span, in document order; empty when every link will parse
 */
export function plainMarkupIssues({ text }: { text: string }): readonly string[] {
  const issues: string[] = [];
  let resumeAt = 0;
  for (const match of text.matchAll(MARKUP_OPENER)) {
    if (match.index < resumeAt) {
      continue;
    }
    const span = judgeSpan({ openAt: match.index, text });
    resumeAt = span.resumeAt;
    if (span.issue !== undefined) {
      issues.push(span.issue);
    }
  }
  return issues;
}

/**
 * One opened span, read the way Slack's parser reads it: closed at the first `>`, broken by a `<` or a newline.
 *
 * @param openAt the index of the span's opening `<`
 * @returns where the scan resumes, and the sentence describing the span when Slack cannot parse it
 */
function judgeSpan({ openAt, text }: { openAt: number; text: string }): { issue?: string; resumeAt: number } {
  const afterOpener = openAt + 1;
  const stop = text.slice(afterOpener).search(/[<>\n]/);
  const stopAt = stop === -1 ? text.length : afterOpener + stop;
  if (text[stopAt] === ">") {
    return { resumeAt: stopAt + 1 };
  }
  const fragment = JSON.stringify(text.slice(openAt, stopAt + 1));
  if (text[stopAt] !== "<") {
    return {
      issue:
        `${fragment} opens a Slack link that never closes with ">" on its own line, so a reader sees the raw ` +
        "markup. Close it: `<url|label>`.",
      resumeAt: stopAt,
    };
  }
  // A nested link: skip to the first ">" on this line, so the link inside it is not reported twice.
  const lineEnd = text.indexOf("\n", afterOpener);
  const closeAt = text.slice(0, lineEnd === -1 ? text.length : lineEnd).indexOf(">", afterOpener);
  return {
    issue:
      `${fragment} opens a Slack link that another "<" interrupts before its closing ">", so Slack cannot ` +
      "parse it and a reader sees literal angle brackets around a broken URL. Write one link per `<…>` " +
      "with a plain-text label, `<url|title #N>`, never a link inside another link's label.",
    resumeAt: closeAt === -1 ? stopAt : closeAt + 1,
  };
}

/**
 * What a reader would see wrong in one as-me payload, judged before it is sent — the ONE pre-wire entry
 * point for both forms, so a send and an edit cannot drift on what they check.
 *
 * A `rich` payload's blocks are what Slack will store, so {@link storedRenderIssues} judges them as-is. A
 * `plain` payload is Slack's to parse, so only what is decidable from the string alone is judged here —
 * {@link plainMarkupIssues} — and the rest is the render proof's and the receipt's.
 *
 * @param payload the rendered message a send or an edit is about to put on the wire
 * @returns one sentence per defect; empty when nothing decidable before the wire is wrong
 */
export function payloadRenderIssues({ payload }: { payload: SlackDripMessagePayload }): readonly string[] {
  if (payload.form === "rich") {
    return storedRenderIssues({ blocks: payload.blocks });
  }
  return plainMarkupIssues({ text: payload.text });
}

/**
 * The stable Slack permalink for a message, built rather than asked for.
 *
 * No API call, and that is the point: `chat.getPermalink` costs a round trip and a scope to produce a
 * string this repo already knows how to spell — `src/corpus/slack/shape.ts` has built corpus permalinks
 * this way all along. The workspace URL rides along on `auth.test`, which the transport already calls once
 * and caches.
 *
 * A THREAD reply carries the query Slack's own permalinks carry, because without it the link opens the
 * channel at that timestamp rather than the thread the reply lives in.
 *
 * @param workspaceUrl the workspace base URL, from `auth.test`
 * @param channel the channel the message landed in
 * @param ts the message's own timestamp
 * @param threadTs the thread root, when this message is a reply
 * @returns the permalink a reader can follow
 */
export function slackPermalink({
  workspaceUrl,
  channel,
  ts,
  threadTs,
}: {
  workspaceUrl: string;
  channel: string;
  ts: string;
  threadTs: string | undefined;
}): string {
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  const link = `${base}archives/${channel}/p${ts.replace(".", "")}`;
  return threadTs === undefined ? link : `${link}?thread_ts=${threadTs}&cid=${channel}`;
}
