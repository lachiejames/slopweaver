/**
 * Pure argument and output handling for `slopweaver linear briefing build`. The shell (`./briefingRun.ts`) reads
 * the form and writes what {@link briefingBundleWrites} returns; every decision is here, bar the evidence floor,
 * which `./briefingFloor.ts` derives.
 */
import { join, resolve } from "node:path";

import { err, ok, type Result } from "../../../lib/result.js";
import { renderLinearBriefingPage } from "../../../outbound/linear/briefingPage.js";
import { type LinearBriefingBundle, planLinearBriefingBundle } from "../../../outbound/linear/briefingPlan.js";
import { linearBriefingFormSchema } from "../../../outbound/linear/briefingSchema.js";
import type { LinearBriefingForm } from "../../../outbound/linear/briefingTypes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { NUMBERED_FORM } from "./briefingFloor.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

const BRIEFING_FLAGS: FlagSpec = { boolean: ["json"], string: ["form", "out"] };

/** Every accepted flag, WITH the `--`, derived from the exact spec passed to the parser. */
export const LINEAR_BRIEFING_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BRIEFING_FLAGS }),
  ...booleanFlagsOf({ spec: BRIEFING_FLAGS }),
].map((name) => `--${name}`);

/** A parsed `linear briefing build` invocation. */
export interface LinearBriefingArgs {
  readonly formSource: string;
  /** Absolute, so every printed command names its form from anywhere. */
  readonly outDir: string;
  readonly json: boolean;
}

/**
 * Parse `linear briefing build --form <json|-> --out <dir> [--json]`.
 *
 * @param argv the arguments after `linear briefing`
 * @param cwd what a relative `--out` resolves against
 * @returns the parsed arguments, or the usage problem found
 */
export function parseLinearBriefingArgs({
  argv,
  cwd,
}: {
  argv: readonly string[];
  cwd: string;
}): Result<LinearBriefingArgs, LinearVerbError> {
  if (argv[0] !== "build") {
    return err(LinearVerbErrors.usage({ noun: "briefing", shape: "build" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: BRIEFING_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const form = values["form"];
  const out = values["out"];
  const problems = [
    ...(typeof form === "string" ? [] : ["--form <json|-> is required (use `-` to read the briefing from stdin)"]),
    ...(typeof out === "string" && out.length > 0 ? [] : ["--out <dir> is required: the bundle directory"]),
  ];
  if (typeof form !== "string" || typeof out !== "string" || problems.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: problems }));
  }
  // `resolve` normalises an absolute path too: `<root>/<day>/.` must find its siblings under `<root>`.
  return ok({ formSource: form, json: values["json"] === true, outDir: resolve(cwd, out) });
}

/**
 * Validate a briefing's JSON text.
 *
 * @param raw the JSON text of the briefing
 * @returns the typed briefing, or one line per rejection naming its path
 */
export function parseLinearBriefingForm({ raw }: { raw: string }): Result<LinearBriefingForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearBriefingFormSchema });
}

/**
 * One file the bundle writes, by absolute path.
 *
 * @internal
 */
export interface LinearBriefingFileWrite {
  readonly path: string;
  readonly contents: string;
}

/** What the shell writes, and the plan it came from. */
export interface LinearBriefingBuild {
  readonly bundle: LinearBriefingBundle;
  readonly writes: readonly LinearBriefingFileWrite[];
  /** The file names `forms/` should hold afterwards, so the shell removes any other numbered form there. */
  readonly formNames: ReadonlySet<string>;
}

/**
 * Every file one briefing's bundle consists of: the validated briefing itself, each form, the apply plan, the
 * doc section and the page fragment.
 *
 * @param form the validated briefing
 * @param outDir the absolute bundle directory
 * @returns the plan and the exact writes it implies
 */
export function briefingBundleWrites({
  form,
  outDir,
}: {
  form: LinearBriefingForm;
  outDir: string;
}): LinearBriefingBuild {
  const bundle = planLinearBriefingBundle({ form, outDir });
  const writes: LinearBriefingFileWrite[] = [
    { contents: `${JSON.stringify(form, null, 2)}\n`, path: join(outDir, "briefing.json") },
    ...bundle.files.map((file) => ({ contents: file.contents, path: join(outDir, file.name) })),
    { contents: `${JSON.stringify({ items: bundle.items }, null, 2)}\n`, path: join(outDir, "apply.json") },
    { contents: bundle.onOwnerWord, path: join(outDir, "on-the-owners-word.md") },
    { contents: renderLinearBriefingPage({ form }), path: join(outDir, "page.html") },
  ];
  const formNames = new Set(bundle.files.map((file) => file.name.slice("forms/".length)));
  return { bundle, formNames, writes };
}

/**
 * The numbered forms in `forms/` that this briefing no longer contains, so a stale item can never be applied.
 *
 * @param present the file names `forms/` holds now
 * @param keep the file names this briefing writes
 * @returns the names to remove
 */
export function staleFormNames({
  present,
  keep,
}: {
  present: readonly string[];
  keep: ReadonlySet<string>;
}): readonly string[] {
  return present.filter((name) => NUMBERED_FORM.test(name) && !keep.has(name));
}

/**
 * The text report: counts, where the page and doc section landed, and every step's dry run to check first.
 *
 * @param build what was written
 * @param carried the earlier unapplied briefings this one re-proposes, from `heldSinceFloor`
 * @param outDir the bundle directory
 * @param removed the stale forms removed
 * @returns one line per row of the report
 */
export function briefingReportLines({
  build,
  carried,
  outDir,
  removed,
}: {
  build: LinearBriefingBuild;
  carried: readonly string[];
  outDir: string;
  removed: readonly string[];
}): readonly string[] {
  const { items } = build.bundle;
  const high = items.filter((item) => item.confidence === "high").length;
  const steps = items.flatMap((item) => item.steps);
  return [
    `linear briefing: ${String(items.length)} item(s), ${String(high)} high and ${String(items.length - high)} low, ` +
      `${String(steps.length)} write(s) → ${outDir}`,
    `  page fragment: ${join(outDir, "page.html")}`,
    `  On their word:   ${join(outDir, "on-the-owners-word.md")}`,
    ...(carried.length === 0
      ? []
      : [`  carries ${String(carried.length)} unapplied briefing(s) since the floor: ${carried.join(", ")}`]),
    ...(removed.length === 0 ? [] : [`  removed ${String(removed.length)} stale form(s): ${removed.join(", ")}`]),
    ...(steps.length === 0 ? [] : ["  dry-run every step before the card is registered:"]),
    ...steps.map((step) => `    ${step.dryRun}`),
  ];
}

/**
 * The `--json` report.
 *
 * @param build what was written
 * @param carried the earlier unapplied briefings this one re-proposes
 * @param outDir the bundle directory
 * @param removed the stale forms removed
 * @returns one JSON document
 */
export function briefingReportJson({
  build,
  carried,
  outDir,
  removed,
}: {
  build: LinearBriefingBuild;
  carried: readonly string[];
  outDir: string;
  removed: readonly string[];
}): string {
  return JSON.stringify({
    carried,
    items: build.bundle.items,
    onOwnerWord: join(outDir, "on-the-owners-word.md"),
    outDir,
    page: join(outDir, "page.html"),
    removed,
  });
}
