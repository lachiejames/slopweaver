/**
 * `slopweaver memory gate` — the loud recurring run, and its own installer.
 *
 * ## Why this is a verb rather than a flag on `memory check`
 *
 * `check` is pointed at ONE directory by a human or a hook config, so a missing directory there means the
 * path is wrong and saying "clean" would be the precise failure requiring `--dir` exists to prevent
 * (`../../../memory/store.ts`'s header). `gate` is pointed at nothing: it DISCOVERS every corpus on the
 * machine, and having none is the honest state of a fresh install rather than a mistake. Two opposite
 * contracts over a missing directory cannot live under one `CommandMeta` without that metadata becoming a
 * lie — the same reasoning `./run.ts`'s header gives for splitting `check` from `sweep` from `hook`.
 *
 * ## What it is wired to, and what that does NOT mean
 *
 * `--install` writes a `pre-push` hook into the state repository. That hook gates nothing about what is
 * being pushed, and `../../../memory/prePushHook.ts` carries the measurement proving why it cannot: the
 * corpus is not in that repository, and the directory it does live in is not a git repository at all. The
 * hook rides the repository this fleet pushes often so that a standing defect is seen, which is the true
 * half of what the scoping doc asked for.
 *
 * ## What it refuses ON, which is not "the corpus is dirty"
 *
 * A fresh finding blocks; an accepted one is reported and does not. `../../../memory/gateBaseline.ts`
 * carries the measurement that forced that split — the first working install refused every push on five
 * defects that predated it, in corpora belonging to other projects, none of which this work is allowed to
 * repair. `--accept` is the only way onto that list and it is never automatic.
 */
import { homedir } from "node:os";

import { declaredMainCheckoutPaths } from "../../../admit/declaredMainCheckouts.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { EscapeHatch } from "../../../hatch/types.js";
import { logger } from "../../../lib/logger.js";
import { checkMemoryCorpus } from "../../../memory/check.js";
import {
  acceptedKeys,
  countFindings,
  type MemoryGateResult,
  partitionAgainstBaseline,
  shrunkBaseline,
} from "../../../memory/gateBaseline.js";
import { gateBaselinePath, readGateBaseline, writeGateBaseline } from "../../../memory/gateBaselineStore.js";
import {
  firstAnsweringGate,
  gateBinaryCandidates,
  prePushInstallVerdict,
  readExistingHook,
  treeRootHoldingLauncher,
  writePrePushHook,
} from "../../../memory/prePushHook.js";
import { renderMemoryHuman } from "../../../memory/render.js";
import { discoverMemoryCorpora, readMemoryCorpus } from "../../../memory/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { resolveAmendsRows } from "./judgedCorpus.js";

const GATE_USAGE = "usage: slopweaver memory gate [--install] [--accept] [--json]";

/** Where a verb's own arguments start: `[node, cli, memory, gate, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `memory gate` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const GATE_FLAGS: FlagSpec = { boolean: ["accept", "install", "json"] };

/** The ambient variable this gate's register row names. */
const HATCH_ENV = "SLOPWEAVER_ALLOW_MEMORY_CORPUS";

/** This gate's own register row — the refusal text is the register's, never this module's. */
const HATCH: EscapeHatch = ESCAPE_HATCHES.find((hatch) => hatch.id === "memory-corpus")!; // registry-owned

/**
 * `--`-prefixed, for the help-truth ratchet.
 *
 * Read off the one `FlagSpec` above rather than restated, so a flag added there cannot go unadvertised. Both
 * groups are destructured with a default instead of `??`: this verb declares no string flags today, and
 * `no-silent-fallback` is right that a substitution should be visible at the point it happens.
 */
const { boolean: BOOLEAN_FLAGS = [], string: STRING_FLAGS = [] } = GATE_FLAGS;

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_GATE_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `memory gate` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemoryGateArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: GATE_FLAGS });
}

/**
 * The state repository's pre-push hook path, read off the one home contract rather than joined here — see
 * `stateHome.ts`'s `statePrePushHook`, and the guard test that refuses a second derivation.
 */
function prePushPath(): string {
  return stateHomePaths().statePrePushHook;
}

