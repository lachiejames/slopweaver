/**
 * `slopweaver atlas trelica report [--offboarding] [--json] [--home <dir>]` — where the three surfaces disagree,
 * or, with `--offboarding`, each offboarding workflow's configured behaviour beside its runs and everyone the
 * evidence does not show as cleanly offboarded.
 *
 * A pure read of a generation already on disk: no network call, no browser, no message to anyone, and it
 * resolves NOTHING. Which surface wins a genuine disagreement is the owner's call, reserved until
 * the owner can see real instances (`docs/atlas-intent/04-corroboration.md`), so this prints the instances and stops.
 */
import { splitTrelicaChannels, summariseTrelicaDisagreement } from "../../../atlas/trelica/disagreement.js";
import { heldTrelicaOffboardingInput } from "../../../atlas/trelica/heldDetails.js";
import type { TrelicaAtlasKind, TrelicaAtlasKindFile, TrelicaAtlasManifest } from "../../../atlas/trelica/model.js";
import { trelicaOffboardingReport } from "../../../atlas/trelica/offboardingEvidence.js";
import {
  readTrelicaAtlas,
  readTrelicaKindFile,
  type TrelicaAtlasSnapshot,
  trelicaAtlasPaths,
} from "../../../atlas/trelica/store.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { parseTrelicaReportOptions, TRELICA_REPORT_USAGE, TRELICA_VERB_INDEX } from "./core.js";
import { type TrelicaOffboardingInputState, trelicaOffboardingLines } from "./offboardingLines.js";

/** The report's four edges: a stored kind file, a whole snapshot, and the two output channels. */
export interface TrelicaAtlasReportDeps {
  /** Read one stored kind file under a home; `null` when no generation has been published. */
  readonly readKind: (args: { home: string; kind: TrelicaAtlasKind }) => Result<TrelicaAtlasKindFile | null>;
  /** Read the whole generation under a home, manifest and every kind file, as one validated snapshot. */
  readonly readSnapshot: (args: { home: string }) => Result<TrelicaAtlasSnapshot>;
  /** Write one line of report data to stdout. */
  readonly out: (args: { line: string }) => void;
  /** Write one diagnostic line to stderr. */
  readonly error: (args: { msg: string }) => void;
}

/** The message for a home with no generation in it. */
const NO_GENERATION = "no trelica generation has been published — run: slopweaver atlas trelica refresh";

/** The kinds the offboarding view is built from. */
const OFFBOARDING_INPUT_KINDS = ["person", "workflow", "workflow-run"] as const satisfies readonly TrelicaAtlasKind[];

/** How fresh each input kind is, off the manifest. */
function inputStates({ manifest }: { manifest: TrelicaAtlasManifest }): TrelicaOffboardingInputState[] {
  return OFFBOARDING_INPUT_KINDS.map((kind) => {
    const { lastAttempt, lastSuccessAt } = manifest.kinds[kind];
    return {
      kind,
      lastSuccessAt,
      latestAttemptFailed: lastAttempt?.outcome === "failed" ? lastAttempt.reasons : null,
    };
  });
}

/** Print each line of a failure as its own diagnostic. */
function reportErrors({ deps, lines }: { deps: TrelicaAtlasReportDeps; lines: readonly string[] }): void {
  lines.forEach((line) => {
    deps.error({ msg: line });
  });
}

/**
 * Why the view cannot be built over these inputs, first failing check only, or nothing when it can. Each check fails
 * closed: a kind never read whole, a file the generation does not vouch for, and a kind whose latest read failed —
 * the last because a view mixing this sync's statuses with an older sync's step evidence would name, or miss, a
 * leaver on evidence that is no longer current.
 */
