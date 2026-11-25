/**
 * The query the typed client takes, and the schema that refuses a malformed one before it reaches SQL.
 *
 * The requirement is a client shaped like a TypeScript SDK exposing list, filter, facets and retrieve-detail,
 * never a blind grep, failing loudly with fast feedback. The failing-loudly half is this module: a query is
 * parsed against a closed vocabulary FIRST, so `--source slak` is a named refusal listing the seven real
 * sources rather than an empty result set that reads exactly like "we have no Slack".
 *
 * That distinction is the whole reason this is a schema and not a bag of optional strings. An empty
 * result and a misspelled filter are indistinguishable to a reader, and the one that is a typo is the one
 * that costs an hour. Every field below is validated against the store's own enums, which are themselves
 * the corpus's own unions, so there is exactly one place a vocabulary is declared.
 *
 * The facets are deliberately a CLOSED list rather than any column name. A facet is a `GROUP BY` over an
 * indexed column, and offering one over an unindexed column would be offering a whole-table scan behind a
 * flag that looks like every other flag.
 */
import { z } from "zod";

import { contentKindEnum, contentSourceEnum, visibilityEnum } from "./schema/enums.js";
import {
  contentGithubTable,
  contentLinearTable,
  contentNotionTable,
  contentSlackTable,
  hasSourceRowTable,
  type SourceWithRowTable,
} from "./schema/sourceRows.js";

/**
 * The source-neutral columns a caller may group by, each backed by an index the planner can seek.
 *
 * @internal
 */
export const STORE_FACETS = ["source", "kind", "container", "author", "visibility", "day"] as const;

/**
 * The per-source facets, namespaced by the source whose table carries them.
 *
 * Each entry holds the COLUMN rather than its name, so the grouping expression a facet becomes is built
 * from the schema itself — a renamed column is a compile error here instead of a runtime `undefined`
 * that would group every row under one value.
 *
 * Namespaced rather than bare because two sources both have a `state` and they are not the same
 * vocabulary — `linear.state` is a workflow state a team named and `github.state` is `open`/`closed`.
 * A bare `--facet state` would have to guess which, and guessing is what this layer exists to refuse.
 * The namespace also settles the join: a facet names exactly one source's table, so a facet read joins
 * one table rather than all four.
 */
export const SOURCE_FACETS = {
  "github.repo": { column: contentGithubTable.repo, source: "github" },
  "github.state": { column: contentGithubTable.state, source: "github" },
  "linear.assignee": { column: contentLinearTable.assignee, source: "linear" },
  "linear.project": { column: contentLinearTable.project, source: "linear" },
  "linear.state": { column: contentLinearTable.state, source: "linear" },
  "linear.team": { column: contentLinearTable.team, source: "linear" },
  "notion.parent": { column: contentNotionTable.parentKind, source: "notion" },
  "slack.channel": { column: contentSlackTable.channelId, source: "slack" },
  "slack.subtype": { column: contentSlackTable.subtype, source: "slack" },
} as const;

/** One per-source facet name. */
export type SourceFacet = keyof typeof SOURCE_FACETS;

/** Every facet a caller may name, source-neutral and per-source alike. */
export const ALL_STORE_FACETS = [...STORE_FACETS, ...Object.keys(SOURCE_FACETS)] as readonly string[];

/** One column a caller may group counts by. */
export type StoreFacet = (typeof STORE_FACETS)[number] | SourceFacet;

/**
 * How many rows a list returns when the caller names no limit.
 *
 * Small on purpose. A CLI answer a person or an agent reads is a page, and a caller that genuinely wants
 * the whole set says so — the failure this avoids is a verb that looks instant on an empty store and
 * prints two million rows on a full one.
 */
export const DEFAULT_LIST_LIMIT = 50;

/**
 * The largest page a single list call will return, whatever the caller asks for.
 *
 * @internal
 */
export const MAX_LIST_LIMIT = 1000;

