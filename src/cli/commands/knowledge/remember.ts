/**
 * `slopweaver knowledge remember` — write ONE memory into the retrieved table.
 *
 * The other half of `./recall.ts`, and the writer the steer asks for: most memories go into something retrieval based.
 *
 * ## Why this is a second verb and not a change to `knowledge record`
 *
 * `knowledge record` writes the append-only lessons file that `handover settle`'s gate reads. Pointing it
 * at Postgres makes every settle in the fleet depend on the store being reachable — a real change to how
 * the whole fleet behaves when Docker is down. They ruled on it: the fold happens
 * after their backup-destination entry clears. The destination is cleared; the backup leg to it and the live
 * store's migration baseline are the two board rows the fold is blocked on, named in
 * `skills/knowledge/SKILL.md`. Until it lands, the two write paths are two verbs with two destinations.
 *
 * ## The placement flag is required, and refusing is the point
 *
 * `--placement` has no default. A writer answers where this belongs BEFORE it is written, and every answer
 * but `retrieved` is refused with the destination named — see `../../../knowledge/memory.ts` for what that
 * gate can and cannot honestly check.
 */
import { randomUUID } from "node:crypto";

import { KnowledgeErrors } from "../../../knowledge/errors.js";
import {
  MEMORY_PLACEMENT_DESTINATIONS,
  MEMORY_PLACEMENTS,
  type MemoryPlacement,
  type MemoryRecording,
  RETAINED_PLACEMENT,
} from "../../../knowledge/memory.js";
import { recordMemory } from "../../../knowledge/memoryRecordStore.js";
import { buildMemoryRecording, type MemoryInput } from "../../../knowledge/memoryRow.js";
import {
  LESSON_SURFACES,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonSurface,
  type LessonTier,
  type LessonVerdict,
} from "../../../knowledge/types.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { REMEMBER_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeRememberArgs } from "./flagSpecs.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";
import { redactRecordingForWrite } from "./redactionContext.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** The run a memory is filed under: `--run` when given, else `ad-hoc` — a memory written outside any run. */
function runOf({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const given = flag({ name: "run", values });
  if (given === undefined) {
    return "ad-hoc";
  }
  return given;
}

/** The text flags a memory cannot be written without. `--run` is absent: it defaults to `ad-hoc`. */
const REQUIRED_TEXT: readonly string[] = [
  "domain",
  "claim",
  "evidence",
  "learner",
  "behaviour-change",
  "retrieval-cue",
];

/** The flags only a lesson may carry — a preference passing one is refused rather than silently stripped. */
const LESSON_FACET_FLAGS: readonly string[] = ["tier", "surface", "repro"];

/** What every kind carries, gathered once so the two branches below state only what differs. */
interface CommonFlags {
  readonly behaviourChange: string;
  readonly claim: string;
  readonly domain: string;
  readonly evidence: string;
  readonly learner: string;
  readonly placement: MemoryPlacement;
  readonly retrievalCue: string;
  readonly run: string;
  readonly verdict: LessonVerdict;
  readonly caveat?: string;
  readonly supersedes?: string;
}

/** The common flags, or the first one missing or outside its vocabulary. */
function commonFlags({ values }: { values: Readonly<Record<string, unknown>> }): CommonFlags | string {
  const placement = MEMORY_PLACEMENTS.find((entry) => entry === flag({ name: "placement", values }));
  if (placement === undefined) {
    return `--placement is required and must be one of ${MEMORY_PLACEMENTS.join(", ")}`;
  }
  const verdict = LESSON_VERDICTS.find((entry) => entry === flag({ name: "verdict", values }));
  if (verdict === undefined) {
    return `--verdict is required and must be one of ${LESSON_VERDICTS.join(", ")}`;
  }
  // Each required text flag is checked HERE and named in the refusal, rather than defaulted to "" and left
  // for the builder to reject: an empty string is a value the builder cannot distinguish from a flag the
  // operator typed blank, and the message it produces would say `--claim is empty` for a flag nobody passed.
  const missing = REQUIRED_TEXT.filter((name) => flag({ name, values }) === undefined);
  const first = missing[0];
  if (first !== undefined) {
    return `--${first} is required (missing: ${missing.map((name) => `--${name}`).join(", ")})`;
  }
  const caveat = flag({ name: "caveat", values });
  const supersedes = flag({ name: "supersedes", values });
  const base = {
    behaviourChange: flag({ name: "behaviour-change", values })!,
    claim: flag({ name: "claim", values })!,
    domain: flag({ name: "domain", values })!,
    evidence: flag({ name: "evidence", values })!,
    learner: flag({ name: "learner", values })!,
    placement,
    retrievalCue: flag({ name: "retrieval-cue", values })!,
    run: runOf({ values }),
    verdict,
    ...(caveat === undefined ? {} : { caveat }),
    ...(supersedes === undefined ? {} : { supersedes }),
  };
  return base;
}

/**
 * The placement refusal, resolved before every other CHECK — once the command line parses at all.
 *
 * A review pass found the version that did not: a `--placement board` invocation missing `--tier`
 * answered "a lesson needs --tier…" and never named `slopweaver handover ask`, so a writer who had already
 * answered the placement question correctly-for-somewhere-else was told about a flag instead of a
 * destination. The message comes from `KnowledgeErrors.placementRefused`, the same renderer the builder
 * uses, so there is one wording rather than two.
 *
 * The qualifier is exact rather than cautious: a malformed argv (`--tier` with no value) is refused by the
 * parser before any flag has a value to read, so no check of any kind runs. That is every verb here, and it
 * is the only thing that precedes this one.
 *
 * @param values the parsed flags
 * @returns the refusal to print, or undefined when the placement is `retrieved`
 */
function placementRefusal({ values }: { values: Readonly<Record<string, unknown>> }): string | undefined {
  const placement = MEMORY_PLACEMENTS.find((entry) => entry === flag({ name: "placement", values }));
  if (placement === undefined) {
    return `--placement is required and must be one of ${MEMORY_PLACEMENTS.join(", ")}`;
  }
  if (placement === RETAINED_PLACEMENT) {
    return undefined;
  }
  return KnowledgeErrors.placementRefused({
    destination: MEMORY_PLACEMENT_DESTINATIONS[placement],
    placement,
  }).message;
}

/** The whole input, narrowed to one of the two kinds, or the reason it could not be. */
function memoryInput({ values }: { values: Readonly<Record<string, unknown>> }): MemoryInput | string {
  // First of the checks, and the ordering is the point — see `placementRefusal`.
  const refused = placementRefusal({ values });
  if (refused !== undefined) {
    return refused;
  }
  const common = commonFlags({ values });
  if (typeof common === "string") {
    return common;
  }
  const kind = flag({ name: "kind", values });
  if (kind === "preference") {
    // A preference has no measurement behind it, so it carries none of the lesson facets — and a caller who
    // passed one has filed a measurement as a preference, or the reverse. The help promised this refusal
    // before the branch honoured it: the flags were parsed and silently dropped.
    const facet = LESSON_FACET_FLAGS.find((name) => flag({ name, values }) !== undefined);
    if (facet !== undefined) {
      return `a preference carries no --${facet}; a paid-for measurement with a ${facet} is a --kind lesson`;
    }
    return { ...common, kind: "preference" };
  }
  if (kind === "trace") {
    return "a trace is written with `slopweaver knowledge trace` — its claim is derived from the probe and the question";
  }
  if (kind !== "lesson") {
    return "--kind is required and must be lesson or preference";
  }
  const tier: LessonTier | undefined = LESSON_TIERS.find((entry) => String(entry) === flag({ name: "tier", values }));
  const surface: LessonSurface | undefined = LESSON_SURFACES.find(
    (entry) => entry === flag({ name: "surface", values }),
  );
  if (tier === undefined || surface === undefined) {
    return `a lesson needs --tier 1|2|3|4 and --surface ${LESSON_SURFACES.join("|")}`;
  }
  const repro = flag({ name: "repro", values });
  const lesson = { ...common, kind: "lesson", surface, tier } as const;
  return repro === undefined ? lesson : { ...lesson, repro };
}

/**
 * Run `knowledge remember` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRemember(argv: readonly string[]): Promise<number> {
  return runKnowledgeRememberWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge remember` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read
 * @returns the process exit code
 */
export async function runKnowledgeRememberWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REMEMBER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRememberArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: REMEMBER_USAGE });
    return EXIT_USAGE;
  }
  const input = memoryInput({ values: parsed.value.values });
  if (typeof input === "string") {
    logger.error({ msg: `knowledge remember: ${input}` });
    logger.error({ msg: REMEMBER_USAGE });
    return EXIT_USAGE;
  }
  // No --home here: the store below connects to the ambient home, so the vocabulary is read from it too.
  const installDomains = await installDomainsOrExit({
    domains: deps.domains,
    home: undefined,
    verb: "knowledge remember",
  });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const row = buildMemoryRecording({ input, installDomains, recordedAt: new Date(), recordingId: randomUUID() });
  if (row.isErr()) {
    logger.error({ msg: `knowledge remember: ${row.error.message}` });
    return EXIT_USAGE;
  }
  let recording = row.value;
  if (parsed.value.values["redact"] === true) {
    const redacted = redactRecordingForWrite({ home: undefined, recording, verb: "knowledge remember" });
    if (redacted === undefined) {
      return EXIT_ERROR;
    }
    recording = redacted;
  }
  return writeAndReport({ json: parsed.value.values["json"] === true, row: recording });
}

/** Write one built memory row through the store and report it, closing the connection whatever happens. */
async function writeAndReport({ json, row }: { json: boolean; row: MemoryRecording }): Promise<number> {
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge remember: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const written = await recordMemory({ client, row });
    if (written.isErr()) {
      logger.error({ msg: `knowledge remember: ${written.error.message}` });
      return EXIT_ERROR;
    }
    if (json) {
      logger.out({ line: JSON.stringify(written.value) });
      return EXIT_OK;
    }
    logger.out({ line: `knowledge remember: ${written.value.id} (recording ${written.value.recordingId})` });
    logger.out({ line: `  recall it with: slopweaver knowledge recall ${JSON.stringify(written.value.domain)}` });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeRememberCommand = defineCommand({ run: runKnowledgeRemember });
