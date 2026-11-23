/**
 * The live Datadog ladder — the rungs a detective fans one keyword across, and the query each one is. Pure.
 *
 * ## Four rungs, not seven, and the measurement that settles it
 *
 * `src/store/probe/shapes.ts` fans a keyword across SEVEN shapes because Postgres's `to_tsvector` tokenises
 * on punctuation, so a name inside an email address or a URL path produces no lexeme and only a substring
 * reaches it. Datadog's message index does not tokenise the same way, so the substring rungs that
 * discriminate over the store collapse over Datadog.
 *
 * MEASURED on this install's site, `env:(prod OR production)`, last 24 h, keyword `Knock` —
 * reproduce with `slopweaver store probe knock --source datadog --from 1d`:
 *
 * | query        | lines, against `Knock`        |
 * | ------------ | ----------------------------- |
 * | `Knock`      | the baseline                  |
 * | `*Knock*`    | the same                      |
 * | `Knock*`     | the same                      |
 * | `*Knock`     | the same                      |
 * | `*:Knock*`   | a fraction of a percent more  |
 * | `*:*Knock*`  | a few percent more            |
 *
 * Over tens of thousands of matching lines, the four message-index rungs land within a handful of each other and the two all-fields rungs are where
 * the count actually moves: `*:` is the rung that cuts, which is the tier-1 knowledge row's own finding
 * stated as a ladder. So the ladder is the bare term, its wildcard, and the two all-fields forms — and the
 * rungs below are the detective's own next moves rather than more rungs, because each needs an argument the
 * keyword does not supply: a PHRASE, a FACET to group by, a term to EXCLUDE.
 *
 * ## There is no regex rung, and that is Datadog's syntax rather than a gap here
 *
 * Datadog's search syntax is `*`, `?`, `AND`, `OR`, `-`, `*:`, `@attr:` and numeric ranges. It has no regular
 * expressions at all, so a `regex` rung would have to be a lie or a local post-filter pretending to be a
 * query. It is the second of those and it says so: `--regex` on `store hits --source datadog` pulls a
 * bounded page and matches over it HERE, which is the same move `store peek --match` already makes and is
 * honest about its bound — a regex that matches nothing on page one has not proven the term is absent.
 */

import { ENV_ABSENT } from "./shapeKey.js";

/** One rung of the Datadog ladder, narrowest first. */
export const DATADOG_RUNGS = ["term", "term-wild", "all-fields", "all-fields-wild"] as const;

/** One rung's id. */
export type DatadogRung = (typeof DATADOG_RUNGS)[number];

/** What one rung is, and what a reader needs to understand its count. */
export interface DatadogRungSpec {
  readonly rung: DatadogRung;
  /** How the query is written, with `term` standing for the keyword. */
  readonly wildcard: string;
  /** One line saying what the rung actually matches. */
  readonly meaning: string;
}

/** Every rung, declared once, in the order a rendered ladder prints them. *
 * @internal
 */
export const DATADOG_RUNG_SPECS: readonly DatadogRungSpec[] = [
  {
    meaning: "the term as a token of the MESSAGE only — an attribute that names it is invisible here",
    rung: "term",
    wildcard: "term",
  },
  {
    meaning: "the term inside a message token; on this index it very nearly equals the bare term",
    rung: "term-wild",
    wildcard: "*term*",
  },
  {
    meaning: "the term as a token of ANY field, message and attributes alike — the rung that cuts",
    rung: "all-fields",
    wildcard: "*:term*",
  },
  {
    meaning: "the term inside any field's token — the widest net Datadog's syntax can express",
    rung: "all-fields-wild",
    wildcard: "*:*term*",
  },
];

/** The spec for one rung, by id. */
const SPEC_BY_RUNG: ReadonlyMap<DatadogRung, DatadogRungSpec> = new Map(
  DATADOG_RUNG_SPECS.map((spec) => [spec.rung, spec]),
);

/**
 * What one rung is, by id.
 *
 * @returns the declared spec
 */
export function datadogRungSpec({ rung }: { rung: DatadogRung }): DatadogRungSpec {
  // `!` rather than a fallback, for the reason every lookup in this package uses one: the map is built from
  // the declaration list, so a miss is a fault here rather than in a caller's input.
  return SPEC_BY_RUNG.get(rung)!;
}