/**
 * The whole query surface, validated.
 *
 * Every filter is optional and they AND together, which is the shape a reader expects from a filter row
 * and the only one that composes without precedence rules nobody remembers. The one exception is the three
 * TEXT predicates, and {@link textPredicateConflict} is where that exception is enforced rather than here:
 * `search`, `contains` and `like` ask the same column three different questions, and a query naming two
 * of them is a caller who has not decided which.
 *
 * @internal
 */
export const storeQuerySchema = z.object({
  assignee: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  container: z.string().min(1).optional(),
  contains: z.string().min(1).optional(),
  kind: z.enum(contentKindEnum.enumValues).optional(),
  like: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.number().int().min(0).default(0),
  person: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
  source: z.enum(contentSourceEnum.enumValues).optional(),
  state: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  thread: z.string().min(1).optional(),
  until: z.iso.datetime().optional(),
  visibility: z.enum(visibilityEnum.enumValues).optional(),
});

/**
 * The three TEXT predicates a query may name, most specific last.
 *
 * Declared as data so {@link textPredicateConflict} and its refusal read the same list, and so a fourth
 * one added later cannot be enforced in one place and forgotten in the other.
 */
export const TEXT_PREDICATES = ["search", "contains", "like"] as const satisfies readonly (keyof StoreQuery)[];

/**
 * The refusal a query naming more than one text predicate earns, or none when it names at most one.
 *
 * These are not filters that compose. `search` asks the stemmed full-text index whether the WORDS appear,
 * `contains` asks whether the CHARACTERS appear literally, and `like` hands the caller's own pattern to
 * `ILIKE`. ANDing two of them would answer a question nobody asked and quietly return less than either,
 * which is the shape of an empty answer that reads as a fact. Pure.
 *
 * @param query the validated query
 * @returns the refusal naming every predicate it gave, or none
 */
export function textPredicateConflict({ query }: { query: StoreQuery }): readonly string[] {
  const named = TEXT_PREDICATES.filter((field) => query[field] !== undefined);
  if (named.length <= 1) {
    return [];
  }
  return [
    `a query may name one text predicate, and this one names ${named.map((field) => `--${field}`).join(" and ")} — ` +
      "--search matches stemmed words, --contains matches literal characters, --like takes your own pattern",
  ];
}

/**
 * The refusal a `--thread` with no `--source` earns, or none when the pair is complete.
 *
 * `--thread` names a row by the id its own platform gave it, and that id is unique only WITHIN a source
 * — the store's identity has always been the pair `(source, source_id)`, which is why `store detail`
 * takes both too. A thread read given only half of it would have to pick a source, and a wrong pick
 * returns a different conversation rather than an error. Pure.
 *
 * @param query the validated query
 * @returns the refusal naming what is missing, or none
 */
export function threadAnchorConflict({ query }: { query: StoreQuery }): readonly string[] {
  if (query.thread === undefined || query.source !== undefined) {
    return [];
  }
  return [
    "--thread names a row by its own platform's id, which is unique only within a source — " +
      "give --source too, the same pair `store detail` takes",
  ];
}

/**
 * Which source each per-source filter belongs to.
 *
 * Declared as data rather than as branches, because {@link sourceForQuery} and the refusal message both
 * read it and a second copy is a second thing to keep in step.
 */
export const FILTER_SOURCES = [
  { field: "assignee", source: "linear" },
  { field: "channel", source: "slack" },
  { field: "repo", source: "github" },
  { field: "team", source: "linear" },
] as const satisfies readonly { readonly field: keyof StoreQuery; readonly source: SourceWithRowTable }[];

/**
 * Whether a facet name is one of the per-source ones.
 *
 * A predicate rather than an `in` check followed by an assertion, so the narrowing is the compiler's
 * conclusion instead of a promise made to it.
 *
 * @returns whether {@link SOURCE_FACETS} declares that facet
 */
export function isSourceFacet(value: string): value is SourceFacet {
  return Object.keys(SOURCE_FACETS).includes(value);
}

