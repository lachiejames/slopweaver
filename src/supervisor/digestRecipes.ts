/**
 * The digest's automation lines, read out of `automation due --json`: what is due, most late first, and — before
 * any of it — every declared automation the definition store does not hold or holds on an earlier build's cadence.
 *
 * MEASURED: every tick across at least five days captured `"rows":[]` beside a `missing` list naming all twenty declared automations,
 * and a digest that read only `rows` printed `recipes: none due` and the chair told the owner the fleet was idle
 * because nothing was due (`recipe-due.json` in the tick's scratch directory). An empty schedule is a claim about the
 * declaration too, so "none due" is said only when both declaration lists were read and are empty; anything else
 * is either an act-first line naming the fix or an UNKNOWN.
 *
 * Pure — documents in, lines out.
 */
import { renderAge } from "#lib/duration.js";

import {
  arrayField,
  asText,
  capped,
  type DigestInputs,
  field,
  jsonOf,
  listOf,
  numberField,
  stringField,
} from "./digestRead.js";

/** The fix verb for an absent or superseded declared row; `automation due` names the same one. */
const REGISTER_STANDING = "slopweaver automation register-standing";

/**
 * The order a due row's tolerance band is read in, most late first. Sixteen due recipes printed as one comma list
 * in no stated order put a five-day-late atlas beside one four minutes late.
 */
const DUE_BANDS = ["overdue", "urgent", "comfortable", "unschedulable"] as const;

/** What the declaration lists established about the schedule: read and empty, read with problems, or unread. */
type DeclarationCoverage = "clear" | "problems" | "unknown";

/** The recipe lines split by where the chair reads them: what it acts on first, and the schedule in its place. */
export interface RecipeDigestLines {
  /** Absent or superseded declared rows, and an unreadable declaration list — read before `broken:`. */
  readonly actFirst: readonly string[];
  /** What is due, most late first, then each rejected definition and each stranded row. */
  readonly schedule: readonly string[];
}

/**
 * One due row as `recipes <band>: <id> — <how late>`. Each part the row does not carry plainly — a band outside
 * {@link DUE_BANDS}, a lateness `automation due` could not compute, an empty recipe id — says UNKNOWN rather
 * than a word that reads as a verdict.
 *
 * @returns the line
 */
function dueRecipeLine({ row }: { row: unknown }): string {
  const tolerance = field({ key: "tolerance", value: row });
  const read = stringField({ key: "band", value: tolerance });
  const band = DUE_BANDS.find((one) => one === read);
  const lateBy = numberField({ key: "lateByMs", value: tolerance });
  // `automation due --json` names a row by `recipeId`; reading `id` printed "undefined" for every due recipe.
  const recipe = stringField({ key: "recipeId", value: row });
  // Lateness is measured from the firing before now, so a negative or non-finite one is no
  // reading of it.
  const lateReads = lateBy !== undefined && Number.isFinite(lateBy) && lateBy >= 0;
  const late = lateReads ? `${renderAge({ ms: lateBy })} late` : "lateness UNKNOWN";
  const name = recipe === undefined || recipe === "" ? "UNKNOWN (the row names no recipeId)" : recipe;
  let bandText = "band UNKNOWN";
  if (band !== undefined) {
    bandText = band;
  }
  return `recipes ${bandText}: ${name} — ${late}`;
}

/**
 * Where a due row's band sorts: the {@link DUE_BANDS} order, an unknown band last.
 *
 * @returns the rank
 */
function bandRank({ row }: { row: unknown }): number {
  const band = stringField({ key: "band", value: field({ key: "tolerance", value: row }) });
  const rank = DUE_BANDS.findIndex((one) => one === band);
  if (rank === -1) {
    return DUE_BANDS.length;
  }
  return rank;
}

/**
 * The due recipes, most late band first. "none due" is said only of a rows list whose every row carries its due
 * verdict AND a declaration both read and clear: a missing list, a row with none, or a declared row the store
 * lacks could each be hiding a due recipe.
 *
 * @param rows recipe-due's rows list, or undefined when the reading carries none
 * @param coverage what the declaration lists established
 * @returns the lines
 */
function dueLines({
  coverage,
  rows,
}: {
  coverage: DeclarationCoverage;
  rows: readonly unknown[] | undefined;
}): readonly string[] {
  if (rows === undefined) {
    return ["recipes: UNKNOWN — recipe-due carries no rows list"];
  }
  const unjudged = rows.filter((row) => typeof field({ key: "due", value: row }) !== "boolean").length;
  const due = rows
    .filter((row) => field({ key: "due", value: row }) === true)
    .toSorted((left, right) => bandRank({ row: left }) - bandRank({ row: right }));
  if (due.length === 0 && unjudged === 0) {
    // The act-first lines already say what the declaration is missing; an empty schedule then says nothing.
    return coverage === "clear" ? ["recipes: none due"] : [];
  }
  const head = unjudged > 0 ? [`recipes: UNKNOWN — ${String(unjudged)} row(s) carry no due verdict`] : [];
  if (due.length === 0) {
    return head;
  }
  return [
    ...head,
    `recipes: ${String(due.length)} due`,
    ...capped({ lines: due.map((row) => dueRecipeLine({ row })), prefix: "recipes due" }),
  ];
}

