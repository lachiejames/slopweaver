/**
 * The PURE core of `slopweaver store` — the flag specs and the query, facet, detail and ingest parsers. The
 * rendered lines sit beside it in `./rowLines.ts` and `./ingestLines.ts`, the identity parse in
 * `./identityArgs.ts`.
 *
 * Separate from {@link ./run} for the reason every other verb's core is: the interesting properties of a
 * query verb are checkable with no database. That a misspelled source is refused BY NAME with the real
 * vocabulary beside it, that an empty result and a refused filter print differently, and that an ingest
 * report says how many rows it refused as well as how many it stored — none of those needs Postgres, and
 * a test that needed one would not run in the unit lane at all.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import {
  ALL_STORE_FACETS,
  isStoreFacet,
  parseStoreQuery,
  type StoreFacet,
  type StoreQuery,
  sourceForQuery,
  textPredicateConflict,
  threadAnchorConflict,
} from "../../../store/query.js";
import { contentKindEnum, contentSourceEnum, visibilityEnum } from "../../../store/schema/enums.js";
import { storeManifest } from "../../manifests/store.js";
import { type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type Parsed, refusalLines, StoreCommandErrors } from "./errors.js";
import { flagNames } from "./identityArgs.js";

// The read renderers live beside this file along the rendering boundary; the verbs read them from here.
export { detailLines, facetLines, listLines } from "./rowLines.js";

/**
 * The filters that read a per-source table's own column rather than one every source has.
 *
 * Spelled once and spread into both the flag spec and the object the schema validates, so a filter added
 * to the query schema and forgotten here would be a flag the parser rejects — which is a loud failure
 * rather than a flag that parses and then does nothing.
 */
const PER_SOURCE_FILTERS: readonly string[] = ["channel", "repo", "team", "assignee", "state"];

/**
 * The verb tokens this noun answers to — what a tail has to start after.
 *
 * DERIVED from the manifest rather than listed, because a list is a second spelling of the verb set and a
 * verb missing from it does not fail loudly: `storeTail` simply keeps the verb word in the tail, and the
 * flag parser then refuses the invocation with `unexpected argument: <verb>`, which reads like a typo in
 * the flags rather than a registration the author forgot. Measured while adding `embed`: that is exactly
 * what happened, and the usage line printed beside it named the verb it had just rejected.
 *
 * Importing the manifest costs nothing at load time — every entry's command module is behind a `lazy`
 * thunk, so this reads the keys and the metadata and loads no verb.
 */
const VERB_TOKENS: ReadonlySet<string> = new Set(Object.keys(storeManifest));

/**
 * Flags every read verb shares — the whole filter surface, spelled once, plus `--home`.
 *
 * `--home` is on EVERY verb that opens the store, and a Codex review pass is why: the routing brief
 * grades a history row against the store resolved under ITS home and appends `--home <that dir>` to the
 * command it prints, so a store verb that refused the flag would turn a graded row into a command that
 * refuses before it opens anything. The selection is read under that home (`../../../store/config.ts`).
 */
const QUERY_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: [
    "home",
    "source",
    "kind",
    "container",
    "author",
    "person",
    "since",
    "until",
    "search",
    "contains",
    "like",
    "visibility",
    "thread",
    "limit",
    "offset",
    ...PER_SOURCE_FILTERS,
  ],
};

/** `store facets` takes the query flags plus which column to group by. */
const FACET_FLAGS: FlagSpec = { boolean: ["json"], string: [...stringFlagsOf({ spec: QUERY_FLAGS }), "facet"] };

/** `store detail` addresses one row by the pair a citation already carries. */
const DETAIL_FLAGS: FlagSpec = { boolean: ["json"], string: ["source", "id", "home"] };

/**
 * `store ingest` reads one bronze file — or one whole SOURCE — up to a required per-slice ceiling.
 *
 * `--file` and `--source` are the two ways of naming what to read and exactly one must be given: a verb
 * that accepted both would have to decide which won, and either answer surprises somebody.
 */
const INGEST_FLAGS: FlagSpec = {
  boolean: ["json", "all"],
  string: ["file", "source", "limit", "from", "from-file", "home"],
};

/** The flags `store query` advertises, for the help-truth ratchet. */
export const STORE_QUERY_FLAG_NAMES: readonly string[] = flagNames({ spec: QUERY_FLAGS });

/** The flags `store facets` advertises. */
export const STORE_FACET_FLAG_NAMES: readonly string[] = flagNames({ spec: FACET_FLAGS });

/** The flags `store detail` advertises. */
export const STORE_DETAIL_FLAG_NAMES: readonly string[] = flagNames({ spec: DETAIL_FLAGS });

