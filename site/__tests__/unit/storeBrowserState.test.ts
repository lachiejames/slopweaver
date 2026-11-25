/*
 * Where the Store page stands and how it moves: a header click sorts ascending then reverses, every change to what is
 * listed returns to page 1 and closes the open row, a typed value rides only on equals and contains and is never
 * blank, and an answer filed under an older state's key is dropped. Synthetic `acme` tokens only.
 */
import { describe, expect, it } from "vitest";
import { utf8Hex } from "../../lib/slots";
import {
  applyStoreFilter,
  clearStoreFilter,
  clickStoreHeader,
  closeStoreRow,
  goToStorePage,
  isCurrentStoreAnswer,
  openStoreRow,
  STORE_BROWSER_START,
  type StoreBrowserState,
  type StoreFilterState,
  selectStoreTable,
  setStoreView,
  storeFilterFromDraft,
  storeRowsKey,
  storeRowsRequest,
} from "../../lib/storeBrowserState";
import { storeReadVerbFor } from "../../lib/storeReadVerbs";

const ORDERS = utf8Hex({ text: "acme_orders" });
const NOTES = utf8Hex({ text: "acme_notes" });
const NAME = utf8Hex({ text: "customer_name" });
const TOTAL = utf8Hex({ text: "total" });

/** On the orders table, page 4, sorted, filtered, a row open — every field away from where a change resets it. */
const DEEP: StoreBrowserState = {
  filter: { column: NAME, operator: "not-null" },
  openRow: "7b7d",
  page: 4,
  sort: { column: TOTAL, direction: "desc" },
  table: ORDERS,
  view: "data",
};

describe("selectStoreTable", () => {
  it("opens a table on its first page, unsorted, unfiltered, no row open, keeping the view", () => {
    expect(selectStoreTable({ state: { ...DEEP, view: "definition" }, table: NOTES })).toEqual({
      filter: null,
      openRow: null,
      page: 1,
      sort: null,
      table: NOTES,
      view: "definition",
    });
  });
});

describe("clickStoreHeader", () => {
  it("sorts a new column ascending, then reverses it, then ascending again", () => {
    const first = clickStoreHeader({ column: NAME, state: { ...STORE_BROWSER_START, table: ORDERS } });
    expect(first.sort).toEqual({ column: NAME, direction: "asc" });
    const second = clickStoreHeader({ column: NAME, state: first });
    expect(second.sort).toEqual({ column: NAME, direction: "desc" });
    expect(clickStoreHeader({ column: NAME, state: second }).sort).toEqual({ column: NAME, direction: "asc" });
  });

  it("sorts another column ascending whatever the current one's direction, back on page 1 with the row closed", () => {
    expect(clickStoreHeader({ column: NAME, state: DEEP })).toEqual({
      ...DEEP,
      openRow: null,
      page: 1,
      sort: { column: NAME, direction: "asc" },
    });
  });
});

describe("filters", () => {
  it("applying one replaces the last and returns to page 1 with the row closed", () => {
    const filter = { column: NAME, operator: "is-null" } as const;
    expect(applyStoreFilter({ filter, state: DEEP })).toEqual({ ...DEEP, filter, openRow: null, page: 1 });
  });

  it("Clear removes it, the separate act, back on page 1", () => {
    expect(clearStoreFilter({ state: DEEP })).toEqual({ ...DEEP, filter: null, openRow: null, page: 1 });
  });

  it("every filter the page can hold builds to an argv the route accepts, a value flag only on equals and contains", () => {
    const filters: readonly StoreFilterState[] = [
      { column: NAME, operator: "eq", value: "acme" },
      { column: NAME, operator: "contains", value: "acme" },
      { column: NAME, operator: "is-null" },
      { column: NAME, operator: "not-null" },
    ];
    const built = filters.map((filter) =>
      storeReadVerbFor({ slug: "rows" })!.build({
        request: storeRowsRequest({ state: applyStoreFilter({ filter, state: DEEP }) })!,
      }),
    );
    expect(built.map((one) => one.kind)).toEqual(["argv", "argv", "argv", "argv"]);
    expect(built.map((one) => JSON.stringify(one).includes("--filter-value-hex"))).toEqual([true, true, false, false]);
  });

  it("selecting another table drops a value-bearing filter with everything else", () => {
    const filtered = applyStoreFilter({ filter: { column: NAME, operator: "contains", value: "acme" }, state: DEEP });
    expect(selectStoreTable({ state: filtered, table: NOTES }).filter).toBeNull();
  });
});

