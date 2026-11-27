/**
 * Pure parsing and reporting for `slopweaver codex plan|review`.
 *
 * No fs, no clock, no console, no network — the shells ({@link ./run}) do all of that.
 *
 * EVERY BOUND IS A REQUIRED FLAG. There is no default bound, no default byte cap and no default
 * concurrency anywhere in this file, and that is the single most deliberate decision in it. A default a
 * machine caller inherits silently is a habit rather than a bound: it is how a 10-minute review and a
 * 60-minute deep pass end up sharing one accidental number that nobody chose and nobody can defend. Only
 * the caller knows which kind of pass this is.
 *
 * THE STDOUT DOCUMENT IS THE CONTRACT, not the exit code. There is no exit code that can mean "answered,
 * and the answer is BROKEN": 0/1/2/3 are all taken, and a review that finds a real defect SUCCEEDED, so it
 * exits 0. An agent that branches on shell status alone would read a genuine finding as permission to
 * carry on. So {@link codexResultJson} emits every verdict explicitly, and `skills/codex/SKILL.md` tells the
 * consuming agent to read the verdict and the artifact — never the exit status.
 */

import type { CompletedPass } from "../../../codex/orchestrate.js";
import { formatPassOutcomeContext } from "../../../codex/outcomeContext.js";
import { CODEX_MODEL, parseCodexModel, parsePassId } from "../../../codex/profiles.js";
import type { CodexPassId, ReviewProperty } from "../../../codex/types.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type PoolReclaimOutcome, poolReclaimJson } from "./descriptionReviewPoolReclaim.js";
import { type CodexCommandError, CodexCommandErrors } from "./errors.js";
import { scratchReclaimJson } from "./scratchReclaimReport.js";

export const PLAN_USAGE =
  "usage: slopweaver codex plan --pass p1|p2|p3 --task-file <path> --bound-seconds <n> " +
  "[--model <id>] [--repo <dir>] [--home <dir>]";

export const REVIEW_USAGE =
  "usage: slopweaver codex review --pass r1|r2|r3 --base <ref> --bound-seconds <n> --max-diff-bytes <n> " +
  "(--property-id <id> --property <claim> | --properties-file <path>) [--concurrency <n>] " +
  "[--model <id>] [--repo <dir>] [--home <dir>]";

/**
 * Validate a parsed properties file.
 *
 * @param parsed the parsed JSON
 * @returns the properties, or why the file was rejected — every invalid entry, once the file's shape is right
 */
export function validatePropertiesFile({
  parsed,
}: {
  parsed: unknown;
}): Result<readonly ReviewProperty[], CodexCommandError> {
  if (!isRecord(parsed)) {
    return err(CodexCommandErrors.propertiesNotObject());
  }
  const raw = parsed["properties"];
  if (!Array.isArray(raw) || raw.length === 0) {
    return err(CodexCommandErrors.propertiesEmpty());
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  const properties: ReviewProperty[] = [];
  raw.forEach((entry, index) => {
    const id = isRecord(entry) && typeof entry["id"] === "string" ? entry["id"] : "";
    const statement = isRecord(entry) && typeof entry["statement"] === "string" ? entry["statement"] : "";
    if (id.length === 0 || !/^[\w.-]+$/.test(id)) {
      errors.push(`properties[${String(index)}].id must be a path-safe non-empty string`);
    }
    if (statement.trim().length === 0) {
      errors.push(`properties[${String(index)}].statement must be a non-empty string`);
    }
    if (seen.has(id)) {
      errors.push(`properties[${String(index)}].id ${JSON.stringify(id)} is a duplicate — ids identify artifacts`);
    }
    seen.add(id);
    properties.push({ id, statement });
  });
  return errors.length > 0 ? err(CodexCommandErrors.propertiesEntriesInvalid({ reasons: errors })) : ok(properties);
}

/** Options for a planning pass. */
export interface CodexPlanOptions {
  readonly pass: CodexPassId;
  readonly taskFile: string;
  readonly boundSeconds: number;
  /** The model this pass asks for: `--model`, or the repository default. */
  readonly model: string;
  readonly repo: string | undefined;
  readonly home: string | undefined;
}

/** Options for a review pass over one or more properties. */
export interface CodexReviewOptions {
  readonly pass: CodexPassId;
  /** Set when the caller named a single property inline. */
  readonly property: ReviewProperty | undefined;
  /** Set when the caller supplied a file of N properties to fan out. */
  readonly propertiesFile: string | undefined;
  readonly base: string;
  readonly boundSeconds: number;
  readonly maxDiffBytes: number;
  /** The explicit parallelism cap for a fan-out. No default: the caller owns the spend. */
  readonly concurrency: number;
  /** The model every property of this review asks for: `--model`, or the repository default. */
  readonly model: string;
  readonly repo: string | undefined;
  readonly home: string | undefined;
}

/** Parse a required positive integer flag, with no fallback — a missing bound must be a refusal. */
function requiredPositiveInt({
  values,
  key,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  key: string;
  errors: string[];
}): number {
  const raw = values[key];
  if (raw === undefined) {
    errors.push(`--${key} is REQUIRED and has no default: only the caller knows what this pass is worth`);
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`--${key} must be a positive whole number, got ${JSON.stringify(raw)}`);
    return 0;
  }
  return parsed;
}

