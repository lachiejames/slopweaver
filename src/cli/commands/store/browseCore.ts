/**
 * The pure argument parsing of `store tables`, `store rows` and `store row`: flags in, a typed request or the
 * reasons it is not one out. Nothing here opens the store; the token decoding is the shape check only, and the names
 * it yields are confirmed against the live catalog by `src/store/browse/read.ts`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { nameOfToken } from "../../../store/browse/catalog.js";
import { MAX_LOCATOR_HEX } from "../../../store/browse/locator.js";
import { MAX_PAGE_SIZE } from "../../../store/browse/sql.js";
import type { StoreRowsFilterRequest, StoreRowsRequest, StoreSortDirection } from "../../../store/browse/types.js";
import { parseFlags } from "../../parseFlags.js";
import { STORE_ROW_FLAG_SPEC, STORE_ROWS_FLAG_SPEC, STORE_TABLES_FLAG_SPEC } from "./browseUsage.js";
import { type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** The page size a request that names none gets. */
const DEFAULT_PAGE_SIZE = 50;

/** What every browsing verb shares: the home it reads, and whether it prints JSON. */
interface BrowseArgsBase {
  readonly home?: string;
  readonly json: boolean;
}

/** `store tables`'s parsed arguments. */
export type StoreTablesArgs = BrowseArgsBase;

/** `store rows`'s parsed arguments. */
export interface StoreRowsArgs extends BrowseArgsBase {
  readonly request: StoreRowsRequest;
}

/** `store row`'s parsed arguments. */
export interface StoreRowArgs extends BrowseArgsBase {
  readonly locatorHex: string;
}

/** The flag values `parseFlags` returned. */
type FlagValues = Readonly<Record<string, string | boolean>>;

/** The home and JSON switch every browsing verb reads the same way. */
function baseOf({ values }: { values: FlagValues }): BrowseArgsBase {
  const home = values["home"];
  return { json: values["json"] === true, ...(typeof home === "string" ? { home } : {}) };
}

/** A value flag's string, or `undefined` when it was not given. */
function stringFlag({ values, name }: { values: FlagValues; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** A name a `-hex` flag carries, or the reason it is not one. */
function nameFlag({
  values,
  name,
  reasons,
}: {
  values: FlagValues;
  name: string;
  reasons: string[];
}): string | undefined {
  const token = stringFlag({ name, values });
  if (token === undefined) {
    return undefined;
  }
  const decoded = nameOfToken({ token });
  if (decoded.isErr()) {
    reasons.push(`--${name} is ${decoded.error}`);
    return undefined;
  }
  return decoded.value;
}

/** A whole-number flag in `[1, max]`, its default when absent, or the reason it is neither. */
function boundedFlag({
  values,
  name,
  whenAbsent,
  max,
  reasons,
}: {
  values: FlagValues;
  name: string;
  whenAbsent: number;
  max: number;
  reasons: string[];
}): number {
  const raw = stringFlag({ name, values });
  if (raw === undefined) {
    return whenAbsent;
  }
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > max) {
    reasons.push(`--${name} takes a whole number from 1 to ${String(max)}, not "${raw}"`);
  }
  return value;
}

/**
 * Parse `store tables`'s flags.
 *
 * @param rest the verb's argv tail
 * @returns the arguments, or the flag error
 */
export function parseStoreTablesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreTablesArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: STORE_TABLES_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  return ok(baseOf({ values: parsed.value.values }));
}

/** The sort a `store rows` request carries, or `null`. */
function sortOf({ values, reasons }: { values: FlagValues; reasons: string[] }): StoreRowsRequest["sort"] {
  const column = nameFlag({ name: "sort-hex", reasons, values });
  const direction = stringFlag({ name: "direction", values });
  if (direction !== undefined && direction !== "asc" && direction !== "desc") {
    reasons.push(`--direction takes asc or desc, not "${direction}"`);
    return null;
  }
  if (column === undefined) {
    if (direction !== undefined) {
      reasons.push("--direction needs --sort-hex naming the column to sort by");
    }
    return null;
  }
  let sortDirection: StoreSortDirection = "asc";
  if (direction === "desc") {
    sortDirection = "desc";
  }
  return { column, direction: sortDirection };
}

/** The filter a `store rows` request carries, or `null`. */
function filterOf({ values, reasons }: { values: FlagValues; reasons: string[] }): StoreRowsFilterRequest | null {
  const column = nameFlag({ name: "filter-column-hex", reasons, values });
  const operator = stringFlag({ name: "filter-op", values });
  const valueHex = stringFlag({ name: "filter-value-hex", values });
  if (column === undefined && operator === undefined && valueHex === undefined) {
    return null;
  }
  if (column === undefined || operator === undefined) {
    reasons.push("a filter needs both --filter-column-hex and --filter-op");
    return null;
  }
  if (operator === "is-null" || operator === "not-null") {
    if (valueHex !== undefined) {
      reasons.push(`--filter-op ${operator} takes no --filter-value-hex`);
      return null;
    }
    return { column, operator };
  }
  if (operator !== "eq" && operator !== "contains") {
    reasons.push(`--filter-op takes eq, contains, is-null or not-null, not "${operator}"`);
    return null;
  }
  const value = nameFlag({ name: "filter-value-hex", reasons, values });
  if (value === undefined) {
    if (valueHex === undefined) {
      reasons.push(`--filter-op ${operator} needs --filter-value-hex`);
    }
    return null;
  }
  return { column, operator, value };
}

/**
 * Parse `store rows`'s flags into the page request.
 *
 * @param rest the verb's argv tail
 * @returns the arguments, or every reason they are not a request
 */
export function parseStoreRowsArgs({ rest }: { rest: readonly string[] }): Result<StoreRowsArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: STORE_ROWS_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const reasons: string[] = [];
  const table = nameFlag({ name: "table-hex", reasons, values });
  if (table === undefined && stringFlag({ name: "table-hex", values }) === undefined) {
    reasons.push("--table-hex names the table to read");
  }
  const sort = sortOf({ reasons, values });
  const filter = filterOf({ reasons, values });
  const page = boundedFlag({ whenAbsent: 1, max: Number.MAX_SAFE_INTEGER, name: "page", reasons, values });
  const pageSize = boundedFlag({
    whenAbsent: DEFAULT_PAGE_SIZE,
    max: MAX_PAGE_SIZE,
    name: "page-size",
    reasons,
    values,
  });
  if (reasons.length > 0 || table === undefined) {
    return err(StoreCommandErrors.argumentsRefused({ reasons }));
  }
  return ok({ ...baseOf({ values }), request: { filter, page, pageSize, sort, table } });
}

/**
 * Parse `store row`'s flags.
 *
 * @param rest the verb's argv tail
 * @returns the arguments, or why the locator flag is missing or not one
 */
export function parseStoreRowArgs({ rest }: { rest: readonly string[] }): Result<StoreRowArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: STORE_ROW_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const locatorHex = stringFlag({ name: "locator-hex", values });
  if (locatorHex === undefined) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: ["--locator-hex names the row to read"] }));
  }
  if (locatorHex.length > MAX_LOCATOR_HEX || !/^(?:[0-9a-f]{2})+$/.test(locatorHex)) {
    return err(
      StoreCommandErrors.argumentsRefused({
        reasons: [
          `--locator-hex takes the lowercase hex locator \`store rows\` printed, at most ${String(MAX_LOCATOR_HEX)} characters`,
        ],
      }),
    );
  }
  return ok({ ...baseOf({ values }), locatorHex });
}
