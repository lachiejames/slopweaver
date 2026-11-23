/**
 * `slopweaver hand line-retire` — retire an unreadable register line whose step a later, readable line settled, so
 * the "line(s) would not read" gap every reader reports closes where it is PROVEN closed and nowhere else.
 *
 * MEASURED: a home carried through a one-off sanitiser left three posted lines that no longer parse (a step id and a
 * board-row slug rewritten to contain `Product 1`), each settled by a readable line after it, and `automation status`
 * printed the same unclosable ISSUE on every run. The register is append-only, so the repair is a sidecar row the
 * reader honours while the bytes still match (`../../../hand/lineRetirement.ts`), never an edit.
 *
 * Bare is a read-only preview; `--apply` carries the digest the preview printed and is refused when the register moved.
 */

import type { RetirementPlan } from "../../../hand/lineRetirement.js";
import {
  applyLineRetirements,
  type LineRetireApplied,
  previewLineRetirements,
} from "../../../hand/lineRetirementApply.js";
import { grantSessionId } from "../../../hatch/grantSession.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { flag, type HandDeps, productionHandDeps, resolvedHomeOf } from "./deps.js";
import { parseHandLineRetireArgs } from "./lineRetireArgs.js";
import { HAND_LINE_RETIRE_USAGE } from "./lineRetireUsage.js";

/** A register digest as the preview prints it. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * The exact apply command a preview prints, naming `--home` only when the preview was given one.
 *
 * @param sourceSha256 the digest the preview read
 * @param home the `--home` the preview was given, if any
 * @returns the command line
 */
export function applyCommandOf({ sourceSha256, home }: { sourceSha256: string; home: string | undefined }): string {
  const homePart = home === undefined ? "" : ` --home ${JSON.stringify(home)}`;
  return `slopweaver hand line-retire --apply --source-sha256 ${sourceSha256} --reason "<why>"${homePart}`;
}

/**
 * The human lines a plan prints: each eligible line, each refused one with why, and the lines already retired.
 *
 * @returns the lines, in register order within each group
 */
export function planLines({ plan }: { plan: RetirementPlan }): readonly string[] {
  return [
    ...plan.eligible.map(
      (line) =>
        `  eligible  line ${String(line.lineNumber)}  step ${JSON.stringify(line.stepId)} settled by line ${String(line.settledByLine)}`,
    ),
    ...plan.refused.map((line) => `  refused   line ${String(line.lineNumber)}  ${line.why}`),
    ...(plan.alreadyRetired.length === 0 ? [] : [`  already retired: line(s) ${plan.alreadyRetired.join(", ")}`]),
  ];
}

/**
 * The visible session an apply records, or `null` outside one.
 *
 * @param env the environment the session id is read from
 * @returns the session id, or `null`
 */
function sessionOf({ env }: { env: Readonly<Record<string, string | undefined>> }): string | null {
  const visible = grantSessionId({ env });
  if (visible === undefined || visible.trim().length === 0) {
    return null;
  }
  return visible;
}

/**
 * Print the read-only preview.
 *
 * @param home the state home
 * @param homeFlag the `--home` the caller passed, for the apply command
 * @param json whether to print one JSON document
 * @returns the exit code
 */
function runPreview({
  deps,
  home,
  homeFlag,
  json,
}: {
  deps: HandDeps;
  home: string;
  homeFlag: string | undefined;
  json: boolean;
}): number {
  const preview = previewLineRetirements({ home });
  if (preview.isErr()) {
    deps.writeDiagnostic(`hand line-retire: ${preview.error.message}`);
    return EXIT_ERROR;
  }
  const { path, plan, sourceSha256 } = preview.value;
  const applyCommand = plan.eligible.length === 0 ? null : applyCommandOf({ home: homeFlag, sourceSha256 });
  if (json) {
    deps.writeOut(JSON.stringify({ ...plan, applyCommand, path, sourceSha256 }));
    return EXIT_OK;
  }
  deps.writeOut(`hand line-retire: preview of ${path}`);
  deps.writeOut(`  sourceSha256 ${sourceSha256}`);
  planLines({ plan }).forEach((line) => {
    deps.writeOut(line);
  });
  if (applyCommand === null) {
    deps.writeOut("  nothing is provably settled, so there is nothing to retire");
    return EXIT_OK;
  }
  deps.writeOut(`  apply with: ${applyCommand}`);
  return EXIT_OK;
}

