/**
 * `slopweaver memory check`, `memory sweep` and `memory hook` — the effectful shells. All the rules live in
 * `src/memory`; these three resolve flags, do the I/O, and choose an exit code.
 *
 * ## Why `sweep` is a verb and not a flag on `check`
 *
 * `check` returns findings and exits non-zero because it found some. `sweep` returns an inventory and has
 * nothing to fail — it exists to be READ, not to pass. One `CommandMeta` cannot honestly describe both, which
 * is the same reasoning that split `check` from `hook`.
 *
 * ## Why `--dir` is required and never derived
 *
 * Claude Code keys auto-memory to the GIT REPOSITORY, so every worktree of a repo shares one directory, and the
 * `<project>` component of that path is undocumented. An earlier design derived it from the working directory:
 * measured against a real machine, that produces a path that does not exist whenever you are in a worktree,
 * which is most of the time. A checker that reads the wrong directory and reports it clean is worse than no
 * checker, so there is no default and no fallback — the caller says where the corpus is.
 *
 * ## Why the two verbs are separate
 *
 * `check` reports to a human and exits non-zero on findings. `hook` speaks a JSON protocol to Claude Code and
 * must ALWAYS exit 0. One flag cannot flip stdin handling, output protocol and exit semantics under a single
 * `CommandMeta` without that metadata becoming a lie.
 */

import { homedir } from "node:os";
import { slopweaverHome } from "../../../homeDir.js";
import type { OwnerDirectiveError } from "../../../judgement/ownerDirective.errors.js";
import { ownerDirectivePort } from "../../../judgement/ownerDirectivePort.js";
import type { OwnerDirectiveSyncOutcome } from "../../../judgement/ownerJudgementRecords.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { checkMemoryCorpus, checkMemoryLeaf } from "../../../memory/check.js";
import { decodeMemoryHookPayload, hookCorpusDir, memoryLeafBasename } from "../../../memory/hookPayload.js";
import { renderMemoryHookOutput, renderMemoryHuman, renderMemoryJson } from "../../../memory/render.js";
import { millisSinceLastChange, readMemoryCorpus, readMemoryLeafFile, resolveRealPath } from "../../../memory/store.js";
import { sweepMemoryCorpus } from "../../../memory/sweep.js";
import { renderMemorySweepHuman, renderMemorySweepJson } from "../../../memory/sweepRender.js";
import type { MemoryCorpus, MemoryFinding, MemoryLeaf } from "../../../memory/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { optionalWholeDays, QUIET_PERIOD_MS, requiredDir, VERB_ARG_OFFSET } from "./args.js";
import { type MemoryVerbError, MemoryVerbErrors } from "./errors.js";
import { resolveAmendsRows } from "./judgedCorpus.js";

const CHECK_USAGE = "usage: slopweaver memory check --dir <path> [--json]";
const SWEEP_USAGE = "usage: slopweaver memory sweep --dir <path> [--json] [--stale-after <days>]";
const HOOK_USAGE = "usage: slopweaver memory hook (--dir <path> | --from-payload)";

/** The flags `memory check` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const CHECK_FLAGS: FlagSpec = { boolean: ["json"], string: ["dir"] };

/** The flags `memory sweep` accepts. */
const SWEEP_FLAGS: FlagSpec = { boolean: ["json"], string: ["dir", "stale-after"] };

/** The flags `memory hook` accepts. */
const HOOK_FLAGS: FlagSpec = { boolean: ["from-payload"], string: ["dir"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_CHECK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: CHECK_FLAGS }),
  ...booleanFlagsOf({ spec: CHECK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_SWEEP_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SWEEP_FLAGS }),
  ...booleanFlagsOf({ spec: SWEEP_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_HOOK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: HOOK_FLAGS }),
  ...booleanFlagsOf({ spec: HOOK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `memory check` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemoryCheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CHECK_FLAGS });
}

/**
 * Parse `memory sweep` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemorySweepArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: SWEEP_FLAGS });
}

/**
 * Parse `memory hook` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemoryHookArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: HOOK_FLAGS });
}

/**
 * Run `memory check`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 clean, 3 with findings, 2 on a bad flag, 1 on an I/O fault
 */
