/**
 * Where the Store page stands — which table, which view, the sort, the filter, the page and the open row — and every
 * way it moves. Pure: the page (`../components/console/StoreBrowser.tsx`) holds one of these and draws it.
 *
 * Two rules every transition keeps, because a page that broke either would draw rows the reader did not ask for:
 *
 * - **Any change to what is listed starts again at page 1 and closes the open row.** A new table, sort or filter
 *   makes the old page number mean a different slice, and a row panel left open over a list it is no longer in reads
 *   as part of it.
 * - **A response answers only the request that asked for it.** Every rows read is keyed by the whole state that
 *   launched it ({@link storeRowsKey}); an answer arriving after the state moved carries an older key and is dropped,
 *   whether or not its fetch was aborted.
 *
 * Tables and columns are held by TOKEN, the opaque spelling the documents print, since that is what a request
 * carries; a name is only ever drawn.
 */
import { err, ok, type Result } from "neverthrow";

import type { StoreFilterOperator } from "./storeDocuments";
import { STORE_PAGE_SIZE, storeFilterValueWhy } from "./storeReadVerbs";

/** The two views of a table: its rows, or its columns' definitions. */
export type StoreView = "data" | "definition";

/**
 * A filter the page applies: one column, and either equals or contains a typed value (contains is the verb's own
 * case-insensitive match), or empty or not, with no value at all.
 */
export type StoreFilterState =
  | { readonly column: string; readonly operator: "eq" | "contains"; readonly value: string }
  | { readonly column: string; readonly operator: "is-null" | "not-null" };

/** Where the page stands. */
export interface StoreBrowserState {
  /** The table shown, by token; `null` until the tables document has read. */
  readonly table: string | null;
  readonly view: StoreView;
  /** The sort the owner chose, by column token; `null` for the verb's own order (the primary key). */
  readonly sort: { readonly column: string; readonly direction: "asc" | "desc" } | null;
  readonly filter: StoreFilterState | null;
  /** The page shown, 1-based. */
  readonly page: number;
  /** The open row's locator, or `null` when no row panel is open. */
  readonly openRow: string | null;
}

/** The page before anything has read: no table, the data view, page 1. */
export const STORE_BROWSER_START: StoreBrowserState = {
  filter: null,
  openRow: null,
  page: 1,
  sort: null,
  table: null,
  view: "data",
};

/**
 * Show a table: its own first page, unsorted, unfiltered, no row open. The view the reader was on is kept.
 *
 * @param table the table's token
 * @returns the state on that table
 */
export function selectStoreTable({ state, table }: { state: StoreBrowserState; table: string }): StoreBrowserState {
  return { ...state, filter: null, openRow: null, page: 1, sort: null, table };
}

/**
 * A header click: a column not sorted on sorts ascending, the sorted column reverses. Either way, page 1.
 *
 * @param column the clicked column's token
 * @returns the state sorted
 */
export function clickStoreHeader({ state, column }: { state: StoreBrowserState; column: string }): StoreBrowserState {
  let direction: "asc" | "desc" = "asc";
  if (state.sort?.column === column && state.sort.direction === "asc") {
    direction = "desc";
  }
  return { ...state, openRow: null, page: 1, sort: { column, direction } };
}

/**
 * The filter the bar's draft asks for, or the sentence saying why it cannot be applied. A column the table does not
 * have is refused; `is-null` and `not-null` drop whatever text the value box still holds; `eq` and `contains` need a
 * value the route will carry (the same check the route makes), kept exactly as typed, surrounding spaces included.
 * An empty value is refused, never read as "no filter": Clear is the way to stop filtering.
 *
 * @param column the chosen column's token
 * @param value the value box's text, whatever the operator
 * @param columnTokens every column token the shown table has
 * @returns the filter, or the refusal sentence
 */
