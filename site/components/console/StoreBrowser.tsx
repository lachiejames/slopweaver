"use client";

import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useRef, useState } from "react";

import { isBag } from "../../lib/bag";
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
  selectStoreTable,
  setStoreView,
  storeRowsKey,
} from "../../lib/storeBrowserState";
import {
  decodeStoreRow,
  decodeStoreRows,
  decodeStoreTables,
  type StoreRowsDocument,
  type StoreTablesDocument,
} from "../../lib/storeDocuments";
import { SpinnerBlock } from "../ui/spinner";
import { BUTTON, CHIP } from "./controls";
import { StoreDefinition } from "./StoreDefinition";
import { StoreFilter } from "./StoreFilter";
import { StoreRowPanel, type StoreRowReading } from "./StoreRowPanel";
import { type Reading, readingOf, readStore, StoreFailure, StoreRowsView } from "./StoreRowsView";
import { StoreTableList } from "./StoreTableList";

/**
 * The Store page: every table down the left with its estimated row count, the chosen one's rows in a grid — sorted by
 * a header click, filtered on one column, fifty to a page — or its definition, and any row opened whole in a panel.
 * Everything is read through `slopweaver store tables|rows|row` (`../../lib/storeReadVerbs.ts`), nothing is written,
 * and a read that fails shows its reason where its answer would be.
 *
 * Every rows read is filed under the state that asked for it (`storeRowsKey`); an answer that arrives after the
 * table, sort, filter or page moved is dropped, so a slow read can never draw over a newer one.
 *
 * Reload remounts the reading half on a new key, so every read runs again while the table, sort, filter, page and
 * open row held here survive it.
 *
 * @returns the browser
 */
export function StoreBrowser(): ReactElement {
  const [state, setState] = useState<StoreBrowserState>(STORE_BROWSER_START);
  const [reloads, setReloads] = useState(0);
  return (
    <StoreReads
      key={reloads}
      state={state}
      setState={setState}
      onReload={() => {
        setReloads((was) => was + 1);
      }}
    />
  );
}

/**
 * The reading half of the Store page: the three reads, each run once per mount and again whenever what it asks for
 * changes, and the page drawn from their answers.
 *
 * @returns the page
 */
