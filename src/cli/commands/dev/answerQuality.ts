/**
 * `slopweaver dev answer-quality` — grade a candidate answer against a frozen golden's rubric, or run the
 * ordering properties that prove the scorer is not measuring surface similarity.
 *
 * The OFFLINE eval lane. Its sibling `src/admit/answerQualityGate.ts` judges an outbound form before it is
 * sent; this reads two files and prints. Nothing here calls a model, reaches a network or writes anything.
 *
 * **GRADING gates nothing; the SELFTEST does.** The ordering properties are wired into
 * `dev gate` as its `answer-quality` check (`src/devGate/answerQualityCheck.ts`) — they are a claim the
 * instrument makes about itself, which is what a gate is for. A grade out of `--candidates` is still a
 * number nobody has agreed to treat as a bar, and should stay one.
 *
 * Effectful shell only: it reads two paths, logs, and — under `--artifact` alone — writes one markdown file.
 * Every grade, every property, every rendered line and the whole redaction is
 * {@link ../../../eval/answerQuality/score}, {@link ../../../eval/answerQuality/selftest},
 * {@link ../../../eval/answerQuality/artifact} and {@link ./answerQualityCore}.
 *
 * The one write is deliberately the exception rather than the default: it publishes a run over goldens the
 * reader of the artifact may not be allowed to see, so the builder MINTS every label it prints rather than
 * passing an authored one through, and the hygiene scanner reads the rendered bytes back before anything
 * reaches disk. A hit writes nothing at all, rather than a partial file.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Logger, logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { buildPerCaseArtifact, renderPerCaseArtifact } from "../../../eval/answerQuality/artifact.js";
import {
  type AnswerCandidate,
  type AnswerQualityCase,
  loadAnswerCandidates,
  loadAnswerQualityCases,
} from "../../../eval/answerQuality/caseSchema.js";
import { type AnswerQualityError, AnswerQualityErrors } from "../../../eval/answerQuality/errors.js";
import { type AnswerGrade, scoreAnswer } from "../../../eval/answerQuality/score.js";
import { type PropertyOutcome, runSelftest, selftestFailed } from "../../../eval/answerQuality/selftest.js";
import { loadDenylist, scanContent } from "../../../hygiene/scan.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  type AnswerQualityScope,
  DEV_ANSWER_QUALITY_USAGE,
  parseDevAnswerQualityArgs,
  renderGrades,
  renderSelftest,
  scopeFromFlags,
} from "./answerQualityCore.js";

/** Read a file, reporting the path rather than node's errno prose. */
function readOrReport({ path }: { path: string }): Result<string, AnswerQualityError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch {
    return err(AnswerQualityErrors.fileUnreadable({ path }));
  }
}

/** Grade every candidate, refusing one whose `caseId` names no case in the file. */
function gradeAll({
  cases,
  candidates,
}: {
  cases: readonly AnswerQualityCase[];
  candidates: readonly AnswerCandidate[];
}): Result<readonly AnswerGrade[], AnswerQualityError> {
  const orphan = candidates.find((candidate) => !cases.some((answerCase) => answerCase.id === candidate.caseId));
  if (orphan !== undefined) {
    return err(AnswerQualityErrors.unknownCase({ candidateLabel: orphan.label, caseId: orphan.caseId }));
  }
  return ok(
    candidates.map((candidate) =>
      scoreAnswer({ answerCase: cases.find((entry) => entry.id === candidate.caseId)!, candidate }),
    ),
  );
}

/** The grading branch: read the candidates, grade them, print. */
function runGrading({
  cases,
  log,
  scope,
}: {
  cases: readonly AnswerQualityCase[];
  log: Pick<Logger, "error" | "out">;
  scope: AnswerQualityScope;
}): number {
  const path = scope.candidates;
  if (path === undefined) {
    log.error({ msg: "answer-quality: no --candidates path" });
    return EXIT_USAGE;
  }
  const raw = readOrReport({ path });
  if (raw.isErr()) {
    log.error({ msg: raw.error.message });
    return EXIT_ERROR;
  }
  const candidates = loadAnswerCandidates({ label: path, raw: raw.value });
  if (candidates.isErr()) {
    log.error({ msg: candidates.error.join("\n") });
    return EXIT_ERROR;
  }
  const grades = gradeAll({ candidates: candidates.value, cases });
  if (grades.isErr()) {
    log.error({ msg: grades.error.message });
    return EXIT_ERROR;
  }
  if (scope.json) {
    log.out({ line: safeJsonStringify({ label: "answer-quality grades", value: { grades: grades.value } }) });
    return EXIT_OK;
  }
  for (const line of renderGrades({ grades: grades.value })) {
    log.out({ line });
  }
  return EXIT_OK;
}

