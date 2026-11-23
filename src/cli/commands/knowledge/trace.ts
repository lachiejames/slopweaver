/**
 * `slopweaver knowledge trace` — write ONE trace: where an investigation looked, and what came back.
 *
 * The third memory kind — the exact probe, whether it paid or was empty,
 * and what the emptiness does not prove. A second verb rather than `remember --kind trace`, because a trace's
 * claim and both placement fields are DERIVED from the probe, the question and the outcome
 * (`../../../knowledge/trace.ts` says why), so the flags a writer supplies are different ones.
 *
 * The connection is opened here and closed in a `finally`, exactly as `./remember.ts` does. An unreachable
 * store is a non-zero exit carrying the reason.
 */
import { randomUUID } from "node:crypto";

import { type MemoryRecording, TRACE_OUTCOMES } from "../../../knowledge/memory.js";
import { recordMemory } from "../../../knowledge/memoryRecordStore.js";
import { buildMemoryRecording, type MemoryInput } from "../../../knowledge/memoryRow.js";
import { type TraceFields, traceInput } from "../../../knowledge/trace.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { TRACE_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeTraceArgs } from "./flagSpecs.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";
import { redactRecordingForWrite } from "./redactionContext.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * A flag's value, or the stated default when the flag was not supplied — an `if` naming the absent case.
 *
 * @param values the parsed flags
 * @param name which flag to read
 * @param absent what an unsupplied flag means, as the usage text states it
 * @returns the supplied value, or the default
 */
function flagWhenAbsent({
  values,
  name,
  absent,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
  absent: string;
}): string {
  const supplied = flag({ name, values });
  if (supplied === undefined) {
    return absent;
  }
  return supplied;
}

/** The text flags a trace cannot be written without. */
const REQUIRED: readonly string[] = ["domain", "question", "probe", "outcome", "evidence"];

/**
 * The trace a writer supplied, or the first flag missing or outside its vocabulary.
 *
 * @param values the parsed flags
 * @returns the fields, or the refusal to print
 */
function traceFields({ values }: { values: Readonly<Record<string, unknown>> }): TraceFields | string {
  const missing = REQUIRED.filter((name) => flag({ name, values }) === undefined);
  const first = missing[0];
  if (first !== undefined) {
    return `--${first} is required (missing: ${missing.map((name) => `--${name}`).join(", ")})`;
  }
  const outcome = TRACE_OUTCOMES.find((entry) => entry === flag({ name: "outcome", values }));
  if (outcome === undefined) {
    return `--outcome must be one of ${TRACE_OUTCOMES.join(", ")}`;
  }
  const doesNotProve = flag({ name: "does-not-prove", values });
  // Both defaults are stated in TRACE_USAGE: a trace is an investigation's own record unless they are the one
  // who looked, and a trace written off any board row is ad-hoc.
  const base = {
    domain: flag({ name: "domain", values })!,
    evidence: flag({ name: "evidence", values })!,
    learner: flagWhenAbsent({ absent: "fleet", name: "learner", values }),
    outcome,
    probe: flag({ name: "probe", values })!,
    question: flag({ name: "question", values })!,
    run: flagWhenAbsent({ absent: "ad-hoc", name: "run", values }),
  };
  return doesNotProve === undefined ? base : { ...base, doesNotProve };
}

/**
 * The recording a trace's input builds against the ambient home's vocabulary, or the exit code of a refusal
 * already printed.
 *
 * @param input the trace, as `traceInput` derived it
 * @param deps where the install's own domains are read
 * @returns the recording to write, or the exit code
 */
async function traceRecording({
  deps,
  input,
}: {
  deps: KnowledgeDomainDeps;
  input: MemoryInput;
}): Promise<MemoryRecording | number> {
  // No --home here: the store connects to the ambient home, so the vocabulary is read from it too.
  const installDomains = await installDomainsOrExit({
    domains: deps.domains,
    home: undefined,
    verb: "knowledge trace",
  });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const row = buildMemoryRecording({ input, installDomains, recordedAt: new Date(), recordingId: randomUUID() });
  if (row.isErr()) {
    logger.error({ msg: `knowledge trace: ${row.error.message}` });
    return EXIT_USAGE;
  }
  return row.value;
}

/**
 * Run `knowledge trace` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeTrace(argv: readonly string[]): Promise<number> {
  return runKnowledgeTraceWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge trace` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read
 * @returns the process exit code
 */
export async function runKnowledgeTraceWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TRACE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeTraceArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: TRACE_USAGE });
    return EXIT_USAGE;
  }
  const fields = traceFields({ values: parsed.value.values });
  if (typeof fields === "string") {
    logger.error({ msg: `knowledge trace: ${fields}` });
    logger.error({ msg: TRACE_USAGE });
    return EXIT_USAGE;
  }
  const input = traceInput({ fields });
  if (input.isErr()) {
    logger.error({ msg: `knowledge trace: ${input.error.message}` });
    return EXIT_USAGE;
  }
  const row = await traceRecording({ deps, input: input.value });
  if (typeof row === "number") {
    return row;
  }
  let recording = row;
  if (parsed.value.values["redact"] === true) {
    const redacted = redactRecordingForWrite({ home: undefined, recording, verb: "knowledge trace" });
    if (redacted === undefined) {
      return EXIT_ERROR;
    }
    recording = redacted;
  }
  return writeAndReport({ fields, json: parsed.value.values["json"] === true, row: recording });
}

/** Write one built trace row through the store and report it, closing the connection whatever happens. */
async function writeAndReport({
  fields,
  json,
  row,
}: {
  fields: { outcome: string; question: string };
  json: boolean;
  row: MemoryRecording;
}): Promise<number> {
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge trace: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const written = await recordMemory({ client, row });
    if (written.isErr()) {
      logger.error({ msg: `knowledge trace: ${written.error.message}` });
      return EXIT_ERROR;
    }
    if (json) {
      logger.out({ line: JSON.stringify(written.value) });
      return EXIT_OK;
    }
    logger.out({
      line: `knowledge trace: ${written.value.id} (recording ${written.value.recordingId}) — ${fields.outcome}`,
    });
    logger.out({
      line: `  recall it with: slopweaver knowledge recall ${JSON.stringify(fields.question)} --kind trace`,
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeTraceCommand = defineCommand({ run: runKnowledgeTrace });
