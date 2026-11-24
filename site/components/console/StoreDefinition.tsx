import type { ReactElement } from "react";

import type { StoreColumnDefinition } from "../../lib/storeDocuments";

/** A definition table's cell. */
const CELL = "border-0 border-b border-solid border-border/60 px-2 py-[0.3rem] text-left align-top";

/**
 * A yes as a tick, a no as nothing, so the columns that ARE nullable, generated or identity stand out.
 *
 * @returns the mark
 */
function markOf({ yes }: { yes: boolean }): string {
  if (yes) {
    return "✓";
  }
  return "";
}

/**
 * A table's definition as the catalog gives it: every column in catalog order with its type, whether it may be null,
 * whether the database generates it, whether it is an identity column, and where it sits in the primary key.
 *
 * @param columns the table's columns, in catalog order
 * @param primaryKey the key's column names in key order; empty when the table has none
 * @returns the definition
 */
export function StoreDefinition({
  columns,
  primaryKey,
}: {
  columns: readonly StoreColumnDefinition[];
  primaryKey: readonly string[];
}): ReactElement {
  let keyLine = "No primary key: a row is reopened by its physical position, which a later write can move.";
  if (primaryKey.length > 0) {
    keyLine = `Primary key: ${primaryKey.join(", ")}.`;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[0.75rem] text-muted-foreground">{keyLine}</p>
      <table className="w-full border-separate border-spacing-0 text-[0.78rem]">
        <thead>
          <tr className="text-muted-foreground">
            <th className={CELL}>#</th>
            <th className={CELL}>column</th>
            <th className={CELL}>type</th>
            <th className={CELL}>nullable</th>
            <th className={CELL}>generated</th>
            <th className={CELL}>identity</th>
            <th className={CELL}>key position</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.token}>
              <td className={`${CELL} text-muted-foreground tabular-nums`}>{String(column.ordinal)}</td>
              <td className={`${CELL} font-mono font-semibold`}>{column.name}</td>
              <td className={`${CELL} font-mono text-muted-foreground`}>{column.formattedType}</td>
              <td className={CELL}>{markOf({ yes: column.nullable })}</td>
              <td className={CELL}>{markOf({ yes: column.generated })}</td>
              <td className={CELL}>{markOf({ yes: column.identity })}</td>
              <td className={`${CELL} tabular-nums`}>
                {column.primaryKeyPosition === null ? "" : String(column.primaryKeyPosition)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