/**
 * Build, check and write the redacted per-case artifact.
 *
 * Two independent mechanisms stand between a run and a file, and they are complements rather than a belt with
 * a spare. The pure builder publishes closed-union members, numbers and labels it minted itself and has no
 * path that carries an authored string through — which is the leak a pattern could never see, so it is a
 * construction rather than a check that could refuse. The hygiene scanner then reads the RENDERED bytes for
 * every leak class it knows, which is the leak a closed union could never anticipate, and a hit is the one
 * thing that stops the write.
 */
function writeArtifact({
  casesRaw,
  caseCount,
  outcomes,
  path,
}: {
  casesRaw: string;
  caseCount: number;
  outcomes: readonly PropertyOutcome[];
  path: string;
}): Result<readonly string[], AnswerQualityError> {
  const { artifact, mappings } = buildPerCaseArtifact({
    outcomes,
    provenance: {
      caseCount,
      casesBytes: Buffer.byteLength(casesRaw, "utf8"),
      casesSha256: createHash("sha256").update(casesRaw, "utf8").digest("hex"),
    },
  });
  const contents = `${renderPerCaseArtifact({ artifact }).join("\n")}\n`;
  const hits = scanContent({ content: contents, denylist: loadDenylist(), path });
  if (hits.length > 0) {
    return err(AnswerQualityErrors.artifactUnhygienic({ labels: [...new Set(hits.map((hit) => hit.label))] }));
  }
  writeFileAtomic({ contents, path });
  return ok([
    `wrote the redacted per-case artifact to ${path}`,
    `  ${String(artifact.outcomes.length)} outcome(s), cases sha256 ${artifact.provenance.casesSha256}`,
    `  the labels it published stand for these ids — this mapping is yours, and is NOT in the file:`,
    ...mappings.map((mapping) => `    ${mapping.published} = ${mapping.source}`),
  ]);
}

/** The self-test branch: run every ordering property, print, publish it when asked, and fail on any of them. */
function runProperties({
  cases,
  casesRaw,
  log,
  scope,
}: {
  cases: readonly AnswerQualityCase[];
  casesRaw: string;
  log: Pick<Logger, "error" | "out">;
  scope: AnswerQualityScope;
}): number {
  const outcomes = runSelftest({ cases });
  const artifactPath = scope.artifact;
  if (artifactPath !== undefined) {
    const written = writeArtifact({
      caseCount: cases.length,
      casesRaw,
      outcomes,
      path: artifactPath,
    });
    if (written.isErr()) {
      log.error({ msg: written.error.message });
      return EXIT_ERROR;
    }
    for (const line of written.value) {
      log.out({ line });
    }
  }
  if (scope.json) {
    log.out({ line: safeJsonStringify({ label: "answer-quality selftest", value: { outcomes } }) });
  } else {
    for (const line of renderSelftest({ outcomes })) {
      log.out({ line });
    }
  }
  if (selftestFailed({ outcomes })) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Run the answer-quality verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev answer-quality <tail>`)
 * @param log the diagnostic + data sinks
 * @returns EXIT_OK on a completed run, EXIT_ERROR when a file could not be read, an ordering property failed,
 *   or the artifact was refused, EXIT_USAGE on a bad or contradictory flag combination
 */
export function runDevAnswerQualityWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_ANSWER_QUALITY_USAGE });
    return EXIT_OK;
  }
  const flags = parseDevAnswerQualityArgs({ rest });
  if (flags.isErr()) {
    log.error({ msg: [...flags.error, DEV_ANSWER_QUALITY_USAGE].join("\n") });
    return EXIT_USAGE;
  }
  const scope = scopeFromFlags({ flags: flags.value });
  if (scope.isErr()) {
    log.error({ msg: [scope.error.message, DEV_ANSWER_QUALITY_USAGE].join("\n") });
    return EXIT_USAGE;
  }
  const raw = readOrReport({ path: scope.value.cases });
  if (raw.isErr()) {
    log.error({ msg: raw.error.message });
    return EXIT_ERROR;
  }
  const cases = loadAnswerQualityCases({ label: scope.value.cases, raw: raw.value });
  if (cases.isErr()) {
    log.error({ msg: cases.error.join("\n") });
    return EXIT_ERROR;
  }
  if (scope.value.selftest) {
    return runProperties({
      cases: cases.value,
      casesRaw: raw.value,
      log,
      scope: scope.value,
    });
  }
  return runGrading({ cases: cases.value, log, scope: scope.value });
}

/**
 * Run the answer-quality verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev answer-quality <tail>`)
 * @returns the process exit code — see {@link runDevAnswerQualityWithDeps}
 */
export function runDevAnswerQuality(argv: readonly string[]): number {
  return runDevAnswerQualityWithDeps({ argv, log: logger });
}

export const devAnswerQualityCommand = defineCommand({ run: runDevAnswerQuality });
