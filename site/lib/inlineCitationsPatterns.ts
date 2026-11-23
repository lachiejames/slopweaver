/**
 * Every pattern a card's sentence is searched with for a reference — addresses, spellings and the alternatives list —
 * split out of `./inlineCitations.ts`, which resolves a sentence with them.
 */

import { anyCase, BEFORE_UNIT_NOUN, LINEAR_KEY, PR_JOIN, PR_WORD } from "./referenceSpellings";
import { AFTER_VALUE_NOUN, HASH_AFTER_VALUE_NOUN, MONITOR_FIRST, MONITOR_LISTED } from "./valueNouns";

/**
 * What a BARE address in prose ends on and never means: sentence punctuation, and Markdown emphasis closing round
 * it. GitHub's own autolink drops the same characters, so an address that really ends in one (`?op=!`) is written
 * wrapped — `<URL>`, `<URL|label>` or `[label](URL)` — and a wrapped address keeps every character.
 * `./cardAddresses.ts` trims a carried address by this same rule, so the two never disagree on where one ends.
 */
export const ADDRESS_TRAILING = /[.,;:!?*]+$/u;

/**
 * An address's optional query then fragment: every character RFC 3986 allows there except brackets and quotes, which
 * prose wraps an address in, each ending on a character a sentence's own punctuation is not (`;baz=qux`).
 */
const QUERY = String.raw`(?:\?[\w\-.~%!$&*+,;=:@/?]*[\w\-~%$&+=@/])?(?:#[\w\-.~%!$&*+,;=:@/?]*[\w\-~%$&+=@/])?`;

/**
 * A pull request's address as prose carries it, its number captured under `group`: the pull request, then
 * optionally a tab (`/files`), then an optional trailing slash, a query (`?notification_referrer_id=1234`, whose
 * number is the address's) and a fragment (`#discussion_r1`), each ending on a character a sentence's own
 * full stop, comma or closing bracket is not, so that punctuation is never read as part of the address.
 *
 * @param group the name the number's capture group takes, unique within the one expression it is spliced into
 * @returns the pattern source
 */
function prAddress({ group }: { group: string }): string {
  return String.raw`https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(?<${group}>\d+)(?:\/[\w\-./]*[\w\-~])?\/?${QUERY}`;
}

/** A day of a month, `1` to `31`, with or without its leading zero. */
const DAY = String.raw`(?:0?[1-9]|[12]\d|3[01])`;

/** A month, abbreviated or whole, in any case — the day beside it is a date (a month name next to a day number, either order). */
const MONTH = String.raw`(?:${[
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]
  .map((word) => anyCase({ word }))
  .join("|")})\.?(?![a-zA-Z])`;

/**
 * A number standing alone — `Decide 1234,` — its digits captured under `nN`. Never part of a word, a path, a
 * decimal (`14.6h`), a time (`hh:mm`, `h AM`), a range (`3-4`, `N - M`, `N–M`), a thousands group (`1,339,505`), a fraction (`93/93`), a
 * percentage or an amount (`$120`, `€12345`), a day beside its month (a month name and a day number), never after a value noun (`./valueNouns.ts`), never before a
 * unit ({@link BEFORE_UNIT_NOUN}, `18 lines`), and never followed by a letter (`14h`,
 * `2x`). Whether it is a pull request is not this pattern's to say: {@link numberUrl} decides that from the
 * row's repository.
 */
const BARE_NUMBER = String.raw`(?<![\w.,:/#$€£¥@~\p{Dash}])(?<![$€£¥]\s+)(?<!\d\s*[\p{Dash}/]\s*)${AFTER_VALUE_NOUN}(?!(?<=\b${MONTH}\s+)${DAY}\b|${DAY}\s+${MONTH})(?<nN>\d+)(?![\w%/:\p{Dash}]|[.,]\d|\s*[\p{Dash}/]\s*\d|\s*[aApP]\.?[mM]\b\.?)${BEFORE_UNIT_NOUN}`;

/**
 * A Linear issue's address, its key captured under `lKey`, then its optional title slug and fragment — a comment's
 * `#comment-c1` is where the citation points, so the chip keeps it.
 */
export const LINEAR_ADDRESS = String.raw`https:\/\/linear\.app\/[^/\s]+\/issue\/(?<lKey>[A-Za-z][A-Za-z0-9]{0,9}-\d+)(?:\/[\w-]+)?\/?${QUERY}`;

/** The pull request an address names, without its tab or fragment — what two spellings of one PR share. */
export const PR_BASE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/u;

/** Every pull-request address anywhere in prose. */
export const PR_URL = new RegExp(prAddress({ group: "n" }), "gu");

