/**
 * Typed domain errors for `./openPageRow.ts` — the one authoring verb an `open-pages.json` row has. Each
 * factory computes its own `message`, so the CLI edge prints and never assembles; `ROW_REFUSED` and
 * `DOCUMENT_REFUSED` carry their defect lines beside the message because the edge prints those one per line
 * rather than joined, which is the one branch a caller takes on the code.
 */
import { errorMessage } from "../lib/errorMessage.js";

/** The row's text could not be read or parsed at all. */
export interface RowUnreadableError {
  readonly code: "ROW_UNREADABLE";
  readonly message: string;
  readonly source: string;
  readonly cause: unknown;
}

/** The row is not a JSON object at all. */
export interface RowNotAnObjectError {
  readonly code: "ROW_NOT_AN_OBJECT";
  readonly message: string;
}

/** The row would render as a card the page's own gate refuses; every defect, not the first. */
export interface RowRefusedError {
  readonly code: "ROW_REFUSED";
  readonly message: string;
  readonly defects: readonly string[];
}

/** The owner's ruling already settled the page, so a card carrying its question would ask them twice. */
export interface RowAlreadyRuledError {
  readonly code: "ROW_ALREADY_RULED";
  readonly message: string;
  readonly mark: string;
}

/** The file is not a JSON array of rows. */
export interface DocumentNotAnArrayError {
  readonly code: "DOCUMENT_NOT_AN_ARRAY";
  readonly message: string;
}

/** A row already names this url, and the caller did not ask to replace it. */
export interface DuplicateUrlError {
  readonly code: "DUPLICATE_URL";
  readonly message: string;
  readonly url: string;
  readonly position: number;
}

/** The edited document would carry more rows than the render's index accepts. */
export interface OverCapError {
  readonly code: "OVER_CAP";
  readonly message: string;
  readonly rows: number;
  readonly cap: number;
  /** Whether the document was ALREADY over the cap, so this write did not cause it. */
  readonly already: boolean;
}

/** The edited document would not survive the render's own index gate. */
export interface DocumentRefusedError {
  readonly code: "DOCUMENT_REFUSED";
  readonly message: string;
  readonly defects: readonly string[];
}

/** Every failure `./openPageRow.ts` can produce. */
export type OpenPageRowError =
  | RowUnreadableError
  | RowNotAnObjectError
  | RowRefusedError
  | RowAlreadyRuledError
  | DocumentNotAnArrayError
  | DuplicateUrlError
  | OverCapError
  | DocumentRefusedError;

export const OpenPageRowErrors = {
  documentNotAnArray: (): DocumentNotAnArrayError => ({
    code: "DOCUMENT_NOT_AN_ARRAY",
    message: "the open-pages document is a JSON array of open pages, one object each",
  }),
  documentRefused: ({ defects }: { defects: readonly string[] }): DocumentRefusedError => ({
    code: "DOCUMENT_REFUSED",
    defects,
    message: `the edited document would be refused by \`briefing render\` (${String(defects.length)} defect(s))`,
  }),
  duplicateUrl: ({ url, position }: { url: string; position: number }): DuplicateUrlError => ({
    code: "DUPLICATE_URL",
    message: `row ${String(position)} already names ${url} — pass --replace to swap it in place`,
    position,
    url,
  }),
  overCap: ({ rows, cap, already }: { rows: number; cap: number; already: boolean }): OverCapError => ({
    already,
    cap,
    code: "OVER_CAP",
    message: already
      ? `the document already carries ${String(rows)} rows, over the cap of ${String(cap)} the render ` +
        "refuses — settle or drop a page before editing this one"
      : `the edit would make ${String(rows)} rows, over the cap of ${String(cap)} the render refuses — ` +
        "settle or drop a page before adding one",
    rows,
  }),
  rowAlreadyRuled: ({ mark }: { mark: string }): RowAlreadyRuledError => ({
    code: "ROW_ALREADY_RULED",
    mark,
    message:
      `the lock-in ledger marks this page ${mark}, so the owner's ruling already covers what it asks and it gets no ` +
      "card — write a new page for a new question rather than re-asking this one",
  }),
  rowNotAnObject: (): RowNotAnObjectError => ({
    code: "ROW_NOT_AN_OBJECT",
    message: "the row is one JSON object carrying label, url, ask, landedIso and the six card fields",
  }),
  rowRefused: ({ defects }: { defects: readonly string[] }): RowRefusedError => ({
    code: "ROW_REFUSED",
    defects,
    message: `the row would render as a card the page gate refuses (${String(defects.length)} defect(s))`,
  }),
  rowUnreadable: ({ source, cause }: { source: string; cause: unknown }): RowUnreadableError => ({
    cause,
    code: "ROW_UNREADABLE",
    message: `${source}: could not read the row — ${errorMessage({ error: cause })}`,
    source,
  }),
} as const;