export async function runMemoryCheck(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHECK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemoryCheckArgs({ rest });
  const dir = parsed.isOk() ? requiredDir({ parsed: parsed.value }).mapErr((e) => [e.message]) : err(parsed.error);
  if (dir.isErr()) {
    dir.error.forEach((e) => {
      logger.error({ msg: `memory check: ${e}` });
    });
    logger.error({ msg: CHECK_USAGE });
    return EXIT_USAGE;
  }
  const json = parsed.isOk() && parsed.value.values["json"] === true;
  const read = readMemoryCorpus({ dir: dir.value });
  if (read.isErr()) {
    logger.error({ msg: `memory check: cannot read ${dir.value} — ${read.error.message}` });
    return EXIT_ERROR;
  }
  const findings = checkMemoryCorpus({ corpus: await resolveAmendsRows({ corpus: read.value, home: undefined }) });
  if (json) {
    logger.out({ line: renderMemoryJson({ findings }) });
  } else {
    renderMemoryHuman({ findings }).forEach((line) => {
      logger.error({ msg: line });
    });
  }
  return findings.length === 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Run `memory sweep`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 with rows, 3 when the directory holds no memories to lay out, 2 on a bad flag, 1 on an I/O fault
 */
export async function runMemorySweep(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SWEEP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemorySweepArgs({ rest });
  const settings = parsed.isOk()
    ? combine({
        dir: requiredDir({ parsed: parsed.value }),
        stale: optionalWholeDays({ key: "stale-after", parsed: parsed.value }),
      })
    : err(parsed.error);
  if (settings.isErr()) {
    settings.error.forEach((e) => {
      logger.error({ msg: `memory sweep: ${e}` });
    });
    logger.error({ msg: SWEEP_USAGE });
    return EXIT_USAGE;
  }
  const read = readMemoryCorpus({ dir: settings.value.dir });
  if (read.isErr()) {
    logger.error({ msg: `memory sweep: cannot read ${settings.value.dir} — ${read.error.message}` });
    return EXIT_ERROR;
  }
  const corpus = await resolveAmendsRows({ corpus: read.value, home: undefined });
  const sweep = sweepMemoryCorpus({ corpus, now: Date.now(), staleAfterDays: settings.value.stale });
  if (parsed.isOk() && parsed.value.values["json"] === true) {
    logger.out({ line: renderMemorySweepJson({ sweep }) });
  } else {
    renderMemorySweepHuman({ sweep }).forEach((line) => {
      logger.error({ msg: line });
    });
  }
  return sweep.rows.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** Both settings, or EVERY rejection — so a caller who got two flags wrong is told about both in one run. */
function combine({
  dir,
  stale,
}: {
  dir: Result<string, MemoryVerbError>;
  stale: Result<number | null, MemoryVerbError>;
}): Result<{ dir: string; stale: number | null }> {
  if (dir.isOk() && stale.isOk()) {
    return ok({ dir: dir.value, stale: stale.value });
  }
  return err([...(dir.isOk() ? [] : [dir.error.message]), ...(stale.isOk() ? [] : [stale.error.message])]);
}

/** The injectable edges of the hook, so its every branch is unit-testable without a process or a filesystem. */
export interface MemoryHookDeps {
  readonly readStdin: () => Promise<string>;
  readonly readCorpus: typeof readMemoryCorpus;
  /** Fills each amending memory's board row state, so a session-start check judges `amends-canon-without-row`. */
  readonly resolveAmendsRows: (args: { corpus: MemoryCorpus }) => Promise<MemoryCorpus>;
  readonly readLeaf: typeof readMemoryLeafFile;
  readonly lastChangeMillis: (args: { dir: string }) => number | null;
  readonly userHome: () => string;
  readonly resolvePath: (args: { path: string }) => string;
  /** Apply the event's explicit owner directives to the store; a refusal is reported, never thrown. */
  readonly syncOwnerDirectives: (args: {
    leaves: readonly MemoryLeaf[];
  }) => Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>>;
  readonly out: (line: string) => void;
  readonly warn: (line: string) => void;
}

/** The leaves observed by an event and the integrity findings generated from the same parse. */
interface MemoryHookAssessment {
  readonly findings: readonly MemoryFinding[];
  readonly leaves: readonly MemoryLeaf[];
}

/** Decide a session-start event, or `null` when the corpus is too fresh to judge or cannot be read. */
async function sessionStartAssessment({
  dir,
  deps,
}: {
  dir: string;
  deps: MemoryHookDeps;
}): Promise<MemoryHookAssessment | null> {
  const age = deps.lastChangeMillis({ dir });
  if (age !== null && age < QUIET_PERIOD_MS) {
    return null;
  }
  const read = deps.readCorpus({ dir });
  if (read.isErr()) {
    deps.warn(`memory hook: cannot read ${dir} — ${read.error.message}`);
    return null;
  }
  const corpus = await deps.resolveAmendsRows({ corpus: read.value });
  return { findings: checkMemoryCorpus({ corpus }), leaves: corpus.leaves };
}

/** Decide one written file, or `null` when it is not a corpus leaf. */
function writeAssessment({
  dir,
  filePath,
  deps,
}: {
  dir: string;
  filePath: string;
  deps: MemoryHookDeps;
}): MemoryHookAssessment | null {
  const basename = memoryLeafBasename({
    resolvedDir: deps.resolvePath({ path: dir }),
    resolvedFile: deps.resolvePath({ path: filePath }),
  });
  if (basename === null) {
    return null;
  }
  const read = deps.readLeaf({ basename, dir });
  if (read.isErr()) {
    deps.warn(`memory hook: cannot read ${basename} — ${read.error.message}`);
    return null;
  }
  return { findings: checkMemoryLeaf({ leaf: read.value }), leaves: [read.value] };
}

/**
 * The hook's decision core. Returns the JSON to print, or `null` to print nothing.
 *
 * @param dir the corpus directory
 * @param deps the injectable I/O edges
 * @returns one protocol JSON object, or `null` for silence
 */
export async function memoryHookOutput({
  dir,
  deps,
}: {
  dir: string | null;
  deps: MemoryHookDeps;
}): Promise<string | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(await deps.readStdin());
  } catch {
    // A malformed payload is a wiring fault, not a memory defect. Say so on stderr (visible in hook debug
    // output) and print nothing, because the protocol channel is for findings only.
    deps.warn("memory hook: could not parse the hook payload");
    return null;
  }
  const request = decodeMemoryHookPayload({ payload });
  if (request.kind === "ignore") {
    return null;
  }
  const effectiveDir = hookCorpusDir({ dir, request, userHome: deps.userHome });
  if (effectiveDir === null) {
    return null;
  }
  const assessment =
    request.kind === "check-corpus"
      ? await sessionStartAssessment({ deps, dir: effectiveDir })
      : writeAssessment({ deps, dir: effectiveDir, filePath: request.filePath });
  if (assessment === null) {
    return null;
  }
  const synced = await deps.syncOwnerDirectives({ leaves: assessment.leaves });
  return renderMemoryHookOutput({
    event: request.kind === "check-corpus" ? "SessionStart" : "PostToolUse",
    findings: assessment.findings,
    problems: synced.isOk() ? [] : [synced.error.message],
  });
}

