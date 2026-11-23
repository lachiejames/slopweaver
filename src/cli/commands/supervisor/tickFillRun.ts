/**
 * `slopweaver supervisor tick fill` — the effectful shell around `../../../supervisor/tickFill.ts`: find the tick,
 * read the files its flags name, apply the edits, write `tick.json` atomically, and say what close would still
 * refuse. Why the verb exists is in that module's header: the chair wrote this file with jq, and jq is banned.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { applyTickFill, type TickFillEdits, tickFormIssues } from "../../../supervisor/tickFill.js";
import { nextTickNumber } from "../../../supervisor/tickPlan.js";
import {
  type TickWorkflowError,
  TickWorkflowErrors,
  tickWorkflowErrorLines,
} from "../../../supervisor/tickWorkflowErrors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { readJson, readText, TICK_INPUT_FILE } from "./tickFiles.js";
import type { TickFillArgs } from "./tickFillArgs.js";

/** What a fill needs of the tick seams: its two output lanes. */
export interface TickFillDeps {
  readonly scratch: Pick<SupervisorTickDeps["scratch"], "writeOut" | "writeDiagnostic">;
}

/**
 * The tick a fill edits: the one named, or the highest in the seat's directory.
 *
 * @returns the tick's directory, or why there is none
 */
function fillTickDir({ dir, tick }: { dir: string; tick: number | undefined }): Result<string, TickWorkflowError> {
  if (tick !== undefined) {
    return ok(join(dir, `tick-${String(tick)}`));
  }
  if (!existsSync(dir)) {
    return err(TickWorkflowErrors.captureInvalid({ path: dir, reason: "does not exist — run `tick seat` first" }));
  }
  const next = nextTickNumber({ names: readdirSync(dir) });
  if (next === 1) {
    return err(TickWorkflowErrors.captureInvalid({ path: dir, reason: "holds no tick-<n> — run `tick open` first" }));
  }
  return ok(join(dir, `tick-${String(next - 1)}`));
}

/**
 * One file the flags name, read whole, its failure naming the flag.
 *
 * @param flag the flag that named it, for the refusal
 * @returns the text, or the refusal
 */
function textOf({ flag, path }: { flag: string; path: string }): Result<string, TickWorkflowError> {
  return readText({ path }).mapErr((reason) => TickWorkflowErrors.inputInvalid({ issues: [`--${flag} ${reason}`] }));
}

/**
 * A JSON array file of rows, or none when the flag was not passed.
 *
 * @param flag the flag, for the refusal
 * @param path the file, when passed
 * @returns the rows, or the refusal
 */
function rowsFile({
  flag,
  path,
}: {
  flag: string;
  path: string | undefined;
}): Result<readonly unknown[], TickWorkflowError> {
  if (path === undefined) {
    return ok([]);
  }
  return readJson({ path })
    .mapErr((reason) => TickWorkflowErrors.inputInvalid({ issues: [`--${flag} ${reason}`] }))
    .andThen((value) =>
      Array.isArray(value)
        ? ok<readonly unknown[], TickWorkflowError>(value)
        : err(TickWorkflowErrors.inputInvalid({ issues: [`--${flag} ${path}: is not a JSON array of rows`] })),
    );
}

/**
 * An earlier tick's form, for `--carry-from`.
 *
 * @returns the form as fields, or the refusal
 */
function carriedForm({
  dir,
  carryFrom,
}: {
  dir: string;
  carryFrom: number | undefined;
}): Result<Readonly<Record<string, unknown>> | undefined, TickWorkflowError> {
  if (carryFrom === undefined) {
    return ok(undefined);
  }
  const path = join(dir, `tick-${String(carryFrom)}`, TICK_INPUT_FILE);
  return readJson({ path })
    .mapErr((reason) => TickWorkflowErrors.captureInvalid({ path, reason }))
    .andThen((value) =>
      isRecord(value)
        ? ok<Readonly<Record<string, unknown>>, TickWorkflowError>(value)
        : err(TickWorkflowErrors.captureInvalid({ path, reason: "is not a JSON object" })),
    );
}

/**
 * The folds the flags give: their text, or each named file's text with its trailing newline taken off.
 *
 * @returns the folds, undefined when neither flag was passed, or the refusal
 */
function foldsOf({ args }: { args: TickFillArgs }): Result<readonly string[] | undefined, TickWorkflowError> {
  if (args.foldFiles === undefined) {
    return ok(args.folds);
  }
  const folds: string[] = [];
  for (const path of args.foldFiles) {
    const text = textOf({ flag: "fold-file", path });
    if (text.isErr()) return err(text.error);
    folds.push(text.value.replace(/\n+$/u, ""));
  }
  return ok(folds);
}

