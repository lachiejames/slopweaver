/**
 * The seven search shapes a detective fans one keyword across, and the escaping that makes each one safe.
 *
 * Pure: no I/O, no clock, no database handle. {@link ./sql} turns what is here into statements.
 *
 * ## Why a ladder of shapes rather than one search
 *
 * The detectives need a ladder of counts instead of hand-written SQL: the exact text match turns up a few
 * records, the full wildcard match turns up a million, and the alphanumeric-only wildcard match turns up a
 * handful. A detective then reads that handful first, before digging through the million.
 *
 * The counts ARE the finding. A detective that only ever runs one search cannot tell a keyword that is
 * everywhere from a keyword that is nowhere, and both look identical in a ranked page of ten rows.
 *
 * ## The measurement that makes `exact` insufficient on its own, and this module necessary
 *
 * MEASURED against a live store of a couple of million rows, keyword `barten` — reproduce the whole table
 * with `slopweaver store probe barten`. The keyword is a synthetic stand-in for the measured name, so the
 * command reproduces the table's shape on any store, not these counts:
 *
 * | shape        | rows      |
 * | ------------ | --------- |
 * | `exact`      | dozens    |
 * | `wild-left`  | dozens    |
 * | `slash`      | dozens    |
 * | `alnum`      | thousands |
 * | `wild-right` | thousands |
 * | `wild-both`  | thousands |
 *
 * The generated `searchable` column is `to_tsvector('english', …)`, which tokenises on punctuation — so a
 * name inside an email address, a `<@U…|handle>` mention or a URL path never produces the bare lexeme, and
 * **nearly all the records that mention this person are invisible to the one search the store shipped**. No
 * amount of better ranking reaches them; only a substring does. That is the whole reason the six substring
 * shapes exist beside `exact`.
 *
 * ## Where the ladder discriminates, and where it does not
 *
 * `wild-both`, `alnum` and `wild-right` land within a handful of rows of each other on that keyword, because for a
 * term carrying no punctuation all three very nearly reduce to containment. `wild-left` and `slash` are
 * the rungs that cut. On a keyword that IS punctuation-shaped the ordering inverts — MEASURED the same
 * day on `17000`: `exact` 13, `alnum` 20, and `slash` **4**, which are the four pull-request URLs ending in that number, the worked
 * example of the move (`slopweaver store probe 17000`).
 *
 * So the rule a detective follows is not "read shape X". It is read where the count COLLAPSES, which is
 * a different rung for a name than for an identifier, and {@link ../result.collapse} computes it.
 *
 * ## What `exact` means here, and the reading of it that was rejected
 *
 * `exact` is the term as a whole stemmed WORD, through the tsvector. The alternative considered and not
 * taken is whole-FIELD equality — `body ILIKE 'barten'`, the body being nothing but the term. That is a
 * defensible reading of "exact text match" and it is the wrong one for this store: a `body` here holds a
 * paragraph, so the shape would be structurally zero on almost every row and the ladder's narrowest rung
 * would carry no information at all. The owner's own description has `exact` finding three records and
 * the wildcards growing from there, which is this reading rather than that one.
 */

/** One rung of the ladder, in the order a detective reads them: widest last. */
export const PROBE_SHAPES = ["exact", "wild-left", "slash", "alnum", "wild-right", "wild-both", "regex"] as const;

/** One search shape's id. */
export type ProbeShape = (typeof PROBE_SHAPES)[number];

/**
 * How a shape reaches the rows, which decides what it costs and whether an index can serve it.
 *
 * `lexeme` is the generated `searchable` tsvector through its gin index — single-digit milliseconds at any
 * term length. `trigram` is `pg_trgm` over `body` and `coalesce(title,'')`, which needs THREE literal
 * characters to extract a trigram from; below that the planner has nothing to seek and falls back to a
 * scan of every row. MEASURED: `body ilike '%nz%'` took several seconds against `searchable @@
 * plainto_tsquery('english','nz')` at about 100 ms, on the same couple of million rows.
 *
 * @internal
 */
