"use client";

/*
 * The rows past a Fleet view's cut, behind one closed fold. Its rows mount only once the owner opens it: Past folds
 * thousands of settled rows (2,852 on one install — open `/fleet?view=past`), and a closed `<details>`
 * still mounts everything inside it, each row with its own source block.
 */

import { type ReactElement, useState } from "react";

import { COUNT } from "./Row";

/** A list under its rows' fold: the summary names how many it holds. */
const MORE =
  "mt-[0.4rem] text-[0.78rem] [&>summary]:cursor-pointer [&>summary]:text-muted-foreground [&>summary]:py-[0.3rem]";

/**
 * The folded rows, drawn only while the fold is open.
 *
 * @param label what the summary says before the count
 * @param render draws one row, carrying its own key
 * @returns the fold, or nothing when no row is past the cut
 */
export function FleetMore<T>({
  rows,
  label,
  render,
}: {
  rows: readonly T[];
  label: string;
  render: (row: T) => ReactElement;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) {
    return null;
  }
  return (
    <details
      className={MORE}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        {label} <span className={COUNT}>{String(rows.length)}</span>
      </summary>
      {open && rows.map(render)}
    </details>
  );
}
