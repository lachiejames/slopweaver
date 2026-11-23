/**
 * Slack's own mrkdwn, tokenized — so a draft PREVIEW reads the way the message will read in Slack.
 *
 * The owner wants a Slack-native view of what a post will look like in a channel, in a slide-over. A preview that
 * showed the raw `<@U01ABCD>` and `*bold*` would be the journal's spelling rather than the message, and the whole
 * point is to react to what the room will see.
 *
 * ## TOKENS, never HTML — the property, not a style choice
 *
 * This returns a list of typed spans. The component maps each one to a React element, so a draft is only
 * ever React TEXT and `dangerouslySetInnerHTML` never appears on this path. A drafted message is prose a
 * session composed about an incident; it may contain anything, and turning it into markup would make the
 * card a rendering surface for arbitrary text.
 *
 * ## Bounded by construction
 *
 * A single pass, left to right, that always consumes at least one character — so it terminates on any
 * input, including the pathological ones a regex-based renderer backtracks on. It handles what a bot draft
 * actually uses and deliberately no more: mentions, channel links, links, code spans, bold and italic.
 * Anything it does not recognise stays TEXT, which is the honest failure direction — a preview showing a
 * literal `~strike~` is wrong about one span, and one guessing at a construct is wrong about the message.
 *
 * Imports only `./slackEscapes`, itself pure, for {@link readableSpan}, and `./slackPeople`'s pure `groupLabel`, so a
 * user group reads as its handle the way every other console surface draws one. Pure: text in, spans out. The spans
 * stay wire-escaped — `readSlackDraftsMrkdwn.ts` re-tokenizes a bold span's text and unescapes at its own edge — so a
 * surface that DRAWS a span reads it through `readableSpan` exactly once, at the render. The one exception is a user
 * group's handle, unescaped as it is read, because the label drawn from it is a choice rather than wire text.
 */

import type { FencedSegment } from "./slackEmoji";
import { slackUnescaped } from "./slackEscapes";
import { groupLabel } from "./slackPeople";

/** One piece of a rendered draft. */
export type MrkdwnSpan =
  | { readonly kind: "text"; readonly text: string }
  /** `<@U01ABCD>` — rendered as the label when one is known, else as the id, always as a mention chip. */
  | {
      readonly kind: "mention";
      readonly userId: string;
      readonly label: string;
      /** The label is the wire's own id, because no name was known — so it still carries the wire's escapes. */
      readonly idLabel?: true;
      /**
       * A user group's `@handle`, as `<!subteam^S…|@handle>` wrote it — present only on a labelled group, and already
       * unescaped, as is the label drawn from it.
       */
      readonly handle?: string;
    }
  /** `<#C01ABCD|name>` — a channel link. */
  | { readonly kind: "channel"; readonly channelId: string; readonly label: string }
  /** `<https://…|text>` or a bare `<https://…>`. */
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "bold"; readonly text: string }
  | { readonly kind: "italic"; readonly text: string };

/** What the caller knows about the people a draft names, so a chip can read as a name. */
export interface MentionLabels {
  readonly labelFor: (args: { userId: string }) => string | undefined;
}

