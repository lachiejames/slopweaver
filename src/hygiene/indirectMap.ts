/**
 * The indirect-references candidate map and its closed class set — pure.
 *
 * The map lives at `$SLOPWEAVER_HOME/hygiene/indirect-reference-map.tsv`, never in git, for the reason the direct
 * map does: some of its rows are the organisation's own words. Each row is one candidate pattern with the class
 * it reports under, what to do with a hit and the replacement a reviewer would propose:
 *
 * ```text
 * class<TAB>flags<TAB>disposition<TAB>pattern<TAB>replacement
 * ```
 *
 * `flags` is `i` (case-insensitive) or `-`. `disposition` is `remove` (an obvious candidate a pull request takes
 * out), `review` (one the owner judges, listed place by place) or `aggregate` (vocabulary too common to list by
 * line, such as a vendor that is an integration's own name, reported as totals). The class must be one of
 * {@link INDIRECT_CLASSES}: a typo would otherwise open an unreviewed bucket. A failure names the line and what
 * is wrong, and never quotes the row, because its pattern may be a name.
 */
import { err, ok, type Result } from "../lib/result.js";

/** How a tie-back works, which is how the review page groups its candidates. */
export type IndirectGroup =
  | "people"
  | "organisation-vocabulary"
  | "provider-identity"
  | "compliance-and-configuration"
  | "narrative-and-time"
  | "business-and-geography";

/** Every class a candidate-map row may name, and the group it reports under. */
export const INDIRECT_CLASSES = {
  "business-domain": "business-and-geography",
  channel: "organisation-vocabulary",
  "compliance-control": "compliance-and-configuration",
  "dated-event": "narrative-and-time",
  "employment-history": "narrative-and-time",
  "incident-number": "provider-identity",
  "internal-system": "organisation-vocabulary",
  "issue-key": "provider-identity",
  "job-title": "people",
  locale: "business-and-geography",
  "meeting-quote": "narrative-and-time",
  person: "people",
  "policy-name": "compliance-and-configuration",
  "provider-id": "provider-identity",
  "team-key": "organisation-vocabulary",
  "vendor-set": "business-and-geography",
} as const satisfies Record<string, IndirectGroup>;

/** One class a candidate-map row may name. */
export type IndirectClassName = keyof typeof INDIRECT_CLASSES;

/** What a hit on a row asks for. */
export type IndirectDisposition = "remove" | "review" | "aggregate";

/** One candidate-map row, compiled. */
export interface IndirectMapRow {
  readonly className: IndirectClassName;
  readonly disposition: IndirectDisposition;
  readonly re: RegExp;
  readonly replacement: string;
}

/** The map file's first non-comment line is not the header. */
interface IndirectMapHeaderMissingError {
  readonly code: "INDIRECT_MAP_HEADER_MISSING";
  readonly message: string;
}

/** One row cannot be read. */
interface IndirectMapRowMalformedError {
  readonly code: "INDIRECT_MAP_ROW_MALFORMED";
  readonly message: string;
  readonly line: number;
}

/** The map parsed to no row, so a scan over it would read clean for a reason that is not the tree. */
interface IndirectMapEmptyError {
  readonly code: "INDIRECT_MAP_EMPTY";
  readonly message: string;
}

/** Every way a candidate map fails to parse. */
export type IndirectMapError = IndirectMapHeaderMissingError | IndirectMapRowMalformedError | IndirectMapEmptyError;

/** The factory every candidate-map failure is built through. */
const IndirectMapErrors = {
  empty: (): IndirectMapEmptyError => ({
    code: "INDIRECT_MAP_EMPTY",
    message: "the indirect candidate map holds no row, so a clean scan over it would prove nothing",
  }),
  headerMissing: (): IndirectMapHeaderMissingError => ({
    code: "INDIRECT_MAP_HEADER_MISSING",
    message: `the indirect candidate map's first non-comment line must be the header: ${HEADER.replaceAll("\t", "<TAB>")}`,
  }),
  rowMalformed: ({ line, why }: { line: number; why: string }): IndirectMapRowMalformedError => ({
    code: "INDIRECT_MAP_ROW_MALFORMED",
    line,
    message: `indirect candidate map line ${String(line)}: ${why}`,
  }),
} as const;

/** The exact header line. */
const HEADER = "class\tflags\tdisposition\tpattern\treplacement";

const DISPOSITIONS: readonly IndirectDisposition[] = ["remove", "review", "aggregate"];

/**
 * Pure: whether a word is one of the closed classes.
 *
 * @param name the class cell
 * @returns whether it names a class
 */
export function isIndirectClass(name: string): name is IndirectClassName {
  return Object.hasOwn(INDIRECT_CLASSES, name);
}

/**
 * Pure: whether a word is a disposition.
 *
 * @param word the disposition cell
 * @returns whether it is one
 */
function isDisposition(word: string): word is IndirectDisposition {
  return (DISPOSITIONS as readonly string[]).includes(word);
}

/**
 * Pure: one candidate-map row.
 *
 * @param line the 1-based line it sits on, for the error
 * @param raw the line's text
 * @returns the compiled row, or why it is malformed
 */
function parseRow({ line, raw }: { line: number; raw: string }): Result<IndirectMapRow, IndirectMapRowMalformedError> {
  const cells = raw.split("\t");
  if (cells.length !== 5) {
    return err(
      IndirectMapErrors.rowMalformed({ line, why: `expected 5 tab-separated cells, got ${String(cells.length)}` }),
    );
  }
  // Five cells, counted just above.
  const className = cells[0]!;
  const flags = cells[1]!;
  const disposition = cells[2]!;
  const pattern = cells[3]!;
  const replacement = cells[4]!;
  if (!isIndirectClass(className)) {
    return err(IndirectMapErrors.rowMalformed({ line, why: "the class is not one of the closed indirect classes" }));
  }
  if (flags !== "i" && flags !== "-") {
    return err(IndirectMapErrors.rowMalformed({ line, why: "flags must be 'i' or '-'" }));
  }
  if (!isDisposition(disposition)) {
    return err(IndirectMapErrors.rowMalformed({ line, why: "disposition must be remove, review or aggregate" }));
  }
  if (pattern.length === 0) {
    return err(IndirectMapErrors.rowMalformed({ line, why: "the pattern is empty" }));
  }
  if (replacement.trim().length === 0) {
    return err(IndirectMapErrors.rowMalformed({ line, why: "the replacement is empty" }));
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags === "i" ? "giu" : "gu");
  } catch {
    return err(IndirectMapErrors.rowMalformed({ line, why: "the pattern is not a valid regular expression" }));
  }
  if (re.test("")) {
    return err(IndirectMapErrors.rowMalformed({ line, why: "the pattern matches the empty string" }));
  }
  re.lastIndex = 0;
  return ok({ className, disposition, re, replacement: replacement.trim() });
}

/**
 * Pure: parse a candidate map. An exact duplicate row is kept once, so it cannot double a count.
 *
 * @param text the whole map file
 * @returns every row compiled, or the first reason the map cannot be trusted
 */
export function parseIndirectMap({ text }: { text: string }): Result<readonly IndirectMapRow[], IndirectMapError> {
  const [header, ...body] = text
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter(({ raw }) => raw.trim().length > 0 && !raw.startsWith("#"));
  if (header?.raw !== HEADER) {
    return err(IndirectMapErrors.headerMissing());
  }
  const rows: IndirectMapRow[] = [];
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
    return err(IndirectMapErrors.empty());
  }
  return ok(rows);
}