/** The real I/O edges. Separate from the verb so the verb reads as its control flow rather than its wiring. */
function productionHookDeps(): MemoryHookDeps {
  return {
    lastChangeMillis: ({ dir: corpusDir }) => {
      const age = millisSinceLastChange({ dir: corpusDir, now: Date.now() });
      return age.isOk() ? age.value : null;
    },
    out: (line) => {
      logger.out({ line: line });
    },
    readCorpus: readMemoryCorpus,
    readLeaf: readMemoryLeafFile,
    resolveAmendsRows: ({ corpus }) => resolveAmendsRows({ corpus, home: undefined }),
    readStdin: async () => (await import("../../../lib/readStdin.js")).readStdin(),
    resolvePath: resolveRealPath,
    syncOwnerDirectives: ({ leaves }) => ownerDirectivePort().syncFromMemory({ home: slopweaverHome(), leaves }),
    userHome: homedir,
    warn: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/**
 * Run `memory hook`. ALWAYS returns 0.
 *
 * Even a bad flag returns 0, which looks wrong and is not: `EXIT_USAGE` is 2, and 2 is the one code Claude Code
 * reads as a hook error worth surfacing to the model. A validator must never occupy that channel — the usage
 * message still goes to stderr, where a mis-wired hook shows up in debug output.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns `EXIT_OK`, unconditionally
 */
export async function runMemoryHook(argv: readonly string[]): Promise<number> {
  try {
    await hookBody({ argv });
  } catch {
    // Deliberately silent. Anything that could report the failure is itself a write to a stream that may be
    // the reason we are here, so attempting one would be the same bug one level down.
  }
  return EXIT_OK;
}

/**
 * Everything the hook actually does. Split out so {@link runMemoryHook} is a single unconditional
 * `return EXIT_OK` with no branch that can bypass it.
 *
 * The split is not cosmetic. An earlier version put the try block AFTER argument parsing, so the unknown-flag
 * path wrote its usage message to stderr while still outside the guard. A review found the counterexample and it
 * reproduced first try: with `process.stderr.write` throwing `EPIPE` — which is what happens when the hook's
 * reader has gone away — `memory hook --bogus` REJECTED instead of returning 0. Every statement that touches a
 * stream now sits inside the guard, including the diagnostics.
 */
async function hookBody({ argv }: { argv: readonly string[] }): Promise<void> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HOOK_USAGE });
    return;
  }
  const parsed = parseMemoryHookArgs({ rest });
  const dir = parsed.isOk() ? hookDirectory({ parsed: parsed.value }).mapErr((e) => [e.message]) : err(parsed.error);
  if (dir.isErr()) {
    dir.error.forEach((e) => {
      logger.error({ msg: `memory hook: ${e}` });
    });
    logger.error({ msg: HOOK_USAGE });
    return;
  }
  const output = await memoryHookOutput({ deps: productionHookDeps(), dir: dir.value });
  if (output !== null) {
    logger.out({ line: output });
  }
}

/** Resolve the hook's one directory source: an explicit configured corpus, or the trusted Write payload. */
function hookDirectory({ parsed }: { parsed: ParsedFlags }): Result<string | null, MemoryVerbError> {
  const fromPayload = parsed.values["from-payload"] === true;
  const explicit = parsed.values["dir"];
  if (fromPayload && explicit !== undefined) {
    return err(MemoryVerbErrors.exclusiveFlags({ flags: ["--dir", "--from-payload"] }));
  }
  if (fromPayload) {
    return ok(null);
  }
  return requiredDir({ parsed });
}

export const memoryCheckCommand = defineCommand({ run: runMemoryCheck });

export const memorySweepCommand = defineCommand({ run: runMemorySweep });

export const memoryHookCommand = defineCommand({ run: runMemoryHook });