/** The angle-bracket entities Slack encodes: a mention, a channel, or a link, each optionally `|labelled`. */
const ENTITY = /^<([@#!]?)([^>|]*)(?:\|([^>]*))?>/;

/**
 * The schemes a `<…>` entity may become an `<a href>` for.
 *
 * An allowlist rather than "anything that is not a mention", because the entity grammar is permissive and
 * the draft is prose: `<javascript:…>` reads as a link to Slack's own encoder and would reach the DOM as a
 * live href here. Anything else stays TEXT, which is this file's honest failure direction — a preview
 * showing a literal `<foo>` is wrong about one span, and one turning it into a link is wrong about what the
 * page will do when the reader clicks it.
 */
const LINK_SCHEME = /^(?:https?:\/\/|mailto:)/;

/**
 * A code span, a bold run or an italic run — each non-empty and not spanning a line break. Bold and italic
 * also start and end on a non-space, as Slack's do, so a cron line's `0 * * * *` stays asterisks.
 */
const CODE = /^`([^`\n]+)`/;
const BOLD = /^\*([^*\s](?:[^*\n]*[^*\s])?)\*/;
const ITALIC = /^_([^_\s](?:[^_\n]*[^_\s])?)_/;

/** A character that makes a `_` or `*` beside it part of a word rather than emphasis. */
const WORD_CHARACTER = /^[\p{L}\p{N}]$/u;

/** The `<!…>` broadcasts, which a reader must see as a ping before they agree to a post. */
const PING = /^(?:here|channel|everyone)$/;

/** A user-group ping's body, `subteam^S…`, its group id captured. */
const SUBTEAM = /^subteam\^(.+)$/;

/**
 * One stretch of a line as its spans (`fencedLines`, `./slackEmoji.ts`): a fenced one is code, so it is ONE text span
 * exactly as written — no bold, link or mention read inside it, as Slack reads none in a code block — and any other is
 * tokenized by {@link mrkdwnSpans}.
 *
 * @param segment the stretch, and whether a fence spanning lines covers it
 * @param labels how to name a mentioned user outside a fence
 * @returns the spans, in order — none for an empty fenced stretch
 */
export function segmentSpans({
  segment,
  labels,
}: {
  segment: FencedSegment;
  labels: MentionLabels;
}): readonly MrkdwnSpan[] {
  if (!segment.fenced) {
    return mrkdwnSpans({ labels, text: segment.text });
  }
  if (segment.text.length === 0) {
    return [];
  }
  return [{ kind: "text", text: segment.text }];
}

/**
 * Tokenize one drafted message.
 *
 * @param text the draft, in Slack mrkdwn
 * @param labels how to name a mentioned user; an unknown id renders as the id itself
 * @returns the spans, in order, with adjacent plain characters merged into one text span
 */
export function mrkdwnSpans({ text, labels }: { text: string; labels: MentionLabels }): readonly MrkdwnSpan[] {
  const out: MrkdwnSpan[] = [];
  let plain = "";
  let rest = text;
  const flush = (): void => {
    if (plain.length > 0) {
      out.push({ kind: "text", text: plain });
      plain = "";
    }
  };
  let afterWord = false;
  while (rest.length > 0) {
    const span = spanAt({ afterWord, labels, rest });
    if (span === undefined) {
      afterWord = WORD_CHARACTER.test(rest.slice(0, 1));
      plain += rest.slice(0, 1);
      rest = rest.slice(1);
      continue;
    }
    flush();
    out.push(span.span);
    afterWord = WORD_CHARACTER.test(rest.slice(span.consumed - 1, span.consumed));
    rest = rest.slice(span.consumed);
  }
  flush();
  return out;
}

/**
 * The span starting at the head of `rest`, and how many characters it consumed — `undefined` for plain text.
 * Bold and italic open and close only at a word boundary, as Slack's own: `max_retries` and `api_gateway`
 * stay words, never an italic run swallowing the entity after them.
 */
function spanAt({
  rest,
  labels,
  afterWord,
}: {
  rest: string;
  labels: MentionLabels;
  afterWord: boolean;
}): { readonly span: MrkdwnSpan; readonly consumed: number } | undefined {
  const entity = entityAt({ labels, rest });
  if (entity !== undefined) {
    return entity;
  }
  for (const pair of [
    { emphasis: false, kind: "code" as const, shape: CODE },
    { emphasis: true, kind: "bold" as const, shape: BOLD },
    { emphasis: true, kind: "italic" as const, shape: ITALIC },
  ]) {
    const match = pair.shape.exec(rest);
    const inner = match?.at(1);
    if (match === null || inner === undefined) {
      continue;
    }
    const consumed = match[0].length;
    const bounded = !(pair.emphasis && (afterWord || WORD_CHARACTER.test(rest.charAt(consumed))));
    if (bounded) {
      return { consumed, span: { kind: pair.kind, text: inner } };
    }
  }
  return undefined;
}

/** One `<…>` entity at the head of `rest`, or `undefined` when there is none. */
function entityAt({
  rest,
  labels,
}: {
  rest: string;
  labels: MentionLabels;
}): { readonly span: MrkdwnSpan; readonly consumed: number } | undefined {
  const match = ENTITY.exec(rest);
  if (match === null) {
    return undefined;
  }
  const sigil = match.at(1);
  const body = match.at(2);
  const written = match.at(3);
  const consumed = match[0].length;
  if (body === undefined || body.length === 0) {
    return undefined;
  }
  if (sigil === "@") {
    const known = labels.labelFor({ userId: body });
    if (known === undefined) {
      return { consumed, span: { idLabel: true, kind: "mention", label: `@${body}`, userId: body } };
    }
    return { consumed, span: { kind: "mention", label: `@${known}`, userId: body } };
  }
  if (sigil === "#") {
    return { consumed, span: { channelId: body, kind: "channel", label: channelLabel({ body, written }) } };
  }
  const subteam = sigil === "!" ? SUBTEAM.exec(body) : null;
  if (subteam !== null) {
    return { consumed, span: groupSpan({ body, groupId: subteam[1], written }) };
  }
  if (sigil === "!" && PING.test(body)) {
    // `<!here>`, `<!channel>`, `<!everyone>` — a broadcast, which reads as a mention of everyone and is
    // exactly the span a reader most needs to see before they agree to a post.
    return { consumed, span: { idLabel: true, kind: "mention", label: `@${body}`, userId: body } };
  }
  if (sigil === "!") {
    // Any other command — `<!date^…|written date>` — is its written fallback, as Slack draws it; never a person.
    return { consumed, span: { kind: "text", text: written ?? body } };
  }
  if (!LINK_SCHEME.test(body)) {
    return undefined;
  }
  return { consumed, span: { href: body, kind: "link", label: linkLabel({ body, written }) } };
}

/**
 * A user-group ping as Slack draws it: `@handle` when the wire wrote one, else `@a group` — never `@subteam^S…`, which
 * names nothing a reader knows. The `subteam^S…` body stays the span's id, which a surface draws
 * only as the hover. The handle is unescaped HERE, once, so the label carries no `idLabel` and the render leaves it be.
 */
function groupSpan({
  body,
  groupId,
  written,
}: {
  body: string;
  groupId: string;
  written: string | undefined;
}): MrkdwnSpan {
  if (written === undefined) {
    const bare = groupLabel({ groupId, handle: undefined, recordedKey: undefined });
    return { kind: "mention", label: `@${bare.text}`, userId: body };
  }
  const handle = slackUnescaped({ text: written });
  const labelled = groupLabel({ groupId, handle, recordedKey: undefined });
  return { handle, kind: "mention", label: `@${labelled.text}`, userId: body };
}

/** How a channel link reads: its written name, else the raw id. */
function channelLabel({ written, body }: { written: string | undefined; body: string }): string {
  if (written !== undefined && written.length > 0) {
    return `#${written}`;
  }
  return `#${body}`;
}