/**
 * The one per-source table a query needs joined, or a refusal when it asks for two.
 *
 * `state` is deliberately absent from {@link FILTER_SOURCES}: both GitHub and Linear have one, so it
 * takes its source from whatever the rest of the query already settled rather than picking for the
 * caller. A `--state` with nothing to pin it is refused for exactly that reason.
 *
 * @param query the validated query
 * @param facet the facet being grouped by, when there is one
 * @returns the single source whose table must be joined, `null` when none is needed, or the refusal
 */
export function sourceForQuery({
  query,
  facet,
}: {
  query: StoreQuery;
  facet?: StoreFacet;
}): { source: SourceWithRowTable | null } | { errors: readonly string[] } {
  const asked = askedSources({ facet, query });
  const named = query.source;
  if (named !== undefined && asked.size > 0 && !(hasSourceRowTable(named) && asked.has(named))) {
    const [only] = [...asked.entries()];
    return {
      errors: [
        `${only === undefined ? "that filter" : `${only[1].join(", ")} is a ${only[0]} filter`}, but --source ${named} was given`,
      ],
    };
  }
  if (asked.size > 1) {
    const both = [...asked.entries()].map(([source, why]) => `${why.join(", ")} (${source})`);
    return { errors: [`a query may name one source's columns, and this one names ${both.join(" and ")}`] };
  }
  const [chosen] = [...asked.keys()];
  const stateSettled = named === "github" || named === "linear" || chosen !== undefined;
  if (query.state !== undefined && !stateSettled) {
    return {
      errors: [
        "--state belongs to both github and linear, so it needs --source, another filter, or a facet to say which",
      ],
    };
  }
  if (chosen === undefined) {
    // No filter or facet reached into a per-source table, so the query joins none.
    return { source: null };
  }
  return { source: chosen };
}

/**
 * Which per-source tables a query's own filters and facet reach into, and which flag asked for each.
 *
 * @param query the validated query
 * @param facet the facet being grouped by, when there is one
 * @returns one entry per source named, carrying the flags that named it
 */
function askedSources({
  query,
  facet,
}: {
  query: StoreQuery;
  facet: StoreFacet | undefined;
}): ReadonlyMap<SourceWithRowTable, readonly string[]> {
  const asked = new Map<SourceWithRowTable, string[]>();
  const note = ({ source, why }: { source: SourceWithRowTable; why: string }): void => {
    const earlier = asked.get(source);
    if (earlier === undefined) {
      // The first flag to reach this source's table opens its list.
      asked.set(source, [why]);
      return;
    }
    asked.set(source, [...earlier, why]);
  };
  for (const { field, source } of FILTER_SOURCES) {
    if (query[field] !== undefined) {
      note({ source, why: `--${field}` });
    }
  }
  if (facet !== undefined && isSourceFacet(facet)) {
    note({ source: SOURCE_FACETS[facet].source, why: `--facet ${facet}` });
  }
  return asked;
}

/** A parsed, validated query — the only shape the client accepts. */
export type StoreQuery = z.infer<typeof storeQuerySchema>;

/**
 * Parse an untrusted query, naming every field that is wrong rather than the first.
 *
 * A list rather than one message because a caller assembling flags usually has more than one wrong, and
 * a verb that reports them one lap at a time is the slow-feedback shape this whole layer replaces.
 *
 * @param input the untrusted query, typically assembled from CLI flags
 * @returns the validated query, or every reason it was refused
 */
export function parseStoreQuery({ input }: { input: unknown }): { query: StoreQuery } | { errors: readonly string[] } {
  const parsed = storeQuerySchema.safeParse(input);
  if (parsed.success) {
    return { query: parsed.data };
  }
  return {
    errors: parsed.error.issues.map((issue) => {
      const where = issue.path.join(".");
      return `${where === "" ? "query" : where}: ${issue.message}`;
    }),
  };
}

/**
 * Validate a facet name against the closed list, so a typo is a refusal rather than a `GROUP BY` failure.
 *
 * @param value the untrusted facet name
 * @returns whether the store groups by that column
 */
export function isStoreFacet(value: string): value is StoreFacet {
  return ALL_STORE_FACETS.includes(value);
}