describe("storeFilterFromDraft", () => {
  const columnTokens = [NAME, TOTAL];

  it("builds equals and contains with the value exactly as typed, surrounding spaces kept", () => {
    expect(
      (["eq", "contains"] as const).map((operator) =>
        storeFilterFromDraft({ column: NAME, columnTokens, operator, value: " acme " })._unsafeUnwrap(),
      ),
    ).toEqual([
      { column: NAME, operator: "eq", value: " acme " },
      { column: NAME, operator: "contains", value: " acme " },
    ]);
  });

  it("builds is null and is not null with no value, whatever the box still holds", () => {
    expect(
      (["is-null", "not-null"] as const).map((operator) =>
        storeFilterFromDraft({ column: TOTAL, columnTokens, operator, value: "left over" })._unsafeUnwrap(),
      ),
    ).toEqual([
      { column: TOTAL, operator: "is-null" },
      { column: TOTAL, operator: "not-null" },
    ]);
  });

  it("refuses an empty or blank value with a sentence rather than reading it as no filter", () => {
    expect(
      ["", "   "].map((value) =>
        storeFilterFromDraft({ column: NAME, columnTokens, operator: "eq", value })._unsafeUnwrapErr(),
      ),
    ).toEqual([
      "type a value to filter on; to stop filtering, use Clear",
      "type a value to filter on; to stop filtering, use Clear",
    ]);
  });

  it("refuses a column the table does not have, and a value the route would refuse", () => {
    expect(storeFilterFromDraft({ column: "", columnTokens, operator: "is-null", value: "" })._unsafeUnwrapErr()).toBe(
      "pick a column to filter on",
    );
    expect(
      storeFilterFromDraft({
        column: NAME,
        columnTokens,
        operator: "contains",
        value: "a".repeat(2001),
      })._unsafeUnwrapErr(),
    ).toBe("the value is 2001 characters; the console carries up to 2000");
  });
});

describe("pages, views and the row panel", () => {
  it("goes to a page with the row closed, holding a page below one at one", () => {
    expect(goToStorePage({ page: 5, state: DEEP })).toEqual({ ...DEEP, openRow: null, page: 5 });
    expect(goToStorePage({ page: 0, state: DEEP }).page).toBe(1);
    expect(goToStorePage({ page: Number.NaN, state: DEEP }).page).toBe(1);
  });

  it("switching view keeps the page, sort and filter, and closes the row", () => {
    expect(setStoreView({ state: DEEP, view: "definition" })).toEqual({ ...DEEP, openRow: null, view: "definition" });
  });

  it("opens and closes a row without moving anything else", () => {
    const closed = closeStoreRow({ state: DEEP });
    expect(closed).toEqual({ ...DEEP, openRow: null });
    expect(openStoreRow({ locator: "7b2031207d", state: closed })).toEqual({ ...DEEP, openRow: "7b2031207d" });
  });
});

describe("storeRowsRequest", () => {
  it("asks for nothing while no table is chosen", () => {
    expect(storeRowsRequest({ state: STORE_BROWSER_START })).toBeNull();
    expect(storeRowsKey({ state: STORE_BROWSER_START })).toBeNull();
  });

  it("carries exactly the fields the rows read takes, and builds to the verb's argv", () => {
    const request = storeRowsRequest({ state: DEEP })!;
    expect(request).toEqual({
      direction: "desc",
      filterColumn: NAME,
      filterOp: "not-null",
      page: 4,
      pageSize: 50,
      sortColumn: TOTAL,
      table: ORDERS,
    });
    expect(storeReadVerbFor({ slug: "rows" })!.build({ request })).toEqual({
      argv: [
        "store",
        "rows",
        "--table-hex",
        ORDERS,
        "--sort-hex",
        TOTAL,
        "--direction",
        "desc",
        "--filter-column-hex",
        NAME,
        "--filter-op",
        "not-null",
        "--page",
        "4",
        "--page-size",
        "50",
        "--json",
      ],
      kind: "argv",
    });
  });

  it("sends no value for an is-null filter", () => {
    const state = applyStoreFilter({ filter: { column: NAME, operator: "is-null" }, state: DEEP });
    expect(storeRowsRequest({ state })).toEqual({
      direction: "desc",
      filterColumn: NAME,
      filterOp: "is-null",
      page: 1,
      pageSize: 50,
      sortColumn: TOTAL,
      table: ORDERS,
    });
  });
});

describe("stale answers", () => {
  it("files an answer under the state that asked; any change to what is listed makes it stale", () => {
    const asked = storeRowsKey({ state: DEEP })!;
    expect(isCurrentStoreAnswer({ answeredKey: asked, state: DEEP })).toBe(true);
    const moved = [
      selectStoreTable({ state: DEEP, table: NOTES }),
      clickStoreHeader({ column: NAME, state: DEEP }),
      clearStoreFilter({ state: DEEP }),
      goToStorePage({ page: 5, state: DEEP }),
    ];
    expect(moved.map((state) => isCurrentStoreAnswer({ answeredKey: asked, state }))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("makes an answer stale when only the typed value or only the operator changed", () => {
    const filtered = applyStoreFilter({ filter: { column: NAME, operator: "eq", value: "acme" }, state: DEEP });
    const asked = storeRowsKey({ state: filtered })!;
    const moved = [
      applyStoreFilter({ filter: { column: NAME, operator: "eq", value: "acme2" }, state: filtered }),
      applyStoreFilter({ filter: { column: NAME, operator: "contains", value: "acme" }, state: filtered }),
    ];
    expect(moved.map((state) => isCurrentStoreAnswer({ answeredKey: asked, state }))).toEqual([false, false]);
  });

  it("keeps an answer current across a view switch or a row opening, which list the same rows", () => {
    const asked = storeRowsKey({ state: DEEP })!;
    expect(isCurrentStoreAnswer({ answeredKey: asked, state: setStoreView({ state: DEEP, view: "definition" }) })).toBe(
      true,
    );
    expect(isCurrentStoreAnswer({ answeredKey: asked, state: closeStoreRow({ state: DEEP }) })).toBe(true);
  });
});
