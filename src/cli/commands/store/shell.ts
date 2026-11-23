/**
 * What every store-reading shell needs and none of them should own: opening the store, refusing, and
 * folding a flag bag plus a question into the query the schema validates.
 *
 * Extracted because `store cite` and `store read` had grown three copies of the same four functions
 * between them, which the `duplicate-windows` gate caught. They are genuinely the same job — both select
 * store rows for a question — and the difference between them is what they DO with the rows, which is
 * what stays in each shell.
 */
import type { CorpusRecord } from "../../../corpus/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import {
  parseStoreQuery,
  type StoreQuery,
  sourceForQuery,
  TEXT_PREDICATES,
  textPredicateConflict,
  threadAnchorConflict,
} from "../../../store/query.js";
import { selectStoreRecords } from "../../../store/selection.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/**
 * Print a list of refusal lines followed by the verb's usage, and return the usage exit code.
 *
 * @param lines every reason the invocation was refused, not just the first
 * @param usage the verb's own usage text
 * @returns the exit code to return
 */
export function refuseWith({ lines, usage }: { lines: readonly string[]; usage: string }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Print a parser's typed refusal one line per problem, then the verb's usage, and return the usage exit code.
 *
 * @param error every reason the invocation was refused, not just the first
 * @param usage the verb's own usage text
 * @returns the exit code to return
 */
export function refuseParsed({ error, usage }: { error: StoreCommandError; usage: string }): number {
  return refuseWith({ lines: storeCommandErrorLines({ error }), usage });
}

/**
 * Open the store, or print the refusal naming both places a selection can live.
 *
 * A tool that picks its own database is a tool that can run against the wrong one, which is why every
 * verb here refuses rather than defaulting. `home` is a parameter for the reason the Slack token
 * resolvers' is: a zero-arg resolver silently reads the DEFAULT home's remembered selection, so a verb
 * running under `--home /elsewhere` would take its database from one home while writing its shards and
 * reports into another. Two homes, one read — the kind of mismatch a green suite never notices.
 *
 * @param home the Slopweaver home the remembered selection is read under
 * @returns the open client, or the exit code to return instead
 *
 * @internal
 */
export async function openStoreOrRefuse({ home }: { home?: string } = {}): Promise<
  { client: StoreClient } | { code: number }
> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return { code: EXIT_ERROR };
  }
  return { client: opened.value };
}

/**
 * Fold a question and a flag bag into the untrusted query object the store schema validates.
 *
 * The question is BOTH the free text a reader is given and the `--search` term the candidates are
 * selected by, which is the shape of this whole mechanism: Postgres narrows, something else judges.
 *
 * **That default is skipped when the caller named a text predicate of their own**, and it has to be: a
 * question always exists on these verbs, so defaulting `search` from it unconditionally would put a second
 * text predicate on every `--contains` or `--like` call and {@link ../../../store/query.textPredicateConflict}
 * would refuse each one. The readers still get the question verbatim; only the SELECTION changes hands.
 *
 * @param values the tokenised flag values
 * @param question the positional question
 * @param filters which flag names are query filters rather than shell options
 * @param limit the page size to use when the caller named none
 * @returns the object to validate
 *
 * @internal
 */
export function storeQueryInput({
  values,
  question,
  filters,
  limit,
}: {
  values: Readonly<Record<string, string | boolean>>;
  question: string;
  filters: readonly string[];
  limit: number;
}): Record<string, unknown> {
  const named = TEXT_PREDICATES.filter((field) => typeof values[field] === "string");
  const input: Record<string, unknown> = named.length === 0 ? { search: question } : {};
  for (const key of filters) {
    const value = values[key];
    if (typeof value === "string") {
      input[key] = value;
    }
  }
  const namedLimit = values["limit"];
  input["limit"] = typeof namedLimit === "string" && /^\d+$/.test(namedLimit) ? Number(namedLimit) : limit;
  return input;
}

/**
 * The query filters both store-reading shells accept, spelled once.
 *
 * @internal
 */