/**
 * Every character Datadog's search syntax gives a meaning to, and which must be escaped in a literal term.
 *
 * From `docs.datadoghq.com/logs/explorer/search_syntax`. The list is the documented
 * reserved set; a term carrying one of these unescaped does not fail, it silently searches for something
 * else, which is the failure mode the whole `Result` discipline in this package exists to refuse.
 */
const RESERVED = new Set([
  "+",
  "-",
  "=",
  "&",
  "|",
  ">",
  "<",
  "!",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "^",
  '"',
  "“",
  "”",
  "~",
  "*",
  "?",
  ":",
  "\\",
  "/",
]);

/**
 * Escape a keyword so Datadog searches for it literally.
 *
 * Built character by character rather than by a regex replace, for the same reason
 * `src/store/probe/shapes.ts`'s own escaper is: a replacement string gives `$` its own meaning, and a term
 * containing `$&` would rewrite itself.
 *
 * @param term the keyword exactly as the caller typed it
 * @returns the term safe to place inside a query
 */
export function escapeDatadogTerm({ term }: { term: string }): string {
  let out = "";
  for (const char of term) {
    out += RESERVED.has(char) ? `\\${char}` : char;
  }
  return out;
}

/**
 * The query one rung searches with.
 *
 * Whitespace is what makes this more than string concatenation: a term containing a space is two tokens to
 * Datadog, so `*:*two words*` is a wildcard on `two` ANDed with a bare `words*`, which is not the search the
 * caller asked for. A term carrying whitespace is therefore quoted as a phrase and the wildcard rungs
 * degrade to the bare phrase, which is the only thing the syntax can express — and
 * {@link datadogRungQuery} says so by returning the same string for every rung, so a ladder over such a term
 * shows four identical counts rather than four different wrong ones.
 *
 * @param rung which rung of the ladder
 * @param term the keyword exactly as the caller typed it
 * @returns the query string to send
 */
export function datadogRungQuery({ rung, term }: { rung: DatadogRung; term: string }): string {
  if (/\s/.test(term)) {
    return `"${term.replaceAll('"', "")}"`;
  }
  const literal = escapeDatadogTerm({ term });
  if (rung === "term") {
    return literal;
  }
  if (rung === "term-wild") {
    return `*${literal}*`;
  }
  if (rung === "all-fields") {
    return `*:${literal}*`;
  }
  return `*:*${literal}*`;
}

/**
 * The environment scope clause a query carries, on the owner's A ruling.
 *
 * The scope is all logs, regardless of environment. Production is a fine place to start, but the owner
 * sometimes needs staging or other kinds of logs, and pre-existing bugs mean some logs carry the wrong env key
 * or none.
 *
 * So the DEFAULT is no clause at all — every environment, including the events whose env tag is wrong and
 * the events that carry none, both of which any `env:` clause silently excludes. `--env` narrows, and
 * narrowing is the caller's explicit act rather than this function's default.
 *
 * There is deliberately no way to ask for "the events with no env tag" through this clause: Datadog has no
 * negated-existence operator on a reserved attribute, so the honest answer is the unscoped query plus the
 * `env` facet from {@link ../detective/shape}, which names {@link ENV_ABSENT} as its own bucket.
 *
 * @param envs the environments the caller narrowed to, empty for every environment
 * @returns the clause, or nothing when the query is unscoped
 */
export function envClause({ envs }: { envs: readonly string[] }): string | null {
  const named = envs.filter((env) => env.length > 0 && env !== ENV_ABSENT);
  if (named.length === 0) {
    return null;
  }
  if (named.length === 1) {
    return `env:${named[0]!}`;
  }
  return `env:(${named.join(" OR ")})`;
}

/**
 * The whole query one rung sends: the rung's own term, the caller's env narrowing, and any extra clause.
 *
 * @param rung which rung of the ladder
 * @param term the keyword
 * @param envs the environments the caller narrowed to, empty for every environment
 * @param extra a clause the caller added — a service, a status, an exclusion — or nothing
 * @returns the query string to send
 */
export function datadogQuery({
  rung,
  term,
  envs,
  extra,
}: {
  rung: DatadogRung;
  term: string;
  envs: readonly string[];
  extra?: string | undefined;
}): string {
  const env = envClause({ envs });
  return [
    ...(env === null ? [] : [env]),
    ...(extra === undefined || extra.length === 0 ? [] : [extra]),
    datadogRungQuery({ rung, term }),
  ].join(" ");
}
