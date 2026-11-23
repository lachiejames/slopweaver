/**
 * A sweep block's headline as a TYPED LIST of sentences — the shape that makes an over-cap headline
 * impossible to author, rather than a count taken after two prose strings were joined.
 *
 * ## Why the shape moved
 *
 * The headline used to arrive as two free-text flags, `--headline-strong` and `--headline-rest`, joined and
 * counted against {@link BLOCK_MAX_SENTENCES} after the whole edit was composed. MEASURED over twenty of the
 * chair's passes: five refusals of `the headline joins to 5 sentences, over the cap of 4`, two of them in the
 * last four passes, each costing a `perl` rewrite of that pass's script and a re-run. So the headline is a
 * list of at most four sentences, a fifth is refused at PARSE time naming the count, and a sentence carrying a
 * filesystem path, a seat number or the words `tick` or `row` is refused the same way: the chair should never
 * be able to author an over-cap headline.
 *
 * ## Why each element must be exactly one sentence
 *
 * A list of four elements is only a four-sentence headline if every element is one sentence, so each is
 * measured with the same `splitSentences`/`sentenceCount` the schema counts with (`./text.ts`): one
 * terminator, at the end. An element carrying two is refused rather than accepted as "one item" — otherwise
 * the list would be the two-string join again with more strings.
 *
 * ## What the three wording refusals catch, and what they deliberately do not
 *
 * - **A filesystem path**: ANY whitespace-delimited token holding a `\` (a Windows path), or holding a `/`, surrounding punctuation stripped, except
 *   the two shapes that are not one. An `http(s)://` address with a real host (`WEB_ADDRESS`), opened by nothing but a bracket or quote and closed by nothing but those or sentence punctuation — the chair's reply names `http://localhost:3000/queue`
 *   on purpose — and a BARE repository name, `owner/repo` or `owner/repo#N`: two runs of word characters and
 *   hyphens around ONE `/`, no dot, no second `/`, wrapped in nothing but `( ) , . ; : ! ?`. It is stated as the
 *   one shape that passes because the opposite, a list of the shapes a path can take, lost to five in a row under
 *   review — a long extension, a digit one, a hyphenated one, a scoped package, a bare directory — and a list of
 *   quote characters lost to a curly one. A quoted span holding both a space and a `/` (a web address aside) is a
 *   path too, in any quote that opens and closes at a word's edge, so `“docs/my archive”` cannot pass as two
 *   repository-shaped halves while `Sadie’s` opens no span. Spans are judged in each element.
 *
 * Every detector below also runs over the elements joined by a space, exactly as the page renders them, so neither a
 * quote nor a seat number can open in one element and close in the next. The residue, stated: a bare `docs/archive` IS the
 *   repository shape, and passes. Unquoted, each whitespace-separated token is judged ALONE, since nothing marks
 *   where a path with a space ends: `docs/my archive` reads exactly like a repository name and a word. So an unquoted
 *   path with a space passes whenever each of its slash-holding pieces is that bare shape (`docs/my archive`,
 *   `docs/my archive/file`); quoted, it is refused.
 * - **A seat number**: the word `seat` or `workspace`, then nothing but spaces, `:`, `#`, `-`, `no.` or
 *   `number`, then digits — `workspace:93`, `Seat # 307`, `seat no. 12`. A number BEFORE the word
 *   (`307 seats recovered`) is not a seat's address and passes.
 * - **`tick`, `ticks`, `row`, `rows`** as whole words, any casing. `tomorrow` and `ticket` pass: the test is
 *   a word boundary, never a substring. This is unconditional, unlike `./fleetJargon.ts`'s gloss rule — a
 *   gloss does not make either word something the owner reads a headline for.
 *
 * Pure — a list of strings in, every defect out, in source order, as display lines.
 */
import { BLOCK_MAX_SENTENCES } from "./caps.js";
import { sentenceCount, splitSentences } from "./text.js";

/**
 * Whatever wraps a token without being part of a path: at the start, anything a path cannot OPEN with (only a word
 * character, `.`, `~`, `$`, `/`, `\` or `@` can); at the end, anything but a word character, `/` or `\`. Stated
 * as what a path may hold rather than as a list of wrappers, because a list let `*src/file.ts*` through, and a
 * separator is never wrapping, because stripping one let `C:\.` through.
 */
const WRAPPING = /^[^\w.~$/@\\]+|[^\w/\\]+$/gu;