export function storeFilterFromDraft({
  column,
  operator,
  value,
  columnTokens,
}: {
  column: string;
  operator: StoreFilterOperator;
  value: string;
  columnTokens: readonly string[];
}): Result<StoreFilterState, string> {
  if (!columnTokens.includes(column)) {
    return err("pick a column to filter on");
  }
  if (operator === "is-null" || operator === "not-null") {
    return ok({ column, operator });
  }
  const why = storeFilterValueWhy({ value });
  if (why !== undefined) {
    return err(why);
  }
  return ok({ column, operator, value });
}

/**
 * Apply a filter, which replaces any filter already applied. Page 1.
 *
 * @param filter the column, the operator and, for equals and contains, the value
 * @returns the state filtered
 */
export function applyStoreFilter({
  state,
  filter,
}: {
  state: StoreBrowserState;
  filter: StoreFilterState;
}): StoreBrowserState {
  return { ...state, filter, openRow: null, page: 1 };
}

/**
 * Stop filtering, the separate Clear. Page 1.
 *
 * @returns the state unfiltered
 */
export function clearStoreFilter({ state }: { state: StoreBrowserState }): StoreBrowserState {
  return { ...state, filter: null, openRow: null, page: 1 };
}

/**
 * Go to a page. A page below 1 is page 1; whether a later page exists is the verb's to say (`hasNext`), so the page
 * offers Next only when it does.
 *
 * @param page the page number to show, counted from one
 * @returns the state on that page, its row panel closed
 */
export function goToStorePage({ state, page }: { state: StoreBrowserState; page: number }): StoreBrowserState {
  let target = Math.floor(page);
  if (!Number.isFinite(target) || target < 1) {
    target = 1;
  }
  return { ...state, openRow: null, page: target };
}

/**
 * Switch between the rows and the definition. What is listed does not change, so the page and sort are kept.
 *
 * @returns the state on that view
 */
export function setStoreView({ state, view }: { state: StoreBrowserState; view: StoreView }): StoreBrowserState {
  return { ...state, openRow: null, view };
}

/**
 * Open a row's panel.
 *
 * @param locator the row's locator, as the rows document printed it
 * @returns the state with that row open
 */
export function openStoreRow({ state, locator }: { state: StoreBrowserState; locator: string }): StoreBrowserState {
  return { ...state, openRow: locator };
}

/**
 * Close the row panel.
 *
 * @returns the state with no row open
 */
export function closeStoreRow({ state }: { state: StoreBrowserState }): StoreBrowserState {
  return { ...state, openRow: null };
}

/**
 * The body of the rows read this state asks for — exactly the fields `store rows` takes on the route — or `null`
 * while no table is chosen.
 *
 * @returns the request body, or `null`
 */
export function storeRowsRequest({ state }: { state: StoreBrowserState }): Readonly<Record<string, unknown>> | null {
  if (state.table === null) {
    return null;
  }
  const body: Record<string, unknown> = { page: state.page, pageSize: STORE_PAGE_SIZE, table: state.table };
  if (state.sort !== null) {
    body["sortColumn"] = state.sort.column;
    body["direction"] = state.sort.direction;
  }
  if (state.filter !== null) {
    body["filterColumn"] = state.filter.column;
    body["filterOp"] = state.filter.operator;
    if (state.filter.operator === "eq" || state.filter.operator === "contains") {
      body["filterValue"] = state.filter.value;
    }
  }
  return body;
}

/**
 * The key a rows read is filed under: everything that decides which rows it answers with, and nothing else (the
 * view and the open row do not change the rows). Two states listing the same rows share a key; any change to the
 * table, sort, filter or page gives a new one.
 *
 * @returns the key, or `null` while no table is chosen
 */
export function storeRowsKey({ state }: { state: StoreBrowserState }): string | null {
  const request = storeRowsRequest({ state });
  if (request === null) {
    return null;
  }
  return JSON.stringify(request);
}

/**
 * Whether an answer still answers the page: its key is the one the current state asks under.
 *
 * @param answeredKey the key the answering request was launched under
 * @returns true when the answer may be drawn
 */
export function isCurrentStoreAnswer({
  state,
  answeredKey,
}: {
  state: StoreBrowserState;
  answeredKey: string;
}): boolean {
  return storeRowsKey({ state }) === answeredKey;
}
