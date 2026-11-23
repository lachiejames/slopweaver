/**
 * `slopweaver distil answer` — ground the digest the visible session composed, and cache it.
 *
 * There is no model in this verb. It reloads the brief, proves the corpus still produces the SAME batch
 * (contract fingerprint, pinned refs, content hash, and the rendered prompt — see `gold/distilBrief.ts` for
 * why both a hash check and a prompt check are needed), validates the answer's shape with the identical
 * `validateBatchDigest` a forced-tool call used to be checked against, and only then writes the cache. Gold
 * is rewritten the moment every unique batch in the current plan is cached — never from a partial set.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { goldDir } from "../../../corpus/corpusPaths.js";
import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { type BatchDigest, DISTIL_PROMPT_FINGERPRINT, validateBatchDigest } from "../../../gold/distil.js";
import { type DistilBrief, parseDistilBrief, rebuildBriefBatch } from "../../../gold/distilBrief.js";
import { readDistilPromptMarker, saveDistilCache, writeDistilPromptMarker } from "../../../gold/distilCache.js";
import type { DistilBatch } from "../../../gold/distilGroup.js";
import { censusRecordsFor, type PlannedDistilBatch } from "../../../gold/distilStreamPlan.js";
import type { LoadSlotGuard } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { orThrow, safeFs } from "../../../lib/safeBoundary.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import {
  buildDistilPlanOptions,
  DISTIL_PLAN_FLAG_SPEC,
  distilAnsweredProgressLine,
  distilCompleteLine,
  planDistil,
  removedDistilFlagRefusal,
} from "./core.js";
import { loadDistilBatchPlan } from "./plan.js";
import { cacheIsComplete, publishFromCache } from "./publish.js";
import { DISTIL_ANSWER_USAGE } from "./usage.js";

/** The `answer` verb's OWN two flags, layered on top of {@link DISTIL_PLAN_FLAG_SPEC}. */
const DISTIL_ANSWER_EXTRA_FLAG_SPEC = { string: ["brief", "answer"] } as const;

