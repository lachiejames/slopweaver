"use client";

import type { ReactElement } from "react";

import type { StoreTableDefinition } from "../../lib/storeDocuments";
import { cn } from "../../lib/utils";

/**
 * An estimate as the rail prints it: a planner's figure, marked as one, or the plain fact that there is none.
 *
 * @param estimatedRows `pg_class.reltuples`, or `null` for a table never analysed
 * @returns the figure
 */
function estimateOf({ estimatedRows }: { estimatedRows: number | null }): string {
  if (estimatedRows === null) {
    return "not analysed";
  }
  return `~${estimatedRows.toLocaleString("en")}`;
}

/**
 * The Store page's left rail: every table in the public schema with its estimated row count, and the table shown
 * marked. No box narrows it by name: the console takes typed words in the call's chat alone.
 *
 * @param tables every table the tables document listed, in its order
 * @param withheldTables how many the verb left out because a name in their definition would be masked
 * @param selected the token of the table shown, or `null`
 * @param onSelect what choosing a table does, given its token
 * @returns the rail
 */
export function StoreTableList({
  tables,
  withheldTables,
  selected,
  onSelect,
}: {
  tables: readonly StoreTableDefinition[];
  withheldTables: number;
  selected: string | null;
  onSelect: (table: string) => void;
}): ReactElement {
  return (
    <nav aria-label="tables" className="flex min-h-0 flex-col gap-2">
      <p
        className="m-0 text-[0.7rem] text-muted-foreground"
        title="counts are pg_class.reltuples, the planner's estimate"
      >
        {String(tables.length)} tables · counts estimated
      </p>
      {withheldTables > 0 && (
        <p className="m-0 text-[0.7rem] text-muted-foreground">
          {String(withheldTables)} withheld: a name in their definition would be masked
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-px p-0">
        {tables.map((table) => (
          <li key={table.token}>
            <button
              type="button"
              aria-current={table.token === selected ? "true" : undefined}
              onClick={() => {
                onSelect(table.token);
              }}
              className={cn(
                "flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[6px] border-0 bg-transparent px-2 py-[0.3rem] text-left text-[0.78rem] text-foreground hover:bg-muted",
                table.token === selected && "bg-primary/16 font-semibold",
              )}
            >
              <span className="min-w-0 truncate font-mono">{table.name}</span>
              <span className="flex-none text-[0.7rem] text-muted-foreground tabular-nums">
                {estimateOf({ estimatedRows: table.estimatedRows })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {tables.length === 0 && withheldTables === 0 && (
        <p className="m-0 text-[0.75rem] text-muted-foreground">The public schema holds no tables.</p>
      )}
    </nav>
  );
}