/** Parse a required string flag. */
function requiredString({
  values,
  key,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  key: string;
  errors: string[];
}): string {
  const raw = values[key];
  if (raw === undefined || raw.trim().length === 0) {
    errors.push(`--${key} is required`);
    return "";
  }
  return raw;
}

/**
 * The model a pass asks for — `--model` when the caller named one, otherwise the repository default.
 *
 * The default is the whole point of the flag being optional: the fleet runs on
 * {@link CODEX_MODEL} and a pass that needs a different thinker says so by name, in its own argv.
 *
 * A REPEATED `--model` never reaches here: the shared flag parser refuses it, so a malformed first one cannot
 * hide behind a valid last one — a Codex review found that shape.
 */
function modelOf({ values, errors }: { values: Readonly<Record<string, string>>; errors: string[] }): string {
  const raw = values["model"];
  if (raw === undefined) {
    return CODEX_MODEL;
  }
  const model = parseCodexModel({ value: raw });
  if (model === undefined) {
    errors.push(`--model must be a Codex model id such as ${CODEX_MODEL}, got ${JSON.stringify(raw)}`);
    return CODEX_MODEL;
  }
  return model;
}

/** Validate a pass id belongs to the expected family (plan vs review). */
function passOfKind({
  values,
  expected,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  expected: "plan" | "review";
  errors: string[];
}): CodexPassId {
  const raw = values["pass"];
  if (raw === undefined) {
    errors.push("--pass is required");
    return expected === "plan" ? "p1" : "r1";
  }
  const parsed = parsePassId({ value: raw });
  const family = expected === "plan" ? ["p1", "p2", "p3"] : ["r1", "r2", "r3"];
  if (parsed === undefined || !family.includes(parsed)) {
    errors.push(`--pass must be one of ${family.join("|")} for a ${expected} pass, got ${JSON.stringify(raw)}`);
    return expected === "plan" ? "p1" : "r1";
  }
  return parsed;
}

/**
 * Parse the `codex plan` verb tail.
 *
 * @param rest the argv tail after `codex plan`
 * @returns the options, or every rejection
 */
export function parseCodexPlanOptions({ rest }: { rest: readonly string[] }): Result<CodexPlanOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { value: ["pass", "task-file", "bound-seconds", "model", "repo", "home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const options: CodexPlanOptions = {
    boundSeconds: requiredPositiveInt({ errors, key: "bound-seconds", values }),
    home: values["home"],
    model: modelOf({ errors, values }),
    pass: passOfKind({ errors, expected: "plan", values }),
    repo: values["repo"],
    taskFile: requiredString({ errors, key: "task-file", values }),
  };
  return errors.length > 0 ? err(errors) : ok(options);
}

/**
 * Parse the `codex review` verb tail.
 *
 * ONE property per invocation, by design. The measured difference is stark: ~25 checks in one call ran
 * 1h50m and never converged; one property with the diff supplied answered in 51 seconds. Reviewing N
 * properties means N invocations, which is what makes each one bounded and each answer attributable.
 *
 * @param rest the argv tail after `codex review`
 * @returns the options, or every rejection
 */
export function parseCodexReviewOptions({ rest }: { rest: readonly string[] }): Result<CodexReviewOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      value: [
        "pass",
        "property-id",
        "property",
        "properties-file",
        "concurrency",
        "base",
        "bound-seconds",
        "max-diff-bytes",
        "model",
        "repo",
        "home",
      ],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const inlineProperty = inlinePropertyFrom({ errors, values });
  const propertiesFile = values["properties-file"];
  if (inlineProperty === undefined && propertiesFile === undefined) {
    errors.push(
      "supply either --property-id with --property, or --properties-file. A review with no property has no " +
        "stopping condition — that is the shape that ran 1h50m without converging",
    );
  }
  if (inlineProperty !== undefined && propertiesFile !== undefined) {
    errors.push("--properties-file cannot be combined with an inline --property; choose one source");
  }
  const options: CodexReviewOptions = {
    base: requiredString({ errors, key: "base", values }),
    boundSeconds: requiredPositiveInt({ errors, key: "bound-seconds", values }),
    // The bound applies PER PROPERTY, so a fan-out's parallelism is the caller's spend decision.
    concurrency: values["concurrency"] === undefined ? 1 : requiredPositiveInt({ errors, key: "concurrency", values }),
    home: values["home"],
    maxDiffBytes: requiredPositiveInt({ errors, key: "max-diff-bytes", values }),
    model: modelOf({ errors, values }),
    pass: passOfKind({ errors, expected: "review", values }),
    propertiesFile,
    property: inlineProperty,
    repo: values["repo"],
  };
  return errors.length > 0 ? err(errors) : ok(options);
}

