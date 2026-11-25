/**
 * The closed list of store reads the console's Store page may run — a list beside `liveVerbs.ts`, `syncVerbs.ts`,
 * `actVerbs.ts` and `talkTools.ts`, and the one whose argv carries values the page chose.
 *
 * `liveVerbs.ts` holds that no request value ever reaches an argv, and that invariant stays true there. Browsing a
 * table cannot keep it: which table, which column sorts, which column filters are the page's choice. So the
 * parameterised reads live HERE, narrowly: three slugs (`tables`, `rows`, `row`), each a literal `store <verb> …
 * --json` argv in which a request may fill only the DATA flags this file declares. No request value is ever a noun, a
 * verb, a flag name or a path, and every value travels in a spelling no parser can read as a flag:
 *
 * - a table or column is the catalog's own TOKEN (lowercase hex of the name's UTF-8, printed by `store tables` and
 *   `store rows`), passed through after a shape check — the verb decodes it and looks the name up in the live
 *   catalog before quoting anything into SQL (`src/store/browse/types.ts`);
 * - a filter is `eq`, `contains`, `is-null` or `not-null`; the first two carry the one typed value this list takes,
 *   `filterValue`, which travels raw in the POST body and is checked here ({@link storeFilterValueWhy}) and written
 *   into the argv only as its UTF-8 hex after the literal `--filter-value-hex`, so it can never read as a flag. Hex
 *   is an argv spelling, not a secret: another process of the same user can still read it off the process table;
 * - a row locator is the opaque hex a rows document printed, passed through after a shape check;
 * - a page and a page size are digits.
 *
 * Nothing here writes, and nothing here launches a model (rule 2). The store's credential never reaches the page: the
 * verb reads it from `$SLOPWEAVER_HOME` itself.
 */
import { isBag } from "./bag";
import { type BuiltArgv, refuseSlot, TEXT_MAX, utf8Hex } from "./slots";
import type { SpawnOutcome } from "./spawnVerb";

/** A request body the route parsed: a JSON object, its fields not yet checked. */
export type StoreReadRequest = Readonly<Record<string, unknown>>;

/** One read the Store page may run. */
export interface StoreReadVerb {
  /** The name the route takes as `/api/store/<slug>`. */
  readonly slug: "tables" | "rows" | "row";
  /** The verb line as a reader would type it — never a value, since a failure prints it. */
  readonly title: string;
  /** How long the child may run before it is killed; the verb's own statement timeout sits well inside it. */
  readonly timeoutMs: number;
  /** The fields a request may carry; any other is refused. */
  readonly fields: readonly string[];
  /** The argv after `slopweaver`, from a request whose fields are exactly this row's, or the one refusal. */
  readonly build: (args: { request: StoreReadRequest }) => BuiltArgv;
}

/**
 * Fifteen seconds for every store read: the verb bounds its own statements well inside that, so a kill here is the
 * outer fail-safe for a connection that never answered, never the ordinary way a slow read ends.
 */
export const STORE_READ_TIMEOUT_MS = 15_000;

/** The default page size, as `store rows` takes it when no `--page-size` is passed. */
export const STORE_PAGE_SIZE = 50;

/** The largest page `store rows` serves. */
export const STORE_PAGE_SIZE_MAX = 100;

/** The highest page number the console asks for; far past any table this machine holds. */
const PAGE_MAX = 1_000_000_000;

/** A catalog token: lowercase hex, whole bytes, non-empty, up to 256 bytes of name. */
const TOKEN_SHAPE = /^(?:[0-9a-f]{2}){1,256}$/;

/** A row locator: lowercase hex, whole bytes, non-empty. */
const LOCATOR_SHAPE = /^(?:[0-9a-f]{2})+$/;

/** The longest locator the page passes back: 8 KiB of hex. */
export const LOCATOR_MAX = 8 * 1024;

/** The filter operators that carry a typed value. */
const VALUE_OPERATORS = ["eq", "contains"] as const;