export type ProbeAccess = "lexeme" | "trigram";

/** How many literal characters `pg_trgm` needs before its index can serve a pattern at all. */
export const TRIGRAM_FLOOR = 3;

/** What one shape is, and what a reader needs to understand its count. */
export interface ProbeShapeSpec {
  readonly shape: ProbeShape;
  /** How the ladder names this wildcard, printed beside the count so the ladder reads as a sequence of narrowing steps. */
  readonly wildcard: string;
  /** One line saying what the shape actually matches, for the human report and for a detective's brief. */
  readonly meaning: string;
  readonly access: ProbeAccess;
}

/**
 * Every shape, declared once.
 *
 * The order matches {@link PROBE_SHAPES}: narrowest first, so the rendered ladder puts the rung a
 * detective should spend attention on at the top and the million-row rung at the bottom.
 */
export const PROBE_SHAPE_SPECS: readonly ProbeShapeSpec[] = [
  {
    access: "lexeme",
    meaning: "the term as a whole stemmed word, through the generated tsvector",
    shape: "exact",
    wildcard: "term",
  },
  {
    access: "trigram",
    meaning: "a word ENDS with the term — the wildcard is on the left only",
    shape: "wild-left",
    wildcard: "*term",
  },
  {
    access: "trigram",
    meaning: "the term inside one slash-delimited segment — a path, a URL, an org/repo pair",
    shape: "slash",
    wildcard: "/*term*/",
  },
  {
    access: "trigram",
    meaning: "the term inside ONE alphanumeric word — the wildcards may not cross punctuation or space",
    shape: "alnum",
    wildcard: "[0-9a-z]*term[0-9a-z]*",
  },
  {
    access: "trigram",
    meaning: "a word STARTS with the term — the wildcard is on the right only",
    shape: "wild-right",
    wildcard: "term*",
  },
  {
    access: "trigram",
    meaning: "the term anywhere at all, crossing anything — the widest net there is",
    shape: "wild-both",
    wildcard: "*term*",
  },
  {
    access: "trigram",
    meaning: "the caller's own narrow regex, matched case-insensitively",
    shape: "regex",
    wildcard: "<your regex>",
  },
];

/** The spec for one shape, by id. */
const SPEC_BY_SHAPE: ReadonlyMap<ProbeShape, ProbeShapeSpec> = new Map(
  PROBE_SHAPE_SPECS.map((spec) => [spec.shape, spec]),
);

/**
 * What one shape is, by id.
 *
 * @returns the declared spec
 */
export function probeShapeSpec({ shape }: { shape: ProbeShape }): ProbeShapeSpec {
  // `!` rather than a fallback: SPEC_BY_SHAPE is built from PROBE_SHAPE_SPECS, whose entries are typed as
  // ProbeShape, so a miss here would be a fault in this module rather than in any caller's input.
  return SPEC_BY_SHAPE.get(shape)!;
}

/**
 * Escape a term for a `LIKE`/`ILIKE` pattern, so a keyword carrying `%` or `_` searches for itself.
 *
 * The backslash goes first — escaping it after the wildcards would double-escape what this function just
 * wrote.
 *
 * @param term the keyword exactly as the caller typed it
 * @returns the term safe to interpolate between `%` wildcards
 */
export function escapeLike({ term }: { term: string }): string {
  return term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * Every character POSIX ERE gives a meaning to, and which must therefore be escaped in a literal term.
 *
 * Written as a list rather than spread from one string: spreading a string yields Unicode code points and
 * splits a surrogate pair, which is meaningless for a set of ASCII metacharacters and is the class the
 * `no-misused-spread` rule exists to catch before it reaches something where it matters.
 */
const REGEX_META = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]);