/** The flags `store ingest` advertises. */
export const STORE_INGEST_FLAG_NAMES: readonly string[] = flagNames({ spec: INGEST_FLAGS });

/**
 * The flag tail of an invocation, whether the verb was spoken or defaulted.
 *
 * @param argv the full process argv (`[node, cli, store, …]`)
 * @returns the tail after the noun and, when it was spoken, the verb
 */
export function storeTail({ argv }: { argv: readonly string[] }): readonly string[] {
  const spoken = argv[3];
  return argv.slice(spoken !== undefined && VERB_TOKENS.has(spoken) ? 4 : 3);
}

/**
 * Whether a typed source is one the store has a column for.
 *
 * @param value the untrusted source name
 * @returns whether the store's `content_source` enum has a word for it
 */
export function isStorableSource(value: string): value is (typeof contentSourceEnum.enumValues)[number] {
  return (contentSourceEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Read an integer flag, refusing a value that is not one rather than silently reading as absent.
 *
 * @param raw the flag's value as typed
 * @param name the flag's name, for the refusal
 * @returns the number, `undefined` when the flag was not given, or the refusal
 */
function integerFlag({ raw, name }: { raw: string | boolean | undefined; name: string }): Parsed<number | undefined> {
  if (raw === undefined || raw === true || raw === false) {
    return ok(undefined);
  }
  return digitsOf({ name, raw });
}

/** A typed integer flag value as a number, refused by name when it is not all digits. */
function digitsOf({ raw, name }: { raw: string; name: string }): Parsed<number> {
  if (!/^\d+$/.test(raw)) {
    return err(StoreCommandErrors.integerRequired({ flag: name, got: raw }));
  }
  return ok(Number(raw));
}

/**
 * `--from`, the byte offset an ingest of one file resumes at — the file's first byte when it is not given,
 * because an ingest that names no resume point starts at the beginning.
 *
 * @param raw the flag's value as typed
 * @returns the offset, or the refusal of a value that is not an integer
 */
function resumeByteFlag({ raw }: { raw: string | boolean | undefined }): Parsed<number> {
  if (raw === undefined || raw === true || raw === false) {
    return ok(0);
  }
  return digitsOf({ name: "from", raw });
}

/** A parsed read invocation: the validated query, and whether to print JSON. */
export interface StoreReadArgs {
  readonly query: StoreQuery;
  readonly json: boolean;
  /** The state home whose remembered selection names the database, when the caller named one. */
  readonly home?: string;
}

/**
 * Parse a query invocation, naming every wrong flag rather than the first.
 *
 * A misspelled `--source` is refused HERE, before a connection is opened, with the seven real sources
 * printed beside it. That is the whole difference between this and a grep: an empty result set and a typo
 * are indistinguishable to a reader, and only one of them is a fact about the corpus.
 *
 * @param rest the flag tail
 * @returns the parsed query and output mode, or every reason it was refused
 */
export function parseStoreReadArgs({ rest }: { rest: readonly string[] }): Parsed<StoreReadArgs> {
  return parseQueryFlags({ rest, spec: QUERY_FLAGS });
}

/**
 * Parse a query invocation against a given flag spec, so `facets` can add its own flag.
 *
 * @param rest the flag tail
 * @param spec which flags this verb accepts
 * @returns the parsed query and output mode, or every reason it was refused
 */
function parseQueryFlags({ rest, spec }: { rest: readonly string[]; spec: FlagSpec }): Parsed<StoreReadArgs> {
  const parsed = parseFlags({ args: rest, spec });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const limit = integerFlag({ name: "limit", raw: parsed.value.values["limit"] });
  const offset = integerFlag({ name: "offset", raw: parsed.value.values["offset"] });
  if (limit.isErr() || offset.isErr()) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusalLines({ results: [limit, offset] }) }));
  }
  const input = queryInputOf({ limit: limit.value, offset: offset.value, parsed: parsed.value });
  const validated = parseStoreQuery({ input });
  if ("errors" in validated) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: [...validated.errors, ...vocabularyLines()] }));
  }
  // Two text predicates over the same column is a caller who has not decided which question they are
  // asking, and ANDing them would answer neither. Refused here for the same reason the source check below
  // is: an empty result set reads as a fact about the store.
  const conflict = textPredicateConflict({ query: validated.query });
  if (conflict.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: [...conflict, ...vocabularyLines()] }));
  }
  // A `--thread` with no `--source` cannot address one row, and picking a source for the caller returns
  // a DIFFERENT conversation rather than nothing — which is the one failure a reader cannot see.
  const anchored = threadAnchorConflict({ query: validated.query });
  if (anchored.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: [...anchored, ...vocabularyLines()] }));
  }
  // A per-source filter names exactly one source's table, so two of them, or one contradicting
  // `--source`, is a query that can only ever return nothing. Refused here rather than answered with an
  // empty result set, for the same reason a misspelled source is.
  const coherent = sourceForQuery({ query: validated.query });
  if ("errors" in coherent) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: [...coherent.errors, ...vocabularyLines()] }));
  }
  return ok({
    json: parsed.value.values["json"] === true,
    query: validated.query,
    ...homeOf({ parsed: parsed.value }),
  });
}

