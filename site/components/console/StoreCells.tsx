import type { ReactElement } from "react";

import type { StoreCell, StoreColumnDefinition } from "../../lib/storeDocuments";

/*
 * How one store cell is drawn, in the grid and in the row panel. Four states stay four: SQL NULL (italic grey), a
 * value the credential mask withheld (amber, its reason on hover), an empty string (a grey quote pair, never blank),
 * and a value. Every value is drawn as TEXT through React — never as HTML — whatever the column holds.
 */

/** The grey italic NULL, Studio's own marking. */
const NULL_MARK = "italic text-muted-foreground";

/** A value the mask withheld, amber, its reason on hover. */
const WITHHELD_MARK = "text-warning";

/** A value cell's longest run before the grid cuts it: the panel holds the rest. */
const GRID_CHARACTERS = 120;

/** In the row panel, a value longer than this, or on several lines, or JSON, folds rather than running down the page. */
const PANEL_FOLD_CHARACTERS = 160;

/**
 * One cell as the grid draws it: one line, cut, NULL and withheld marked.
 *
 * @param cell the cell the rows document printed
 * @param column its column, whose kind decides the alignment and the binary note
 * @returns the cell's content
 */
export function StoreCellPreview({ cell, column }: { cell: StoreCell; column: StoreColumnDefinition }): ReactElement {
  if (cell.kind === "null") {
    return <span className={NULL_MARK}>NULL</span>;
  }
  if (cell.kind === "withheld") {
    return (
      <span className={WITHHELD_MARK} title={cell.why}>
        withheld
      </span>
    );
  }
  if (cell.text === "") {
    return <span className="text-muted-foreground">&quot;&quot;</span>;
  }
  const flat = cell.text.replace(/\s+/g, " ");
  let shown = flat;
  if (flat.length > GRID_CHARACTERS) {
    shown = `${flat.slice(0, GRID_CHARACTERS)}…`;
  } else if (cell.truncated) {
    shown = `${flat}…`;
  }
  if (column.displayKind === "binary") {
    return (
      <span className="font-mono text-muted-foreground" title={`base64, ${String(cell.characters)} characters`}>
        {shown}
      </span>
    );
  }
  if (column.displayKind === "json") {
    return <span className="font-mono">{shown}</span>;
  }
  return <span>{shown}</span>;
}

/**
 * A JSON value laid out for reading, or the text as it came when it does not parse (a cut value never will).
 *
 * @returns the text to put in a `<pre>`
 */
function readableJson({ text }: { text: string }): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * One cell as the row panel draws it: whole, a long, multi-line or JSON value folded in a native `<details>` with
 * whitespace kept in a `<pre>`, and a cut value saying how much of it is shown.
 *
 * @param cell the cell the row document printed
 * @param column its column
 * @returns the cell's content
 */
export function StoreCellFull({ cell, column }: { cell: StoreCell; column: StoreColumnDefinition }): ReactElement {
  if (cell.kind === "null") {
    return <span className={NULL_MARK}>NULL</span>;
  }
  if (cell.kind === "withheld") {
    return <span className={WITHHELD_MARK}>withheld: {cell.why}</span>;
  }
  if (cell.text === "") {
    return <span className="text-muted-foreground">&quot;&quot; (an empty string)</span>;
  }
  let body = cell.text;
  if (column.displayKind === "json" && !cell.truncated) {
    body = readableJson({ text: cell.text });
  }
  const cut = cell.truncated ? (
    <p className="m-0 mt-1 text-[0.72rem] text-muted-foreground">
      cut: the first {String(cell.text.length)} of {String(cell.characters)} characters
    </p>
  ) : null;
  const folds = column.displayKind === "json" || cell.text.includes("\n") || cell.text.length > PANEL_FOLD_CHARACTERS;
  if (!folds) {
    return (
      <>
        <span className="break-words whitespace-pre-wrap">{body}</span>
        {cut}
      </>
    );
  }
  const head = cell.text.replace(/\s+/g, " ").slice(0, 80);
  return (
    <>
      <details>
        <summary className="cursor-pointer truncate font-mono text-[0.78rem]">
          {head}
          {cell.text.length > 80 ? "…" : ""}{" "}
          <span className="text-muted-foreground">({String(cell.characters)} characters)</span>
        </summary>
        <pre className="m-0 mt-1 max-h-[60vh] overflow-auto rounded-[6px] border border-solid border-border bg-muted p-2 font-mono text-[0.76rem] break-words whitespace-pre-wrap">
          {body}
        </pre>
      </details>
      {cut}
    </>
  );
}

/**
 * A column's name and catalog type, the type in grey and a key mark on a primary-key column — the header the grid
 * draws and the label the row panel draws.
 *
 * @returns the label
 */
export function StoreColumnLabel({ column }: { column: StoreColumnDefinition }): ReactElement {
  return (
    <span className="inline-flex items-baseline gap-[0.35rem] whitespace-nowrap">
      {column.primaryKeyPosition !== null && (
        <span className="text-warning" title={`primary key, position ${String(column.primaryKeyPosition)}`}>
          ⚿
        </span>
      )}
      <span className="font-semibold text-foreground">{column.name}</span>
      <span className="font-normal text-muted-foreground">{column.formattedType}</span>
    </span>
  );
}