/**
 * Escape a term for a POSIX regular expression, so a keyword carrying `.` or `(` searches for itself.
 *
 * Built character by character rather than by a regex replace, because the replacement string of a
 * `String.replace` gives `$` its own meaning and a term containing `$&` would then rewrite itself.
 *
 * @param term the keyword exactly as the caller typed it
 * @returns the term as a literal regex fragment
 */
export function escapeRegex({ term }: { term: string }): string {
  let out = "";
  for (const char of term) {
    out += REGEX_META.has(char) ? `\\${char}` : char;
  }
  return out;
}

/**
 * The longest run of literal characters in a regex — what `pg_trgm` has to work with.
 *
 * A pattern with no run of {@link TRIGRAM_FLOOR} literal characters cannot be served by the trigram index
 * at ALL, so it becomes a scan of every row in the store. This counts a run conservatively: a quantifier,
 * an alternation or an escape ENDS the current run, because none of them contributes a trigram the index
 * can seek. It therefore under-reports rather than over-reports, which is the correct direction for a
 * check whose job is to warn about cost.
 *
 * **Everything INSIDE a character class counts for nothing**, and getting that wrong is how this function
 * first shipped: `[a-z]+[0-9]+` has no literal at all, but a walker that only ends a run at a
 * metacharacter reads `a`, `-`, `z` as a three-character run — `-` is not a metacharacter — and reports a
 * pattern that must scan the whole store as index-servable. Tracking the bracket depth is what makes the
 * answer zero.
 *
 * @param pattern the caller's regex
 * @returns the length of its longest literal run
 */
export function longestLiteralRun({ pattern }: { pattern: string }): number {
  let best = 0;
  let run = 0;
  let escaped = false;
  let inClass = false;
  for (const char of pattern) {
    if (escaped) {
      escaped = false;
      run = 0;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      run = 0;
      continue;
    }
    if (char === "[") {
      inClass = true;
      run = 0;
      continue;
    }
    if (char === "]") {
      inClass = false;
      run = 0;
      continue;
    }
    if (inClass || REGEX_META.has(char)) {
      run = 0;
      continue;
    }
    run += 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Whether this shape can be index-served for this term, or will scan every row in the store.
 *
 * @param shape which rung of the ladder
 * @param term the keyword, or for `regex` the caller's own pattern
 * @returns true when an index can serve it
 */
export function isIndexed({ shape, term }: { shape: ProbeShape; term: string }): boolean {
  if (probeShapeSpec({ shape }).access === "lexeme") {
    return true;
  }
  if (shape === "regex") {
    return longestLiteralRun({ pattern: term }) >= TRIGRAM_FLOOR;
  }
  return term.length >= TRIGRAM_FLOOR;
}

/**
 * The regex one substring shape matches a term with, ready to bind as a parameter.
 *
 * `\m` and `\M` are Postgres's own start-of-word and end-of-word assertions, which is what makes
 * `wild-left` mean "a word ends with the term" rather than "the whole body ends with the term" — the
 * latter is what a bare `LIKE '%term'` means over a column holding a paragraph, and it is almost never the
 * question a detective is asking.
 *
 * `wild-both` has no regex: it is plain containment and goes through `ILIKE`, which the planner serves
 * from the same trigram index more cheaply than an equivalent pattern would.
 *
 * @param shape which rung of the ladder
 * @param term the keyword, already trusted as a literal
 * @returns the regex source, or nothing when the shape does not use one
 */
export function shapeRegex({ shape, term }: { shape: ProbeShape; term: string }): string | null {
  const literal = escapeRegex({ term });
  if (shape === "wild-left") {
    return `${literal}\\M`;
  }
  if (shape === "wild-right") {
    return `\\m${literal}`;
  }
  if (shape === "alnum") {
    return `\\m[0-9a-z]*${literal}[0-9a-z]*\\M`;
  }
  if (shape === "slash") {
    return `/[^/[:space:]]*${literal}[^/[:space:]]*(/|\\M)`;
  }
  return null;
}
