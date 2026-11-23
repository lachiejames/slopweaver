/**
 * The onboarding self-evaluation's one input shape: a completed run, written as JSON by the fresh visible
 * session that just played a new developer through `skills/onboard/SKILL.md`.
 *
 * No code composes this file — only a visible session can judge whether an instruction said what to do, a
 * verb refused with a reason or failed silently, or where a step required a guess (rule 2's shape: the CLI
 * gathers evidence and renders it, judgement stays in the session). This module is the pure boundary that
 * shape crosses: `parseOnboardEvalRun` is the only place a hand-typed JSON string becomes a trusted value,
 * and {@link ONBOARD_EVAL_RUN_SCHEMA} is the one prose description of the shape, printed by
 * `slopweaver onboard eval --schema` so the eval doc never restates it and cannot drift from what the parser
 * actually accepts.
 */
import { isOneOf, isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * How one step of the onboarding flow went. `unproven-credential-gated` is its own outcome rather than a
 * skip, so a step that needed real provider credentials the eval has none of is never silently dropped from
 * the report — see `AGENTS.md`'s onboarding-eval ask: "each credential-only step is scored as 'unproven
 * here' rather than skipped silently."
 */
const ONBOARD_EVAL_OUTCOMES = ["ok", "refused-with-reason", "failed-silently", "unproven-credential-gated"] as const;

/** One of {@link ONBOARD_EVAL_OUTCOMES}. */
export type OnboardEvalOutcome = (typeof ONBOARD_EVAL_OUTCOMES)[number];

/** One step of the onboarding flow, as the evaluating session judged it. */
export interface OnboardEvalStepRecord {
  /** A short, stable id for the step, e.g. `1-scaffold-inspect` — stable across runs so a delta can match steps up. */
  readonly id: string;
  /** Where in the skill this step came from, e.g. `skills/onboard/SKILL.md § 1 — Scaffold + inspect the home`. */
  readonly skillRef: string;
  /** The `slopweaver` verb this step invoked, when it invoked one. */
  readonly verb: string | undefined;
  /** Whether the skill's instruction said what to do, without the session having to infer it. */
  readonly instructionClear: boolean;
  /** Whether the verb the instruction named actually existed and ran. */
  readonly verbPresent: boolean;
  readonly outcome: OnboardEvalOutcome;
  /** The refusal reason, the silent-failure symptom, or what stayed unproven — always populated. */
  readonly outcomeDetail: string;
  /** Whether the session had to guess undocumented behaviour to get past this step. */
  readonly guessed: boolean;
  /** What was guessed, when {@link guessed} is true. */
  readonly guessNote: string | undefined;
  readonly durationSeconds: number;
}

/** One completed onboarding self-evaluation run. */
export interface OnboardEvalRun {
  /** A stable id for this run, e.g. an ISO timestamp. */
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The repository commit `skills/onboard/SKILL.md` was read at, so a later diff can say what changed. */
  readonly onboardSkillCommit: string;
  readonly steps: readonly OnboardEvalStepRecord[];
  /** The evaluating session's closing notes — anything a per-step record does not capture. */
  readonly notes: string;
}

/** The prose shape description `slopweaver onboard eval --schema` prints. The one copy; the doc points here. */
export const ONBOARD_EVAL_RUN_SCHEMA = `OnboardEvalRun (JSON):
{
  "runId": string,                // e.g. an ISO timestamp
  "startedAt": string,             // ISO 8601
  "finishedAt": string,            // ISO 8601
  "onboardSkillCommit": string,    // \`git rev-parse HEAD\` in the repo the evaluated skill came from
  "notes": string,                 // closing notes; "" if none
  "steps": [
    {
      "id": string,                 // stable across runs, e.g. "1-scaffold-inspect"
      "skillRef": string,           // e.g. "skills/onboard/SKILL.md § 1 — Scaffold + inspect the home"
      "verb": string | null,        // the slopweaver verb this step invoked, or null
      "instructionClear": boolean,  // did the skill say what to do without inference
      "verbPresent": boolean,       // did the named verb exist and run
      "outcome": "ok" | "refused-with-reason" | "failed-silently" | "unproven-credential-gated",
      "outcomeDetail": string,      // the refusal reason, the silent-failure symptom, or what stayed unproven
      "guessed": boolean,           // did this step require a guess
      "guessNote": string | null,   // what was guessed, when guessed is true
      "durationSeconds": number
    }
  ]
}`;

/** One field-level parse failure, naming the exact JSON path so a malformed run is fixable rather than opaque. */
function fieldError({ path, detail }: { path: string; detail: string }): string {
  return `${path}: ${detail}`;
}

/**
 * Narrow an already-validated value to `string`, via a genuine runtime check rather than an `as` cast —
 * every caller here has already rejected the malformed case above, so the throw is unreachable in practice,
 * and honest about that rather than asserting past it.
 */
function asString({ value }: { value: unknown }): string {
  if (typeof value !== "string") {
    throw new Error("onboardEval: internal validation gap — expected a string");
  }
  return value;
}

/** The `boolean` sibling of {@link asString}. */
function asBoolean({ value }: { value: unknown }): boolean {
  if (typeof value !== "boolean") {
    throw new Error("onboardEval: internal validation gap — expected a boolean");
  }
  return value;
}

/** The non-negative `number` sibling of {@link asString}. */
function asNumber({ value }: { value: unknown }): number {
  if (typeof value !== "number") {
    throw new Error("onboardEval: internal validation gap — expected a number");
  }
  return value;
}

/** The {@link OnboardEvalOutcome} sibling of {@link asString}. */
function asOutcome({ value }: { value: unknown }): OnboardEvalOutcome {
  if (typeof value !== "string" || !isOneOf(value, ONBOARD_EVAL_OUTCOMES)) {
    throw new Error("onboardEval: internal validation gap — expected a known outcome");
  }
  return value;
}

/** A `string | undefined` field that arrived as JSON `null` for "absent". */
function asOptionalString({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Whether a value is a non-empty string — `undefined` when it passes, else the error to report. */
function checkNonEmptyString({ value, field }: { value: unknown; field: string }): string | undefined {
  return typeof value === "string" && value.length > 0 ? undefined : `${field} must be a non-empty string`;
}

/** The `boolean` sibling of {@link checkNonEmptyString}. */
function checkBoolean({ value, field }: { value: unknown; field: string }): string | undefined {
  return typeof value === "boolean" ? undefined : `${field} must be a boolean`;
}

/** A `string | null | undefined` field — every one of those three shapes is accepted. */
function checkOptionalString({ value, field }: { value: unknown; field: string }): string | undefined {
  return value === undefined || value === null || typeof value === "string"
    ? undefined
    : `${field} must be a string or null`;
}

/** Whether a value is one of {@link ONBOARD_EVAL_OUTCOMES}. */
function checkOutcome({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && isOneOf(value, ONBOARD_EVAL_OUTCOMES)
    ? undefined
    : `outcome must be one of ${ONBOARD_EVAL_OUTCOMES.join(", ")}`;
}

/** Whether a value is a non-negative, finite duration. */
function checkDuration({ value }: { value: unknown }): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? undefined
    : "durationSeconds must be a non-negative number";
}

/** Every field-level check {@link parseStep} runs, in declaration order. */
function stepChecks({ value }: { value: Record<string, unknown> }): readonly (string | undefined)[] {
  return [
    checkNonEmptyString({ field: "id", value: value["id"] }),
    checkNonEmptyString({ field: "skillRef", value: value["skillRef"] }),
    checkOptionalString({ field: "verb", value: value["verb"] }),
    checkBoolean({ field: "instructionClear", value: value["instructionClear"] }),
    checkBoolean({ field: "verbPresent", value: value["verbPresent"] }),
    checkOutcome({ value: value["outcome"] }),
    checkNonEmptyString({ field: "outcomeDetail", value: value["outcomeDetail"] }),
    checkBoolean({ field: "guessed", value: value["guessed"] }),
    checkOptionalString({ field: "guessNote", value: value["guessNote"] }),
    checkDuration({ value: value["durationSeconds"] }),
  ];
}

/** Parse one step record out of an already-unwrapped JSON value. */
function parseStep({ value, index }: { value: unknown; index: number }): Result<OnboardEvalStepRecord> {
  const path = `steps[${index}]`;
  if (!isRecord(value)) {
    return err([fieldError({ detail: "must be an object", path })]);
  }
  const errors = stepChecks({ value }).flatMap((detail) =>
    detail === undefined ? [] : [fieldError({ detail, path })],
  );
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    durationSeconds: asNumber({ value: value["durationSeconds"] }),
    guessed: asBoolean({ value: value["guessed"] }),
    guessNote: asOptionalString({ value: value["guessNote"] }),
    id: asString({ value: value["id"] }),
    instructionClear: asBoolean({ value: value["instructionClear"] }),
    outcome: asOutcome({ value: value["outcome"] }),
    outcomeDetail: asString({ value: value["outcomeDetail"] }),
    skillRef: asString({ value: value["skillRef"] }),
    verb: asOptionalString({ value: value["verb"] }),
    verbPresent: asBoolean({ value: value["verbPresent"] }),
  });
}

/**
 * Parse a run artifact's raw JSON text into a validated {@link OnboardEvalRun}.
 *
 * @param raw the file's raw text, as written by the evaluating session
 * @returns the validated run, or every field-level reason it was rejected
 */
export function parseOnboardEvalRun({ raw }: { raw: string }): Result<OnboardEvalRun> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error: unknown) {
    return err([`not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
  if (!isRecord(decoded)) {
    return err(["the run artifact must be a JSON object matching OnboardEvalRun — see --schema"]);
  }
  const errors: string[] = [];
  for (const field of ["runId", "startedAt", "finishedAt", "onboardSkillCommit", "notes"] as const) {
    if (typeof decoded[field] !== "string") {
      errors.push(fieldError({ detail: `${field} must be a string`, path: field }));
    }
  }
  const rawSteps = decoded["steps"];
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    errors.push(fieldError({ detail: "steps must be a non-empty array", path: "steps" }));
  }
  if (errors.length > 0) {
    return err(errors);
  }
  const parsedSteps = (Array.isArray(rawSteps) ? rawSteps : []).map((value, index) => parseStep({ index, value }));
  const stepErrors = parsedSteps.flatMap((step) => (step.isErr() ? step.error : []));
  if (stepErrors.length > 0) {
    return err(stepErrors);
  }
  return ok({
    finishedAt: asString({ value: decoded["finishedAt"] }),
    notes: asString({ value: decoded["notes"] }),
    onboardSkillCommit: asString({ value: decoded["onboardSkillCommit"] }),
    runId: asString({ value: decoded["runId"] }),
    startedAt: asString({ value: decoded["startedAt"] }),
    steps: parsedSteps.flatMap((step) => (step.isOk() ? [step.value] : [])),
  });
}
