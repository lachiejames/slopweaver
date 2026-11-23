/**
 * The novel-word test behind the `jsdoc-tags` gate's earn-your-place rule (code-quality survey item 9,
 * Option B). Measured on this tree: of 9,084 `@param` descriptions, only 17 are literal restatement of the
 * parameter name (0 novel words); 69% carry three or more. Word COUNT is the wrong instrument — it flags
 * `@param tsIso the decision timestamp` (four words, one of them novel: "decision") the same as
 * `@param source the source` (three words, zero novel) — so the gate grades by novel content instead: a
 * word the parameter's own identifier does not already give the reader, once the identifier is split into
 * its parts and both sides are lowercased.
 *
 * Pure string work, no AST, no I/O — {@link identifierWords} and {@link novelWordCount} are unit-tested with
 * inline fixtures.
 */

/**
 * Common structural words that never count as documentation, regardless of the parameter's own name. A
 * `@param` description built only from these is boilerplate ("the value to use", "the thing that is
 * passed") no matter what the parameter is called.
 */
const GLUE_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "it",
  "its",
  "not",
  "no",
  "so",
  "when",
  "while",
  "which",
  "who",
  "whom",
  "whose",
  "what",
  "where",
  "why",
  "how",
  "into",
  "onto",
  "over",
  "under",
  "up",
  "down",
  "out",
  "off",
  "all",
  "any",
  "both",
  "each",
  "one",
  "some",
  "such",
  "only",
  "own",
  "same",
  "too",
  "very",
  "can",
  "will",
  "just",
  "used",
  "use",
  "given",
  "passed",
  "value",
]);

/**
 * Split an identifier into its lowercase word parts — `camelCase`, `PascalCase`, `snake_case` and
 * `kebab-case` all decompose the same way, so a `@param` for `tsIso` is graded against `{"ts", "iso"}`
 * whichever spelling convention the parameter used. A digit run splits from its neighbouring letters too
 * (`http2Port` → `{"http", "2", "port"}`), so a description that restates the name using its spelled-out
 * digit ("the HTTP 2 port") is graded as the restatement it is, not credited with a novel word for "http"
 * alone.
 *
 * @param name the parameter (or field) identifier
 * @returns its lowercase word parts, in order
 */
export function identifierWords({ name }: { name: string }): readonly string[] {
  return name
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * A raw candidate word, ORIGINAL case preserved (so {@link identifierWords} can still see its camelCase),
 * digits included (so a description's own digit run is graded the same way as one embedded in the
 * identifier — matching if it repeats the identifier's digit, novel if it names a different one), and both
 * straight and curly apostrophes included (so a possessive typed with a real typographic apostrophe, `’`,
 * is captured as ONE candidate rather than split in two at the character {@link POSSESSIVE_SUFFIX} would
 * otherwise never see).
 */
const RAW_WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9'’]*/g;

/** A trailing possessive `'s`/`’s`, or a bare trailing apostrophe (`users'`) — stripped before comparison. */
const POSSESSIVE_SUFFIX = /['’]s?$/i;

/**
 * How many words in a `@param` description are NOVEL — present in neither the parameter's own identifier
 * nor the fixed glue-word list. Zero means the description would add nothing a reader does not already have
 * from the signature line alone.
 *
 * Each description word is run through the SAME {@link identifierWords} split as the parameter name, after
 * stripping a trailing possessive — so a description that spells the identifier out inline (`tsIso`) or
 * possessively (`the user's config` for `user`) is graded as the restatement it is, not credited with a
 * novel word for the un-split or un-stripped form.
 *
 * @param name the parameter's identifier, split for comparison
 * @param description the tag's description text
 * @returns the count of distinct novel words
 */
export function novelWordCount({ name, description }: { name: string; description: string }): number {
  const identifierSet = new Set(identifierWords({ name }));
  const rawWords = description.match(RAW_WORD_PATTERN);
  // A global match answers `null`, not an empty list, when the description holds no word at all — and a
  // description with no word has no novel one.
  if (rawWords === null) {
    return 0;
  }
  const novel = new Set<string>();
  for (const raw of rawWords) {
    for (const word of identifierWords({ name: raw.replace(POSSESSIVE_SUFFIX, "") })) {
      if (GLUE_WORDS.has(word) || identifierSet.has(word)) {
        continue;
      }
      novel.add(word);
    }
  }
  return novel.size;
}