/** Every flag `distil answer` accepts, as the `--`-prefixed tokens a caller types. */
export const DISTIL_ANSWER_FLAG_NAMES: readonly string[] = [
  ...DISTIL_PLAN_FLAG_SPEC.string,
  ...DISTIL_ANSWER_EXTRA_FLAG_SPEC.string,
  ...DISTIL_PLAN_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/** The merged spec `distil answer` tokenises the whole tail against. */
const DISTIL_ANSWER_MERGED_SPEC = {
  boolean: [...DISTIL_PLAN_FLAG_SPEC.boolean],
  value: [...DISTIL_PLAN_FLAG_SPEC.string, ...DISTIL_ANSWER_EXTRA_FLAG_SPEC.string],
};

/** Everything the tail could hold: the shared plan options, plus `--brief`/`--answer`. */
export interface DistilAnswerArgs {
  readonly home?: string;
  readonly corpus?: string;
  readonly maxPerBatch?: number;
  readonly topContainers?: number;
  readonly recentOnly: boolean;
  readonly briefPath?: string;
  readonly answerPath?: string;
}

/**
 * Tokenise the whole tail once, then build the shared plan options and this verb's own two flags. Exported
 * so the repo-wide `--help`-truth ratchet can push a real invocation through the real parser.
 *
 * @param rest the verb tail (already checked against `removedDistilFlagRefusal`)
 * @returns the validated args, or the accumulated flag errors
 */
export function parseDistilAnswerArgs({ rest }: { rest: readonly string[] }): Result<DistilAnswerArgs> {
  const parsed = parseFlagTail({ rest, spec: DISTIL_ANSWER_MERGED_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const planOptions = buildDistilPlanOptions(parsed.value);
  if (planOptions.isErr()) {
    return err(planOptions.error);
  }
  const { brief, answer } = parsed.value.values;
  const missing = [
    brief === undefined ? "--brief is required" : undefined,
    answer === undefined ? "--answer is required" : undefined,
  ].filter((line): line is string => line !== undefined);
  if (missing.length > 0) {
    return err(missing);
  }
  return ok({
    ...planOptions.value,
    ...(brief !== undefined ? { briefPath: brief } : {}),
    ...(answer !== undefined ? { answerPath: answer } : {}),
  });
}

/** Read a file, turning an unreadable one into a stated reason rather than a stack trace. */
function readOrReport({ path, what }: { path: string; what: string }): Result<string> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error) {
    return err([`could not read the ${what} at ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

/** Parse JSON, turning a malformed file into a stated reason rather than a thrown `SyntaxError`. */
function parseJsonOrReport({ text, what }: { text: string; what: string }): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (error) {
    return err([`the ${what} is not JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

/** Write a text file, creating parent dirs — routed through `safeFs` so a failure is a typed, re-thrown error. */
function writeTextFile({ path, text }: { path: string; text: string }): void {
  orThrow({
    result: safeFs({
      execute: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
      },
      operation: "distil.writeGoldDoc",
      path,
    }),
  });
}

/** Print every reason and return the code — one refusal per call site instead of a repeated forEach block. */
function refuse({ code, errors }: { code: number; errors: readonly string[] }): number {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
  return code;
}

/**
 * Run the answer verb over an injected clock — the testable core. `runDistilAnswer` below is the CLI-facing
 * wrapper the manifest loads, kept to the single-`argv` verb contract; this is what a test calls to inject a
 * deterministic build timestamp for the gold overview. `distil answer` is never the bare-noun default, so
 * its tail starts at index 4 (after both the noun and the explicit verb word) — see `./run.ts` for the one
 * verb that needs a different offset.
 *
 * @param argv the full process argv (verb tail starts at index 4: `[node, cli, distil, answer, …]`)
 * @param nowIso the build-timestamp clock (injected for deterministic tests)
 * @returns the process exit code
 */
export function runDistilAnswerWithDeps({
  argv,
  nowIso,
  guard,
}: {
  argv: readonly string[];
  nowIso: () => string;
  guard?: LoadSlotGuard;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DISTIL_ANSWER_USAGE });
    return EXIT_OK;
  }
  const removed = removedDistilFlagRefusal({ rest });
  if (removed.length > 0) {
    return refuse({ code: EXIT_ERROR, errors: removed });
  }
  const parsed = parseDistilAnswerArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: [...parsed.error, DISTIL_ANSWER_USAGE] });
  }
  return runWithArgs({ args: parsed.value, guard, nowIso });
}

/**
 * Run the answer verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runDistilAnswer(argv: readonly string[]): number {
  return runDistilAnswerWithDeps({ argv, nowIso: () => new Date().toISOString() });
}

/** Read + validate the two input files, then dispatch to the caching/gold-writing step. */
function runWithArgs({
  args,
  guard,
  nowIso,
}: {
  args: DistilAnswerArgs;
  guard: LoadSlotGuard | undefined;
  nowIso: () => string;
}): number {
  const home = resolveHome({ named: args.home });
  const briefPath = args.briefPath!; // required, checked in parseDistilAnswerArgs
  const answerPath = args.answerPath!;
  const briefText = readOrReport({ path: briefPath, what: "brief" });
  const answerText = readOrReport({ path: answerPath, what: "answer" });
  if (briefText.isErr() || answerText.isErr()) {
    return refuse({
      code: EXIT_ERROR,
      errors: [...(briefText.isErr() ? briefText.error : []), ...(answerText.isErr() ? answerText.error : [])],
    });
  }
  const briefJson = parseJsonOrReport({ text: briefText.value, what: "brief" });
  const answerJson = parseJsonOrReport({ text: answerText.value, what: "answer" });
  if (briefJson.isErr() || answerJson.isErr()) {
    return refuse({
      code: EXIT_ERROR,
      errors: [...(briefJson.isErr() ? briefJson.error : []), ...(answerJson.isErr() ? answerJson.error : [])],
    });
  }
  const brief = parseDistilBrief({ input: briefJson.value });
  if (brief.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [brief.error.message] });
  }
  if (!isRecord(answerJson.value)) {
    return refuse({ code: EXIT_ERROR, errors: ["the answer is not a JSON object"] });
  }
  return groundAndCache({ answerPayload: answerJson.value, args, brief: brief.value, guard, home, nowIso });
}