/** The filter operators that carry none. */
const NULL_OPERATORS = ["is-null", "not-null"] as const;

/** The longest filter value the console carries; `store rows` itself has no cap. */
export const STORE_FILTER_VALUE_MAX = TEXT_MAX;

/** The sort directions `store rows` takes. */
const DIRECTIONS = ["asc", "desc"] as const;

/** The fields each read takes. */
const TABLES_FIELDS: readonly string[] = [];
const ROWS_FIELDS: readonly string[] = [
  "table",
  "page",
  "pageSize",
  "sortColumn",
  "direction",
  "filterColumn",
  "filterOp",
  "filterValue",
];
const ROW_FIELDS: readonly string[] = ["locator"];

/**
 * Is this a catalog token as `store tables` prints one?
 *
 * @returns true for lowercase hex of whole bytes, up to 512 characters
 */
export function isStoreToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/**
 * The sentence a field that is not a catalog token is refused with.
 *
 * @returns the refusal
 */
function notTokenWhy({ field }: { field: string }): string {
  return `${field} is not a catalog token: lowercase hex as \`store tables\` prints one, up to 512 characters`;
}

/**
 * A whole number within a range, as a request field must carry a page or a page size.
 *
 * @returns the number, or `undefined` when the field is anything else
 */
function wholeIn({ value, min, max }: { value: unknown; min: number; max: number }): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

/**
 * Refuse any field a row did not declare, so a client that thinks it can pass something the door does not take is
 * told so rather than ignored.
 *
 * @returns the refusal, or `undefined` when every field is declared
 */
function strayFieldWhy({
  request,
  fields,
  verb,
}: {
  request: StoreReadRequest;
  fields: readonly string[];
  verb: string;
}): string | undefined {
  const stray = Object.keys(request).find((key) => !fields.includes(key));
  if (stray !== undefined) {
    return `store ${verb} takes no field named ${stray}`;
  }
  return undefined;
}

/**
 * `store tables --json`: no field at all.
 *
 * @returns the argv, or the refusal of a field it does not take
 */
function buildTables({ request }: { request: StoreReadRequest }): BuiltArgv {
  const stray = strayFieldWhy({ fields: TABLES_FIELDS, request, verb: "tables" });
  if (stray !== undefined) {
    return { kind: "refused", why: stray };
  }
  return { argv: ["store", "tables", "--json"], kind: "argv" };
}

/**
 * The sort flags of a rows request: both fields or neither.
 *
 * @returns the flags, or the refusal
 */
function sortFlags({ request }: { request: StoreReadRequest }): BuiltArgv {
  const column = request["sortColumn"];
  const direction = request["direction"];
  if (column === undefined && direction === undefined) {
    return { argv: [], kind: "argv" };
  }
  if (column === undefined || direction === undefined) {
    return { kind: "refused", why: "a sort names both sortColumn and direction, or neither" };
  }
  if (!isStoreToken(column)) {
    return { kind: "refused", why: notTokenWhy({ field: "sortColumn" }) };
  }
  const known = DIRECTIONS.find((one) => one === direction);
  if (known === undefined) {
    return { kind: "refused", why: "direction is asc or desc" };
  }
  return { argv: ["--sort-hex", column, "--direction", known], kind: "argv" };
}

/**
 * Why a typed filter value cannot be carried, or `undefined` when it can: it must be text with something in it
 * besides whitespace, at most {@link STORE_FILTER_VALUE_MAX} characters, whole characters only (a lone surrogate has
 * no UTF-8 spelling) and no control character but tab and newline. A value that passes is carried exactly, its
 * surrounding spaces kept. The page's draft check and the route's builder both ask this, so the two cannot disagree.
 *
 * @param value the value as the request carried it, not yet known to be text
 * @returns the refusal sentence, or `undefined`
 */
