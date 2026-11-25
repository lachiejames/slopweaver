"use client";

import { type ReactElement, useState } from "react";

import { type StoreFilterState, storeFilterFromDraft } from "../../lib/storeBrowserState";
import type { StoreColumnDefinition, StoreFilterOperator } from "../../lib/storeDocuments";
import { STORE_FILTER_VALUE_MAX } from "../../lib/storeReadVerbs";
import { BUTTON, BUTTON_PRIMARY, CHIP } from "./controls";

/** The operators in the order the select offers them, with the words it shows. */
const OPERATOR_WORDS: readonly { readonly operator: StoreFilterOperator; readonly words: string }[] = [
  { operator: "eq", words: "equals" },
  { operator: "contains", words: "contains" },
  { operator: "is-null", words: "is null" },
  { operator: "not-null", words: "is not null" },
];

/** A small select or box in the filter bar. */
const FIELD =
  "rounded-[6px] border border-solid border-border bg-(--c-panel) px-2 py-[0.25rem] text-[0.78rem] text-foreground outline-none focus:border-ring";

/**
 * The words an applied filter is summarised by in its chip: the column and the operator, never the value, so a typed
 * value is shown only in the box it was typed into.
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
 * The Store page's one filter: a column, an operator, and for equals and contains a typed value; Apply sets it, and
 * Clear, a separate button, removes it. Contains is the verb's own case-insensitive match. An empty value is refused
 * with a sentence rather than read as no filter. The value box is one of the console's named search boxes
 * (`site/__tests__/unit/textInputs.test.ts`): it narrows a read-only view and sends its words to nothing but
 * `store rows`. The page keys this bar by table, so a draft never outlives the table it was typed for.
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
  const [operator, setOperator] = useState<StoreFilterOperator>("eq");
  const [value, setValue] = useState("");
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const takesValue = operator === "eq" || operator === "contains";
  const apply = (): void => {
    const drafted = storeFilterFromDraft({
      column,
      columnTokens: columns.map((one) => one.token),
      operator,
      value,
    });
    if (drafted.isErr()) {
      setRefusal(drafted.error);
      return;
    }
    setRefusal(undefined);
    onApply(drafted.value);
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
          {takesValue && (
            <input
              type="search"
              aria-label="value"
              placeholder="value"
              autoComplete="off"
              spellCheck={false}
              maxLength={STORE_FILTER_VALUE_MAX}
              className={`${FIELD} min-w-[12rem] flex-1`}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          )}
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
