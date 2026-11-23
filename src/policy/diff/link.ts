/**
 * Every identifier in a document a link, before the document is diffed.
 *
 * Evidence and policies link to each other, so every identifier is a hyperlink to whatever it represents in Vanta.
 * Two kinds of reference reach a link here:
 *
 * - an IDENTIFIER — a control id, a Linear key — through the Slack door's own resolver
 *   (`../../outbound/linkify/bareRefs.ts`'s `linkifyMarkdown`), so a page and a Slack post agree on what `NET-38`
 *   links to; anything it recognises and cannot resolve comes back as residue, for the caller to refuse;
 * - a NAME — a Vanta policy, an evidence document, a phrase the record lists — matched case-insensitively at word
 *   boundaries, never inside an existing link or a code span.
 *
 * Links go in at the MARKDOWN level, on both sides, before anything is compared: `./units.ts`'s `canonicalWords`
 * drops link syntax, so linking can never manufacture a difference.
 *
 * Pure.
 */
import { type BareRefContext, linkifyMarkdown } from "../../outbound/linkify/bareRefs.js";

/** A phrase and the URL every occurrence of it links to. */
export interface PhraseLink {
  readonly text: string;
  readonly url: string;
}

/** A span of the text no new link may be placed inside. */
interface Range {
  readonly start: number;
  readonly end: number;
}

/** An existing link or image, or a code span. */
const PROTECTED = /!?\[[^\]]*\]\([^)]*\)|`[^`]*`/g;

/** Every span of `markdown` that is already a link, an image or code. */
function protectedRanges({ markdown }: { markdown: string }): readonly Range[] {
  return Array.from(markdown.matchAll(PROTECTED), (match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
}

/** A string with every regex metacharacter escaped. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A URL as a markdown link destination can hold it: a space or bracket percent-encoded, since either ends the
 * destination early. Vanta's own policy ids carry brackets — `custom-privacy-policy-(external%2C-customer-facing)`
 * is one this atlas holds, read back by `slopweaver policy diff` over the evidence record.
 */
function destination({ url }: { url: string }): string {
  return url.replace(
    /[\s()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/**
 * Link every occurrence of every phrase that is not already inside a link or code, longest phrase first so
 * "Secure Development Policy" wins over a shorter phrase it contains.
 *
 * @param markdown the text to link
 * @param phrases the phrases and their URLs
 * @returns the text with each occurrence written as `[occurrence](url)`, its own casing kept
 */
export function linkPhrases({ markdown, phrases }: { markdown: string; phrases: readonly PhraseLink[] }): string {
  let text = markdown;
  const ordered = phrases.toSorted((x, y) => y.text.length - x.text.length);
  for (const phrase of ordered) {
    const ranges = protectedRanges({ markdown: text });
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp({ text: phrase.text })}(?![\\p{L}\\p{N}-])`, "giu");
    let out = "";
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (ranges.some((range) => start < range.end && end > range.start)) {
        continue;
      }
      out += `${text.slice(cursor, start)}[${match[0]}](${destination({ url: phrase.url })})`;
      cursor = end;
    }
    text = out + text.slice(cursor);
  }
  return text;
}

/**
 * The schemes a published link may carry. Anything else with a scheme — `javascript:`, `data:`, `vbscript:` — is
 * refused rather than escaped, because escaping keeps it clickable.
 */
const LINK_SCHEME = /^(https?|mailto):/i;

/**
 * The one extra scheme an image may carry: the content-addressed key `slopweaver policy diff` rewrites a local image
 * to before anything is compared.
 */
const IMAGE_SCHEME = /^diff-image:[0-9a-f]+$/;

/**
 * A markdown link or image: whether it is an image, its text and its address. THE one pattern every check here and
 * the team post's Slack rendering read links by, so no shape can be a link to one and text to the other — an address
 * with a space or a title in it is not a link to either, and is then read as the bare text it is ({@link
 * bareAddresses}).
 */
export const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\(([^)\s]*)\)/g;

/**
 * Whether an address has a scheme at all, read the way a browser reads it — a control character or space before or
 * inside the scheme is stripped, so `\u0001javascript:` is `javascript:`. Rather than reproduce that stripping, an
 * address carrying any control character is treated as schemed, and so refused unless it is plainly allowed.
 */
