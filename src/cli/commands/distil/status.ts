/**
 * `slopweaver distil status` — the batch plan, with nothing spent to produce it.
 *
 * Read-only: it reads bronze + the digest cache and reports the plan `distil brief` would hand out from.
 * There is no model call anywhere in this file, and no write — `effect: "none"` on the manifest entry is
 * literally true, which is new: the pre-rewrite `distil --dry-run` was a flag on a verb that otherwise
 * called a model, so its own truth depended on which other flags were absent.
 */

import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import {
  type BatchDigest,
  buildDigestPrompt,
  DISTIL_PROMPT_FINGERPRINT,
  digestPromptTruncation,
} from "../../../gold/distil.js";
import { readDistilPromptMarker } from "../../../gold/distilCache.js";
import { materialiseBatch, type PlannedDistilBatch } from "../../../gold/distilStreamPlan.js";
import type { LoadSlotGuard } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { truncationLine } from "../../../lib/truncation.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  DISTIL_PLAN_FLAG_SPEC,
  type DistilPlanOptions,
  nextDistilBatch,
  parseDistilPlanOptions,
  planDistil,
  promptChangeRefusal,
  removedDistilFlagRefusal,
} from "./core.js";
import { loadDistilBatchPlan } from "./plan.js";
import { DISTIL_STATUS_USAGE } from "./usage.js";

/** Every flag `distil status` accepts, as the `--`-prefixed tokens a caller types. */
export const DISTIL_STATUS_FLAG_NAMES: readonly string[] = [
  ...DISTIL_PLAN_FLAG_SPEC.string.map((name) => `--${name}`),
  ...DISTIL_PLAN_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * The next batch's own facts — record count, prompt size, truncation — or absence when nothing remains. Its
 * records are read back here and nowhere else, so the verb holds one batch rather than the corpus.
 */
function nextBatchLines({
  batches,
  cache,
  reader,
}: {
  batches: readonly PlannedDistilBatch[];
  cache: ReadonlyMap<string, BatchDigest>;
  reader: RowReader;
}): readonly string[] {
  const planned = nextDistilBatch({ batches, cache });
  if (planned === undefined) {
    return ["next batch: none — every unique batch in this plan is already cached"];
  }
  const read = materialiseBatch({ batch: planned, reader });
  if (read.isErr()) {
    return [`next batch: could not be read back — ${read.error.message}`];
  }
  const next = read.value;
  const prompt = buildDigestPrompt({ batch: next });
  const promptChars = prompt.system.length + prompt.user.length;
  const truncation = truncationLine({
    capNoun: "chars per record, spent as one budget across the batch",
    label: "the distil prompt",
    truncation: digestPromptTruncation({ batches: [next] }),
  });
  return [
    `next batch: ${next.source}/${next.container} · ${String(next.records.length)} record(s) · ~${String(promptChars)} prompt char(s)`,
    ...(truncation === undefined ? [] : [truncation]),
  ];
}

/**
 * Run the status verb. `distil status` is never the bare-noun default, so its tail always starts after both
 * the noun AND the explicit verb word — index 4, like `distil answer` and unlike `distil`/`distil brief`
 * (see `./run.ts` for why THOSE two need a different offset).
 *
 * @param argv the full process argv (verb tail starts at index 4: `[node, cli, distil, status, …]`)
 * @returns the process exit code
 */
export function runDistilStatus(argv: readonly string[]): number {
  return runDistilStatusWithDeps({ argv });
}

/**
 * Run `distil status` with an injected load-slot guard.
 *
 * @param argv the full process argv (verb tail starts at index 4)
 * @param guard the machine's load-slot guard; omit for the real one — a seam so a test never writes into
 *   the machine-wide slot directory it shares with every other process on the host
 * @returns the process exit code
 */
export function runDistilStatusWithDeps({ argv, guard }: { argv: readonly string[]; guard?: LoadSlotGuard }): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DISTIL_STATUS_USAGE });
    return EXIT_OK;
  }
  const removed = removedDistilFlagRefusal({ rest });
  if (removed.length > 0) {
    removed.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const parsed = parseDistilPlanOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: DISTIL_STATUS_USAGE });
    return EXIT_ERROR;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  return withRowReader({ run: (reader) => reportStatus({ guard, home, options, reader }) });
}

/**
 * Plan, then print the status lines — everything after the arguments parse, run inside one open row reader.
 *
 * @param options the validated plan options
 * @param home the resolved Slopweaver home
 * @param reader the open row reader the plan and the next batch read rows back through
 * @param guard the machine's load-slot guard, when a test injects one
 * @returns the process exit code
 */
function reportStatus({
  options,
  home,
  reader,
  guard,
}: {
  options: DistilPlanOptions;
  home: string;
  reader: RowReader;
  guard: LoadSlotGuard | undefined;
}): number {
  const inputs = loadDistilBatchPlan({ home, options, reader, ...(guard !== undefined ? { guard } : {}) });
  if (inputs.isErr()) {
    inputs.error.forEach((e) => {
      logger.error({ msg: e });
    });
    return EXIT_ERROR;
  }
  inputs.value.warnings.forEach((w) => {
    logger.warn({ msg: w });
  });
  const { batches, cache } = inputs.value;
  const marker = readDistilPromptMarker({ home });
  if (marker.isErr()) {
    marker.error.forEach((e) => {
      logger.error({ msg: e });
    });
    return EXIT_ERROR;
  }
  const plan = planDistil({ batches, cache });
  const drift = promptChangeRefusal({
    accepted: false,
    cachedCount: cache.size,
    currentFingerprint: DISTIL_PROMPT_FINGERPRINT,
    storedFingerprint: marker.value,
  });
  logger.out({
    line: `${String(plan.totalUniqueBatches)} unique batch(es): ${String(plan.cachedUniqueBatches)} cached, ${String(plan.remainingUniqueBatches)} remaining`,
  });
  for (const line of nextBatchLines({ batches, cache, reader })) {
    logger.out({ line });
  }
  logger.out({ line: "CLI model calls: zero" });
  drift.forEach((line) => {
    logger.warn({ msg: line });
  });
  return EXIT_OK;
}

export const distilStatusCommand = defineCommand({ run: runDistilStatus });