/**
 * A GitHub ISSUE's address. Never a chip of its own, but it CLAIMS its number, so `#N` beside
 * `…/issues/N` — which `handover ask` accepts as that `#N`'s citation — links the issue rather than a
 * `/pull/N` the row's repository would invent.
 */
export const ISSUE_BASE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/u;

/** Every GitHub issue address anywhere in prose. */
export const ISSUE_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/gu;

/** Every Linear issue address anywhere in prose. */
export const LINEAR_URL = new RegExp(LINEAR_ADDRESS, "gu");

/**
 * What must NOT follow a spelling that claims a `#N` — `owner/repo#N`, `acme-admin #N` — because a number with its
 * own address after it is the `#N (URL)` / `#N URL` reference, and claiming it would print the address again.
 */
const NO_ADDRESS_AFTER = String.raw`(?! ?\(?https:\/\/)`;

/**
 * Every reference the text can carry, most specific first: a number with its address in brackets or after a
 * space, a bare pull-request address, a Linear issue address, `owner/repo#N`, a repository then `PR N`, `PR #N`,
 * `pull request N` or `#N`, a `PR N`, `PR #N` or `pull request N` naming no repository, a bare `#N`,
 * `[owner/]repo N`, and a bare Linear key. No reference may start inside a word or a path, so an address's own
 * fragment or a hyphenated word's tail is never read as one. A `PR N` naming no repository reads like a `#N`: the
 * words say it is a pull request, so it resolves through a carried address first and then the row's references,
 * because 253 recorded questions (the count `cardAlignment` makes) spell one that way.
 */