function StoreReads({
  state,
  setState,
  onReload,
}: {
  state: StoreBrowserState;
  setState: Dispatch<SetStateAction<StoreBrowserState>>;
  onReload: () => void;
}): ReactElement {
  const [tables, setTables] = useState<Reading<StoreTablesDocument>>({ phase: "loading" });
  const [rows, setRows] = useState<{ readonly key: string; readonly reading: Reading<StoreRowsDocument> } | null>(null);
  const [row, setRow] = useState<{ readonly locator: string; readonly reading: StoreRowReading } | null>(null);
  // The state as of the last commit, which an answer arriving later is judged against.
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  });

  useEffect(() => {
    const control = new AbortController();
    const load = async (): Promise<void> => {
      const response = await readStore({ body: {}, signal: control.signal, slug: "tables" });
      if (control.signal.aborted) {
        return;
      }
      const reading = readingOf({ decode: decodeStoreTables, response });
      setTables(reading);
      if (reading.phase !== "ready") {
        return;
      }
      const first = reading.document.tables.at(0);
      if (first !== undefined) {
        setState((was) => (was.table === null ? selectStoreTable({ state: was, table: first.token }) : was));
      }
    };
    void load();
    return () => {
      control.abort();
    };
  }, [setState]);

  const key = storeRowsKey({ state });
  useEffect(() => {
    if (key === null) {
      return undefined;
    }
    // The key IS the request body, so the read and its filing can never disagree.
    const body: unknown = JSON.parse(key);
    if (!isBag(body)) {
      return undefined;
    }
    const control = new AbortController();
    const load = async (): Promise<void> => {
      const response = await readStore({ body, signal: control.signal, slug: "rows" });
      // An aborted read answers nothing, and an answer to a state the page has left is dropped whether or not its
      // fetch could be aborted.
      if (control.signal.aborted || !isCurrentStoreAnswer({ answeredKey: key, state: current.current })) {
        return;
      }
      setRows({ key, reading: readingOf({ decode: decodeStoreRows, response }) });
    };
    void load();
    return () => {
      control.abort();
    };
  }, [key]);

  const locator = state.openRow;
  useEffect(() => {
    if (locator === null) {
      return undefined;
    }
    const control = new AbortController();
    const load = async (): Promise<void> => {
      const response = await readStore({ body: { locator }, signal: control.signal, slug: "row" });
      if (control.signal.aborted || current.current.openRow !== locator) {
        return;
      }
      setRow({ locator, reading: readingOf({ decode: decodeStoreRow, response }) });
    };
    void load();
    return () => {
      control.abort();
    };
  }, [locator]);

  if (tables.phase === "loading") {
    return <SpinnerBlock label="the store's tables" />;
  }
  if (tables.phase === "failed") {
    return <StoreFailure verb="slopweaver store tables" why={tables.why} />;
  }
  const table = tables.document.tables.find((one) => one.token === state.table);
  let rowsReading: Reading<StoreRowsDocument> = { phase: "loading" };
  if (rows !== null && rows.key === key) {
    rowsReading = rows.reading;
  }
  let rowReading: StoreRowReading = { phase: "loading" };
  if (row !== null && row.locator === state.openRow) {
    rowReading = row.reading;
  }

  return (
    <div className="flex min-h-0 gap-4 max-[760px]:flex-col">
      <aside className="sticky top-2 max-h-[calc(100vh-6rem)] w-[15rem] flex-none self-start overflow-y-auto max-[760px]:static max-[760px]:max-h-none max-[760px]:w-full">
        <StoreTableList
          tables={tables.document.tables}
          selected={state.table}
          onSelect={(token) => {
            setState((was) => selectStoreTable({ state: was, table: token }));
          }}
        />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {table === undefined ? (
          <p className="m-0 text-[0.82rem] text-muted-foreground">The public schema holds no tables to show.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-mono text-[0.95rem] font-semibold">{table.name}</h2>
              <span className={CHIP} title="the store is read in a read-only transaction; nothing on this page writes">
                Read-only
              </span>
              <fieldset
                aria-label="view"
                className="m-0 ml-2 inline-flex overflow-hidden rounded-[8px] border border-solid border-border p-0"
              >
                {(["data", "definition"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={state.view === view}
                    onClick={() => {
                      setState((was) => setStoreView({ state: was, view }));
                    }}
                    className="cursor-pointer border-0 bg-(--c-panel) px-3 py-[0.3rem] text-[0.78rem] capitalize aria-pressed:bg-primary/16 aria-pressed:font-semibold"
                  >
                    {view}
                  </button>
                ))}
              </fieldset>
              <button type="button" className={`${BUTTON} ml-auto`} onClick={onReload}>
                Reload
              </button>
            </div>
            {state.view === "definition" ? (
              <StoreDefinition columns={table.columns} primaryKey={table.primaryKey} />
            ) : (
              <>
                <StoreFilter
                  key={table.token}
                  columns={table.columns}
                  applied={state.filter}
                  onApply={(filter) => {
                    setState((was) => applyStoreFilter({ filter, state: was }));
                  }}
                  onClear={() => {
                    setState((was) => clearStoreFilter({ state: was }));
                  }}
                />
                <StoreRowsView
                  reading={rowsReading}
                  state={state}
                  onSort={(column) => {
                    setState((was) => clickStoreHeader({ column, state: was }));
                  }}
                  onOpen={(rowLocator) => {
                    setState((was) => openStoreRow({ locator: rowLocator, state: was }));
                  }}
                  onPage={(page) => {
                    setState((was) => goToStorePage({ page, state: was }));
                  }}
                />
              </>
            )}
          </>
        )}
      </section>
      {table !== undefined && state.openRow !== null && (
        <StoreRowPanel
          table={table.name}
          reading={rowReading}
          onClose={() => {
            setState((was) => closeStoreRow({ state: was }));
          }}
        />
      )}
    </div>
  );
}