export function storeFilterValueWhy({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return "the value is not text";
  }
  if (value.trim().length === 0) {
    return "type a value to filter on; to stop filtering, use Clear";
  }
  return refuseSlot({ slot: { shape: "hexText", slot: "the value" }, value });
}

/**
 * The filter flags of a rows request: none; a column and `is-null` or `not-null`, with no value; or a column, `eq` or
 * `contains`, and the value as UTF-8 hex. A value on an operator that takes none is refused, never dropped.
 *
 * @returns the flags, or the refusal
 */
function filterFlags({ request }: { request: StoreReadRequest }): BuiltArgv {
  const column = request["filterColumn"];
  const operator = request["filterOp"];
  const value = request["filterValue"];
  if (column === undefined && operator === undefined && value === undefined) {
    return { argv: [], kind: "argv" };
  }
  if (column === undefined || operator === undefined) {
    return { kind: "refused", why: "a filter names both filterColumn and filterOp" };
  }
  if (!isStoreToken(column)) {
    return { kind: "refused", why: notTokenWhy({ field: "filterColumn" }) };
  }
  const nullOperator = NULL_OPERATORS.find((one) => one === operator);
  if (nullOperator !== undefined) {
    if (value !== undefined) {
      return { kind: "refused", why: `filterOp ${nullOperator} takes no filterValue` };
    }
    return { argv: ["--filter-column-hex", column, "--filter-op", nullOperator], kind: "argv" };
  }
  const valueOperator = VALUE_OPERATORS.find((one) => one === operator);
  if (valueOperator === undefined) {
    return { kind: "refused", why: "filterOp is eq, contains, is-null or not-null" };
  }
  const why = storeFilterValueWhy({ value });
  if (why !== undefined || typeof value !== "string") {
    return { kind: "refused", why: `filterOp ${valueOperator} needs a filterValue: ${String(why)}` };
  }
  return {
    argv: ["--filter-column-hex", column, "--filter-op", valueOperator, "--filter-value-hex", utf8Hex({ text: value })],
    kind: "argv",
  };
}

/**
 * `store rows --table-hex <token> [sort] [filter] --page <n> [--page-size <n>] --json`.
 *
 * @returns the argv, or the first refusal
 */
function buildRows({ request }: { request: StoreReadRequest }): BuiltArgv {
  const stray = strayFieldWhy({ fields: ROWS_FIELDS, request, verb: "rows" });
  if (stray !== undefined) {
    return { kind: "refused", why: stray };
  }
  const table = request["table"];
  if (!isStoreToken(table)) {
    return { kind: "refused", why: notTokenWhy({ field: "table" }) };
  }
  const page = wholeIn({ max: PAGE_MAX, min: 1, value: request["page"] });
  if (page === undefined) {
    return { kind: "refused", why: `page is not a whole number from 1 to ${String(PAGE_MAX)}` };
  }
  const sizeFlags: string[] = [];
  if (request["pageSize"] !== undefined) {
    const size = wholeIn({ max: STORE_PAGE_SIZE_MAX, min: 1, value: request["pageSize"] });
    if (size === undefined) {
      return { kind: "refused", why: `pageSize is not a whole number from 1 to ${String(STORE_PAGE_SIZE_MAX)}` };
    }
    sizeFlags.push("--page-size", String(size));
  }
  const sort = sortFlags({ request });
  if (sort.kind === "refused") {
    return sort;
  }
  const filter = filterFlags({ request });
  if (filter.kind === "refused") {
    return filter;
  }
  return {
    argv: [
      "store",
      "rows",
      "--table-hex",
      table,
      ...sort.argv,
      ...filter.argv,
      "--page",
      String(page),
      ...sizeFlags,
      "--json",
    ],
    kind: "argv",
  };
}

/**
 * `store row --locator-hex <locator> --json`.
 *
 * @returns the argv, or the refusal
 */