function hasScheme({ url }: { url: string }): boolean {
  return /\p{Cc}/u.test(url) || /^[^/?#]*:/.test(url);
}

/**
 * Every link or image address in some markdown that a published page must not carry: a link with a scheme outside
 * {@link LINK_SCHEME}, or an image outside that and {@link IMAGE_SCHEME}. An address with no scheme is relative and
 * harmless.
 *
 * @param markdown the text to scan
 * @returns the refused addresses, each once
 */
function unsafeAddresses({ markdown }: { markdown: string }): readonly string[] {
  const refused = Array.from(markdown.matchAll(MARKDOWN_LINK)).flatMap((match) => {
    const url = match[3]!;
    const image = match[1] === "!";
    const allowed = LINK_SCHEME.test(url) || (image && IMAGE_SCHEME.test(url));
    return hasScheme({ url }) && !allowed ? [url] : [];
  });
  return [...new Set(refused)];
}

/**
 * The top-level names that never lead anywhere a reader can follow, from three sources rather than from memory:
 * IANA's special-use domain registry (`localhost`, `local`, `test`, `invalid`, `example`, `onion`, `alt`, and `arpa`,
 * which holds `home.arpa`); ICANN's private-use `internal` and the three names it withheld from delegation for
 * colliding with private networks (`corp`, `home`, `mail`); and the defaults routers and operating systems hand a
 * private network (`lan`, `localdomain`, `intranet`, `private`). A private name outside these, or a public one that
 * resolves to a private address (`127.0.0.1.nip.io`), would take a DNS lookup to catch, which a pure check cannot do.
 */
const UNREACHABLE_TOP = new Set([
  "alt",
  "arpa",
  "corp",
  "example",
  "home",
  "internal",
  "intranet",
  "invalid",
  "lan",
  "local",
  "localdomain",
  "localhost",
  "mail",
  "onion",
  "private",
  "test",
]);

/** The second-level names IANA reserves for documentation, which resolve only to its own placeholder page. */
const DOCUMENTATION_HOSTS = /(^|\.)example\.(com|net|org)$/;

/**
 * Whether a host is a public name: two labels or more, ending in an alphabetic top-level name that is not one of
 * {@link UNREACHABLE_TOP}. So `localhost`, a single-label `x`, an IP literal (`127.0.0.1`, `[::1]`) and `a.local` are
 * not — each resolves on the author's machine or network at best, and nowhere for a reader of the published page.
 */
function publicHost({ host }: { host: string }): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  const labels = name.split(".");
  const top = labels.at(-1)!;
  return (
    labels.length >= 2 &&
    labels.every((label) => label !== "") &&
    /^\p{L}{2,}$/u.test(top) &&
    !UNREACHABLE_TOP.has(top) &&
    !DOCUMENTATION_HOSTS.test(name)
  );
}

/**
 * Whether an address names a public web host, or one mailbox at one — somewhere a click can actually go. A mailto
 * carries no query, since a `?cc=` or `?to=` names further mailboxes this check would otherwise not read.
 */
function reachable({ url }: { url: string }): boolean {
  const mailbox = /^mailto:[^@\s?]+@([^@\s?]+)$/i.exec(url);
  if (mailbox !== null) {
    return publicHost({ host: mailbox[1]! });
  }
  return /^https?:/i.test(url) && URL.canParse(url) && publicHost({ host: new URL(url).hostname });
}

/**
 * Every link or image address in some markdown that would lead nowhere on the published page: anything that is not
 * an http or https address at a public host or a mailto address at one — a relative path resolves against the page,
 * not the repository, a `#fragment` names a heading the page gives no anchor, and `localhost` or an IP is the author's
 * own machine — and an image that is not an https address or a key this run read.
 *
 * @param markdown the text to scan
 * @param images the image keys this run read and inlined
 * @returns the addresses, each once
 */
export function brokenAddresses({
  markdown,
  images,
}: {
  markdown: string;
  images: ReadonlySet<string>;
}): readonly string[] {
  const broken = Array.from(markdown.matchAll(MARKDOWN_LINK)).flatMap((match) => {
    const url = match[3]!;
    if (match[1] === "!") {
      return images.has(url) || (/^https:/i.test(url) && reachable({ url })) ? [] : [url];
    }
    return reachable({ url }) ? [] : [url];
  });
  return [...new Set(broken)];
}

/**
 * What the team post prints for a markdown link or image: null when it is a link with words, which the post keeps as
 * a Slack link; otherwise the words alone as plain text — an image's caption, or nothing for a link with no words. The
 * one rule {@link bareAddresses} and the post's rendering share, so the check reads exactly the text the post prints.
 *
 * @param image whether it is an image
 * @param words its text or caption
 * @returns null to keep it a link, or the plain text printed in its place
 */
export function postLinkText({ image, words }: { image: boolean; words: string }): string | null {
  if (image || words === "") {
    return words;
  }
  return null;
}