/** The one slash-holding shape that names a repository, not a place on disk: `owner/repo`, `owner/repo#N`. */
const REPOSITORY = /^[\w-]+\/[\w-]+(?:#\d+)?$/u;

/**
 * A web address: `http(s)://`, a HOST of letters, digits, dots and hyphens, an optional port, then only a path, query
 * or fragment. The host is checked because a bare `https://` prefix exempted `https://example.com,/tmp/secret`
 * whole; after a real host, a slash is the address's own path.
 */
const WEB_ADDRESS = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#]\S*)?$/iu;

/**
 * What may OPEN a web address and leave it one: brackets and quotes. Unrestricted, stripping let
 * `=https://example.com/tmp/report` pass as an address when it is not one.
 */
const WEB_OPENING = /^[(<[`\p{Quotation_Mark}]*$/u;

/**
 * What may CLOSE a web address and leave it one: closing brackets, quotes and the sentence's own punctuation. Stripped
 * unrestricted, a trailing `=` let `https://example.com=` pass as an address.
 */
const WEB_CLOSING = /^[)\]>.,;:!?`\p{Quotation_Mark}]*$/u;

/** Whatever a token closes with that a path cannot — the trailing half of {@link WRAPPING}. */
const TRAILING_WRAPPING = /[^\w/\\]*$/u;

/** Whatever a token opens with that a path cannot — the leading half of {@link WRAPPING}. */
const LEADING_WRAPPING = /^[^\w.~$/@\\]*/u;

/** The only wrapping a repository name may stand in and still pass: a bracket or the sentence's own punctuation. */
const ORDINARY_WRAPPING = /^[(),.;:!?]*$/u;

/**
 * A span inside any quote — a backtick or any character Unicode itself classes `Quotation_Mark` (ASCII, curly,
 * low-9, guillemets, corner brackets, fullwidth) — whose opening quote starts a word and whose closing quote ends
 * one, so an apostrophe inside `Sadie’s` opens nothing. The class is Unicode's, not a list, because a list lost
 * first to a curly quote and then to a fullwidth one. The span closes at the FIRST later quote not
 * followed by a letter or digit; a quote that is followed by one (an apostrophe, an inner opener) closes nothing, so
 * `"Sadie’s note: docs/my archive/file"` is one span. A span may be EMPTY, so `""` closes
 * at once rather than pairing its closing quote with the next span's opener.
 */
const QUOTED_SPAN =
  /(?<![\p{L}\p{N}])[`\p{Quotation_Mark}]((?:(?![`\p{Quotation_Mark}](?![\p{L}\p{N}]))[\s\S])*)[`\p{Quotation_Mark}](?![\p{L}\p{N}])/gu;

/**
 * A seat's address: the word, then only separators or `no.`/`number`, then digits — with no word boundary demanded
 * around `no` or `number`, since none sits in `Seat number12` or `Seatno12`.
 */
const SEAT_NUMBER = /\b(?:seat|workspace)s?(?:[\s:#-]|no\.?|number)*\d+/giu;

/** The fleet's own words for a sweep and a board entry, as whole words. */
const FLEET_WORD = /(?<![A-Za-z0-9_])(?:ticks?|rows?)(?![A-Za-z0-9_])/giu;

/**
 * Whether one token is a web address: opened by nothing but brackets or quotes, closed by nothing but those or the
 * sentence's punctuation, its wrapping stripped.
 *
 * @param token one whitespace-delimited token
 * @returns true when it reads as an address rather than a place on disk
 */
function isWebAddress({ token }: { token: string }): boolean {
  const [opening] = LEADING_WRAPPING.exec(token)!;
  const [closing] = TRAILING_WRAPPING.exec(token)!;
  return WEB_OPENING.test(opening) && WEB_CLOSING.test(closing) && WEB_ADDRESS.test(token.replace(WRAPPING, ""));
}

/**
 * Whether one token, its wrapping punctuation stripped, is a filesystem path.
 *
 * @param token one whitespace-delimited token
 * @returns true when it reads as a path on this machine
 */
function isFilesystemPath({ token }: { token: string }): boolean {
  const bare = token.replace(WRAPPING, "");
  if (bare.includes("\\")) {
    return true;
  }
  if (!bare.includes("/") || isWebAddress({ token })) {
    return false;
  }
  const wrapping = [...token.matchAll(WRAPPING)].map((match) => match[0]).join("");
  return !(REPOSITORY.test(bare) && ORDINARY_WRAPPING.test(wrapping));
}

/**
 * A quoted span with every web-address word removed, so a span is a path only for a slash that is not an address's.
 *
 * @param span the quoted text
 * @returns the span's other words, space-joined
 */
function withoutWebAddresses({ span }: { span: string }): string {
  return span
    .split(/\s+/u)
    .filter((word) => !isWebAddress({ token: word }))
    .join(" ");
}

/**
 * Every quoted span in a text holding both whitespace and a `/` that is not a web address's own.
 *
 * @param text a sentence, or the whole headline as it renders
 * @returns each such span, trimmed, in the order it occurs
 */
function quotedPaths({ text }: { text: string }): readonly string[] {
  // Whitespace is judged on the span AS QUOTED, before trimming, so `" docs/archive "` is a spaced path.
  return [...text.matchAll(QUOTED_SPAN)]
    .map((match) => match.slice(1).join(""))
    .filter((span) => /\s/u.test(span) && withoutWebAddresses({ span }).includes("/"))
    .map((span) => span.trim());
}

/** What one wording detector found, before it is worded as a refusal. */
interface WordingFinding {
  readonly kind: "path" | "seat" | "word";
  readonly found: string;
}

/**
 * Every wording defect in a text, each naming the offending token.
 *
 * @param text one sentence, or the whole headline as the page renders it
 * @returns one finding per defect, in the order they occur
 */
function wordingFindings({ text }: { text: string }): readonly WordingFinding[] {
  const quoted = quotedPaths({ text });
  const tokens = text
    .split(/\s+/u)
    .filter((token) => isFilesystemPath({ token }))
    .map((token) => token.replace(WRAPPING, ""))
    .filter((bare) => !quoted.some((span) => span.includes(bare)));
  return [
    ...[...tokens, ...quoted].map((found): WordingFinding => ({ found, kind: "path" })),
    ...[...text.matchAll(SEAT_NUMBER)].map((match): WordingFinding => ({ found: match[0], kind: "seat" })),
    ...[...text.matchAll(FLEET_WORD)].map((match): WordingFinding => ({ found: match[0], kind: "word" })),
  ];
}

/**
 * A finding's identity, for telling a defect the join created from one an element already carries.
 *
 * @returns the kind and the offending text, as one key
 */
const findingKey = (finding: WordingFinding): string => `${finding.kind}:${finding.found}`;

/**
 * One finding as the refusal line the chair reads.
 *
 * @param label how the refusal names the text, e.g. `headline.sentences: sentence 2`
 * @returns the display line
 */
function describeFinding({ finding, label }: { finding: WordingFinding; label: string }): string {
  switch (finding.kind) {
    case "path": {
      return `${label} names a filesystem path, ${finding.found} — say what it is, not where`;
    }
    case "seat": {
      return `${label} names a seat number, "${finding.found}" — say what the seat is doing, not its number`;
    }
    case "word": {
      return `${label} uses the fleet word "${finding.found}" — say what happened, in plain words`;
    }
    default: {
      const unhandled: never = finding.kind;
      return unhandled;
    }
  }
}

/**
 * Every defect in a proposed headline sentence list: the count, then each sentence's shape and wording.
 *
 * @param sentences the headline, one sentence per element, first one bold
 * @param field how the refusal names the list — a JSON path or a flag
 * @returns one display line per defect, or an empty list when the headline may be written
 */
export function headlineSentenceIssues({
  sentences,
  field,
}: {
  sentences: readonly string[];
  field: string;
}): readonly string[] {
  const count: string[] = [];
  if (sentences.length === 0) {
    count.push(`${field}: has 0 sentences; the headline needs at least 1`);
  }
  if (sentences.length > BLOCK_MAX_SENTENCES) {
    count.push(
      `${field}: has ${String(sentences.length)} sentences; at most ${String(BLOCK_MAX_SENTENCES)} are allowed — ` +
        "keep the ones the owner has to read to decide, and move the rest into a fold",
    );
  }
  const each = sentences.flatMap((sentence, index) => {
    const label = `${field}: sentence ${String(index + 1)}`;
    const parts = splitSentences({ text: sentence }).length;
    const terminators = sentenceCount({ text: sentence });
    const shape =
      parts === 1 && terminators === 1
        ? []
        : [
            `${label} must be exactly one sentence ending in . ! or ?, and it reads as ${String(parts)} part(s) ` +
              `with ${String(terminators)} terminator(s)`,
          ];
    return [...shape, ...wordingFindings({ text: sentence }).map((finding) => describeFinding({ finding, label }))];
  });
  // The page renders the list as ONE line, the elements joined by a space, so every detector runs over that line
  // too: a quote opened in one element and closed in the next, or `Seat no.` then `12 recovered.`, is a defect
  // no single element holds, so one detector at a time is the losing shape. Only what no element
  // already reported is added.
  const own = new Set(sentences.flatMap((sentence) => wordingFindings({ text: sentence }).map(findingKey)));
  const across = wordingFindings({ text: sentences.join(" ") })
    .filter((finding) => !own.has(findingKey(finding)))
    .map((finding) => describeFinding({ finding, label: `${field}: the headline as rendered` }));
  return [...count, ...each, ...across];
}
