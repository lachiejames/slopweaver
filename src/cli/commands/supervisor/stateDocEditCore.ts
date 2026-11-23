/**
 * The pure half of `slopweaver supervisor state-amend`, `state-fold` and `state-archive`: what their flags mean.
 *
 * No I/O. `./stateDocEditRun.ts` reads the doc, calls `../../../supervisor/stateDocEdit.ts`, and writes.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseFlagTail } from "../../optionParsers.js";
import { type SupervisorError, SupervisorErrors, supervisorErrorLines } from "./errors.js";

export const STATE_AMEND_USAGE =
  "usage: slopweaver supervisor state-amend --doc <path> --handoff <n> --row <text> [--row <text> ...] " +
  "[--after-rulings] [--json]";

export const STATE_ARCHIVE_USAGE =
  "usage: slopweaver supervisor state-archive --doc <path> --predecessor <n> --successor <n> --archive <file name> " +
  "--description <text> --block-file <path> --successor-summary <path> [--when <text>] [--json]";

export const STATE_FOLD_USAGE =
  "usage: slopweaver supervisor state-fold --doc <path> --handoff <n> --keep <rows> --archive <file name> " +
  "--description <text> [--when <text>] [--json]";

/** `state-fold`'s flags. */
export const STATE_FOLD_FLAG_SPEC = {
  boolean: ["json"],
  value: ["doc", "handoff", "keep", "archive", "description", "when"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `state-amend`'s flags. `row` is repeatable and extracted before the rest reaches the parser. */
export const STATE_AMEND_FLAG_SPEC = {
  boolean: ["after-rulings", "json"],
  value: ["doc", "handoff", "row"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `state-archive`'s flags. */
export const STATE_ARCHIVE_FLAG_SPEC = {
  boolean: ["json"],
  value: ["doc", "predecessor", "successor", "archive", "description", "block-file", "successor-summary", "when"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** A parsed `state-amend`. */
export interface StateAmendArgs {
  readonly doc: string;
  readonly handoff: string;
  readonly rows: readonly string[];
  readonly afterRulings: boolean;
  readonly json: boolean;
}

/** A parsed `state-archive`. */
export interface StateArchiveArgs {
  readonly doc: string;
  readonly predecessor: string;
  readonly successor: string;
  /** The archive's file name, placed under `<doc dir>/archive/`. */
  readonly archive: string;
  readonly description: string;
  readonly blockFile: string;
  /**
   * The DERIVED successor summary that goes in beside the block.
   *
   * Required, and verified rather than trusted. The boot block is shift mechanics; measured over eleven
   * handoffs it carries no statement of what the owner wants to be true, which is the gap the owner
   * named. So the archive step — the one moment every handover passes through — will not take a block
   * without a summary `slopweaver supervisor successor-summary` derived and sealed.
   */
  readonly successorSummary: string;
  readonly when: string | undefined;
  readonly json: boolean;
}

/** A parsed `state-fold`. */
export interface StateFoldArgs {
  readonly doc: string;
  readonly handoff: string;
  /** How many of the block's newest shift rows stay; every older one is folded. */
  readonly keep: number;
  /** The archive's file name, placed under `<doc dir>/archive/`. */
  readonly archive: string;
  readonly description: string;
  readonly when: string | undefined;
  readonly json: boolean;
}

/**
 * Take every `--row <value>` pair out of an argv tail, keeping each value VERBATIM — a row routinely opens with
 * `- `, which the shared repeated-flag helpers would read as a flag and skip.
 *
 * @param rest the argv tail
 * @returns the rows in order and the tail without them, or the refusal
 */
export function extractRows({
  rest,
}: {
  rest: readonly string[];
}): Result<{ readonly rows: readonly string[]; readonly remainder: readonly string[] }, SupervisorError> {
  const rows: string[] = [];
  const remainder: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (token.startsWith("--row=")) {
      rows.push(token.slice("--row=".length));
    } else if (token === "--row") {
      const value = rest[index + 1];
      if (value === undefined) {
        return err(SupervisorErrors.rowValueMissing());
      }
      rows.push(value);
      index += 1;
    } else {
      remainder.push(token);
    }
  }
  return ok({ remainder, rows });
}

/**
 * Refuse a handoff number that is not a plain positive integer.
 *
 * @param value the raw flag value
 * @param flag the flag name, for the refusal
 * @param errors the accumulator
 * @returns the value when valid, else `undefined`
 */
function handoffNumber({
  value,
  flag,
  errors,
}: {
  value: string | undefined;
  flag: string;
  errors: string[];
}): string | undefined {
  if (value === undefined) {
    errors.push(`${flag} is required`);
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    errors.push(`${flag} must be a handoff number like 249, not "${value}"`);
    return undefined;
  }
  return value;
}

/**
 * Require one value flag.
 *
 * @param value the raw flag value
 * @param flag the flag name, for the refusal
 * @param errors the accumulator
 * @returns the value when present, else `undefined`
 */
function required({
  value,
  flag,
  errors,
}: {
  value: string | undefined;
  flag: string;
  errors: string[];
}): string | undefined {
  if (value === undefined || value.length === 0) {
    errors.push(`${flag} is required`);
    return undefined;
  }
  return value;
}

/**
 * Parse `state-amend`'s argv tail.
 *
 * @param rest the argv after `supervisor state-amend`
 * @returns the parsed arguments, or every rejection
 */
export function parseStateAmendArgs({ rest }: { rest: readonly string[] }): Result<StateAmendArgs> {
  const extracted = extractRows({ rest });
  if (extracted.isErr()) {
    return err(supervisorErrorLines({ error: extracted.error }));
  }
  const parsed = parseFlagTail({
    rest: extracted.value.remainder,
    spec: { boolean: STATE_AMEND_FLAG_SPEC.boolean, value: ["doc", "handoff"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const doc = required({ errors, flag: "--doc", value: values["doc"] });
  const handoff = handoffNumber({ errors, flag: "--handoff", value: values["handoff"] });
  if (extracted.value.rows.length === 0) {
    errors.push("at least one --row is required");
  }
  if (doc === undefined || handoff === undefined || errors.length > 0) {
    return err(errors);
  }
  return ok({
    afterRulings: flags.has("after-rulings"),
    doc,
    handoff,
    json: flags.has("json"),
    rows: extracted.value.rows,
  });
}

/**
 * Refuse an archive name that could escape `archive/` or is not a markdown file.
 *
 * @param value the raw `--archive` value
 * @param errors the accumulator
 * @returns the name when valid, else `undefined`
 */
function archiveName({ value, errors }: { value: string | undefined; errors: string[] }): string | undefined {
  const name = required({ errors, flag: "--archive", value });
  if (name === undefined) {
    return undefined;
  }
  if (/[/\\`\r\n\0]/.test(name) || name.startsWith(".") || !name.endsWith(".md")) {
    errors.push(
      `--archive must be a plain file name ending .md, placed under the doc's archive/ directory — not "${name}"`,
    );
    return undefined;
  }
  return name;
}

/**
 * Parse `state-archive`'s argv tail.
 *
 * @param rest the argv after `supervisor state-archive`
 * @returns the parsed arguments, or every rejection
 */
export function parseStateArchiveArgs({ rest }: { rest: readonly string[] }): Result<StateArchiveArgs> {
  const parsed = parseFlagTail({ rest, spec: STATE_ARCHIVE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const doc = required({ errors, flag: "--doc", value: values["doc"] });
  const predecessor = handoffNumber({ errors, flag: "--predecessor", value: values["predecessor"] });
  const successor = handoffNumber({ errors, flag: "--successor", value: values["successor"] });
  const archive = archiveName({ errors, value: values["archive"] });
  const description = required({ errors, flag: "--description", value: values["description"] });
  const blockFile = required({ errors, flag: "--block-file", value: values["block-file"] });
  const successorSummary = required({ errors, flag: "--successor-summary", value: values["successor-summary"] });
  const complete =
    doc !== undefined &&
    predecessor !== undefined &&
    successor !== undefined &&
    archive !== undefined &&
    description !== undefined &&
    blockFile !== undefined &&
    successorSummary !== undefined;
  if (!complete || errors.length > 0) {
    return err(errors);
  }
  return ok({
    archive,
    blockFile,
    description,
    doc,
    json: flags.has("json"),
    predecessor,
    successor,
    successorSummary,
    when: values["when"],
  });
}

/**
 * Refuse a keep count that is not a plain non-negative integer.
 *
 * @param value the raw `--keep` value
 * @param errors the accumulator
 * @returns the count when valid, else `undefined`
 */
function keepCount({ value, errors }: { value: string | undefined; errors: string[] }): number | undefined {
  const raw = required({ errors, flag: "--keep", value });
  if (raw === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9]\d{0,5})$/.test(raw)) {
    errors.push(`--keep must be how many of the newest rows stay, a whole number like 10, not "${raw}"`);
    return undefined;
  }
  return Number(raw);
}

/**
 * Parse `state-fold`'s argv tail.
 *
 * @param rest the argv after `supervisor state-fold`
 * @returns the parsed arguments, or every rejection
 */
export function parseStateFoldArgs({ rest }: { rest: readonly string[] }): Result<StateFoldArgs> {
  const parsed = parseFlagTail({ rest, spec: STATE_FOLD_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const doc = required({ errors, flag: "--doc", value: values["doc"] });
  const handoff = handoffNumber({ errors, flag: "--handoff", value: values["handoff"] });
  const keep = keepCount({ errors, value: values["keep"] });
  const archive = archiveName({ errors, value: values["archive"] });
  const description = required({ errors, flag: "--description", value: values["description"] });
  const complete =
    doc !== undefined &&
    handoff !== undefined &&
    keep !== undefined &&
    archive !== undefined &&
    description !== undefined;
  if (!complete || errors.length > 0) {
    return err(errors);
  }
  return ok({ archive, description, doc, handoff, json: flags.has("json"), keep, when: values["when"] });
}