export const ALTERNATIVES = [
  // Slack's own link markup, `<URL|label>` or `<URL>`, as a message the owner answers carries it verbatim — one chip,
  // never the address's chip and then its label's.
  String.raw`<(?<mUrl>https:\/\/[^|>\s]+)(?:\|(?<mLabel>[^>]+))?>`,
  // A Markdown link, `[PR #N](URL)`, is one chip under its label the same way.
  String.raw`\[(?<dLabel>[^\]\n]+)\]\((?<dUrl>https:\/\/[^)\s]+)\)`,
  String.raw`#(?<bN>\d+) ?\((?<bUrl>${prAddress({ group: "bUrlN" })})\)`,
  String.raw`#(?<sN>\d+) (?<sUrl>${prAddress({ group: "sUrlN" })})`,
  // `URL (#N)`, the reverse of `#N (URL)`, is one chip too: the bracketed number is the address's own.
  String.raw`(?<uUrl>${prAddress({ group: "uN" })})(?: ?\(#\k<uN>\))?`,
  String.raw`(?<lUrl>${LINEAR_ADDRESS})`,
  // A local page's `file://…/pages/<slug>/index.html` is its page's chip wherever a sentence names it, not only in
  // the recorded question a card lifts pages out of. Every bare `file://` address is read whole and
  // `localPageSlugOf` alone decides whether it is a page, so a spelling it accepts (`%41lpha`,
  // `alpha/./index.html`) is one too, and
  // one it refuses stays words with nothing inside its path read as a number or a key. It starts a token as
  // `./queueCardActLinks.ts`'s `ADDRESS` does, so `profile:///…` and `prefix/file:///…` are not one; any case.
  String.raw`(?<=^|[\s<>"'\x60([{]|(?:^|\s)\*+)(?<fUrl>${anyCase({ word: "file" })}:\/\/[^\s<>"'\x60)\]}]+)`,
  // Any other address is ONE chip, whole: `…?id=1234` or `…/QQQQ-134-notes` inside it names nothing. A
  // closing bracket ends it, as in `cardAddresses`, so `(https://…/docs)#N` still links #N.
  String.raw`(?<xUrl>https?:\/\/[^\s<>"'\x60)\]}|]+)`,
  // A board row's slug — three or more lower-case words joined by hyphens — cites that row only when the board
  // holds one; membership, never the shape, decides (citations reach workstreams).
  String.raw`(?<![\p{L}\p{M}\p{N}_/.:-])(?<wSlug>[a-z0-9]+(?:-[a-z0-9]+){2,})(?![\p{L}\p{M}\p{N}_/#:-])`,
  // A Datadog monitor's id, the first and every later one a list names, only through the board's records.
  MONITOR_FIRST,
  MONITOR_LISTED,
  // `issue owner/repo#N` says it is an issue, so it links the issue, never a `/pull/N`.
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])${anyCase({ word: "issue" })}[sS]?\s+(?<iOwner>[\w.-]+)\/(?<iRepo>[\w.-]*\w)#(?<iN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d)${NO_ADDRESS_AFTER}`,
  // A `PR` before it, `PR acme/acme-admin#N`, says it is the pull request, never a carried issue.
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])(?:(?<oPr>${PR_WORD})\s+)?(?<oOwner>[\w.-]+)\/(?<oRepo>[\w.-]*\w)#(?<oN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d)${NO_ADDRESS_AFTER}`,
  // `acme-admin#N`, the compact spelling, as well as `acme-admin #N` and `acme-admin PR N`.
  // With a PR word before the repository, a bare number after it is that PR too: `PR acme-admin N`.
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])(?:(?<pPr>${PR_WORD})\s+)?(?![a-zA-Z][a-zA-Z0-9]{0,9}-\d+\s)(?<pRepo>(?:[\w.-]+\/)?[\w.-]*\w)(?: (?:(?<pWord>${PR_WORD})${PR_JOIN}|#)|#|(?<=(?<![\p{L}\p{M}\p{N}_/.-])${PR_WORD}\s+(?:[\w.-]+\/)?[\w.-]*\w) )(?<pN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-(?!(?<=${PR_WORD}${PR_JOIN}\d+-)\d+(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_]))[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d+(?!\d)-?[\p{L}\p{M}\p{N}_])(?!(?<!${PR_WORD}${PR_JOIN}\d+)\s*\p{Dash}\s*\d)${NO_ADDRESS_AFTER}`,
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])${PR_WORD}(?:[sS](?= ))?${PR_JOIN}(?<qN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-(?!\d+(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_]))[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d+(?!\d)-?[\p{L}\p{M}\p{N}_])${NO_ADDRESS_AFTER}`,
  // The far end of a range the PR word names, `PRs N–M` or `PR N-M`, any dash: a pull request by that word. The
  // pattern above stops short of a word joined by a hyphen, never of the range's own far end, unless a
  // word is joined past that end, by a hyphen or none: `PR-N-M-notes` and `PR N–Mclair` are one slug.
  String.raw`(?<=(?<![\p{L}\p{M}\p{N}_/.-])${PR_WORD}(?:[sS](?= ))?${PR_JOIN}\d+\s*\p{Dash}\s*)#?(?<gN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-(?!\d+(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_]))[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d+(?!\d)-?[\p{L}\p{M}\p{N}_])${NO_ADDRESS_AFTER}`,
  // A value noun's `#N` is that value unless a carried address says otherwise, as in `port #N`.
  String.raw`${HASH_AFTER_VALUE_NOUN}#(?<vN>\d+)(?![\p{L}\p{M}\p{N}_])`,
  // Never inside a word or after a path's `/` — except the `/` of a list, `#N/#N/#N`.
  // A range's first end, `#N–M`, is words like the range itself, and so is a slug's `#N-notes`.
  String.raw`(?<![\p{L}\p{M}\p{N}_])(?:(?<=#\d+\/)|(?<!\/))${AFTER_VALUE_NOUN}#(?<hN>\d+)(?![\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d|-(?!\d+(?![\p{L}\p{M}\p{N}_]))[\p{L}\p{M}\p{N}_])`,
  // A ticket-shaped word is never a spaced spelling's repository: `ABC-1 #N` is a key and a #N.
  // After a repository a dash-joined number is prose whatever the dash, `acme/repo#N–M`: only a PR word opens a range.
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])(?![a-zA-Z][a-zA-Z0-9]{0,9}-\d+\s)(?<rWord>(?:[\w.-]+\/)?[\w.-]*\w) (?<rN>\d+)(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d)${BEFORE_UNIT_NOUN}`,
  String.raw`(?<![\p{L}\p{M}\p{N}_-])(?<kKey>${LINEAR_KEY})(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])`,
  // `exa-2` or `Exa-2` links as a known team's key, else only through a carried address for `EXA-2`: `utf-8` is never a ticket.
  // Either case, a key fused into a longer hyphenated name, `post-1234-draft`, is part of that name.
  String.raw`(?<![\p{L}\p{M}\p{N}_-])(?<kLower>[a-zA-Z][a-zA-Z0-9]{0,9}-\d+)(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])`,
  String.raw`${BARE_NUMBER}`,
] as const;

/** The group that says which of {@link ALTERNATIVES} matched, in the same order. */
export const ALTERNATIVE_TAGS = [
  "mUrl",
  "dUrl",
  "bUrl",
  "sUrl",
  "uUrl",
  "lUrl",
  "fUrl",
  "xUrl",
  "wSlug",
  "cN",
  "cL",
  "iN",
  "oN",
  "pN",
  "qN",
  "gN",
  "vN",
  "hN",
  "rN",
  "kKey",
  "kLower",
  "nN",
] as const;

/** Every alternative at once — what finds the next place a reference may start. */
export const REFERENCE_SOURCE = ALTERNATIVES.join("|");
