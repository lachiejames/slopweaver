"use client";

import type { ReactElement, ReactNode } from "react";

import type { StoreRowDocument } from "../../lib/storeDocuments";
import { SLIDE_BODY_FOLDED, SlideOver } from "../live/SlideOver";
import { Spinner, SpinnerBlock } from "../ui/spinner";
import { CHIP } from "./controls";
import { StoreCellFull, StoreColumnLabel } from "./StoreCells";

/** What the row panel has to draw: the read under way, its document, or why there is none. */
export type StoreRowReading =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly document: StoreRowDocument }
  | { readonly phase: "failed"; readonly why: string };

/**
 * The words a locator's stability is described by under the panel's title.
 *
 * @returns the line
 */
function stabilityLineOf({ document }: { document: StoreRowDocument }): string {
  return `found by its position as the page read it; a row written since reads as gone · read ${document.observedAtIso}`;
}

/**
 * One row opened whole, read-only: every column in catalog order, its name and type, then its value — long text and
 * JSON folded in native `<details>`, whitespace kept in a `<pre>`, NULL and withheld marked. Drawn in the site's one
 * panel shell (`../live/SlideOver.tsx`), with no act bar: nothing here writes.
 *
 * @param table the table's name, the panel's title while the row reads
 * @param reading the row read as it stands
 * @param onClose what closing the panel does
 * @returns the panel
 */
export function StoreRowPanel({
  table,
  reading,
  onClose,
}: {
  table: string;
  reading: StoreRowReading;
  onClose: () => void;
}): ReactElement {
  let meta: ReactNode = <Spinner label="the row" />;
  if (reading.phase === "ready") {
    meta = stabilityLineOf({ document: reading.document });
  }
  if (reading.phase === "failed") {
    meta = "the row did not read";
  }
  return (
    <SlideOver
      label={`a row of ${table}`}
      tag={<span className={CHIP}>read-only</span>}
      title={<span className="font-mono">{table}</span>}
      meta={meta}
      onClose={onClose}
    >
      <div className={SLIDE_BODY_FOLDED}>
        {reading.phase === "loading" && <SpinnerBlock label="every column of the row" />}
        {reading.phase === "failed" && (
          <p role="alert" className="m-0 text-warning">
            slopweaver store row: {reading.why}
          </p>
        )}
        {reading.phase === "ready" && (
          <dl className="m-0 grid grid-cols-[minmax(10rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-[0.55rem]">
            {reading.document.columns.map((column) => (
              <div key={column.token} className="contents">
                <dt className="text-[0.76rem]">
                  <StoreColumnLabel column={column} />
                </dt>
                <dd className="m-0 min-w-0 text-[0.8rem]">
                  <StoreCellFull cell={reading.document.cells[column.name]} column={column} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </SlideOver>
  );
}
