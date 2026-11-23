/**
 * Slack's own escaping of a message's mrkdwn `text`, undone so a card reads what Slack draws: `&`, `<` and `>`
 * where the wire carries `&amp;`, `&lt;` and `&gt;`, and a link's label, a channel's name or a date's fallback
 * where the wire carries `<…|label>`.
 */

/** The three characters Slack escapes in a message's mrkdwn `text`, and what each stands for. */
const SLACK_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
]);

/**
 * An escape a truncation cut short, just before the `…` the recorder ends a cut text with. A `&` a person typed reaches
 * the wire as `&amp;`, so a bare `&` running into that `…` is always the front of an escape the cut split.
 */
const CUT_ESCAPE = /&(?:a|am|amp|l|lt|g|gt)?…$/u;

/**
 * Undo Slack's own escaping of `&`, `<` and `>` in a message's text, so a card reads `&` where Slack draws one, and
 * drop an escape a truncation split in two, so a cut text never ends on half of one.
 *
 * @returns the text with each escape replaced by the character it stands for
 */
export function slackUnescaped({ text }: { text: string }): string {
  return text.replace(CUT_ESCAPE, "…").replace(/&(?:amp|lt|gt);/g, (escape) => {
    const plain = SLACK_ESCAPES.get(escape);
    return plain ?? escape;
  });
}

/**
 * One `<…>` token of Slack's wire text, split at its first `|`: what it points at (`@U…`, `#C…`, `!here`,
 * `https://…`) and the label Slack sent with it, both still escaped as the wire carries them — and whether a
 * truncation cut it off before its `>`, when what survives of it may name nothing.
 */
export interface WireToken {
  readonly target: string;
  readonly label: string | undefined;
  readonly cut: boolean;
}

/**
 * Every `<…>` Slack wrote into a message's text, and the one a truncation cut off before its `>` at the very end. A
 * `<` a person typed reaches the wire as `&lt;`, so a bare `<` is always Slack's own markup.
 */
const WIRE_TOKEN = /<([^<>]*)(?:>|$)/gu;

/** A token's wire body split at its first `|`, so a label carrying a `|` keeps it. */
function wireToken({ body, cut }: { body: string; cut: boolean }): WireToken {
  const bar = body.indexOf("|");
  if (bar === -1) {
    return { cut, label: undefined, target: body };
  }
  return { cut, label: body.slice(bar + 1), target: body.slice(0, bar) };
}

/** A link's target, `https:`, `mailto:`, `tel:` or any other scheme, as against a `@`, `#` or `!` token. */
const LINK_TARGET = /^[a-z][a-z0-9+.-]*:/iu;

/** The label Slack sent with a token, unescaped, or nothing when it sent none or a blank one. */
function sentLabel({ token }: { token: WireToken }): string | undefined {
  if (token.label === undefined || token.label.trim() === "") {
    return undefined;
  }
  return slackUnescaped({ text: token.label });
}

/**
 * A token as Slack draws it with no roster to hand: a channel as `#name`, else "a channel" (never the `C…` id, which
 * names nothing a reader knows), a date by its fallback, and a link or anything else by its label, else its address.
 * A cut token with no label that is no link names nothing its surviving half could say, so it reads as the `…`.
 *
 * @returns the words the token reads as
 */
export function slackTokenPlainly({ token }: { token: WireToken }): string {
  const label = sentLabel({ token });
  if (token.cut && label === undefined && !LINK_TARGET.test(token.target)) {
    return "…";
  }
  if (token.target.startsWith("#")) {
    if (label === undefined) {
      return "a channel";
    }
    return `#${label}`;
  }
  if (label !== undefined) {
    return label;
  }
  if (token.target.startsWith("!date^")) {
    return "a date";
  }
  return slackUnescaped({ text: token.target });
}

/**
 * A message's text as plain words, read in ONE pass: each `<…>` token drawn by `drawToken`, and only the text
 * between tokens unescaped — so an escaped `&lt;` in the owner's words never reads as a token, and words `drawToken`
 * supplies (a roster name) are never unescaped a second time.
 *
 * @param drawToken the words for one token; {@link slackTokenPlainly} is the drawing that needs no roster
 * @returns the text Slack would draw, tokens unmarked
 */
export function slackWireWords({ text, drawToken }: { text: string; drawToken: (token: WireToken) => string }): string {
  const parts: string[] = [];
  let at = 0;
  for (const match of text.matchAll(WIRE_TOKEN)) {
    parts.push(
      slackUnescaped({ text: text.slice(at, match.index) }),
      drawToken(wireToken({ body: match[1], cut: !match[0].endsWith(">") })),
    );
    at = match.index + match[0].length;
  }
  parts.push(slackUnescaped({ text: text.slice(at) }));
  return parts.join("");
}

/**
 * A message's text as plain words with no roster: every token by {@link slackTokenPlainly}, escapes undone.
 *
 * @returns the text Slack would draw, tokens unmarked
 */
export function slackPlainWords({ text }: { text: string }): string {
  return slackWireWords({ drawToken: (token) => slackTokenPlainly({ token }), text });
}
