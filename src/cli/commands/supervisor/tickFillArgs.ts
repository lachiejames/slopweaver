/**
 * The flags of `slopweaver supervisor tick fill`, and what an invocation means. No I/O: `./tickFillRun.ts` reads the
 * files the flags name. Its own module beside `./tickCore.ts`, which dispatches to it, because fill has more flags
 * than the other three subactions together.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import { FOLD_AT_MAX_DIGITS } from "../../../supervisor/tickFoldWording.js";
import { parseFlagTail } from "../../optionParsers.js";
import { repeatedFlagValues } from "../../parseFlags.js";
import { missing, tickNumberOf } from "./tickArgParts.js";

/** The list flags `tick fill` reads off the raw argv, in the order written. */
const FILL_REPEATABLE = [
  "headline-sentence",
  "fold",
  "fold-file",
  "alignment-detail",
  "drop-card",
  "drop-action",
  "drop-judgement",
] as const;

/** Every flag `tick fill` takes, for the parser and the help-truth ratchet. */
export const FILL_FLAG_SPEC = {
  boolean: ["quiet-shift"],
  repeatable: [...FILL_REPEATABLE],
  value: [
    "dir",
    "tick",
    "carry-from",
    "fold-at",
    "fold-summary",
    "lede",
    "alignment-summary",
    "earlier-summary",
    "sleeping",
    "open-pages-reviewed",
    "shift",
    "shift-file",
    "actions",
    "judgements",
    ...FILL_REPEATABLE,
  ],
};

/** A parsed `tick fill`: what to change, files named rather than read — `./tickFillRun.ts` reads them. */
export interface TickFillArgs {
  readonly subaction: "fill";
  readonly dir: string;
  readonly tick: number | undefined;
  readonly carryFrom: number | undefined;
  readonly headline: readonly string[] | undefined;
  readonly folds: readonly string[] | undefined;
  readonly foldFiles: readonly string[] | undefined;
  readonly foldAt: number | undefined;
  readonly foldSummary: string | undefined;
  readonly lede: string | undefined;
  readonly alignmentSummary: string | undefined;
  readonly earlierSummary: string | undefined;
  readonly alignmentDetails: readonly string[] | undefined;
  readonly dropCards: readonly string[] | undefined;
  readonly sleeping: boolean | undefined;
  readonly openPagesReviewed: boolean | undefined;
  /** The shift line as text, a file holding it, or `null` for `--quiet-shift`. */
  readonly shift: { readonly text: string } | { readonly file: string } | null | undefined;
  readonly actionsFile: string | undefined;
  readonly judgementsFile: string | undefined;
  readonly dropActions: readonly string[];
  readonly dropJudgements: readonly string[];
}

/**
 * A `true|false` flag value.
 *
 * @param flag the flag, without its `--`
 * @param raw the value, when passed
 * @returns the boolean, undefined when absent, or a usage refusal
 */
function booleanOf({
  flag,
  raw,
}: {
  flag: string;
  raw: string | undefined;
}): Result<boolean | undefined, ScratchError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (raw !== "true" && raw !== "false") {
    return err(ScratchErrors.usage({ message: `--${flag} ${raw} must be true or false` }));
  }
  return ok(raw === "true");
}

/**
 * A `--fold-at` value as an index.
 *
 * @param raw the value, when passed
 * @returns the index, undefined when absent, or a usage refusal
 */
function foldIndexOf({ raw }: { raw: string | undefined }): Result<number | undefined, ScratchError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (!new RegExp(`^\\d{1,${String(FOLD_AT_MAX_DIGITS)}}$`, "u").test(raw)) {
    return err(ScratchErrors.usage({ message: `--fold-at ${raw} must be a whole number from 0` }));
  }
  return ok(Number(raw));
}

/**
 * The shift edit: text, a file, the quiet line, or none — at most one of the three.
 *
 * @param values the parsed value flags
 * @param quiet whether `--quiet-shift` was passed
 * @returns the edit, or a usage refusal naming the clash
 */
function shiftOf({
  values,
  quiet,
}: {
  values: Readonly<Record<string, string>>;
  quiet: boolean;
}): Result<TickFillArgs["shift"], ScratchError> {
  const text = values["shift"];
  const file = values["shift-file"];
  const given = [text !== undefined, file !== undefined, quiet].filter(Boolean).length;
  if (given > 1) {
    return err(ScratchErrors.usage({ message: "tick fill: --shift, --shift-file and --quiet-shift are one choice" }));
  }
  if (text !== undefined) return ok({ text });
  if (file !== undefined) return ok({ file });
  if (quiet) return ok(null);
  return ok(undefined);
}