/**
 * Run `hand line-retire` against injected seams.
 *
 * @param rest the argv tail after `hand line-retire`
 * @param deps everything the verb touches outside itself
 * @param env the environment the recording session is read from
 * @returns the process exit code
 */
export function runHandLineRetire({
  rest,
  deps,
  env,
}: {
  rest: readonly string[];
  deps: HandDeps;
  env: Readonly<Record<string, string | undefined>>;
}): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(HAND_LINE_RETIRE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandLineRetireArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(HAND_LINE_RETIRE_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = resolvedHomeOf({ values });
  const json = values["json"] === true;
  const sourceSha256 = flag({ name: "source-sha256", values });
  const reason = flag({ name: "reason", values });
  if (values["apply"] !== true) {
    if (sourceSha256 !== undefined || reason !== undefined) {
      deps.writeDiagnostic("hand line-retire: --source-sha256 and --reason go with --apply");
      deps.writeDiagnostic(HAND_LINE_RETIRE_USAGE);
      return EXIT_USAGE;
    }
    return runPreview({ deps, home, homeFlag: flag({ name: "home", values }), json });
  }
  if (sourceSha256 === undefined || !SHA256_HEX.test(sourceSha256) || reason === undefined || reason.trim() === "") {
    deps.writeDiagnostic(
      "hand line-retire: --apply needs the preview's --source-sha256 (64 lowercase hex) and a non-empty --reason",
    );
    deps.writeDiagnostic(HAND_LINE_RETIRE_USAGE);
    return EXIT_USAGE;
  }
  const applied = applyLineRetirements({
    bySession: sessionOf({ env }),
    home,
    nowIso: deps.now(),
    reason: reason.trim(),
    sourceSha256,
  });
  if (applied.isErr()) {
    deps.writeDiagnostic(`hand line-retire: ${applied.error.message}`);
    return applied.error.code === "NOTHING_ELIGIBLE" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  return reportApplied({ applied: applied.value, deps, json });
}

/**
 * Print what an apply wrote and what the read-back found.
 *
 * @param applied the apply's result
 * @param deps the injected seams
 * @param json whether to print one JSON document
 * @returns the exit code
 */
function reportApplied({ applied, deps, json }: { applied: LineRetireApplied; deps: HandDeps; json: boolean }): number {
  const { plan, sidecarPath, unparsedAfter, written } = applied;
  if (json) {
    deps.writeOut(JSON.stringify({ refused: plan.refused, sidecarPath, unparsedAfter, written }));
    return EXIT_OK;
  }
  deps.writeOut(`hand line-retire: retired ${String(written.length)} line(s) in ${sidecarPath}`);
  written.forEach((row) => {
    deps.writeOut(
      `  retired   line ${String(row.lineNumber)}  step ${JSON.stringify(row.stepId)} settled by line ${String(row.settledByLine)}`,
    );
  });
  planLines({ plan: { ...plan, eligible: [] } }).forEach((line) => {
    deps.writeOut(line);
  });
  deps.writeOut(`  read back: ${String(unparsedAfter)} line(s) of the register still do not read`);
  return EXIT_OK;
}

/** `slopweaver hand line-retire`. */
export const handLineRetireCommand = defineCommand({
  run: (argv) => runHandLineRetire({ deps: productionHandDeps(), env: process.env, rest: argv.slice(VERB_ARG_OFFSET) }),
});
