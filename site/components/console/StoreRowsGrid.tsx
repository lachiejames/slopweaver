"use client";

import type { ReactElement } from "react";

import type { StoreColumnDefinition, StoreRowsDocument } from "../../lib/storeDocuments";
import { cn } from "../../lib/utils";
import { StoreCellPreview, StoreColumnLabel } from "./StoreCells";

/**
 * The arrow a header wears for the sort the page asked for.
 *
 * @returns the arrow, or nothing when the column is not the sorted one
 */
function sortMarkOf({
  column,
  sort,
}: {
  column: StoreColumnDefinition;
  sort: { readonly column: string; readonly direction: "asc" | "desc" } | null;
}): string {
  if (sort === null || sort.column !== column.token) {
    return "";
  }
  if (sort.direction === "asc") {
    return "↑";
  }
  return "↓";
}

/**
 * One page of a table's rows as a dense grid: a header per column with its name, its type in grey and a key mark on
 * the primary key, clicked to sort; a row per row, clicked to open every column in the panel. A page with no rows
 * says so in the grid's own place, never as a blank.
 *
 * @param document the rows document the grid draws
 * @param sort the sort the page asked for, by column token, so the header marks it before and after the read
 * @param openRow the locator of the row whose panel is open, marked
 * @param onSort what a header click does, given the column's token
 * @param onOpen what a row click does, given the row's locator
 * @returns the grid
 */
export function StoreRowsGrid({
  document,
  sort,
  openRow,
  onSort,
  onOpen,
}: {
  document: StoreRowsDocument;
  sort: { readonly column: string; readonly direction: "asc" | "desc" } | null;
  openRow: string | null;
  onSort: (column: string) => void;
  onOpen: (locator: string) => void;
}): ReactElement {
  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-[0.78rem]">
      <thead>
        <tr>
          {document.columns.map((column) => (
            <th
              key={column.token}
              scope="col"
              aria-sort={sortAria({ column, sort })}
              className="sticky top-0 z-1 border-0 border-r border-b border-solid border-border bg-muted p-0 text-left font-normal"
            >
              <button
                type="button"
                onClick={() => {
                  onSort(column.token);
                }}
                title={`sort by ${column.name}`}
                className="flex w-full cursor-pointer items-baseline gap-1 border-0 bg-transparent px-2 py-[0.35rem] text-left text-[0.76rem]"
              >
                <StoreColumnLabel column={column} />
                <span className="ml-auto text-primary">{sortMarkOf({ column, sort })}</span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {document.rows.map((row) => (
          <tr
            key={row.locator}
            onClick={() => {
              onOpen(row.locator);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onOpen(row.locator);
              }
            }}
            tabIndex={0}
            className={cn(
              "cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted",
              row.locator === openRow && "bg-primary/12",
            )}
          >
            {document.columns.map((column) => (
              <td
                key={column.token}
                className={cn(
                  "max-w-[28rem] truncate border-0 border-r border-b border-solid border-border/60 px-2 py-[0.3rem] align-top",
                  column.displayKind === "number" && "text-right tabular-nums",
                )}
              >
                <StoreCellPreview cell={row.cells[column.name]} column={column} />
              </td>
            ))}
          </tr>
        ))}
        {document.rows.length === 0 && (
          <tr>
            <td colSpan={document.columns.length} className="px-2 py-6 text-center text-muted-foreground">
              {emptyLineOf({ document })}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * What a page with no rows says: a filter that matched nothing, a page past the last, or an empty table.
 *
 * @returns the line
 */
function emptyLineOf({ document }: { document: StoreRowsDocument }): string {
  if (document.filter !== null) {
    return "No row matches this filter.";
  }
  if (document.page > 1) {
    return "No rows on this page.";
  }
  return "This table holds no rows.";
}

/**
 * The header's `aria-sort`, so a screen reader hears the sort the arrow shows.
 *
 * @returns the attribute value, or `undefined` on an unsorted column
 */
function sortAria({
  column,
  sort,
}: {
  column: StoreColumnDefinition;
  sort: { readonly column: string; readonly direction: "asc" | "desc" } | null;
}): "ascending" | "descending" | undefined {
  if (sort === null || sort.column !== column.token) {
    return undefined;
  }
  if (sort.direction === "asc") {
    return "ascending";
  }
  return "descending";
}