/**
 * Install (or refresh) the pre-push hook.
 *
 * The launcher is resolved and PROVED to answer `memory gate --help` before anything is written. Both
 * halves of that were defects here in turn: a path that is not there takes the hook's fail-open branch and
 * reports success while checking nothing, and a path that IS there but whose branch lacks the verb refuses
 * every push with a usage error. `../../../memory/prePushHook.ts` carries both measurements.
 *
 * @returns 0 when the hook is in place, 1 when it could not be written, 3 when something else owns the path
 *   or no candidate launcher answers the verb
 */
function install(): number {
  const path = prePushPath();
  const treeRoot = treeRootHoldingLauncher({ moduleUrl: import.meta.url });
  if (treeRoot === null) {
    logger.error({ msg: "memory gate --install: cannot find this install's own bin/slopweaver launcher" });
    return EXIT_EXPECTED_EMPTY;
  }
  const binary = firstAnsweringGate({
    candidates: gateBinaryCandidates({
      declaredCheckouts: declaredMainCheckoutPaths(),
      env: process.env,
      treeRoot,
      userHome: homedir(),
    }),
  });
  if (binary === null) {
    logger.error({
      msg: "memory gate --install: no candidate launcher answers `memory gate --help` — install the plugin mirror, or land this verb on the declared main checkout, then re-run",
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const verdict = prePushInstallVerdict({ existing: readExistingHook({ path }) });
  if (verdict.action === "refuse") {
    logger.error({ msg: `memory gate --install: ${path} — ${verdict.reason}` });
    return EXIT_EXPECTED_EMPTY;
  }
  const written = writePrePushHook({ binary, path });
  if (written.isErr()) {
    logger.error({ msg: `memory gate --install: cannot write ${path} — ${written.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `memory gate: ${verdict.action === "refresh" ? "refreshed" : "installed"} ${path} -> ${binary}` });
  return EXIT_OK;
}

/**
 * Check every corpus on the machine. Every corpus's amendment rows are judged against the ONE board in the
 * ambient `$SLOPWEAVER_HOME`, whichever project the corpus belongs to.
 *
 * @param userHome the current user's home directory
 * @returns one result per corpus, or a message saying why none could be read
 */
async function checkEveryCorpus({
  userHome,
}: {
  userHome: string;
}): Promise<{ results: readonly MemoryGateResult[] } | { error: string }> {
  const corpora = discoverMemoryCorpora({ userHome });
  if (corpora.isErr()) {
    return { error: corpora.error.message };
  }
  const results: MemoryGateResult[] = [];
  for (const dir of corpora.value) {
    const read = readMemoryCorpus({ dir });
    if (read.isErr()) {
      return { error: `cannot read ${dir} — ${read.error.message}` };
    }
    const corpus = await resolveAmendsRows({ corpus: read.value, home: undefined });
    results.push({ dir, findings: checkMemoryCorpus({ corpus }) });
  }
  return { results };
}

/**
 * Record every finding standing right now as accepted debt.
 *
 * Deliberately a flag rather than something the report does on its own: the scoping doc's fourth item is
 * *"Do NOT auto-fix"*, and a gate that quietly accepts what it just found is the same defect wearing a
 * different hat — it would make the first run after any regression green.
 *
 * @param results one entry per discovered corpus
 * @returns 0 once written, 1 when the list could not be written
 */
function accept({ results }: { results: readonly MemoryGateResult[] }): number {
  const path = gateBaselinePath();
  const accepted = readGateBaseline({ path });
  if (accepted.isErr()) {
    logger.error({ msg: `memory gate --accept: cannot read ${path} — ${accepted.error.message}` });
    return EXIT_ERROR;
  }
  const keys = acceptedKeys({ accepted: accepted.value, results });
  const written = writeGateBaseline({ keys, path });
  if (written.isErr()) {
    logger.error({ msg: `memory gate --accept: cannot write ${path} — ${written.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `memory gate: accepted ${String(keys.length)} standing finding(s) into ${path}` });
  return EXIT_OK;
}

/**
 * Run `slopweaver memory gate`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 clean or hatched, 3 with a fresh finding, 2 on a bad flag, 1 on an I/O fault
 */
export async function runMemoryGate(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemoryGateArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: `memory gate: ${e}` });
    });
    logger.error({ msg: GATE_USAGE });
    return EXIT_USAGE;
  }
  if (parsed.value.values["install"] === true) {
    return install();
  }
  const outcome = await checkEveryCorpus({ userHome: homedir() });
  if ("error" in outcome) {
    logger.error({ msg: `memory gate: ${outcome.error}` });
    return EXIT_ERROR;
  }
  if (parsed.value.values["accept"] === true) {
    return accept({ results: outcome.results });
  }
  return judge({ json: parsed.value.values["json"] === true, results: outcome.results });
}

