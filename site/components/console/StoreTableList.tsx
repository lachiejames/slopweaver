"use client";

import { type ReactElement, useState } from "react";

import type { StoreTableDefinition } from "../../lib/storeDocuments";
import { matchingStoreTables, type StoreTableNameMatch, storeTableCountWords } from "../../lib/storeTableNames";
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
 * A table's name in the rail, with the part the name box matched marked. Text nodes only, so a name is never read as
 * markup.
 *
 * @returns the drawn name
 */
function TableName({ match }: { match: StoreTableNameMatch }): ReactElement {
  if (match.name === null) {
    return <span className="min-w-0 truncate font-mono">{match.table.name}</span>;
  }
  return (
    <span className="min-w-0 truncate font-mono">
      {match.name.before}
      <mark className="rounded-[3px] bg-primary/10 text-foreground underline decoration-primary underline-offset-2">
        {match.name.match}
      </mark>
      {match.name.after}
    </span>
  );
}

/**
 * The Store page's left rail: a box that narrows the tables by name, then every table in the public schema it keeps,
 * with its estimated row count and the table shown marked. The box is one of the console's named search boxes
 * (`site/__tests__/unit/textInputs.test.ts`): it narrows the list already read, ignoring case, marks the match, and
 * sends nothing anywhere; choosing a table is still a click.
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
  const [query, setQuery] = useState("");
  const kept = matchingStoreTables({ query, tables });
  const counted = storeTableCountWords({ kept: kept.length, query, total: tables.length });
  return (
    <nav aria-label="tables" className="flex min-h-0 flex-col gap-2">
      <input
        type="search"
        aria-label="table name"
        placeholder="table name"
        autoComplete="off"
        spellCheck={false}
        className="rounded-[6px] border border-solid border-border bg-(--c-panel) px-2 py-[0.25rem] font-mono text-[0.78rem] text-foreground outline-none focus:border-ring"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <p
        className="m-0 text-[0.7rem] text-muted-foreground"
        title="counts are pg_class.reltuples, the planner's estimate"
      >
        {counted} · counts estimated
      </p>
      {withheldTables > 0 && (
        <p className="m-0 text-[0.7rem] text-muted-foreground">
          {String(withheldTables)} withheld: a name in their definition would be masked
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-px p-0">
        {kept.map((match) => (
          <li key={match.table.token}>
            <button
              type="button"
              aria-current={match.table.token === selected ? "true" : undefined}
              onClick={() => {
                onSelect(match.table.token);
              }}
              className={cn(
                "flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[6px] border-0 bg-transparent px-2 py-[0.3rem] text-left text-[0.78rem] text-foreground hover:bg-muted",
                match.table.token === selected && "bg-primary/16 font-semibold",
              )}
            >
              <TableName match={match} />
              <span className="flex-none text-[0.7rem] text-muted-foreground tabular-nums">
                {estimateOf({ estimatedRows: match.table.estimatedRows })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {tables.length === 0 && withheldTables === 0 && (
        <p className="m-0 text-[0.75rem] text-muted-foreground">The public schema holds no tables.</p>
      )}
      {tables.length > 0 && kept.length === 0 && (
        <p className="m-0 text-[0.75rem] text-muted-foreground">No table name matches.</p>
      )}
    </nav>
  );
}