/** The inline single property, when the caller named one. Undefined when neither flag is present. */
function inlinePropertyFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  errors: string[];
}): ReviewProperty | undefined {
  const id = values["property-id"];
  const statement = values["property"];
  if (id === undefined && statement === undefined) {
    return undefined;
  }
  if (id === undefined || statement === undefined) {
    errors.push("--property-id and --property must be given together");
    return undefined;
  }
  if (!/^[\w.-]+$/.test(id)) {
    errors.push(`--property-id must be path-safe (letters, digits, dot, dash, underscore), got ${JSON.stringify(id)}`);
  }
  if (statement.trim().length === 0) {
    errors.push("--property must not be empty");
  }
  return { id, statement };
}

/**
 * The verdict a caller should branch on, extracted from a completed pass.
 *
 * @param pass the completed pass
 * @returns the verdict string — this, never the exit code, since a review that finds a real defect
 *   SUCCEEDED and therefore exits 0
 */
export function verdictOf({ pass }: { pass: CompletedPass }): string {
  const outcome = pass.record.outcome;
  switch (outcome.kind) {
    case "answered":
      return outcome.answer.verdict;
    case "no-verdict":
      return `NO_VERDICT:${outcome.reason}`;
    case "fatal":
      return "FATAL";
  }
}

/** Where a pass's artifact was published — `null` for a pass whose artifact write failed, so none exists. */
function publishedArtifactPath({ pass }: { pass: CompletedPass }): string | null {
  const location = pass.location;
  if (location === undefined) {
    return null;
  }
  return location.artifactPath;
}

/** Why a pass's artifact was not persisted — `null` for a pass whose write succeeded, or that recorded no reason. */
function persistFailure({ pass }: { pass: CompletedPass }): string | null {
  const persistError = pass.persistError;
  if (persistError === undefined) {
    return null;
  }
  return persistError;
}

/** A pass's human-line destination: the artifact path, or NOT PERSISTED with the recorded reason or `unknown`. */
function passDestination({ pass }: { pass: CompletedPass }): string {
  const artifactPath = publishedArtifactPath({ pass });
  if (artifactPath !== null) {
    return artifactPath;
  }
  const failure = persistFailure({ pass });
  if (failure === null) {
    return "NOT PERSISTED (unknown)";
  }
  return `NOT PERSISTED (${failure})`;
}

/**
 * The machine-readable result document for stdout.
 *
 * This — not the exit code — is what a caller must branch on, because `BROKEN` and `CLEAN` are both
 * successful passes and both exit 0. Every field a consuming agent needs to decide "may I proceed?" is
 * here explicitly, including the artifact path to read the full answer from. `scratchReclaim` says what
 * became of the pass's own scratch workspace; it is beside the verdict and never part of it. A review
 * also carries a top-level `snapshotPoolReclaim`, what became of a description review's one-shot pool,
 * beside every verdict in the same way; a plan carries none.
 *
 * @param passes every completed pass in this invocation
 * @param poolReclaim the review's pool outcome, omitted from the document when absent
 * @returns the JSON document, as one line
 */
export function codexResultJson({
  passes,
  poolReclaim,
}: {
  passes: readonly CompletedPass[];
  poolReclaim?: PoolReclaimOutcome | undefined;
}): string {
  return JSON.stringify({
    passes: passes.map((pass) => ({
      artifactPath: publishedArtifactPath({ pass }),
      pass: pass.record.scope.pass,
      persistError: persistFailure({ pass }),
      property: pass.record.scope.mode === "review" ? pass.record.scope.property.id : null,
      scratchReclaim: scratchReclaimJson({ outcome: pass.scratchReclaim }),
      verdict: verdictOf({ pass }),
    })),
    schemaVersion: 1,
    ...(poolReclaim === undefined ? {} : { snapshotPoolReclaim: poolReclaimJson({ outcome: poolReclaim }) }),
  });
}

/**
 * Human-readable summary lines for stderr.
 *
 * @param passes every completed pass
 * @returns one line per pass
 */
export function codexHumanLines({ passes }: { passes: readonly CompletedPass[] }): readonly string[] {
  return passes.map((pass) => {
    const where = passDestination({ pass });
    const context = formatPassOutcomeContext({ record: pass.record });
    const suffix = context === undefined ? "" : ` — ${context}`;
    return `${pass.record.scope.pass} ${verdictOf({ pass })}${suffix} → ${where}`;
  });
}
