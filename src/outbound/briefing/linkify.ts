/**
 * Turning a bare URL a composer typed into prose into a real link, escaping everything around it.
 *
 * Its own module because it is now read by two renderers — `./render.ts` and `./autonomyRender.ts` — and the
 * second could not import it from the first without the two forming a cycle. The pattern and what it
 * deliberately does NOT match stay with the constant below.
 */
import { isLocalPageUrl } from "../../pages/url.js";
import { type BareRefContext, resolveBareRef, scanBareRefs } from "../linkify/bareRefs.js";
import { escapeAttribute, escapeText } from "./escape.js";

/**
 * A URL sitting loose in running prose, matched up to but not including the punctuation a sentence supplies.
 *
 * The trailing-character class is the whole subtlety. `… artifact/abc .` and `… artifact/abc,` are how a
 * composer actually writes one, so a match that ran to the next space would put the full stop inside the
 * `href` and produce a link that 404s — a DIFFERENT dead link, arrived at by fixing dead links.
 *
 * The `file:` arm spells a local page's WHOLE shape rather than matching the scheme loosely and filtering
 * the result afterwards, and a review pass is why. The page the owner
 * reacts to lives in a local file, so an address the fleet now produces has to linkify or it is exactly the inert
 * text the URL ruling below was about — but a loose `(?:https?|file)` CONSUMES a non-page address before anything
 * can reject it, and `file:///tmp/run.log,https://claude.ai/code/artifact/abc` then matched as one
 * token, was skipped whole, and left an artifact URL that used to be clickable inert. A match that is
 * discarded has already eaten its characters; the only safe narrowing is one that never matches.
 *
 * It therefore repeats `../../pages/url.ts`'s `LOCAL_PAGE_URL_IN_TEXT`, which is checked rather than trusted:
 * `src/__tests__/unit/outbound/briefing/render/localPageAddress.test.ts` asserts the two agree on the same address.
 */
const BARE_URL =
  /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]|file:\/\/\/[^\s<>"':,]*\/pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/index\.html/g;

/**
 * One run of prose with every bare URL in it turned into a real link, everything else escaped.
 *
 * A URL the owner has to select, copy, open in a new tab and paste into is not a link, and the fleet
 * briefing's own folds once carried twenty-three of them. The fix is here rather than in the schema on purpose. A refusal would have been the house move, but
 * it refuses the composer's page and leaves the READER with the same dead text until someone rewrites the
 * form; linking it is what makes every page already written clickable the moment it re-renders.
 *
 * The visible text stays the URL, character for character, so `../../briefing/text.ts`'s counters read
 * exactly what they read before — a rewritten label would change every word count on the page.
 *
 * A caller that knows which repository the prose is ABOUT passes `context`, and a bare `#` number between
 * the URLs becomes a link too, resolved by the same `resolveBareRef` the page check refuses with. The words
 * stay verbatim — only an anchor is added — and a reference the context cannot resolve stays text for
 * `briefing check` to name, never a guess. URLs are cut out first, so a `#` inside one is never split off.
 *
 * @internal — the escaper this file's prose branches share, and the Linear briefing page's feed line.
 * @param text the run's raw text
 * @param context the repository the prose is about; absent, only URLs are linked
 * @returns the text escaped, with each bare URL wrapped in an anchor
 */
export function linkifyText({ text, context }: { text: string; context?: BareRefContext }): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(BARE_URL)) {
    const url = match[0];
    out += linkifyRefs({ context, text: text.slice(cursor, match.index) });
    // A `file:` match whose path cannot name a real file — an encoded NUL in an ancestor, say — is emitted as
    // TEXT rather than skipped. Skipping would leave the cursor past it and drop the characters entirely; the
    // shape already excludes an ordinary log path, so what reaches here is a page-shaped address that turns
    // out to be unopenable, and the honest render of one is the words themselves, unlinked.
    const linkable = !url.startsWith("file:") || isLocalPageUrl({ url });
    out += linkable
      ? `<a class="raw" href="${escapeAttribute({ text: url })}">${escapeText({ text: url })}</a>`
      : escapeText({ text: url });
    cursor = match.index + url.length;
  }
  return out + linkifyRefs({ context, text: text.slice(cursor) });
}

/**
 * A stretch of prose holding no URL, escaped, with every bare reference `context` resolves turned into a link.
 *
 * @param text prose with no URL in it
 * @param context the repository the prose is about; undefined escapes the text alone
 * @returns the escaped text, with resolvable references anchored
 */
function linkifyRefs({ text, context }: { text: string; context: BareRefContext | undefined }): string {
  if (context === undefined) {
    return escapeText({ text });
  }
  let out = "";
  let cursor = 0;
  for (const span of scanBareRefs({ context, text })) {
    const resolved = resolveBareRef({ context, span });
    if (resolved !== undefined) {
      out += escapeText({ text: text.slice(cursor, span.start) });
      out += `<a href="${escapeAttribute({ text: resolved.url })}">${escapeText({ text: span.raw })}</a>`;
      cursor = span.end;
    }
  }
  return out + escapeText({ text: text.slice(cursor) });
}
