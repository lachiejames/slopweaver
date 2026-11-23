/**
 * `slopweaver distil brief` — hand the NEXT uncached batch to the visible session.
 *
 * This is the read half of the split that removed the spawned model. It plans the same way `distil status`
 * does, picks the next uncached batch, pins its records and writes the exact prompt as a brief — then prints
 * it. It posts nothing, opens no socket, and runs no model; everything downstream happens inside the turn
 * that invoked it. `slopweaver distil` with no verb is this verb (see `../../manifests/distil.ts`).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { type BatchDigest, DISTIL_PROMPT_FINGERPRINT } from "../../../gold/distil.js";
import { buildDistilBrief, renderDistilBrief } from "../../../gold/distilBrief.js";
import { readDistilPromptMarker } from "../../../gold/distilCache.js";
import { materialiseBatch, type PlannedDistilBatch } from "../../../gold/distilStreamPlan.js";
import { writeJsonFile } from "../../../lib/jsonFile.js";
import type { LoadSlotGuard } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  buildDistilPlanOptions,
  DISTIL_PLAN_FLAG_SPEC,
  nextDistilBatch,
  promptChangeRefusal,
  removedDistilFlagRefusal,
} from "./core.js";
import { loadDistilBatchPlan } from "./plan.js";
import { publishFromCache } from "./publish.js";
import { DISTIL_BRIEF_USAGE } from "./usage.js";

/** The `brief` verb's OWN extra flags, layered on top of {@link DISTIL_PLAN_FLAG_SPEC}. */
const DISTIL_BRIEF_EXTRA_FLAG_SPEC = { boolean: ["accept-prompt-change"], string: ["out"] } as const;

/** Every flag `distil brief` accepts, as the `--`-prefixed tokens a caller types. */
export const DISTIL_BRIEF_FLAG_NAMES: readonly string[] = [
  ...DISTIL_PLAN_FLAG_SPEC.string,
  ...DISTIL_BRIEF_EXTRA_FLAG_SPEC.string,
  ...DISTIL_PLAN_FLAG_SPEC.boolean,
  ...DISTIL_BRIEF_EXTRA_FLAG_SPEC.boolean,
].map((name) => `--${name}`);

/**
 * Where a brief lands: `--out` when given, else by batch hash beside the turn/ask briefs under the same home.
 * `out` is a REQUIRED key whose value may be unset, so it is read directly rather than through a fallback.
 */
function distilBriefPath({ args, hash, home }: { args: DistilBriefArgs; hash: string; home: string }): string {
  if (args.out === undefined) {
    return join(stateHomePaths({ home }).briefs, `distil-${hash}.json`);
  }
  return args.out;
}

/** The merged spec `distil brief` tokenises the WHOLE tail against — plan flags plus its own two. */
const DISTIL_BRIEF_MERGED_SPEC = {
  boolean: [...DISTIL_PLAN_FLAG_SPEC.boolean, ...DISTIL_BRIEF_EXTRA_FLAG_SPEC.boolean],
  value: [...DISTIL_PLAN_FLAG_SPEC.string, ...DISTIL_BRIEF_EXTRA_FLAG_SPEC.string],
};

/** Everything the tail could hold: the shared plan options, plus this verb's own `--out`/`--accept-prompt-change`. */
export interface DistilBriefArgs {
  readonly home?: string;
  readonly corpus?: string;
  readonly maxPerBatch?: number;
  readonly topContainers?: number;
  readonly recentOnly: boolean;
  readonly out: string | undefined;
  readonly acceptPromptChange: boolean;
}

/**
 * Tokenise the WHOLE tail once, then build both the shared plan options and this verb's own two flags.
 * Exported so the repo-wide `--help`-truth ratchet can push a real invocation through the real parser.
 *
 * @param rest the verb tail (already checked against `removedDistilFlagRefusal`)
 * @returns the validated args, or the accumulated flag errors
 */
