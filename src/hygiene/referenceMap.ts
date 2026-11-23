/**
 * The reference map's parser — pure. The map is the installation's own names, held at
 * `$SLOPWEAVER_HOME/hygiene/reference-map.tsv` and never committed: one row per name, as a regular expression,
 * with the class it counts under. `audit references` scans an exported tree for every row.
 *
 * Format: blank lines and `#` comments are skipped; the first other line is exactly `class<TAB>flags<TAB>pattern`;
 * every later line is one row, its flags `i` (case-insensitive) or `-`. A failure names the line and what is
 * wrong with it, and never quotes the row: its pattern IS a name.
 */
import { err, ok, type Result } from "../lib/result.js";

/** One reference-map row: the class it reports under and its compiled, global expression. */
export interface ReferenceMapRow {
  readonly className: string;
  readonly re: RegExp;
}

/** The map file carries no `class`, `flags` and `pattern` header. */
interface MapHeaderMissingError {
  readonly code: "MAP_HEADER_MISSING";
  readonly message: string;
}

/** One map row cannot be read: wrong column count, an unknown flag, a bad class name or a bad expression. */
interface MapRowMalformedError {
  readonly code: "MAP_ROW_MALFORMED";
  readonly message: string;
  readonly line: number;
}

/** The map parsed to no row at all, so a scan over it would count zero for a reason that is not the tree. */
interface MapEmptyError {
  readonly code: "MAP_EMPTY";
  readonly message: string;
}

/** Every way a reference map fails to parse. */
export type ReferenceMapError = MapHeaderMissingError | MapRowMalformedError | MapEmptyError;

/** The factory every reference-map failure is built through. */
const ReferenceMapErrors = {
  empty: (): MapEmptyError => ({
    code: "MAP_EMPTY",
    message: "the reference map holds no row, so a zero over it would prove nothing about the tree",
  }),
  headerMissing: (): MapHeaderMissingError => ({
    code: "MAP_HEADER_MISSING",
    message: "the reference map's first non-comment line must be the header: class<TAB>flags<TAB>pattern",
  }),
  rowMalformed: ({ line, why }: { line: number; why: string }): MapRowMalformedError => ({
    code: "MAP_ROW_MALFORMED",
    line,
    message: `reference map line ${String(line)}: ${why}`,
  }),
} as const;

/** The exact header line. */
const HEADER = "class\tflags\tpattern";

/** A class name: lowercase words joined by `-`, so a page can print it and it can never carry a name's case. */
const CLASS_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Pure: parse a reference map. An exact duplicate row is kept once, so it cannot double a count.
 *
 * @param text the whole map file
 * @returns every row compiled, or the first reason the map cannot be trusted
 */
export function parseReferenceMap({ text }: { text: string }): Result<readonly ReferenceMapRow[], ReferenceMapError> {
  const [header, ...body] = text
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter(({ raw }) => raw.trim().length > 0 && !raw.startsWith("#"));
  if (header?.raw !== HEADER) {
    return err(ReferenceMapErrors.headerMissing());
  }
  const rows: ReferenceMapRow[] = [];
  const seen = new Set<string>();
  for (const { line, raw } of body) {
    const row = parseRow({ line, raw });
    if (row.isErr()) {
      return err(row.error);
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      rows.push(row.value);
    }
  }
  if (rows.length === 0) {
    return err(ReferenceMapErrors.empty());
  }
  return ok(rows);
}

/**
 * Pure: one map row.
 *
 * @param line the 1-based line it sits on, for the error
 * @param raw the line's text
 * @returns the compiled row, or why it is malformed
 */
function parseRow({ line, raw }: { line: number; raw: string }): Result<ReferenceMapRow, MapRowMalformedError> {
  const cells = raw.split("\t");
  if (cells.length !== 3) {
    return err(
      ReferenceMapErrors.rowMalformed({ line, why: `expected 3 tab-separated cells, got ${String(cells.length)}` }),
    );
  }
  // Three cells, counted just above.
  const className = cells[0]!;
  const flags = cells[1]!;
  const pattern = cells[2]!;
  if (!CLASS_NAME.test(className)) {
    return err(ReferenceMapErrors.rowMalformed({ line, why: "the class must be lowercase words joined by '-'" }));
  }
  if (flags !== "i" && flags !== "-") {
    return err(ReferenceMapErrors.rowMalformed({ line, why: "flags must be 'i' or '-'" }));
  }
  if (pattern.length === 0) {
    return err(ReferenceMapErrors.rowMalformed({ line, why: "the pattern is empty" }));
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags === "i" ? "gi" : "g");
  } catch {
    return err(ReferenceMapErrors.rowMalformed({ line, why: "the pattern is not a valid regular expression" }));
  }
  if (re.test("")) {
    return err(
      ReferenceMapErrors.rowMalformed({ line, why: "the pattern matches the empty string, so it matches everywhere" }),
    );
  }
  return ok({ className, re });
}