/**
 * The `--home` a parsed invocation named, as a spread-able fragment that is absent rather than undefined.
 *
 * @param parsed the tokenised flags
 * @returns `{ home }` when one was given, else nothing to spread
 */
export function homeOf({ parsed }: { parsed: { values: Readonly<Record<string, string | boolean>> } }): {
  home?: string;
} {
  const home = parsed.values["home"];
  return typeof home === "string" ? { home } : {};
}

/**
 * Fold parsed flags into the untrusted query object the schema validates.
 *
 * Every absent flag is omitted rather than set to `undefined`, because `exactOptionalPropertyTypes` makes
 * those two different things and the schema treats a present-but-undefined field as a supplied one.
 *
 * @param parsed the tokenised flags
 * @param limit the validated limit, when one was given
 * @param offset the validated offset, when one was given
 * @returns the object to validate
 */
function queryInputOf({
  parsed,
  limit,
  offset,
}: {
  parsed: ParsedFlags;
  limit: number | undefined;
  offset: number | undefined;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of [
    "source",
    "kind",
    "container",
    "author",
    "person",
    "since",
    "until",
    "search",
    "contains",
    "like",
    "visibility",
    "thread",
    ...PER_SOURCE_FILTERS,
  ]) {
    const value = parsed.values[key];
    if (typeof value === "string") {
      input[key] = value;
    }
  }
  if (limit !== undefined) {
    input["limit"] = limit;
  }
  if (offset !== undefined) {
    input["offset"] = offset;
  }
  return input;
}

/**
 * The closed vocabularies a refused query prints, so the fix is in the refusal rather than in the source.
 *
 * @returns one line per vocabulary the store enforces
 */
export function vocabularyLines(): readonly string[] {
  return [
    `sources: ${contentSourceEnum.enumValues.join(", ")}`,
    `kinds: ${contentKindEnum.enumValues.join(", ")}`,
    `visibility: ${visibilityEnum.enumValues.join(", ")}`,
    `facets: ${ALL_STORE_FACETS.join(", ")}`,
  ];
}

/** A parsed facet invocation: the query, which column to group by, and the output mode. */
export interface StoreFacetArgs extends StoreReadArgs {
  readonly facet: StoreFacet;
}

/**
 * Parse a facet invocation, refusing a facet the store does not group by.
 *
 * @param rest the flag tail
 * @returns the parsed facet query, or every reason it was refused
 */
export function parseStoreFacetArgs({ rest }: { rest: readonly string[] }): Parsed<StoreFacetArgs> {
  const base = parseQueryFlags({ rest, spec: FACET_FLAGS });
  if (base.isErr()) {
    return err(base.error);
  }
  const reparsed = parseFlags({ args: rest, spec: FACET_FLAGS });
  const raw = reparsed.isOk() ? reparsed.value.values["facet"] : undefined;
  const facet = typeof raw === "string" ? raw : "source";
  if (!isStoreFacet(facet)) {
    return err(StoreCommandErrors.facetUnknown({ facet, known: ALL_STORE_FACETS }));
  }
  const coherent = sourceForQuery({ facet, query: base.value.query });
  if ("errors" in coherent) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: [...coherent.errors, ...vocabularyLines()] }));
  }
  return ok({ ...base.value, facet });
}

/** A parsed detail invocation: the pair that addresses one row. */
export interface StoreDetailArgs {
  readonly source: (typeof contentSourceEnum.enumValues)[number];
  readonly sourceId: string;
  readonly json: boolean;
  readonly home?: string;
}

/**
 * Parse a detail invocation, which needs both halves of the identity pair.
 *
 * @param rest the flag tail
 * @returns the parsed address, or every reason it was refused
 */