export function parseDistilBriefArgs({ rest }: { rest: readonly string[] }): Result<DistilBriefArgs> {
  const parsed = parseFlagTail({ rest, spec: DISTIL_BRIEF_MERGED_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const planOptions = buildDistilPlanOptions(parsed.value);
  if (planOptions.isErr()) {
    return err(planOptions.error);
  }
  return ok({
    ...planOptions.value,
    acceptPromptChange: parsed.value.flags.has("accept-prompt-change"),
    out: parsed.value.values["out"],
  });
}

/** Print a batch of lines through one logger level — collapses the repeated `forEach` blocks below. */
function reportLines({ lines, level }: { lines: readonly string[]; level: "error" | "warn" }): void {
  lines.forEach((line) => {
    logger[level]({ msg: line });
  });
}

/** Load the batch plan, gate it against a contract change, and brief the next uncached batch (or say why not). */
function briefNextBatch({ args, guard }: { args: DistilBriefArgs; guard: LoadSlotGuard | undefined }): number {
  return withRowReader({ run: (reader) => briefWithReader({ args, guard, reader }) });
}

/**
 * Every batch in the plan is cached, so there is nothing to hand to a session — rebuild the derived files
 * from the cache instead, and say which.
 */
function republishFromCache({
  batches,
  cache,
  home,
  recordCountBySource,
}: {
  batches: readonly PlannedDistilBatch[];
  cache: ReadonlyMap<string, BatchDigest>;
  home: string;
  recordCountBySource: ReadonlyMap<CorpusSource, number>;
}): number {
  // Every hash is cached, so there is nothing to hand to a session — but that is NOT the same as there
  // being nothing to do. The derived files are written from the cache, and the state where the cache is
  // complete while gold is missing is reachable by killing the process between a per-batch checkpoint and
  // the write. Before this, that state was unrecoverable: `brief` said "nothing to distil" forever and no
  // other verb would rebuild. Publishing is idempotent — the same digests render the same bytes.
  const written = publishFromCache({
    batches,
    builtAtIso: new Date().toISOString(),
    cache,
    exists: ({ path }) => existsSync(path),
    home,
    recordCountBySource,
    writeText: ({ path, text }) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    },
  });
  logger.out({
    line:
      written.gold === 0
        ? "nothing to distil — every unique batch in this plan is already cached, and its gold is written"
        : `every unique batch in this plan is already cached — rebuilt ${String(written.gold)} gold doc(s) ` +
          `and ${String(written.silver)} silver digest(s) from it`,
  });
  return EXIT_EXPECTED_EMPTY;
}

/** {@link briefNextBatch}'s body, inside the one row reader the plan and the chosen batch read through. */
function briefWithReader({
  args,
  guard,
  reader,
}: {
  args: DistilBriefArgs;
  guard: LoadSlotGuard | undefined;
  reader: RowReader;
}): number {
  const home = resolveHome({ named: args.home });
  const inputs = loadDistilBatchPlan({ home, options: args, reader, ...(guard !== undefined ? { guard } : {}) });
  if (inputs.isErr()) {
    reportLines({ level: "error", lines: inputs.error });
    return EXIT_ERROR;
  }
  reportLines({ level: "warn", lines: inputs.value.warnings });
  // Read before the empty-plan exit too: a corrupt marker is refused whatever the corpus holds, never hidden
  // behind "nothing to distil".
  const marker = readDistilPromptMarker({ home });
  if (marker.isErr()) {
    reportLines({ level: "error", lines: marker.error });
    return EXIT_ERROR;
  }
  const { batches, cache } = inputs.value;
  if (batches.length === 0) {
    logger.out({ line: "no records to distil — run `slopweaver refresh` first" });
    return EXIT_EXPECTED_EMPTY;
  }
  const refusal = promptChangeRefusal({
    accepted: args.acceptPromptChange,
    cachedCount: cache.size,
    currentFingerprint: DISTIL_PROMPT_FINGERPRINT,
    storedFingerprint: marker.value,
  });
  if (refusal.length > 0) {
    reportLines({ level: "error", lines: refusal });
    return EXIT_USAGE;
  }
  const planned = nextDistilBatch({ batches, cache });
  if (planned === undefined) {
    return republishFromCache({ batches, cache, home, recordCountBySource: inputs.value.recordCountBySource });
  }
  const next = materialiseBatch({ batch: planned, reader });
  if (next.isErr()) {
    reportLines({ level: "error", lines: [next.error.message] });
    return EXIT_ERROR;
  }
  const brief = buildDistilBrief({ batch: next.value, promptFingerprint: DISTIL_PROMPT_FINGERPRINT });
  const path = distilBriefPath({ args, hash: planned.hash, home });
  writeJsonFile({ path, value: brief });
  for (const line of renderDistilBrief({ brief, briefPath: path })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the brief verb over an already-sliced tail — shared by the bare `distil` noun (`./run.ts`, tail starts
 * at index 3) and the explicit `distil brief` verb (tail starts at index 4), which consume a different argv
 * offset for the same reason every free-text noun does: the bare noun has no verb word to skip.
 *
 * @param rest the verb's own argv tail, already sliced by the caller
 * @returns the process exit code
 */
export function runDistilBriefWithRest({ rest, guard }: { rest: readonly string[]; guard?: LoadSlotGuard }): number {
  const gated = refuseRunnerOnStandingRuling({ noun: "distil", rest, verb: "brief" });
  if (gated !== undefined) {
    return gated;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DISTIL_BRIEF_USAGE });
    return EXIT_OK;
  }
  const removed = removedDistilFlagRefusal({ rest });
  if (removed.length > 0) {
    reportLines({ level: "error", lines: removed });
    return EXIT_ERROR;
  }
  const parsed = parseDistilBriefArgs({ rest });
  if (parsed.isErr()) {
    reportLines({ level: "error", lines: [...parsed.error, DISTIL_BRIEF_USAGE] });
    return EXIT_USAGE;
  }
  return briefNextBatch({ args: parsed.value, guard });
}

/**
 * Run the explicit `distil brief` verb.
 *
 * @param argv the full process argv (verb tail starts at index 4: `[node, cli, distil, brief, …]`)
 * @returns the process exit code
 */
export function runDistilBrief(argv: readonly string[]): number {
  return runDistilBriefWithRest({ rest: argv.slice(4) });
}

export const distilBriefCommand = defineCommand({ run: runDistilBrief });
