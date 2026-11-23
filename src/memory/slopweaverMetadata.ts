/**
 * Parsing the structured fields under a memory's `metadata.slopweaver` namespace — the correction subject a
 * standing correction is matched by, the overlap answers the write gate reads (`./overlapNomination.ts`), and
 * the canon amendment `amends-canon-without-row` judges. Pure; `./parse.ts` hands each the value the YAML
 * parser already produced.
 *
 * Each field has two halves, deliberately separate: a validator says what is wrong, a reader says what is
 * usable, and the reader WITHHOLDS whatever the validator reported rather than repairing it. A reader that
 * repaired what the validator rejected would make the findings decorative — a half-formed correction subject
 * would reach the overlay as a correction nothing matches, and a typo in an overlap answer would silently
 * count as an answer, so the gate would stop asking.
 */
import { isOneOf, isRecord } from "../lib/parsers.js";
import {
  MEMORY_OVERLAP_ANSWERS,
  type MemoryAmendsCanon,
  type MemoryCorrectionSubject,
  type MemoryFinding,
  type MemoryOverlap,
} from "./types.js";

/** A finding about the file as a whole (no single line is at fault). */
function schemaFinding({ file, message }: { file: string; message: string }): MemoryFinding {
  return { check: "schema", file, line: null, message };
}

/** A string with something in it, trimmed; `null` for anything else. */
function nonEmpty({ value }: { value: unknown }): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
}

/**
 * Validate `metadata.slopweaver.correctionSubject`.
 *
 * Every required field is checked by name rather than the object being waved through as "a mapping": a
 * correction whose subject is half-formed cannot be MATCHED, and an unmatchable correction is worse than an
 * absent one — it looks like the bot was told and still got it wrong. `url` is optional because not every
 * source has one worth carrying; nothing matches on it.
 *
 * @param file the leaf the findings are about
 * @param value the field as the YAML parser left it, `undefined` when absent
 * @returns one finding per missing or malformed field
 */
export function correctionSubjectFindings({ file, value }: { file: string; value: unknown }): readonly MemoryFinding[] {
  if (value === undefined) {
    return [];
  }
  if (!isRecord(value)) {
    return [schemaFinding({ file, message: "frontmatter `metadata.slopweaver.correctionSubject` must be a mapping" })];
  }
  const findings: MemoryFinding[] = [];
  for (const key of ["source", "container", "sourceId"]) {
    const field = value[key];
    if (typeof field !== "string" || field.trim() === "") {
      findings.push(
        schemaFinding({
          file,
          message: `frontmatter \`metadata.slopweaver.correctionSubject.${key}\` must be a non-empty string`,
        }),
      );
    }
  }
  const url = value["url"];
  if (url !== undefined && (typeof url !== "string" || url.trim() === "")) {
    findings.push(
      schemaFinding({
        file,
        message: "frontmatter `metadata.slopweaver.correctionSubject.url` must be a non-empty string when present",
      }),
    );
  }
  return findings;
}

/**
 * A well-formed correction subject, or `null` for anything {@link correctionSubjectFindings} would flag.
 *
 * @param value the field as the YAML parser left it
 * @returns the trimmed subject, or `null`
 */
export function readCorrectionSubject({ value }: { value: unknown }): MemoryCorrectionSubject | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = value["source"];
  const container = value["container"];
  const sourceId = value["sourceId"];
  const url = value["url"];
  if (
    typeof source !== "string" ||
    typeof container !== "string" ||
    typeof sourceId !== "string" ||
    source.trim() === "" ||
    container.trim() === "" ||
    sourceId.trim() === ""
  ) {
    return null;
  }
  return {
    container: container.trim(),
    source: source.trim(),
    sourceId: sourceId.trim(),
    ...(typeof url === "string" && url.trim() !== "" ? { url: url.trim() } : {}),
  };
}

