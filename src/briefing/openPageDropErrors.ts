/**
 * Typed domain errors for `./openPageDrop.ts` — the one verb that REMOVES an `open-pages.json` row. Each
 * factory computes its own `message`, so the CLI edge prints and never assembles; `UNSETTLED` and
 * `DOCUMENT_REFUSED` carry their lines beside the message because the edge prints those one per line, which is
 * the one branch a caller takes on the code.
 */

/** The file is not a JSON array of rows. */
export interface DropDocumentNotAnArrayError {
  readonly code: "DOCUMENT_NOT_AN_ARRAY";
  readonly message: string;
}

/** No row names the url exactly. */
export interface DropUrlNotFoundError {
  readonly code: "URL_NOT_FOUND";
  readonly message: string;
  readonly url: string;
  readonly rows: number;
}

/** More than one row names the url, so which one the owner's ruling overtook is not the verb's to pick. */
export interface DropUrlDuplicatedError {
  readonly code: "URL_DUPLICATED";
  readonly message: string;
  readonly url: string;
  /** Every 1-based position naming it. */
  readonly positions: readonly number[];
}

/** Nothing on record settles the page, so dropping its row would take a live question off the owner's page. */
export interface DropUnsettledError {
  readonly code: "UNSETTLED";
  readonly message: string;
  readonly url: string;
  /** What each source of evidence said, one line each. */
  readonly reasons: readonly string[];
}

/** The document left after the drop would not survive the render's own index gate. */
export interface DropDocumentRefusedError {
  readonly code: "DOCUMENT_REFUSED";
  readonly message: string;
  readonly defects: readonly string[];
}

/** Every failure `./openPageDrop.ts` can produce. */
export type OpenPageDropError =
  | DropDocumentNotAnArrayError
  | DropUrlNotFoundError
  | DropUrlDuplicatedError
  | DropUnsettledError
  | DropDocumentRefusedError;

export const OpenPageDropErrors = {
  documentNotAnArray: (): DropDocumentNotAnArrayError => ({
    code: "DOCUMENT_NOT_AN_ARRAY",
    message: "the open-pages document is a JSON array of open pages, one object each",
  }),
  documentRefused: ({ defects }: { defects: readonly string[] }): DropDocumentRefusedError => ({
    code: "DOCUMENT_REFUSED",
    defects,
    message: `the document left after the drop would be refused by \`briefing render\` (${String(defects.length)} defect(s))`,
  }),
  unsettled: ({ url, reasons }: { url: string; reasons: readonly string[] }): DropUnsettledError => ({
    code: "UNSETTLED",
    message:
      `nothing on record settles ${url}, so its row stays — record the owner's ruling with \`session-start lock-in\`, ` +
      "or name the board row that settled it with --settled-by <slug>",
    reasons,
    url,
  }),
  urlDuplicated: ({ url, positions }: { url: string; positions: readonly number[] }): DropUrlDuplicatedError => ({
    code: "URL_DUPLICATED",
    message: `rows ${positions.join(", ")} all name ${url}, so which one to drop is not this verb's to pick`,
    positions,
    url,
  }),
  urlNotFound: ({ url, rows }: { url: string; rows: number }): DropUrlNotFoundError => ({
    code: "URL_NOT_FOUND",
    message: `none of the ${String(rows)} row(s) names ${url} exactly`,
    rows,
    url,
  }),
} as const;

/** Why one source of evidence does not settle the page: one line of an `UNSETTLED` refusal's reasons. */
export interface DropReason {
  readonly code:
    | "LOCK_IN_UNDECODED"
    | "LOCK_IN_ABSENT"
    | "LOCK_IN_UNDECIDED"
    | "ROW_UNREADABLE"
    | "ROW_NOT_AN_ADDRESS"
    | "ROW_NOT_PUBLISHED"
    | "ROW_NOT_OVER";
  readonly message: string;
}

export const DropReasons = {
  lockInAbsent: ({ keys }: { keys: readonly string[] }): DropReason => ({
    code: "LOCK_IN_ABSENT",
    message: `lock-in: no resolution is recorded under ${keys.join(", ")}`,
  }),
  lockInUndecided: ({ key, outcome }: { key: string; outcome: string }): DropReason => ({
    code: "LOCK_IN_UNDECIDED",
    message: `lock-in: the owner's latest word under ${key} is ${outcome}, which does not settle a page`,
  }),
  lockInUndecoded: ({ lines }: { lines: number }): DropReason => ({
    code: "LOCK_IN_UNDECODED",
    message: `lock-in: ${String(lines)} ledger line(s) that may name this page did not decode, so the owner's last word is unknown`,
  }),
  rowNotAnAddress: ({ slug, url }: { slug: string; url: string }): DropReason => ({
    code: "ROW_NOT_AN_ADDRESS",
    message: `--settled-by ${slug}: ${url} is not an address, so no row can have published it`,
  }),
  rowNotOver: ({ slug }: { slug: string }): DropReason => ({
    code: "ROW_NOT_OVER",
    message: `--settled-by ${slug}: the row carries no settlement, no terminal status and no dated ruling`,
  }),
  rowNotPublished: ({ slug, url }: { slug: string; url: string }): DropReason => ({
    code: "ROW_NOT_PUBLISHED",
    message: `--settled-by ${slug}: the row names ${url} neither in its artifact: line nor in an artifact event`,
  }),
  rowUnreadable: ({ slug, why }: { slug: string; why: string }): DropReason => ({
    code: "ROW_UNREADABLE",
    message: `--settled-by ${slug}: ${why}`,
  }),
} as const;
