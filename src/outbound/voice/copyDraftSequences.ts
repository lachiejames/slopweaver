/**
 * A Slack message the talk console's running list offers the owner, read as the paragraphs the earns-its-place gate
 * counts (`../slack/draftEarnsItsPlace.ts`). The list holds Slack mrkdwn exactly as the owner will paste it, not a typed
 * form, so this is the one adapter from that text into the run vocabulary a parked as-me form already uses — and the
 * shape a Slack draft is held to stays one shape on both surfaces.
 *
 * What it reads, line by line:
 *
 * - a blank line ends a paragraph; a single newline inside one reads as a space;
 * - a line opening `• `, `- `, `* `, `1. ` or `1) ` is a bullet and is left out, as a one-list's bullets are, and it ends the
 *   paragraph before it, so the lines after a list are their own paragraph (a one-list's `trailing`);
 * - a ```` ``` ```` fence opens and closes a code block whose lines are one code run each, blank lines and
 *   bullet-looking lines included, read before any other rule but a bullet's; a fence opening and closing inside one
 *   line is a code run there, and the prose beside it on that line stays prose;
 * - a `>` line is somebody else's words: a quoted run; a line opening `>>>` quotes itself and every line after it,
 *   a bullet or fence among them included, as Slack draws it;
 * - inside a line, `` `code` `` is a code run, `<@U…>` a mention, `<!subteam^…>` a group, `<!here>` and
 *   `<!channel>` a broadcast, `<#C…|name>` and `<url|label>` or `<url>` (http, https or mailto) a link carrying its
 *   label, and any other `<…>` the literal text it shows as — a mention, channel or group whose id is not a Slack
 *   id (`U…`, `C…`, `S…`) included, so prose dressed as an entity is still counted;
 * - prose between those tokens loses its `*bold*`, `_italic_` and `~strike~` markers, and prose and a link's label
 *   read `&amp;`, `&lt;` and `&gt;` as the characters they show as, so it reads as the words the owner sees.
 *
 * Nothing here judges the text and nothing is returned but runs: the gate decides. Pure.
 */
import type { DripInlineRun } from "../artifact/types.js";

/**
 * A list line, by its leading marker and the space after it — `*bold*` has no space, so it is prose — or `1.`/`1)`
 * numbering, which `./paragraphSpacing.ts` reads as a list item too, so a numbered item is no paragraph.
 */
const BULLET = /^\s*(?:[•◦▪‣]|[-*]|\d+[.)])\s+/u;

/** A quoted line: Slack's `>`, or the escaped `&gt;` a copied message can carry. */
const QUOTE = /^\s*(?:>|&gt;)\s?/u;

/**
 * Slack's `>>>`, or its escaped `&gt;&gt;&gt;`, quoting its own line and every line after it to the end of the
 * message, so the lines after it are never counted as the owner's own prose.
 */
const QUOTE_REST = /^\s*(?:>>>|&gt;&gt;&gt;)\s?/u;

/** An inline code span or an angle-bracketed Slack token. */
const INLINE = /`([^`]+)`|<([^<>]+)>/gu;

/** The schemes a `<…>` becomes a link for, as the tray draws it (`site/lib/slackMrkdwn.ts`'s `LINK_SCHEME`). */
const LINK_SCHEME = /^(?:https?:\/\/|mailto:)/u;

/** A fence marker. */
const FENCE = "```";

/** A `<!…>` body Slack draws as a ping: the room, the channel, or a user group with an id. */
const PING = /^(?:here|channel|everyone|subteam\^[A-Z][A-Z0-9]+)$/u;

/** A Slack member or channel id (`U…`, `W…`, `C…`, `G…`): only one of these makes `<@…>` or `<#…>` a real entity. */
const SLACK_ID = /^[A-Z][A-Z0-9]+$/u;

/**
 * A `*bold*`, `_italic_` or `~strike~` run, opening and closing on a non-space at a word boundary as Slack's do
 * (`site/lib/slackMrkdwn.ts`'s `BOLD`/`ITALIC`), so `max_retries` and a cron line's `0 * * * *` stay as typed.
 */
const EMPHASIS = /(?<![\p{L}\p{N}])([*_~])([^*_~\s](?:[^*_~\n]*[^*_~\s])?)\1(?![\p{L}\p{N}])/gu;

/**
 * Prose between the tokens, its emphasis markers dropped: the owner reads `keen to *hear*` as three words, so the gate's
 * matchers do too.
 *
 * @returns a text run of the words as Slack shows them
 */