/**
 * One value folded onto a single line. The tick prints each digest string as one indented line, so a newline
 * inside a field would print a second, unindented line of the field's choosing — `recipes: none due` included.
 *
 * @returns the text with each line break, and the whitespace around it, as one space; a line with no break is
 *   returned byte for byte
 */
function oneLine({ text }: { text: string }): string {
  return text.replaceAll(/\s*[\n\v\f\r\x85\p{Zl}\p{Zp}]+\s*/gu, " ");
}

/**
 * A text field of one declaration entry for interpolation, UNKNOWN when the entry does not carry it or carries
 * only whitespace. A line break inside it is folded with the whole line, in {@link recipeDigestLines}.
 *
 * @returns the text
 */
function entryText({ key, value }: { key: string; value: unknown }): string {
  const text = stringField({ key, value });
  if (text === undefined || text.trim() === "") {
    return "UNKNOWN";
  }
  return text;
}

/** @returns the line for one declared row the store does not hold */
function absentLine({ entry }: { entry: unknown }): string {
  return `recipes absent: ${entryText({ key: "recipeId", value: entry })} — ${entryText({ key: "why", value: entry })}`;
}

/** @returns the line for one declared row the store holds on an earlier build's cadence */
function supersededLine({ entry }: { entry: unknown }): string {
  const cadences =
    `cadence \`${entryText({ key: "storedCadence", value: entry })}\` → ` +
    `\`${entryText({ key: "declaredCadence", value: entry })}\``;
  const files = listOf({ key: "ambiguousFiles", value: entry });
  const ambiguous =
    files === undefined || files.length === 0
      ? ""
      : ` — AMBIGUOUS, in ${files.map((one) => asText({ value: one })).join(", ")}: remove every copy but ` +
        `${entryText({ key: "recipeId", value: entry })}.json first`;
  return `recipes superseded: ${entryText({ key: "recipeId", value: entry })} — ${cadences}${ambiguous}`;
}

/**
 * One declaration list's act-first lines: a loud header naming the count and the fix, then each entry capped.
 *
 * @param entries the list, or undefined when the reading did not carry it as an array
 * @param key the producer's field name, for the UNKNOWN line
 * @param label the word the header shouts
 * @param line renders one entry
 * @returns the lines, empty when the list is read and empty
 */
function declarationLines({
  entries,
  key,
  label,
  line,
}: {
  entries: readonly unknown[] | undefined;
  key: string;
  label: string;
  line: (request: { entry: unknown }) => string;
}): readonly string[] {
  if (entries === undefined) {
    return [`recipes: UNKNOWN — recipe-due ${key} is not an array`];
  }
  if (entries.length === 0) {
    return [];
  }
  return [
    `recipes: ${String(entries.length)} declared automation(s) ${label} — run \`${REGISTER_STANDING}\``,
    ...capped({ lines: entries.map((entry) => line({ entry })), prefix: `recipes ${label.toLowerCase()}` }),
  ];
}

/**
 * Every recipe line the digest prints, split into what the chair acts on first and the schedule in its place.
 *
 * @param inputs the tick's readings
 * @returns the two groups
 */
export function recipeDigestLines({ inputs }: { inputs: DigestInputs }): RecipeDigestLines {
  const read = jsonOf({ inputs, name: "recipe-due" });
  if ("line" in read) {
    return { actFirst: [], schedule: [read.line] };
  }
  const missing = listOf({ key: "missing", value: read.value });
  const superseded = listOf({ key: "superseded", value: read.value });
  let coverage: DeclarationCoverage = "problems";
  if (missing === undefined || superseded === undefined) {
    coverage = "unknown";
  } else if (missing.length === 0 && superseded.length === 0) {
    coverage = "clear";
  }
  const rejected = arrayField({ key: "rejected", value: read.value }).map(
    (one) => `recipes: rejected ${asText({ value: one })}`,
  );
  const stranded = arrayField({ key: "stranded", value: read.value }).map(
    (one) => `recipes: stranded ${asText({ value: one })}`,
  );
  // Every line is folded on the way out, whatever field it interpolated: the tick prints each as ONE indented
  // line, so a newline in a rejected path or a recipe id would print a line of the field's own choosing
  // A rejected value is labelled as one for the same reason: unlabelled, a definition
  // rejected as `none due` printed the very line the declared lists exist to suppress.
  return {
    actFirst: [
      ...declarationLines({ entries: missing, key: "missing", label: "ABSENT", line: absentLine }),
      ...declarationLines({ entries: superseded, key: "superseded", label: "SUPERSEDED", line: supersededLine }),
    ].map((text) => oneLine({ text })),
    schedule: [
      ...dueLines({ coverage, rows: listOf({ key: "rows", value: read.value }) }),
      ...capped({ lines: rejected, prefix: "recipes rejected" }),
      ...capped({ lines: stranded, prefix: "recipes stranded" }),
    ].map((text) => oneLine({ text })),
  };
}
