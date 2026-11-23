/**
 * Which published briefings a Queue card links: every page address it carries, and every one its own words spell in
 * any of the three spellings a page is named by — a `file://` or console `http(s)://` address, the console route
 * written relative, or `page:<slug>`. The one resolution the voice reads (`./cardBriefings.ts`) and the Queue draws
 * as chips (`./openCard.ts`), so the two can never disagree about which briefings a card has. Pure.
 */
import { briefingSlugOf, isPageSlug, localPageRoute } from "./localPageHref";

/**
 * Where a briefing's address in prose may start, in either spelling, and the run of characters it may span: never a
 * space, double quote, backtick or angle bracket, the characters `pathToFileURL` always percent-encodes. A closing
 * bracket, an apostrophe and a `|` are NOT stops, since a home directory holding one is a legal path the publisher
 * writes unescaped (`/tmp/O'Brien`); `spelledAddresses` cuts each run at its first `/index.html`,
 * so a quote or Slack's `|label>` after one is never part of it. The run is any `file:`, `http:` or `https:` address,
 * matched without regard to case, and whether it names a briefing is decided by `briefingSlugOf` alone, which parses it
 * as a URL — so a host written in capitals or behind userinfo is read exactly when the parser says it is
 * this console's.
 */
const BRIEFING_RUN = /(?:file|https?):\/\/[^\s<>"`]+/giu;

/**
 * The console's route written relative and standing as its own token — `/api/page/<slug>/…` — never one inside another
 * address's path or query (`github.com/…/api/page/p/`, `?return_to=/api/page/p/`), which names no page. The same token
 * rule as `src/handover/pageReference.ts`'s `CONSOLE_ROUTE_IN_TEXT`, restated since `site/` may not import `src/`.
 */
const ROUTE_RUN = /(?<![^\s("'`<[])\/api\/page\/[^\s<>"`]+/gu;

/**
 * `page:<slug>`, the ledger's identity spelling of a page — `src/handover/pageReference.ts`'s `PAGE_IDENTITY_IN_TEXT`,
 * restated: only closing punctuation may follow, and then the word must END — the end, whitespace, one of the address
 * scanners' own delimiters (`<`, `>`, a double quote, a backtick: ``See `page:foo`—details``), or the `|label` of a
 * Slack link `<page:foo|label>` (`page:foo?x` is a query, `page:foo/bar`, `page:foo;bar` and `page:foo|https://…` name
 * no page). A sentence's trailing full
 * stops are trimmed after. It must also stand as its own token, as `ROUTE_RUN` does:
 * `https://example.com/?next=page:foo` is another address's query and names no page here — stricter on the left than
 * the `\b` that source uses, which would match it.
 */
const PAGE_IDENTITY =
  /(?<![^\s("'`<[*])page:([A-Za-z0-9][A-Za-z0-9._-]*)(?=(?<punct>[)\]}>"'`,;!*?]*)(?:$|\s|(?<bar>\|))|[)\]}'",;!*?]*[<>"`])/gu;

/**
 * What may sit between the start of a whitespace-delimited word and a route or `page:` identity that word names on
 * its own: opening punctuation and nothing else. Anything more — `https://example.com/(`, `mailto:a@b?body=(` — makes
 * the match part of another address, never a page named alone. A lookbehind of one character cannot see that, since
 * `https://example.com/(page:foo)` puts a bracket on both sides of one.
 */
const OPENING_ONLY = /^[("'`<[*]*$/u;

/**
 * Whether a match at `at` stands as its own word: everything from the word's start up to it is opening punctuation.
 *
 * @returns true when nothing but opening punctuation precedes it in its word
 */
function standsAlone({ text, at }: { text: string; at: number }): boolean {
  const before = text.slice(0, at);
  return OPENING_ONLY.test(before.slice(before.search(/\S*$/u)));
}

/** The file both spellings end in (`./localPageHref.ts`). */
const INDEX_FILE = "/index.html";

/**
 * What may follow a briefing's `/index.html` in the same run of characters, by an ALLOWLIST rather than a list of what
 * may not (`/extra`, `;jsessionid=1`): a query or fragment, which the route ignores; or only
 * prose and Markdown's closing punctuation — a full stop, `**`, `_`, `)`, a quote — optionally then a `|label`, which
 * ends the address only as a Slack link, `<address|label>`: bare, `…/index.html|https://…` is one longer
 * word. Anything else carries the path on, so it is another address whose path merely contains the page's, never the
 * page. Residue, stated: a run like `index.html.bak` reads as the page with a full stop after it, because prose spells
 * that shape far more often than a file name does.
 */
const BRIEFING_TAIL = /^(?:[?#].*|(?<punct>[.,;:!)\]}*_']*)(?<bar>\|.*)?)$/su;

/**
 * Whether a match a `|` follows is a Slack link's whole target, `<target|label>`: it opens the link, the bar comes
 * directly after it with no punctuation between that would make the real target longer (`<page:foo)|label>`), and
 * the label closes the link (`<page:foo|https://…` with no `>` is no link).
 *
 * @param at where the match starts in `text`
 * @param end where the match's target ends in `text`, the bar's offset when no punctuation came between
 * @param punct the closing punctuation the match's tail allowed before the bar
 * @returns true when the bar is a Slack link's label separator for exactly this target
 */
function slackTarget({
  text,
  at,
  end,
  punct,
}: {
  text: string;
  at: number;
  end: number;
  punct: string | undefined;
}): boolean {
  const bare = punct === undefined || punct === "";
  return text[at - 1] === "<" && bare && SLACK_LABEL.test(text.slice(end));
}

/** A Slack link's label: the bar, then anything but another bracket, then the `>` that closes the link. */
const SLACK_LABEL = /^\|[^<>]*>/u;

/**
 * Whether `whole` cut just after the `/index.html` at `end` is a briefing's whole address: it names one, and what
 * follows it in the run is {@link BRIEFING_TAIL}.
 *
 * @param at where the run starts in `text`, which a `|label` asks {@link slackTarget} about
 * @returns true when the cut is a briefing address
 */
function endsBriefing({ text, at, whole, end }: { text: string; at: number; whole: string; end: number }): boolean {
  const cut = end + INDEX_FILE.length;
  const tail = BRIEFING_TAIL.exec(whole.slice(cut));
  if (tail === null) {
    return false;
  }
  if (tail.groups?.["bar"] !== undefined && !slackTarget({ at, end: at + cut, punct: tail.groups["punct"], text })) {
    return false;
  }
  return briefingSlugOf({ url: whole.slice(0, cut) }) !== undefined;
}

/** One briefing address a text spells, at the offset it starts. */
interface SpelledAddress {
  readonly at: number;
  readonly address: string;
}

/**
 * Every briefing address one pattern's runs spell: each run is cut at the FIRST `/index.html` that names a briefing,
 * so what follows it — a full stop, Markdown's `**` or `)`, a query — is never part of it, and an
 * ancestor directory that happens to be called `index.html` is read past rather than ending the address.
 *
 * @returns the addresses, each with its offset
 */
function addressRuns({ text, pattern }: { text: string; pattern: RegExp }): readonly SpelledAddress[] {
  const found: SpelledAddress[] = [];
  const runs = new RegExp(pattern.source, pattern.flags);
  for (let run = runs.exec(text); run !== null; run = runs.exec(text)) {
    const whole = run[0];
    let end = whole.indexOf(INDEX_FILE);
    while (end !== -1 && !endsBriefing({ at: run.index, end, text, whole })) {
      end = whole.indexOf(INDEX_FILE, end + 1);
    }
    if (end === -1) {
      // A run naming no briefing may still hold one's start further in, past a bracket: look again from just after.
      runs.lastIndex = run.index + 1;
    } else {
      found.push({ address: whole.slice(0, end + INDEX_FILE.length), at: run.index });
      runs.lastIndex = run.index + end + INDEX_FILE.length;
    }
  }
  return found;
}

/**
 * Every `page:<slug>` identity one text names, each as the console route that opens it.
 *
 * @returns the routes, each with its offset
 */
function identityRoutes({ text }: { text: string }): readonly SpelledAddress[] {
  const found: SpelledAddress[] = [];
  for (const match of text.matchAll(PAGE_IDENTITY)) {
    // A bar ends the identity only as Slack's link form, `<page:foo|label>`, and only directly after it; anywhere else it
    // carries the word on, so `page:foo|https://example.com` and `<page:foo)|label>` name no page.
    const end = match.index + match[0].length;
    if (
      match.groups?.["bar"] !== undefined &&
      !slackTarget({ at: match.index, end, punct: match.groups["punct"], text })
    ) {
      continue;
    }
    const slug = match[1].replace(/\.+$/u, "");
    if (isPageSlug({ slug })) {
      found.push({ address: localPageRoute({ slug }), at: match.index });
    }
  }
  return found;
}

/**
 * Every briefing address one text spells, in any of the three spellings a page is named by — a `file://` or console
 * `http(s)://` address, the console route written relative, or `page:<slug>` — in the order the text spells them.
 *
 * @returns the addresses, in character order
 */
function spelledAddresses({ text }: { text: string }): readonly string[] {
  return [
    ...addressRuns({ pattern: BRIEFING_RUN, text }),
    ...[...addressRuns({ pattern: ROUTE_RUN, text }), ...identityRoutes({ text })].filter(({ at }) =>
      standsAlone({ at, text }),
    ),
  ]
    .toSorted((a, b) => a.at - b.at)
    .map((spelled) => spelled.address);
}

/**
 * The published briefings a card links, each slug once, first seen first: its pages and addresses, then every
 * briefing address its own words spell — the console's `http://localhost:3000/api/page/<slug>/index.html` included,
 * which no page list carries (`./localPageHref.ts` {@link briefingSlugOf}). A pull request or web artifact shares the
 * page shape and is never read as a briefing.
 *
 * @param urls the card's pages' addresses, then every other address it carries
 * @param texts the card's words, whole: drawn sentences, the whole `what`, the subject
 * @returns the slugs to read
 */
export function briefingSlugsOf({
  urls,
  texts,
}: {
  urls: readonly string[];
  texts: readonly string[];
}): readonly string[] {
  return briefingAddressesOf({ texts, urls }).map((briefing) => briefing.slug);
}

/**
 * Every address a briefing could be named by, in the order {@link briefingAddressesOf} weighs them: the given URLs,
 * then every briefing address the words spell. One list for both the briefings a card links and the file each is
 * read at (`./openCard.ts` `cardLinksOf`), so a briefing found by one is never missed by the other.
 *
 * @param urls the card's pages' addresses, then every other address it carries
 * @param texts the card's words, whole
 * @returns every candidate address, duplicates kept
 */
export function briefingCandidatesOf({
  urls,
  texts,
}: {
  urls: readonly string[];
  texts: readonly string[];
}): readonly string[] {
  return [...urls, ...texts.flatMap((text) => spelledAddresses({ text }))];
}

/** One briefing a card links: its page name, and the first address the card spells it by. */
export interface BriefingAddress {
  readonly slug: string;
  readonly url: string;
}

/**
 * The published briefings a card links, each slug once with the first address that named it — the one resolution
 * {@link briefingSlugsOf} reads for the voice and `./cardBriefingPages.ts` draws as the Queue's chips, so the two can
 * never disagree about which briefings a card has.
 *
 * @param urls the card's pages' addresses, then every other address it carries
 * @param texts the card's words, whole
 * @returns each briefing once, first seen first
 */
export function briefingAddressesOf({
  urls,
  texts,
}: {
  urls: readonly string[];
  texts: readonly string[];
}): readonly BriefingAddress[] {
  const found: BriefingAddress[] = [];
  for (const url of briefingCandidatesOf({ texts, urls })) {
    const slug = briefingSlugOf({ url });
    if (slug !== undefined && !found.some((briefing) => briefing.slug === slug)) {
      found.push({ slug, url });
    }
  }
  return found;
}