export const STORE_QUESTION_FILTERS: readonly string[] = [
  "search",
  "contains",
  "like",
  "source",
  "kind",
  "container",
  "author",
  "person",
  "since",
  "until",
  "visibility",
  "thread",
  "channel",
  "repo",
  "team",
  "assignee",
  "state",
];

/**
 * How the candidates were selected, in the words of the predicate that actually ran.
 *
 * A caller reading a thin page has to know which of the three questions was asked of the store, because
 * they select different rows from the same column: measured on this install, `--contains U04` returns 514
 * rows and `--search U04` returns none, since the tokeniser never sees a substring inside a `<@U…>`
 * mention. Reproduce with `slopweaver store query --contains U04 --limit 3`. Pure.
 *
 * @param query the validated query
 * @returns one clause naming the predicate and its term, or that nothing narrowed the selection
 *
 * @internal
 */
export function selectedBy({ query }: { query: StoreQuery }): string {
  if (query.contains !== undefined) {
    return `literal substring: ${query.contains}`;
  }
  if (query.like !== undefined) {
    return `pattern: ${query.like}`;
  }
  if (query.search !== undefined) {
    return `full text: ${query.search}`;
  }
  return "no text predicate — the structured filters alone selected these";
}

/**
 * Say how many rows were held back for having no container, when any were.
 *
 * @param count how many rows could not be placed
 *
 * @internal
 */
export function reportUnplaced({ count }: { count: number }): void {
  if (count === 0) {
    return;
  }
  logger.warn({
    msg:
      `${String(count)} row(s) were left out because their container did not resolve — a citation is ` +
      "computed from the container, so those rows cannot be cited. That is a broken foreign key, not an " +
      "ordinary shape: check `container_id` on them.",
  });
}

/**
 * The flags a store-question verb shares: the filter surface, the page size, the output mode, and `--home`.
 *
 * `--home` is here because the routing brief appends it to every store command it grades
 * (`../../../route/storeReading.ts`), so a store-question verb without it would print as AVAILABLE and refuse
 * on `unknown flag` — a review traced exactly that through `facts --store`.
 */
export const STORE_QUESTION_FLAGS = {
  boolean: ["json"],
  string: [...STORE_QUESTION_FILTERS, "limit", "home"],
} as const;

/** What one store-question invocation resolved to: the question asked, and the records it selected. */
export interface StoreQuestion {
  readonly question: string;
  readonly query: StoreQuery;
  readonly records: readonly CorpusRecord[];
}

/**
 * Parse a store-question invocation, select its records, and hand them back — the whole of what
 * `store cite` and `store read` share.
 *
 * They differ only in what they DO with the records: one renders them as cited facts, the other shards
 * them for parallel readers. Everything before that is the same act — validate the flags against the
 * store's own vocabulary, refuse a query that could only ever return nothing, open the store, read the
 * page, turn the rows back into records — and it was three copies of the same twenty lines until the
 * `duplicate-windows` gate said so.
 *
 * @param rest the argv tail
 * @param usage the calling verb's usage, printed under any refusal
 * @param spec the flags that verb accepts, which must include every filter it means to honour
 * @param defaultLimit the page size when the caller names none
 * @returns the question and its records, or the exit code to return instead
 */
export async function readStoreQuestion({
  rest,
  usage,
  spec,
  defaultLimit,
}: {
  rest: readonly string[];
  usage: string;
  spec: FlagSpec;
  defaultLimit: number;
}): Promise<{ resolved: StoreQuestion; values: Readonly<Record<string, string | boolean>> } | { code: number }> {
  const planned = planStoreQuestion({ defaultLimit, rest, spec, usage });
  if ("code" in planned) {
    return { code: planned.code };
  }
  const { question, query, values } = planned;
  // The SAME `--home` the fan-out is written under, when the calling verb declares that flag. A read that
  // resolved its database from the default home while sharding into another home's directory would be
  // answering one install's question out of another install's records.
  const home = values["home"];
  const opened = await openStoreOrRefuse(typeof home === "string" ? { home } : {});
  if ("code" in opened) {
    return { code: opened.code };
  }
  try {
    const selected = await selectStoreRecords({ client: opened.client, query });
    if (selected.isErr()) {
      logger.error({ msg: selected.error.message });
      return { code: EXIT_ERROR };
    }
    const read = selected.value;
    reportUnplaced({ count: read.unplaced });
    // Which terms actually selected the candidates, always — a caller looking at a thin or empty page needs
    // to tell "the store holds nothing about this" from "these terms found nothing", and the query the
    // question became is the only thing that separates them. It names WHICH predicate ran, because the
    // three do not answer the same question: printing `full text:` over a `--contains` run would describe
    // the wrong mechanism, and reading `query.search` alone printed the word `undefined` outright.
    logger.error({ msg: `selected ${String(read.records.length)} candidate(s) with ${selectedBy({ query })}` });
    return { resolved: { query, question, records: read.records }, values };
  } finally {
    await opened.client.close();
  }
}