/** Characters a sentence or Slack's emphasis (`_x_`, `*x*`, `~x~`) puts after an address, which are not part of it. */
const TRAILING = /[.,;:!?'")\]_*~]+$/;

/** Punctuation or a symbol outside printable ASCII — a curly quote, a dash, an ellipsis — which no address carries raw. */
const NON_ASCII_PUNCTUATION = /(?![ -~])[\p{P}\p{S}]/u;

/** ASCII a sentence or emphasis puts after an address, which is not part of it — GitHub's autolink strips the same. */
const SENTENCE_END = /[.,;:!?'"*_~]/;

/**
 * An address less what a sentence put after it: cut at the first punctuation outside ASCII, then stripped of trailing
 * sentence punctuation and of a closing bracket with no opener inside it — GitHub's own autolink rule, so
 * `…/Policy_(disambiguation)` keeps its bracket and `(see https://acme.com/x)` loses it.
 */
function addressPart({ word }: { word: string }): string {
  const cut = word.search(NON_ASCII_PUNCTUATION);
  let url = cut === -1 ? word : word.slice(0, cut);
  let trimming = true;
  while (trimming) {
    const last = url.at(-1);
    const open = last === ")" ? "(" : "[";
    const unopened = (last === ")" || last === "]") && url.split(last).length > url.split(open).length;
    if (last !== undefined && (SENTENCE_END.test(last) || unopened)) {
      url = url.slice(0, -1);
    } else {
      trimming = false;
    }
  }
  return url;
}

/**
 * The web address a word of a document's text starts with, when it is one: an http or https URL at a public host,
 * less what a sentence put after it — so the page makes it the link it already reads as, rather than characters the
 * owner has to select, copy and paste into a tab.
 *
 * @param word one word of running text
 * @returns the address, a prefix of the word, or null when the word is not one a click could follow
 */
export function bareWebAddress({ word }: { word: string }): string | null {
  const url = addressPart({ word });
  if (/^https?:\/\//i.test(url) && reachable({ url })) {
    return url;
  }
  return null;
}

/**
 * Every address in some markdown's running text — outside its links and code — that would lead nowhere if a reader's
 * client made it a link: a bare URL whose scheme is not http or https or whose host is not public, a mailbox at a
 * host that is not, and a bare host name (`wiki.corp`) that is not. Slack links all three in a post, so the team post
 * would otherwise carry an address no check here read; a public one is left alone, since it leads where it says.
 *
 * @param markdown the text to scan
 * @returns the addresses, each once
 */
export function bareAddresses({ markdown }: { markdown: string }): readonly string[] {
  // Read the text as the team post prints it ({@link postLinkText}): a link with words is a label, whose address the
  // checks above read, and it stands apart from the text around it; anything else is printed as its words alone, with
  // nothing between them and their neighbours — so `wiki.[](…)corp` is read as the `wiki.corp` it prints. Code is one
  // line, the most Slack renders as code, so a backtick pair across a line break is text.
  let text = markdown
    .replace(MARKDOWN_LINK, (_whole, image: string, words: string) => {
      const label = postLinkText({ image: image === "!", words });
      if (label === null) {
        return " ";
      }
      return label;
    })
    .replace(/`[^`\n]*`/g, " ");
  const found: string[] = [];
  const take = ({ pattern, read }: { pattern: RegExp; read: (address: string) => boolean }): void => {
    text = text.replace(pattern, (raw) => {
      const address = raw.replace(TRAILING, "");
      if (!read(address)) {
        found.push(address);
      }
      return " ";
    });
  };
  // An address starts after anything that is not part of one — `_https://…_` is Slack's italics around a URL, and
  // `\b` finds no boundary between `_` and `h`, so `_` is deliberately not a character an address continues.
  take({ pattern: /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/gi, read: (address) => reachable({ url: address }) });
  take({ pattern: /(?<![a-z0-9+.-])mailto:[^\s<>]+/gi, read: (address) => reachable({ url: address }) });
  take({
    pattern: /[a-z0-9.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi,
    read: (address) => publicHost({ host: address.slice(address.indexOf("@") + 1) }),
  });
  take({
    pattern: /(?<![a-z0-9@./-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![a-z0-9-])/gi,
    read: (address) => publicHost({ host: address }),
  });
  return [...new Set(found)];
}

/**
 * Link a unit of a document, or a sentence of the record: identifiers through the Slack door's resolver, then
 * names through {@link linkPhrases}.
 *
 * @param markdown the text to link
 * @param context what an identifier resolves against
 * @param phrases the names to link
 * @returns the linked markdown, every identifier recognised but not resolvable, and every address it must not carry
 */
export function linkDocumentMarkdown({
  markdown,
  context,
  phrases,
}: {
  markdown: string;
  context: BareRefContext;
  phrases: readonly PhraseLink[];
}): { readonly markdown: string; readonly unresolved: readonly string[]; readonly unsafe: readonly string[] } {
  const identifiers = linkifyMarkdown({ context, text: markdown });
  const linked = linkPhrases({ markdown: identifiers.text, phrases });
  return {
    markdown: linked,
    unresolved: [...new Set(identifiers.unresolved.map((span) => span.raw))],
    unsafe: unsafeAddresses({ markdown: linked }),
  };
}