function inputRefusals({
  inputs,
  manifest,
  untrusted,
  unpublished,
}: {
  inputs: readonly TrelicaOffboardingInputState[];
  manifest: TrelicaAtlasManifest;
  untrusted: readonly TrelicaAtlasKind[];
  unpublished: readonly TrelicaAtlasKind[];
}): readonly string[] {
  const isInput = (kind: string): boolean => OFFBOARDING_INPUT_KINDS.some((input) => input === kind);
  const neverWhole = unpublished.filter(isInput).map((kind) => {
    const attempt = manifest.kinds[kind].lastAttempt;
    const why = attempt === null ? "no attempt is recorded" : `its latest attempt said: ${attempt.reasons.join("; ")}`;
    return `${kind} has never been read whole, so the view would rest on a partial read — ${why}`;
  });
  if (neverWhole.length > 0) {
    return neverWhole;
  }
  const unvouched = [...new Set(untrusted.filter(isInput))];
  if (unvouched.length > 0) {
    return [
      `the generation does not vouch for ${unvouched.join(", ")} — the files on disk are not the ones its manifest ` +
        `published; run: slopweaver atlas trelica refresh`,
    ];
  }
  return inputs.flatMap((input) =>
    input.latestAttemptFailed === null
      ? []
      : [
          `${input.kind}'s latest read failed, so the view would rest on older evidence — it said: ` +
            `${input.latestAttemptFailed.join("; ")}; run: slopweaver atlas trelica sync`,
        ],
  );
}

/** The `--offboarding` view: the joined people, workflow and run evidence. */
function runOffboarding({
  asJson,
  deps,
  home,
}: {
  asJson: boolean;
  deps: TrelicaAtlasReportDeps;
  home: string;
}): number {
  const snapshot = deps.readSnapshot({ home });
  if (snapshot.isErr()) {
    reportErrors({ deps, lines: snapshot.error });
    return EXIT_ERROR;
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    deps.error({ msg: NO_GENERATION });
    return EXIT_EXPECTED_EMPTY;
  }
  const inputs = inputStates({ manifest });
  const refusals = inputRefusals({
    inputs,
    manifest,
    untrusted: [...missing, ...mismatched, ...superseded],
    unpublished,
  });
  if (refusals.length > 0) {
    reportErrors({ deps, lines: refusals });
    return EXIT_ERROR;
  }
  const report = trelicaOffboardingReport({
    asOf: manifest.updatedAt,
    input: heldTrelicaOffboardingInput({
      people: files.person,
      runs: files["workflow-run"],
      workflows: files.workflow,
    }),
  });
  if (asJson) {
    deps.out({ line: JSON.stringify({ inputs, ...report }, null, 1) });
    return EXIT_OK;
  }
  trelicaOffboardingLines({ inputs, report }).forEach((line) => {
    deps.out({ line });
  });
  return EXIT_OK;
}

/**
 * Run the Trelica report against injected edges.
 *
 * @param argv the whole process argv
 * @param deps where the kind files are read from and where the lines go
 * @returns the process exit code
 */
export function runTrelicaAtlasReport({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: TrelicaAtlasReportDeps;
}): number {
  const rest = verbTail({ argv, at: TRELICA_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: TRELICA_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseTrelicaReportOptions({ rest });
  if (options.isErr()) {
    reportErrors({ deps, lines: [...options.error, TRELICA_REPORT_USAGE] });
    return EXIT_USAGE;
  }
  const { home, json: asJson, offboarding } = options.value;
  if (offboarding) {
    return runOffboarding({ asJson, deps, home });
  }
  const file = deps.readKind({ home, kind: "method" });
  if (file.isErr()) {
    reportErrors({ deps, lines: file.error });
    return EXIT_ERROR;
  }
  if (file.value === null) {
    deps.error({ msg: NO_GENERATION });
    return EXIT_EXPECTED_EMPTY;
  }
  const split = splitTrelicaChannels({ entities: file.value.entities });
  if (asJson) {
    deps.out({ line: JSON.stringify(split, null, 1) });
    return EXIT_OK;
  }
  summariseTrelicaDisagreement({ split }).forEach((line) => {
    deps.out({ line });
  });
  return EXIT_OK;
}

/**
 * Run the Trelica report.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function trelicaAtlasReportCommand(argv: readonly string[]): number {
  return runTrelicaAtlasReport({
    argv,
    deps: {
      error: ({ msg }) => {
        logger.error({ msg });
      },
      out: ({ line }) => {
        logger.out({ line });
      },
      readKind: ({ home, kind }) => readTrelicaKindFile({ kind, paths: trelicaAtlasPaths({ home }) }),
      readSnapshot: ({ home }) => readTrelicaAtlas({ paths: trelicaAtlasPaths({ home }) }),
    },
  });
}