function buildRow({ request }: { request: StoreReadRequest }): BuiltArgv {
  const stray = strayFieldWhy({ fields: ROW_FIELDS, request, verb: "row" });
  if (stray !== undefined) {
    return { kind: "refused", why: stray };
  }
  const locator = request["locator"];
  if (typeof locator !== "string" || locator.length > LOCATOR_MAX || !LOCATOR_SHAPE.test(locator)) {
    return {
      kind: "refused",
      why: `locator is not a row locator: lowercase hex as \`store rows\` prints one, up to ${String(LOCATOR_MAX)} characters`,
    };
  }
  return { argv: ["store", "row", "--locator-hex", locator, "--json"], kind: "argv" };
}

/** Every read the Store page may run. */
export const STORE_READ_VERBS: readonly StoreReadVerb[] = [
  {
    build: buildTables,
    fields: TABLES_FIELDS,
    slug: "tables",
    timeoutMs: STORE_READ_TIMEOUT_MS,
    title: "slopweaver store tables",
  },
  {
    build: buildRows,
    fields: ROWS_FIELDS,
    slug: "rows",
    timeoutMs: STORE_READ_TIMEOUT_MS,
    title: "slopweaver store rows",
  },
  {
    build: buildRow,
    fields: ROW_FIELDS,
    slug: "row",
    timeoutMs: STORE_READ_TIMEOUT_MS,
    title: "slopweaver store row",
  },
];

/**
 * The read a slug names, or `undefined` for one the list does not hold.
 *
 * @returns the row, or `undefined`
 */
export function storeReadVerbFor({ slug }: { slug: string }): StoreReadVerb | undefined {
  return STORE_READ_VERBS.find((row) => row.slug === slug);
}

/**
 * What the Store route answers: the verb's one JSON document, still undecoded, or the reason there is none — the
 * verb's own sentence when it refused in JSON, else how the run ended. `code` is the verb's error code when it named
 * one, `null` when the refusal is the console's or the run's.
 */
export type StoreReadResponse =
  | { readonly outcome: "read"; readonly document: unknown; readonly tookMs: number }
  | { readonly outcome: "refused"; readonly code: string | null; readonly why: string };

/**
 * The verb's refusal document, `{"error":{"code":…,"message":…}}`, read off its stdout.
 *
 * @param out what the child printed
 * @returns the code and message, or `undefined` when stdout is not that document
 */
export function storeErrorOf({
  out,
}: {
  out: string;
}): { readonly code: string; readonly message: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return undefined;
  }
  if (!isBag(parsed)) {
    return undefined;
  }
  const error = parsed["error"];
  if (!isBag(error)) {
    return undefined;
  }
  const code = error["code"];
  const message = error["message"];
  if (typeof code !== "string" || typeof message !== "string" || message.trim() === "") {
    return undefined;
  }
  return { code, message };
}

/**
 * What one finished child run comes to for the page: its stdout parsed as ONE JSON document on exit 0, or a refusal
 * naming why there is none. A non-zero exit whose stdout is the verb's error document surfaces that document's own
 * sentence; any other failure surfaces how the run ended. Never a partial page: stdout is parsed only on exit 0.
 *
 * @param ran the child's outcome, as `spawnVerb` settled it
 * @param title the verb line, which names a run whose stdout was not JSON
 * @returns the route's answer
 */
export function storeReadOutcomeOf({ ran, title }: { ran: SpawnOutcome; title: string }): StoreReadResponse {
  if (!ran.ok) {
    const stated = storeErrorOf({ out: ran.out });
    if (stated !== undefined) {
      return { code: stated.code, outcome: "refused", why: stated.message };
    }
    return { code: null, outcome: "refused", why: ran.notMeasured };
  }
  let document: unknown;
  try {
    document = JSON.parse(ran.out);
  } catch {
    return { code: null, outcome: "refused", why: `${title} exited 0 but did not print one JSON document` };
  }
  return { document, outcome: "read", tookMs: ran.tookMs };
}