/**
 * Parse and validate a store-question invocation, before any connection is opened.
 *
 * Split from {@link readStoreQuestion} so that everything refusable is refused with no database in the
 * picture — which is what makes a misspelled `--source` a named usage error rather than an unreachable
 * store, and what the whole query layer's "fail loudly, fast feedback" mandate means in practice.
 *
 * @param rest the argv tail
 * @param usage the calling verb's usage, printed under any refusal
 * @param spec the flags that verb accepts
 * @param defaultLimit the page size when the caller names none
 * @returns the question, the validated query and the raw flag values, or the exit code to return
 */
function planStoreQuestion({
  rest,
  usage,
  spec,
  defaultLimit,
}: {
  rest: readonly string[];
  usage: string;
  spec: FlagSpec;
  defaultLimit: number;
}): StoreQuestionArgs | { code: number } {
  const parsed = parseStoreQuestionArgs({ defaultLimit, rest, spec });
  if (parsed.isErr()) {
    return { code: refuseWith({ lines: storeCommandErrorLines({ error: parsed.error }), usage }) };
  }
  return parsed.value;
}

/** A parsed store-question invocation: the question, the validated query, and the raw flag values. */
export interface StoreQuestionArgs {
  readonly question: string;
  readonly query: StoreQuery;
  readonly values: Readonly<Record<string, string | boolean>>;
}

/**
 * Parse a store-question invocation against the store's own vocabulary. PURE — no logging, no database.
 *
 * Separated from the shell that prints its refusal so the whole parse is testable as a value, which is
 * what the repo-wide help-truth ratchet reads: every flag a verb ADVERTISES has to have a probe that
 * parses, and a parser buried inside an effectful shell cannot be probed at all.
 *
 * @param rest the argv tail
 * @param spec the flags the calling verb accepts
 * @param defaultLimit the page size when the caller names none
 * @returns the question and its validated query, or every reason it was refused
 */
export function parseStoreQuestionArgs({
  rest,
  spec,
  defaultLimit,
}: {
  rest: readonly string[];
  spec: FlagSpec;
  defaultLimit: number;
}): Result<StoreQuestionArgs, StoreCommandError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const question = parsed.value.positionals.join(" ").trim();
  if (question.length === 0) {
    return err(StoreCommandErrors.questionMissing());
  }
  const validated = parseStoreQuery({
    input: storeQueryInput({
      filters: STORE_QUESTION_FILTERS,
      limit: defaultLimit,
      question,
      values: parsed.value.values,
    }),
  });
  if ("errors" in validated) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: validated.errors }));
  }
  // The same two coherence checks `store query` applies: a query naming two sources' columns, or one
  // contradicting `--source`, can only ever return nothing, and an empty answer reads as a fact; and a
  // query naming two text predicates has not decided which question it is asking of the same column.
  const conflict = textPredicateConflict({ query: validated.query });
  if (conflict.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: conflict }));
  }
  const anchored = threadAnchorConflict({ query: validated.query });
  if (anchored.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: anchored }));
  }
  const coherent = sourceForQuery({ query: validated.query });
  if ("errors" in coherent) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: coherent.errors }));
  }
  return ok({ query: validated.query, question, values: parsed.value.values });
}