/**
 * A span as a surface draws it: Slack's wire escapes (`&amp;`, `&lt;`, `&gt;`) in its text, label and address read
 * as the characters they stand for. Apply it once, at the render, after tokenizing — never before, or an escaped
 * `&lt;` could be read back as the start of an entity.
 *
 * @param span the tokenized span, still wire-escaped
 * @returns the span with each escape undone
 */
export function readableSpan({ span }: { span: MrkdwnSpan }): MrkdwnSpan {
  if (span.kind === "mention") {
    const userId = slackUnescaped({ text: span.userId });
    // A roster name is not wire text; only an id-as-label, which IS the wire's id, carries escapes.
    if (span.idLabel === true) {
      return { ...span, label: slackUnescaped({ text: span.label }), userId };
    }
    return { ...span, userId };
  }
  if (span.kind === "link") {
    return { ...span, href: slackUnescaped({ text: span.href }), label: slackUnescaped({ text: span.label }) };
  }
  if (span.kind === "channel") {
    return {
      ...span,
      channelId: slackUnescaped({ text: span.channelId }),
      label: slackUnescaped({ text: span.label }),
    };
  }
  return { ...span, text: slackUnescaped({ text: span.text }) };
}

/** How a link reads: its written text, else the URL itself, which is what Slack shows for a bare link. */
function linkLabel({ written, body }: { written: string | undefined; body: string }): string {
  if (written !== undefined && written.length > 0) {
    return written;
  }
  return body;
}
