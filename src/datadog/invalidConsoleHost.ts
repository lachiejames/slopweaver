/**
 * Find a Datadog console host that no site serves — `app.us3.datadoghq.com` and the rest of its derived class —
 * anywhere in a piece of text.
 *
 * ## The failure this exists for
 *
 * The dead `app.`-prefixed regional host must never go out: the bug has recurred across writes on all
 * integrations, so it earns stronger enforcement, and the real console is the site itself. The
 * latest case was a bot answer in a team channel whose three monitor citations all opened
 * `https://app.<this install's site>/monitors/<id>`. Every Datadog doc example is written against US1's
 * `app.datadoghq.com`, so a session that knows the site is regional prefixes it by analogy — and gets a host that
 * resolves to the data intake rather than the console (`./config.ts` carries the `dig` repro).
 *
 * ## Why the banned set is DERIVED, not listed
 *
 * The mistake is a rule misapplied, not a string: every regional site is its own console host, and only the
 * unprefixed ones put the console on `app.`. So the banned set is `app.<site>` for every site whose console host
 * is something else, computed from `./config.ts`'s own table. That bans the `us3`, `us5`, `ap1`, `ap2`, `uk1` and
 * `us2.ddog-gov` forms today, never bans the real `app.datadoghq.com`, `app.datadoghq.eu` or `app.ddog-gov.com`,
 * and follows a site added to the table without anyone remembering this file exists. No `DD_SITE` is read: which
 * hosts do not exist is a vendor fact, true on every install.
 *
 * ## What counts as a hit
 *
 * The host as a whole hostname token, in any case, wherever it sits: bare prose, a markdown destination, a Slack
 * `<url|label>`, HTML, and a URL percent-encoded into another one's query string. One layer of percent-encoding of a
 * printable ASCII character (`app%2eus3…`, `%2F%2Fapp.us3…`) is read as what it spells, so the `/` in front of an
 * encoded host bounds it exactly as a literal one does; an escape of anything else (`%0A`) reads as a separator,
 * and a `%` that opens no escape is left as written, so a stray one can never switch the scan off. A
 * longer hostname that merely CONTAINS the host (`xapp.us3.datadoghq.com`, `app.us3.datadoghq.com.example`) is a
 * different host and is not a hit; a sentence-ending full stop after it is still one.
 *
 * Pure: a string in, the hits out.
 */
import { consoleHostFor, DD_SITES, type DdConsoleHost } from "./config.js";

/** One occurrence of a banned host. */
export interface InvalidDatadogConsoleHostHit {
  /** The banned host, lower-cased, e.g. `app.us3.datadoghq.com`. */
  readonly invalidHost: string;
  /** The console host the writer meant, e.g. `us3.datadoghq.com`. */
  readonly correctHost: DdConsoleHost;
  /** The text exactly as it appeared, percent-encoding and case included. */
  readonly matched: string;
}

/** Every `app.<site>` that is not its site's console host, paired with the host that is. */
export const INVALID_DATADOG_CONSOLE_HOSTS: readonly {
  readonly invalidHost: string;
  readonly correctHost: DdConsoleHost;
}[] = DD_SITES.map((site) => ({ correctHost: consoleHostFor({ site }), invalidHost: `app.${site}` })).filter(
  ({ invalidHost, correctHost }) => invalidHost !== correctHost,
);

/** The correct host per banned host, keyed lower-case. */
const CORRECT_BY_INVALID: ReadonlyMap<string, DdConsoleHost> = new Map(
  INVALID_DATADOG_CONSOLE_HOSTS.map(({ invalidHost, correctHost }) => [invalidHost, correctHost]),
);

/**
 * The banned hosts as one alternation, bounded as a whole hostname token: nothing hostname-shaped before it, and
 * after it neither a label character nor a dot that opens another label.
 *
 * The label characters are ASCII on purpose. A non-ASCII letter after the host (an IDN such as `…comé`) is read as
 * a separator and refused — an over-refusal a hatch covers — because a Unicode-aware boundary would read the Latin-1
 * decode of the UTF-8 punctuation that ends a sentence (an em dash is `â\x80\x94`) as a letter and let a real dead
 * link in an upload through. The flags are `gi` WITHOUT `u` for the same reason: Unicode
 * case folding matches `ſ` as `s` and `U+212A` as `k`, which would read those as ASCII label characters,
 * and a non-Unicode case-insensitive match never folds a non-ASCII character onto an ASCII one.
 */
const INVALID_HOST_PATTERN = new RegExp(
  `(?<![a-z0-9.-])(?:${INVALID_DATADOG_CONSOLE_HOSTS.map(({ invalidHost }) => invalidHost.replaceAll(".", "\\.")).join("|")})(?![a-z0-9-]|\\.[a-z0-9])`,
  "gi",
);

/** A percent-escape. */
const PERCENT_ESCAPE = /^%([0-9a-f]{2})$/iu;

/** A printable ASCII character other than space — what a decoded escape must spell to be read as itself. */
const PRINTABLE_ASCII = /^[!-~]$/u;

/**
 * The text with every percent-escape decoded — to itself when printable ASCII, to a separating space otherwise — and where each decoded character came
 * from in the source, so a hit can quote exactly what was written.
 *
 * @param text the source text
 * @returns the decoded view and, per decoded character, its source start and end
 */
function decodePercentEscapes({ text }: { text: string }): {
  readonly view: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
} {
  let view = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  while (index < text.length) {
    const escape = PERCENT_ESCAPE.exec(text.slice(index, index + 3));
    const decoded = escape === null ? "" : String.fromCharCode(Number.parseInt(escape[1]!, 16));
    const width = escape === null ? 1 : 3;
    if (escape === null) {
      view += text[index]!;
    } else {
      view += PRINTABLE_ASCII.test(decoded) ? decoded : " ";
    }
    starts.push(index);
    ends.push(index + width);
    index += width;
  }
  return { ends, starts, view };
}

/**
 * Every banned Datadog console host in a piece of text, in source order, repeats included.
 *
 * @param text any outbound text — a message body, a URL, a PR description
 * @returns one hit per occurrence; empty when the text is clean
 */
export function invalidDatadogConsoleHosts({ text }: { text: string }): readonly InvalidDatadogConsoleHostHit[] {
  if (!text.includes(".") && !text.includes("%")) {
    return [];
  }
  const { view, starts, ends } = decodePercentEscapes({ text });
  return [...view.matchAll(INVALID_HOST_PATTERN)].map((match) => {
    const invalidHost = match[0].toLowerCase();
    const first = match.index;
    const last = first + match[0].length - 1;
    return {
      correctHost: CORRECT_BY_INVALID.get(invalidHost)!,
      invalidHost,
      matched: text.slice(starts[first], ends[last]),
    };
  });
}