/**
 * One repeatable flag's values in the order written, undefined when it was not passed.
 *
 * @param rest the argv after `supervisor tick fill`
 * @returns the values, or undefined
 */
function listOf({
  name,
  rest,
}: {
  name: (typeof FILL_REPEATABLE)[number];
  rest: readonly string[];
}): readonly string[] | undefined {
  const list = repeatedFlagValues({ name, rest });
  return list.length === 0 ? undefined : list;
}

/**
 * The fold edit: `--fold` texts or `--fold-file` paths, never both, and the index `--fold-at` sets them at.
 *
 * @param rest the argv after `supervisor tick fill`
 * @param values the parsed value flags
 * @returns the fold fields, or a usage refusal naming the clash
 */
function foldEditOf({
  rest,
  values,
}: {
  rest: readonly string[];
  values: Readonly<Record<string, string>>;
}): Result<Pick<TickFillArgs, "folds" | "foldFiles" | "foldAt">, ScratchError> {
  const folds = listOf({ name: "fold", rest });
  const foldFiles = listOf({ name: "fold-file", rest });
  if (folds !== undefined && foldFiles !== undefined) {
    return err(ScratchErrors.usage({ message: "tick fill: --fold and --fold-file are one choice per call" }));
  }
  const noFold = folds === undefined && foldFiles === undefined;
  return foldIndexOf({ raw: values["fold-at"] }).andThen((foldAt) =>
    foldAt !== undefined && noFold
      ? err(ScratchErrors.usage({ message: "tick fill: --fold-at names where ONE --fold or --fold-file goes" }))
      : ok({ foldAt, foldFiles, folds }),
  );
}

/**
 * The fill's checked single values: the tick, the carry, both booleans and the shift.
 *
 * @param values the parsed value flags
 * @param quiet whether `--quiet-shift` was passed
 * @returns the fields, or the first usage refusal
 */
function checkedValuesOf({
  values,
  quiet,
}: {
  values: Readonly<Record<string, string>>;
  quiet: boolean;
}): Result<Pick<TickFillArgs, "tick" | "carryFrom" | "sleeping" | "openPagesReviewed" | "shift">, ScratchError> {
  return tickNumberOf({ raw: values["tick"] }).andThen((tick) =>
    tickNumberOf({ raw: values["carry-from"] }).andThen((carryFrom) =>
      booleanOf({ flag: "sleeping", raw: values["sleeping"] }).andThen((sleeping) =>
        booleanOf({ flag: "open-pages-reviewed", raw: values["open-pages-reviewed"] }).andThen((openPagesReviewed) =>
          shiftOf({ quiet, values }).map((shift) => ({ carryFrom, openPagesReviewed, shift, sleeping, tick })),
        ),
      ),
    ),
  );
}

/**
 * Parse `tick fill`'s flags.
 *
 * @param rest the argv after `supervisor tick fill`
 * @returns the invocation, or the first refusal
 */
export function parseFill({ rest }: { rest: readonly string[] }): Result<TickFillArgs, ScratchError> {
  const parsed = parseFlagTail({ rest, spec: FILL_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ScratchErrors.usage({ message: parsed.error.join("; ") }));
  }
  const { values, flags } = parsed.value;
  const dir = values["dir"];
  if (dir === undefined) {
    return err(missing({ flag: "dir", subaction: "fill" }));
  }
  const edits = Object.keys(values).filter((name) => name !== "dir" && name !== "tick");
  // `flags` holds every non-string entry the tail parsed: `--quiet-shift`, and each repeatable list.
  if (edits.length === 0 && flags.size === 0) {
    return err(ScratchErrors.usage({ message: "tick fill: name at least one edit — a fill with none writes nothing" }));
  }
  return foldEditOf({ rest, values }).andThen((foldEdit) =>
    checkedValuesOf({ quiet: flags.has("quiet-shift"), values }).map((checked): TickFillArgs => ({
      ...foldEdit,
      ...checked,
      actionsFile: values["actions"],
      alignmentDetails: listOf({ name: "alignment-detail", rest }),
      alignmentSummary: values["alignment-summary"],
      dir,
      dropActions: repeatedFlagValues({ name: "drop-action", rest }),
      dropCards: listOf({ name: "drop-card", rest }),
      dropJudgements: repeatedFlagValues({ name: "drop-judgement", rest }),
      earlierSummary: values["earlier-summary"],
      foldSummary: values["fold-summary"],
      headline: listOf({ name: "headline-sentence", rest }),
      judgementsFile: values["judgements"],
      lede: values["lede"],
      subaction: "fill",
    })),
  );
}