export function parseStoreDetailArgs({ rest }: { rest: readonly string[] }): Result<StoreDetailArgs> {
  const parsed = parseFlags({ args: rest, spec: DETAIL_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const source = parsed.value.values["source"];
  const id = parsed.value.values["id"];
  const errors: string[] = [];
  if (typeof source !== "string" || !isStorableSource(source)) {
    errors.push("--source names one of the platforms the store holds");
  }
  if (typeof id !== "string") {
    errors.push("--id is that platform's own id for the row, as bronze and every citation carry it");
  }
  if (typeof source !== "string" || !isStorableSource(source) || typeof id !== "string") {
    return err([...errors, ...vocabularyLines()]);
  }
  return ok({ json: parsed.value.values["json"] === true, source, sourceId: id, ...homeOf({ parsed: parsed.value }) });
}

/** A parsed ingest invocation: what to read, and the required per-slice ceiling. */
export interface StoreIngestArgs {
  /** The one bronze file to read, when the invocation named a file. */
  readonly file?: string;
  /** The source whose whole bronze directory to read, when the invocation named a source instead. */
  readonly source?: (typeof contentSourceEnum.enumValues)[number];
  readonly limit: number;
  readonly json: boolean;
  /**
   * Where to begin in a single file, which must be an offset a previous run REPORTED rather than one
   * anyone computed. Meaningless across a source's many files, so it is refused with `--source`.
   */
  readonly from: number;
  /** Which of a source's files to resume at, in bronze read order. Refused with `--file`. */
  readonly fromFile?: string;
  /** Whether to keep taking bounded slices until each file ends, rather than stopping after one. */
  readonly all: boolean;
  readonly home?: string;
}

/**
 * Parse an ingest invocation. The ceiling is REQUIRED, which is the loader's own bound made visible.
 *
 * `--limit` stays REQUIRED even beside `--all`, and that is the point rather than an oversight: it is the
 * per-slice heap bound, not a total. `--all` keeps taking slices of that size until the file ends, so the
 * transient stays flat however large the file is — 6,899,158,625 bytes for one source here. A caller who
 * dropped the bound would be back to holding the corpus.
 *
 * @param rest the flag tail
 * @returns the parsed ingest, or every reason it was refused
 */
export function parseStoreIngestArgs({ rest }: { rest: readonly string[] }): Parsed<StoreIngestArgs> {
  const parsed = parseFlags({ args: rest, spec: INGEST_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const limit = integerFlag({ name: "limit", raw: parsed.value.values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const from = resumeByteFlag({ raw: parsed.value.values["from"] });
  if (from.isErr()) {
    return err(from.error);
  }
  const values = parsed.value.values;
  const target = ingestTargetErrors({ limit: limit.value, values });
  if (target.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: target }));
  }
  const file = values["file"];
  const source = values["source"];
  const fromFile = values["from-file"];
  return ok({
    all: values["all"] === true,
    from: from.value,
    json: values["json"] === true,
    limit: Number(limit.value),
    ...(typeof file === "string" ? { file } : {}),
    ...(typeof source === "string" && isStorableSource(source) ? { source } : {}),
    ...(typeof fromFile === "string" ? { fromFile } : {}),
    ...homeOf({ parsed: parsed.value }),
  });
}

/**
 * Every reason an ingest invocation names the wrong thing to read, or bounds it wrongly.
 *
 * Pure, and split out of {@link parseStoreIngestArgs} because the two modes' mutual exclusions plus the
 * two resume flags' mode-specific meanings are the whole of the branching — the parse itself is three
 * reads and a spread. Every check reports rather than returning early, so a caller who got two things
 * wrong is told both.
 *
 * @param values the tokenised flag values
 * @param limit the parsed per-slice ceiling, already known to be a number or absent
 * @returns one line per refusal, empty when the invocation is coherent
 */
function ingestTargetErrors({
  values,
  limit,
}: {
  values: Readonly<Record<string, string | boolean>>;
  limit: number | undefined;
}): readonly string[] {
  const file = values["file"];
  const source = values["source"];
  const namedFile = typeof file === "string";
  const namedSource = typeof source === "string";
  const errors: string[] = [];
  if (namedFile && namedSource) {
    errors.push("--file and --source both name what to read; give exactly one");
  } else if (!namedFile && !namedSource) {
    errors.push("name what to read: --file <path.jsonl> for one file, or --source <s> for a source's whole bronze");
  }
  if (namedSource && !isStorableSource(source)) {
    errors.push(
      `--source ${source} is not a source the store has a column for (expected ${contentSourceEnum.enumValues.join(" | ")})`,
    );
  }
  if (limit === undefined || limit < 1) {
    errors.push(
      "--limit is required: the PER-SLICE record ceiling, which is the heap bound rather than a ceiling on the run",
    );
  }
  // Each of the next two is a flag that would parse and then mean nothing, which is worse than a refusal:
  // an operator who typed `--source slack --from 8385643` would watch a whole-source run start from the
  // beginning with no way to tell that their offset had been dropped.
  if (namedSource && typeof values["from"] === "string") {
    errors.push("--from is a byte offset into ONE file; with --source use --from-file <basename> to resume at a file");
  }
  if (namedFile && typeof values["from-file"] === "string") {
    errors.push("--from-file resumes within a source's file list; with --file use --from <byte>");
  }
  return errors;
}