/**
 * The shift edit with any file read.
 *
 * @returns the shift line, `null` for the quiet line, undefined when untouched, or the refusal
 */
function shiftOf({ args }: { args: TickFillArgs }): Result<string | null | undefined, TickWorkflowError> {
  const { shift } = args;
  if (shift === undefined || shift === null) {
    return ok(shift);
  }
  if ("text" in shift) {
    return ok(shift.text);
  }
  return textOf({ flag: "shift-file", path: shift.file }).map((text) => text.replace(/\n+$/u, ""));
}

/**
 * Every edit the invocation makes, with each file it names read.
 *
 * @returns the edits, or the first file that would not read
 */
function editsOf({ args, dir }: { args: TickFillArgs; dir: string }): Result<TickFillEdits, TickWorkflowError> {
  return carriedForm({ carryFrom: args.carryFrom, dir }).andThen((carried) =>
    foldsOf({ args }).andThen((folds) =>
      shiftOf({ args }).andThen((shift) =>
        rowsFile({ flag: "actions", path: args.actionsFile }).andThen((actions) =>
          rowsFile({ flag: "judgements", path: args.judgementsFile }).map((judgements): TickFillEdits => ({
            actions,
            alignmentDetails: args.alignmentDetails,
            alignmentSummary: args.alignmentSummary,
            carried,
            dropActions: args.dropActions,
            dropCards: args.dropCards,
            dropJudgements: args.dropJudgements,
            earlierSummary: args.earlierSummary,
            foldAt: args.foldAt,
            folds,
            foldSummary: args.foldSummary,
            headline: args.headline,
            judgements,
            lede: args.lede,
            openPagesReviewed: args.openPagesReviewed,
            shift,
            sleeping: args.sleeping,
          })),
        ),
      ),
    ),
  );
}

/**
 * `tick fill`: edit the tick file in place, or refuse with nothing written.
 *
 * @param args the parsed invocation
 * @param deps the output lanes, the one seam a fill uses
 * @returns the exit code
 */
export function runFill({ args, deps }: { args: TickFillArgs; deps: TickFillDeps }): number {
  const refuse = (error: TickWorkflowError): number => {
    for (const line of tickWorkflowErrorLines({ error })) {
      deps.scratch.writeDiagnostic(`supervisor tick fill: ${line}`);
    }
    return EXIT_ERROR;
  };
  const dir = resolve(args.dir);
  const tickDir = fillTickDir({ dir, tick: args.tick });
  if (tickDir.isErr()) return refuse(tickDir.error);
  if (args.carryFrom !== undefined && join(dir, `tick-${String(args.carryFrom)}`) === tickDir.value) {
    return refuse(
      TickWorkflowErrors.preflightRefused({
        reasons: [`--carry-from ${String(args.carryFrom)} is the tick being filled — carry from an earlier one`],
        stage: "tick fill",
      }),
    );
  }
  // A close pins the form's hash at its first stage, so an edit after it would leave that close unable to resume.
  if (existsSync(join(tickDir.value, "close-state.json"))) {
    return refuse(
      TickWorkflowErrors.preflightRefused({
        reasons: [`${tickDir.value} already began a close from its form — re-run that close, or open a new tick`],
        stage: "tick fill",
      }),
    );
  }
  const path = join(tickDir.value, TICK_INPUT_FILE);
  const form = readJson({ path }).mapErr((reason) => TickWorkflowErrors.captureInvalid({ path, reason }));
  if (form.isErr()) return refuse(form.error);
  const applied = editsOf({ args, dir }).andThen((edits) => applyTickFill({ edits, form: form.value }));
  if (applied.isErr()) return refuse(applied.error);
  const { changed, form: next } = applied.value;
  if (changed.length === 0) {
    deps.scratch.writeOut(`supervisor tick fill: nothing to change in ${path}`);
  } else {
    writeFileAtomic({ contents: `${JSON.stringify(next, null, 2)}\n`, path });
    deps.scratch.writeOut(`supervisor tick fill: wrote ${path} — ${changed.join(", ")}`);
  }
  const issues = tickFormIssues({ form: next });
  if (issues.length === 0) {
    deps.scratch.writeOut(`  close will take it: slopweaver supervisor tick close --dir ${dir}`);
    return EXIT_OK;
  }
  // A rewrite line is indented under its refusal, and a folds: line is judged without the older notes beside it.
  const refusals = issues.filter((issue) => !issue.startsWith(" ")).length;
  const stricter = issues.some((issue) => issue.startsWith("folds: "))
    ? " (a folds: line can be stricter than close)"
    : "";
  deps.scratch.writeOut(`  close would still refuse ${String(refusals)} issue(s)${stricter}:`);
  for (const issue of issues) {
    deps.scratch.writeOut(`    ${issue}`);
  }
  return EXIT_OK;
}