/**
 * Validate `metadata.slopweaver.overlaps` — a mapping from what the write gate nominated to the writer's answer.
 *
 * @param file the leaf the findings are about
 * @param value the field as the YAML parser left it, `undefined` when absent
 * @returns one finding for a non-mapping, else one per entry whose answer is not one of the two words
 */
export function overlapsFindings({ file, value }: { file: string; value: unknown }): readonly MemoryFinding[] {
  if (value === undefined) {
    return [];
  }
  if (!isRecord(value)) {
    return [schemaFinding({ file, message: "frontmatter `metadata.slopweaver.overlaps` must be a mapping" })];
  }
  return Object.entries(value).flatMap(([target, answer]): readonly MemoryFinding[] => {
    if (typeof answer === "string" && isOneOf(answer, MEMORY_OVERLAP_ANSWERS)) {
      return [];
    }
    return [
      schemaFinding({
        file,
        message: `frontmatter \`metadata.slopweaver.overlaps\` answers \`${target}\` with something other than ${MEMORY_OVERLAP_ANSWERS.join(" or ")}`,
      }),
    ];
  });
}

/**
 * The well-formed overlap answers, in declaration order, withholding every entry {@link overlapsFindings}
 * reported.
 *
 * @param value the field as the YAML parser left it
 * @returns each entry whose answer is `supersedes` or `compatible`
 */
export function readOverlaps({ value }: { value: unknown }): readonly MemoryOverlap[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([target, answer]): readonly MemoryOverlap[] =>
    typeof answer === "string" && isOneOf(answer, MEMORY_OVERLAP_ANSWERS) ? [{ answer, target }] : [],
  );
}

/**
 * Validate `metadata.slopweaver.amendsCanon` — a memory declaring that it amends canon ahead of the change.
 *
 * `target` is required, because a declaration that does not say WHAT it amends cannot be read against anything.
 * `row` is optional here on purpose: a declaration naming no row is not malformed, it is the defect
 * `amends-canon-without-row` exists to report, and filing it as `schema` would hide which rule it breaks.
 *
 * @param file the leaf's basename, used in every finding
 * @param value the raw `amendsCanon` value, `undefined` when absent
 * @returns one `schema` finding per defect, empty when absent or well-formed
 */
export function amendsCanonFindings({ file, value }: { file: string; value: unknown }): readonly MemoryFinding[] {
  if (value === undefined) {
    return [];
  }
  if (!isRecord(value)) {
    return [schemaFinding({ file, message: "frontmatter `metadata.slopweaver.amendsCanon` must be a mapping" })];
  }
  const findings: MemoryFinding[] = [];
  if (nonEmpty({ value: value["target"] }) === null) {
    findings.push(
      schemaFinding({
        file,
        message: "frontmatter `metadata.slopweaver.amendsCanon.target` must name the canon file it amends",
      }),
    );
  }
  const row = value["row"];
  if (row !== undefined && nonEmpty({ value: row }) === null) {
    findings.push(
      schemaFinding({
        file,
        message: "frontmatter `metadata.slopweaver.amendsCanon.row` must be a board slug when present",
      }),
    );
  }
  return findings;
}

/**
 * Read a well-formed amendment declaration, or `null` for anything {@link amendsCanonFindings} flags. The row
 * state is always `unresolved` here: asking the board is I/O, done once at the verb edge.
 *
 * @param value the raw `amendsCanon` value
 * @returns the usable declaration, or `null`
 */
export function readAmendsCanon({ value }: { value: unknown }): MemoryAmendsCanon | null {
  if (!isRecord(value)) {
    return null;
  }
  const target = nonEmpty({ value: value["target"] });
  if (target === null) {
    return null;
  }
  const rawRow = value["row"];
  if (rawRow === undefined) {
    return { row: null, rowState: { kind: "unresolved" }, target };
  }
  const row = nonEmpty({ value: rawRow });
  if (row === null) {
    return null;
  }
  return { row, rowState: { kind: "unresolved" }, target };
}