function plainRun({ text }: { text: string }): DripInlineRun {
  return { text: unescaped({ text: text.replace(EMPHASIS, "$2") }), type: "text" };
}

/**
 * Slack's three wire escapes read back as the characters they show as, `&amp;` last so `&amp;lt;` stays `&lt;`: a
 * label written `&amp;` is the one character `&` on the screen, never the word `amp`.
 *
 * @returns the text as Slack draws it
 */
function unescaped({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * One `<…>` token as the run it renders as, read the way the tray draws it (`site/lib/slackMrkdwn.ts`'s `entityAt`),
 * so what the shape gate treats as opaque is exactly what the owner sees as an entity, and everything else is their prose
 * (prose in brackets, an unknown command and a group with no id are not entities).
 *
 * @param token the text between the brackets
 * @returns the mention, group, broadcast or link run, or the text it shows as
 */
function tokenRun({ token }: { token: string }): DripInlineRun {
  const bar = token.indexOf("|");
  const target = bar === -1 ? token : token.slice(0, bar);
  const label = bar === -1 ? undefined : token.slice(bar + 1);
  const sigil = /^[@#!]/u.test(target) ? target.charAt(0) : "";
  const body = target.slice(sigil.length);
  if (!isEntity({ body, sigil })) {
    // Not an entity Slack renders, so it shows as typed and every word in it is counted.
    return { text: `<${token}>`, type: "text" };
  }
  if (sigil === "@") {
    return { person: body, type: "mention" };
  }
  if (sigil === "!") {
    return commandRun({ body, label });
  }
  // An empty written label reads as the address or channel id, as the tray draws it.
  if (label !== undefined && label !== "") {
    return { label: unescaped({ text: label }), type: "link", url: target };
  }
  return { label: target, type: "link", url: target };
}

/**
 * Whether a `<…>` token is an entity Slack renders: a mention or channel with a Slack id, any `<!…>` command, or a
 * link with a scheme the tray links.
 *
 * @param sigil the leading `@`, `#` or `!`, or empty for a link
 * @param body the token after its sigil, before any `|`
 * @returns true when the token renders as an entity rather than as typed
 */
function isEntity({ sigil, body }: { sigil: string; body: string }): boolean {
  if (body === "") {
    return false;
  }
  if (sigil === "@" || sigil === "#") {
    return SLACK_ID.test(body);
  }
  if (sigil === "!") {
    return true;
  }
  return LINK_SCHEME.test(body);
}

/**
 * A `<!…>` command as it shows: a ping, or any other command (`<!date^…|the fallback>`) as its written fallback, else
 * its body.
 *
 * @param body the command after `!`, before any `|`
 * @param label the written fallback after `|`, when there is one
 * @returns the group or broadcast run, or the text it shows as
 */
function commandRun({ body, label }: { body: string; label: string | undefined }): DripInlineRun {
  if (PING.test(body)) {
    return pingRun({ body });
  }
  if (label !== undefined) {
    return { text: label, type: "text" };
  }
  return { text: body, type: "text" };
}

/**
 * A ping's run: a user group by its id, the room, or the whole channel.
 *
 * @param body a body PING accepts
 * @returns the group or broadcast run
 */
function pingRun({ body }: { body: string }): DripInlineRun {
  if (body.startsWith("subteam^")) {
    return { handle: body.slice("subteam^".length), type: "group" };
  }
  if (body === "here") {
    return { range: "here", type: "broadcast" };
  }
  return { range: "channel", type: "broadcast" };
}

/**
 * One line of prose as runs: text between the inline tokens, each token its own run.
 *
 * @returns the line's runs, in order
 */
function inlineRuns({ line }: { line: string }): readonly DripInlineRun[] {
  const runs: DripInlineRun[] = [];
  let cursor = 0;
  for (const hit of line.matchAll(INLINE)) {
    if (hit.index > cursor) {
      runs.push(plainRun({ text: line.slice(cursor, hit.index) }));
    }
    const [whole, code, token] = hit;
    if (code !== undefined) {
      runs.push({ code: true, text: code, type: "text" });
    } else {
      runs.push(tokenRun({ token: token! }));
    }
    cursor = hit.index + whole.length;
  }
  if (cursor < line.length) {
    runs.push(plainRun({ text: line.slice(cursor) }));
  }
  return runs;
}

/** One line read: the runs it adds to the paragraph, or `undefined` when it ends the paragraph; and the fence after it. */
interface LineRead {
  readonly runs: readonly DripInlineRun[] | undefined;
  readonly fenced: boolean;
}

/**
 * A line inside a fence, or one carrying a fence marker. Each marker toggles code, so prose on a line beside a
 * ```span``` stays prose and is still judged.
 *
 * @param fenced whether a fence was open when the line began
 * @returns the line's code and prose runs, and whether a fence is open after it
 */
function fencedLineRead({ line, fenced }: { line: string; fenced: boolean }): LineRead {
  const runs: DripInlineRun[] = [];
  let open = fenced;
  for (const [index, segment] of line.split(FENCE).entries()) {
    if (index > 0) {
      open = !open;
    }
    if (segment.trim() !== "") {
      runs.push(...segmentRuns({ code: open, segment }));
    }
  }
  return { fenced: open, runs };
}

/**
 * One non-empty piece of a fenced line as its runs.
 *
 * @param code whether the piece sits inside the fence
 * @returns one code run, or the piece's prose runs
 */
function segmentRuns({ segment, code }: { segment: string; code: boolean }): readonly DripInlineRun[] {
  if (code) {
    return [{ code: true, text: segment.trim(), type: "text" }];
  }
  return inlineRuns({ line: segment });
}

/**
 * One line of the tray's text, read by the rules in this file's header.
 *
 * @param fenced whether a fence was open when the line began
 * @returns what the line adds to its paragraph, or that it ends one, and the fence after it
 */
function lineRead({ line, fenced }: { line: string; fenced: boolean }): LineRead {
  if (!fenced && BULLET.test(line)) {
    // A bullet is left out whole, a ```span``` in it included; a fence it leaves open still opens.
    return { fenced: line.split(FENCE).length % 2 === 0, runs: undefined };
  }
  if (fenced || line.includes(FENCE)) {
    return fencedLineRead({ fenced, line });
  }
  if (line.trim() === "") {
    return { fenced: false, runs: undefined };
  }
  const quote = QUOTE.exec(line);
  if (quote !== null) {
    return { fenced: false, runs: [{ quoted: true, text: line.slice(quote[0].length), type: "text" }] };
  }
  return { fenced: false, runs: inlineRuns({ line }) };
}

/**
 * One line inside a `>>>` quote: somebody else's words whatever they look like, a bullet or a fence included. A blank
 * line still ends a paragraph, as it does between `>` lines.
 *
 * @param line the line, the `>>>` marker already cut from the line that opened the quote
 * @returns one quoted run, or that the line ends a paragraph
 */
function quotedRestRead({ line }: { line: string }): LineRead {
  if (line.trim() === "") {
    return { fenced: false, runs: undefined };
  }
  return { fenced: false, runs: [{ quoted: true, text: line, type: "text" }] };
}

/**
 * The tray's text as counted paragraphs, a list's bullets left out. Pure.
 *
 * @param text the whole message the owner would paste, its fold included
 * @returns one run sequence per counted paragraph, in reading order
 */
export function copyDraftSequences({ text }: { text: string }): readonly (readonly DripInlineRun[])[] {
  const sequences: (readonly DripInlineRun[])[] = [];
  let current: DripInlineRun[] = [];
  let fenced = false;
  let quotedRest = false;
  for (const line of text.split(/\r?\n/u)) {
    let quotedLine = line;
    const opensQuote = !quotedRest && !fenced ? QUOTE_REST.exec(line) : null;
    if (opensQuote !== null) {
      quotedRest = true;
      quotedLine = line.slice(opensQuote[0].length);
    }
    const read: LineRead = quotedRest ? quotedRestRead({ line: quotedLine }) : lineRead({ fenced, line });
    fenced = read.fenced;
    if (read.runs === undefined) {
      sequences.push(...paragraphOf({ runs: current }));
      current = [];
    } else if (read.runs.length > 0) {
      current.push(...joinerOf({ runs: current }), ...read.runs);
    }
  }
  sequences.push(...paragraphOf({ runs: current }));
  return sequences;
}

/**
 * A finished paragraph, or nothing when no line added to it.
 *
 * @returns the paragraph alone, or no paragraph
 */
function paragraphOf({ runs }: { runs: readonly DripInlineRun[] }): readonly (readonly DripInlineRun[])[] {
  if (runs.length === 0) {
    return [];
  }
  return [runs];
}

/**
 * The space a single newline inside a paragraph reads as, before every line but the first.
 *
 * @returns the joining space, or nothing before the paragraph's first line
 */
function joinerOf({ runs }: { runs: readonly DripInlineRun[] }): readonly DripInlineRun[] {
  if (runs.length === 0) {
    return [];
  }
  return [{ text: " ", type: "text" }];
}
