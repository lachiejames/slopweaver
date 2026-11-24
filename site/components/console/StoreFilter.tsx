"use client";

import { type ReactElement, useState } from "react";

import type { StoreFilterState } from "../../lib/storeBrowserState";
import type { StoreColumnDefinition } from "../../lib/storeDocuments";
import { BUTTON, BUTTON_PRIMARY, CHIP } from "./controls";

/** The operators in the order the select offers them, with the words it shows. */
const OPERATOR_WORDS: readonly { readonly operator: StoreFilterState["operator"]; readonly words: string }[] = [
  { operator: "is-null", words: "is null" },
  { operator: "not-null", words: "is not null" },
];

/** A small select in the filter bar. */
const FIELD =
  "rounded-[6px] border border-solid border-border bg-(--c-panel) px-2 py-[0.25rem] text-[0.78rem] text-foreground outline-none focus:border-ring";

/**
 * The words an applied filter is summarised by in its chip.
 *
 * @returns the summary
 */
function filterSummaryOf({
  filter,
  columns,
}: {
  filter: StoreFilterState;
  columns: readonly StoreColumnDefinition[];
}): string {
  const column = columns.find((one) => one.token === filter.column);
  let name = "an unknown column";
  if (column !== undefined) {
    name = column.name;
  }
  const words = OPERATOR_WORDS.find((one) => one.operator === filter.operator)!.words;
  return `${name} ${words}`;
}

/**
 * The Store page's one filter: a column, and whether it is null; Apply sets it, and Clear, a separate button, removes
 * it. Nothing here takes typed words, because the console takes them in the call's chat alone
 * (`site/__tests__/unit/textInputs.test.ts`); equals and contains stay with `store rows` in a terminal.
 *
 * @param columns the table's columns, in catalog order
 * @param applied the filter the page applies now, or `null`
 * @param onApply what Apply does, given the filter
 * @param onClear what Clear does
 * @returns the filter bar
 */
export function StoreFilter({
  columns,
  applied,
  onApply,
  onClear,
}: {
  columns: readonly StoreColumnDefinition[];
  applied: StoreFilterState | null;
  onApply: (filter: StoreFilterState) => void;
  onClear: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const first = columns.at(0);
  const [column, setColumn] = useState<string>(first === undefined ? "" : first.token);
  const [operator, setOperator] = useState<StoreFilterState["operator"]>("is-null");
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const apply = (): void => {
    if (!columns.some((one) => one.token === column)) {
      setRefusal("pick a column to filter on");
      return;
    }
    setRefusal(undefined);
    onApply({ column, operator });
    setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={BUTTON}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Filter
      </button>
      {applied !== null && (
        <>
          <span className={CHIP} data-tone="hot">
            {filterSummaryOf({ columns, filter: applied })}
          </span>
          <button type="button" className={BUTTON} onClick={onClear}>
            Clear
          </button>
        </>
      )}
      {open && (
        <form
          className="flex basis-full flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <select
            aria-label="column"
            className={FIELD}
            value={column}
            onChange={(event) => {
              setColumn(event.target.value);
            }}
          >
            {columns.map((one) => (
              <option key={one.token} value={one.token}>
                {one.name}
              </option>
            ))}
          </select>
          <select
            aria-label="operator"
            className={FIELD}
            value={operator}
            onChange={(event) => {
              const chosen = OPERATOR_WORDS.find((one) => one.operator === event.target.value);
              if (chosen !== undefined) {
                setOperator(chosen.operator);
              }
            }}
          >
            {OPERATOR_WORDS.map((one) => (
              <option key={one.operator} value={one.operator}>
                {one.words}
              </option>
            ))}
          </select>
          <button type="submit" className={BUTTON_PRIMARY}>
            Apply
          </button>
          {refusal !== undefined && (
            <p role="alert" className="m-0 basis-full text-[0.75rem] text-warning">
              {refusal}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