/** Rebuild the batch, validate the digest, and — only on success — cache it and (if complete) write gold. */
function groundAndCache(input: {
  brief: DistilBrief;
  answerPayload: Readonly<Record<string, unknown>>;
  args: DistilAnswerArgs;
  guard: LoadSlotGuard | undefined;
  home: string;
  nowIso: () => string;
}): number {
  return withRowReader({ run: (reader) => groundWithReader({ ...input, reader }) });
}

/** {@link groundAndCache}'s body, inside the one row reader the plan and the pinned refs read through. */
function groundWithReader({
  brief,
  answerPayload,
  args,
  guard,
  home,
  nowIso,
  reader,
}: {
  brief: DistilBrief;
  answerPayload: Readonly<Record<string, unknown>>;
  args: DistilAnswerArgs;
  guard: LoadSlotGuard | undefined;
  home: string;
  nowIso: () => string;
  reader: RowReader;
}): number {
  const inputs = loadDistilBatchPlan({ home, options: args, reader, ...(guard !== undefined ? { guard } : {}) });
  if (inputs.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: inputs.error });
  }
  inputs.value.warnings.forEach((w) => {
    logger.warn({ msg: w });
  });
  const { batches, cache, census, recordCountBySource } = inputs.value;
  // Only the brief's pinned records are read back, never the corpus: the rebuild resolves every ref by
  // identity, so a ref the census does not hold is reported exactly as a missing record always was.
  const records = censusRecordsFor({ census, reader, refs: brief.refs });
  if (records.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [records.error.message] });
  }
  const rebuilt = rebuildBriefBatch({ brief, currentFingerprint: DISTIL_PROMPT_FINGERPRINT, records: records.value });
  if (rebuilt.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [rebuilt.error.message] });
  }
  const batch = rebuilt.value;
  const digest = validateBatchDigest({ batch, input: answerPayload });
  if (digest.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [digest.error.message] });
  }
  // A marker that cannot be trusted refuses BEFORE the digest is saved, rather than being overwritten
  // unread: it is what tells `distil brief` and `status` the cache changed contract, and a digest key already
  // carries its own contract (`hashBatch`), so the refusal protects that warning, not the digests.
  const marker = readDistilPromptMarker({ home });
  if (marker.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: marker.error });
  }
  cache.set(batch.hash, digest.value);
  saveDistilCache({ cache, home });
  if (marker.value !== DISTIL_PROMPT_FINGERPRINT) {
    writeDistilPromptMarker({ fingerprint: DISTIL_PROMPT_FINGERPRINT, home });
  }
  return report({ batch, batches, cache, home, nowIso, recordCountBySource });
}

/** Report progress, and write gold when this answer completed the plan. */
function report({
  batch,
  batches,
  cache,
  recordCountBySource,
  home,
  nowIso,
}: {
  batch: DistilBatch;
  batches: readonly PlannedDistilBatch[];
  cache: ReadonlyMap<string, BatchDigest>;
  recordCountBySource: ReadonlyMap<CorpusSource, number>;
  home: string;
  nowIso: () => string;
}): number {
  if (!cacheIsComplete({ batches, cache })) {
    logger.out({ line: distilAnsweredProgressLine({ batch, plan: planDistil({ batches, cache }) }) });
    return EXIT_OK;
  }
  // `answer` has just changed the cache, so the derived files are re-rendered unconditionally.
  publishFromCache({
    batches,
    builtAtIso: nowIso(),
    cache,
    exists: () => false,
    home,
    recordCountBySource,
    writeText: writeTextFile,
  });
  logger.out({ line: distilCompleteLine({ batch, goldPath: goldDir({ home }) }) });
  return EXIT_OK;
}

export const distilAnswerCommand = defineCommand({ run: runDistilAnswer });