/**
 * Partition a run against the debt list, report it, shrink the list, and decide the exit code.
 *
 * @param results one entry per discovered corpus
 * @param json whether to emit the machine shape instead of the human report
 * @returns 0 when nothing fresh stands or the hatch is open, 3 on a fresh finding, 1 when the list is
 *   unreadable
 */
function judge({ results, json }: { results: readonly MemoryGateResult[]; json: boolean }): number {
  const path = gateBaselinePath();
  const accepted = readGateBaseline({ path });
  if (accepted.isErr()) {
    logger.error({ msg: `memory gate: cannot read ${path} — ${accepted.error.message}` });
    return EXIT_ERROR;
  }
  const split = partitionAgainstBaseline({ accepted: accepted.value, results });
  const freshCount = countFindings({ results: split.fresh });
  if (split.staleKeys.length > 0) {
    // The list only ever shrinks, so a fixed defect cannot come back for free. A failure to narrow it is not
    // worth failing the run over — the findings printed below are the answer the caller actually asked for.
    writeGateBaseline({ keys: shrunkBaseline({ accepted: accepted.value, staleKeys: split.staleKeys }), path });
  }
  report({ json, results, split });
  if (freshCount === 0) {
    return EXIT_OK;
  }
  // Read as a local and OR it in, never as a parameter default: `hatch-release` refuses a default
  // initialiser, because a caller passing its own argument would silently close a hatch it must only widen.
  const hatchOpen = process.env[HATCH_ENV] === "1";
  if (hatchOpen) {
    return EXIT_OK;
  }
  hatchRefusalLines({ detail: `${String(freshCount)} new finding(s)`, hatch: HATCH }).forEach((line) => {
    logger.error({ msg: line });
  });
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Print what every corpus said, with the fresh findings separated from the accepted ones.
 *
 * @param results one entry per discovered corpus, carrying the count the header names
 * @param split the fresh and standing buckets
 * @param json whether to emit the machine shape instead of the human report
 */
function report({
  results,
  split,
  json,
}: {
  results: readonly MemoryGateResult[];
  split: { readonly fresh: readonly MemoryGateResult[]; readonly standing: readonly MemoryGateResult[] };
  json: boolean;
}): void {
  if (json) {
    logger.out({ line: JSON.stringify({ fresh: split.fresh, standing: split.standing }, null, 2) });
    return;
  }
  const standingCount = countFindings({ results: split.standing });
  logger.error({
    msg: `memory gate: ${String(results.length)} corpus/corpora checked, ${String(standingCount)} already accepted`,
  });
  // A corpus contributing nothing to a bucket is skipped rather than rendered: `renderMemoryHuman` answers
  // "memory: clean" for an empty list, which is true of a whole corpus and a lie about one bucket of it.
  printBucket({ label: "NEW", results: split.fresh });
  printBucket({ label: "accepted", results: split.standing });
}

/**
 * Print one bucket, skipping the corpora that contributed nothing to it.
 *
 * @param label how each line is marked — the word that tells a reader whether this blocked the run
 * @param results the bucket
 */
function printBucket({ label, results }: { label: string; results: readonly MemoryGateResult[] }): void {
  results
    .filter((result) => result.findings.length > 0)
    .forEach((result) => {
      renderMemoryHuman({ findings: result.findings }).forEach((line) => {
        logger.error({ msg: `  ${label} ${result.dir}: ${line}` });
      });
    });
}

export const memoryGateCommand = defineCommand({ run: runMemoryGate });
