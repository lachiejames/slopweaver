/**
 * `slopweaver supervisor sweep-prompt` and `slopweaver supervisor state-check` — the two edges that keep the
 * supervisor's standing rules in files a gate can hold true, rather than in prose a successor retypes.
 *
 * Both are thin: every judgement lives in the pure cores (`../../../supervisor/sweepPrompt.js`,
 * `../../../supervisor/stateDoc.js`), which carry the measurements behind their caps. This module resolves a
 * path, reads a file and prints.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { sweepArmDecision } from "../../../supervisor/chairPolicy.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { keepShiftOverflow } from "../../../supervisor/shiftOverflowStore.js";
import {
  MAX_BOOT_BLOCK_LINES,
  MAX_STATE_DOC_LINES,
  parseStateDoc,
  stateDocOffences,
} from "../../../supervisor/stateDoc.js";
import {
  emptyShiftSourceMessage,
  MAX_RENDERED_PROMPT_WORDS,
  shiftStateBudgetWords,
  sweepPromptFrameWords,
  unreadableShiftSourceMessage,
} from "../../../supervisor/sweepPrompt.js";
import { armSweepPrompt } from "../../../supervisor/sweepPromptArm.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../optionParsers.js";
import { type ChairGateEvidence, evidenceLanes, gateChairThenRun, productionChairGateDeps } from "./chairGateRun.js";
import { type SupervisorError, SupervisorErrors, supervisorErrorLines } from "./errors.js";

const SWEEP_USAGE =
  "usage: slopweaver supervisor sweep-prompt [--shift <text> | --shift-file <path>] [--budget] [--json]";
const STATE_USAGE = "usage: slopweaver supervisor state-check --path <doc> [--json]";

/** The sweep verb's flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const SWEEP_PROMPT_FLAG_SPEC = {
  boolean: ["budget", "json"],
  value: ["shift", "shift-file"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** The state-check verb's flag tail — same contract as {@link SWEEP_PROMPT_FLAG_SPEC}. */
export const STATE_CHECK_FLAG_SPEC = {
  boolean: ["json"],
  value: ["path"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** What `supervisor sweep-prompt` resolves to: where the shift state comes from, and how to print. */
export interface SweepPromptOptions {
  /** The shift state given inline, or `undefined` when it comes from a file (or nowhere). */
  readonly shift: string | undefined;
  /** A file to read the shift state from, `-` for stdin, or `undefined` for none. */
  readonly shiftFile: string | undefined;
  /** Print the shift state's word budget and render nothing. Refuses either shift flag beside it. */
  readonly budget: boolean;
  readonly json: boolean;
}

/** What `supervisor state-check` resolves to: which doc to judge, and how to print. */
export interface StateCheckOptions {
  /** The state doc to measure. Required — this verb has no default doc, by design. */
  readonly path: string;
  readonly json: boolean;
}

/**
 * Parse `sweep-prompt`'s flag tail. No I/O — reading the shift file is the caller's job.
 *
 * Two combinations are refused rather than silently resolved. `--shift` beside `--shift-file` used to take
 * the file and drop the inline text with no diagnostic, so a seat that changed its mind about where the
 * state lived armed a prompt carrying the other half. `--budget` beside either one asks two questions at
 * once — what may I write, and render what I wrote — and only ever meant the caller had not decided which.
 *
 * @param rest the flag tail, after the noun/verb tokens
 * @returns the validated options, or every rejection
 */
export function parseSweepPromptOptions({ rest }: { rest: readonly string[] }): Result<SweepPromptOptions> {
  const parsed = parseFlagTail({ rest, spec: SWEEP_PROMPT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const shift = values["shift"];
  const shiftFile = values["shift-file"];
  const budget = flags.has("budget");
  const rejections: string[] = [];
  if (shift !== undefined && shiftFile !== undefined) {
    rejections.push("--shift and --shift-file name two different shift states — give exactly one");
  }
  if (budget && (shift !== undefined || shiftFile !== undefined)) {
    rejections.push(
      "--budget prints the budget for a shift state you have not written yet, so it takes neither --shift nor --shift-file",
    );
  }
  if (rejections.length > 0) {
    return err(rejections);
  }
  return ok({ budget, json: flags.has("json"), shift, shiftFile });
}

/**
 * Parse `state-check`'s flag tail. No I/O — reading the doc is the caller's job.
 *
 * @param rest the flag tail, after the noun/verb tokens
 * @returns the validated options, or every rejection
 */
export function parseStateCheckOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<StateCheckOptions, SupervisorError> {
  const parsed = parseFlagTail({ rest, spec: STATE_CHECK_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SupervisorErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const path = values["path"];
  if (path === undefined || path.length === 0) {
    return err(SupervisorErrors.stateDocPathMissing());
  }
  return ok({ json: flags.has("json"), path });
}

/**
 * Where the standing sweep contract lives, resolved from this module rather than from the working directory
 * so the path is right whichever checkout invoked the CLI.
 *
 * @returns the absolute path of the contract file the armed prompt names
 */
export function sweepContractPath(): string {
  return fileURLToPath(new URL("../../../../skills/supervisor/reference/sweep-contract.md", import.meta.url));
}

/**
 * `supervisor sweep-prompt` — render the prompt to arm, from the contract path plus this tick's shift state.
 *
 * Under the lean shape (one Claude plan standing, `../../../supervisor/chairPolicy.ts`) there is no timer to arm:
 * it says so and exits expected-empty, so a chair re-arming by habit is told rather than handed a prompt.
 *
 * @param argv the full process argv
 * @param evidence what the chair gate read, whose plan lanes decide whether a timer sweep is armed at all
 * @returns the process exit code
 */
export async function runSweepPrompt({
  argv,
  evidence,
}: {
  argv: readonly string[];
  evidence: ChairGateEvidence;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["sweep-prompt"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SWEEP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSweepPromptOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: SWEEP_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const contractPath = sweepContractPath();
  if (options.budget) {
    return reportBudget({ contractPath, json: options.json });
  }
  const shiftState = await resolveShiftState({ options });
  if (shiftState.isErr()) {
    shiftState.error.forEach((message) => {
      logger.error({ msg: `supervisor sweep-prompt: ${message}` });
    });
    return EXIT_ERROR;
  }
  // After the shift-state read, never before it: a source that cannot be read is still said, whatever the arm.
  const arm = sweepArmDecision({ lanes: evidenceLanes({ evidence }) });
  if (arm.kind === "event-woken") {
    logger.error({ msg: `supervisor sweep-prompt: no prompt printed — ${arm.why}` });
    return EXIT_EXPECTED_EMPTY;
  }
  return printArmedSweep({ contractPath, json: options.json, shiftState: shiftState.value });
}

/**
 * Render the armed prompt over this tick's shift state, keep any overflow in its file, and print the prompt.
 *
 * @param contractPath the contract the prompt names
 * @param json print the rendered prompt and its cap as a document
 * @param shiftState this tick's shift state, already read
 * @returns `EXIT_OK` once printed, `EXIT_ERROR` when the render or the overflow write failed
 */
function printArmedSweep({
  contractPath,
  json,
  shiftState,
}: {
  contractPath: string;
  json: boolean;
  shiftState: string;
}): number {
  const armed = armSweepPrompt({ contractPath, home: slopweaverHome(), scope: "sweep", shiftState });
  if (armed.isErr()) {
    supervisorCoreErrorLines({ error: armed.error }).forEach((message) => {
      logger.error({ msg: `supervisor sweep-prompt: ${message}` });
    });
    return EXIT_ERROR;
  }
  const { overflow, rendered } = armed.value;
  if (overflow !== undefined) {
    const kept = keepShiftOverflow({ contents: overflow.contents, path: overflow.path });
    if (kept.isErr()) {
      logger.error({ msg: `supervisor sweep-prompt: ${kept.error.join("; ")} — no prompt printed` });
      return EXIT_ERROR;
    }
    logger.error({
      msg: `supervisor sweep-prompt: shift state overflowed; ${String(overflow.words)} words are only in ${overflow.path}`,
    });
  }
  if (json) {
    logger.out({
      line: JSON.stringify({ cap: MAX_RENDERED_PROMPT_WORDS, contract: contractPath, ...rendered }, null, 2),
    });
    return EXIT_OK;
  }
  logger.out({ line: rendered.prompt });
  return EXIT_OK;
}

/**
 * Print how many words this tick's shift state may run to, before a word of it is written.
 *
 * MEASURED (`../../../supervisor/sweepPrompt.ts` § "The cap is on the RENDERED prompt"): the
 * chair hit this verb's word cap 33 times over 31 ticks, every rendered count between 701 and 790, because
 * the cap it was refused by bounds the whole prompt while the thing it writes is only the shift state. The
 * difference is a number no output carried. This mode carries it.
 *
 * @param contractPath the contract the prompt will name, whose length is part of the frame
 * @param json print the numbers as a document rather than a sentence
 * @returns the process exit code — always ok, since a budget query cannot fail
 */
function reportBudget({ contractPath, json }: { contractPath: string; json: boolean }): number {
  const frameWords = sweepPromptFrameWords({ contractPath });
  const shiftBudgetWords = shiftStateBudgetWords({ contractPath });
  if (json) {
    logger.out({
      line: JSON.stringify(
        { cap: MAX_RENDERED_PROMPT_WORDS, contract: contractPath, frameWords, shiftBudgetWords },
        null,
        2,
      ),
    });
    return EXIT_OK;
  }
  logger.out({
    line:
      `the shift state's budget is ${String(shiftBudgetWords)} words — the ` +
      `${String(MAX_RENDERED_PROMPT_WORDS)}-word cap on the rendered prompt less its ${String(frameWords)}-word ` +
      `frame. The contract it names is ${contractPath}.`,
  });
  return EXIT_OK;
}

/**
 * Where this tick's shift state actually comes from: a file, stdin, an inline flag, or nowhere.
 *
 * Naming nothing is not an error — a quiet tick genuinely has no shift state, and the renderer says so in the
 * prompt rather than leaving the field blank. That is why NO flag at all answers an empty string.
 *
 * **Naming a source that cannot be read IS an error**: answering `""` after logging
 * a line would let the render succeed and the seat arm a wakeup claiming the tick was quiet
 * while the state it had written sat in a path that was mistyped, unwritten or already swept. A prompt that
 * silently drops the state it was given is the failure this whole module exists to prevent, so the read is a
 * refusal and nothing is rendered.
 *
 * **So is naming one that holds NOTHING** — a read that succeeds and yields no words is the same silent drop
 * wearing a different failure. `--shift-file - < /dev/null` would arm a "quiet tick" wakeup and exit 0, which is
 * a broken pipe reported as a deliberate choice. `namedSource` refuses all three spellings identically.
 *
 * @param options the parsed flags
 * @returns the shift state's text, or the reason a named source could not be read
 */
async function resolveShiftState({ options }: { options: SweepPromptOptions }): Promise<Result<string>> {
  const path = options.shiftFile;
  if (path === "-") {
    return namedSource({ source: "standard input", text: await readStdin() });
  }
  if (path !== undefined) {
    try {
      return namedSource({ source: path, text: readFileSync(path, "utf8") });
    } catch {
      return err([unreadableShiftSourceMessage({ source: path })]);
    }
  }
  const inline = options.shift;
  // An `if` rather than `?? ""` or a ternary: `house-rules` bans the coalesce and oxlint's
  // prefer-nullish-coalescing rejects the ternary, so this is the one spelling both gates accept.
  if (inline === undefined) {
    return ok("");
  }
  return namedSource({ source: "--shift", text: inline });
}

/**
 * Accept what a NAMED shift source held, or refuse it for holding nothing.
 *
 * @param source how the refusal should describe where the state was supposed to come from
 * @param text what the source actually yielded
 * @returns the text, or the empty-source refusal
 */
function namedSource({ source, text }: { source: string; text: string }): Result<string> {
  if (text.trim().length === 0) {
    return err([emptyShiftSourceMessage({ source })]);
  }
  return ok(text);
}

/**
 * How long the doc's current boot block is. A doc with no boot block yet has nothing standing against that
 * cap, so it reads as an empty block.
 *
 * @param shape the parsed state doc
 * @returns the current block's line count, `0` when the doc has none
 */
function currentBlockLines({ shape }: { shape: ReturnType<typeof parseStateDoc> }): number {
  const block = shape.currentBlock;
  if (block === undefined) {
    return 0;
  }
  return block.lines;
}

/**
 * `supervisor state-check` — judge a state doc against both caps.
 *
 * Diagnostic-shaped: a non-zero exit REPORTS a finding (the doc is over a cap), never a broken tool.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
function runStateCheck(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["state-check"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStateCheckOptions({ rest });
  if (parsed.isErr()) {
    supervisorErrorLines({ error: parsed.error }).forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: STATE_USAGE });
    return EXIT_USAGE;
  }
  const { path, json } = parsed.value;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    logger.error({ msg: `supervisor state-check: cannot read ${path}` });
    return EXIT_ERROR;
  }
  const shape = parseStateDoc({ text });
  const offences = stateDocOffences({ docPath: path, shape, text });
  const blockLines = currentBlockLines({ shape });
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          blocks: shape.blocks.length,
          bootBlockCap: MAX_BOOT_BLOCK_LINES,
          currentBlockLines: blockLines,
          docCap: MAX_STATE_DOC_LINES,
          offences,
          totalLines: shape.totalLines,
        },
        null,
        2,
      ),
    });
    return offences.length === 0 ? EXIT_OK : EXIT_ERROR;
  }
  if (offences.length === 0) {
    logger.info({
      msg: `supervisor state-check: ${path} is ${shape.totalLines}/${MAX_STATE_DOC_LINES} lines, current boot block ${blockLines}/${MAX_BOOT_BLOCK_LINES} — within both caps`,
    });
    return EXIT_OK;
  }
  offences.forEach((offence) => {
    logger.error({ msg: `supervisor state-check: ${offence.message}` });
  });
  return EXIT_ERROR;
}

/** `slopweaver supervisor sweep-prompt`, behind the chair gate — a seat off its required model cannot re-arm its sweep. */
export const supervisorSweepPromptCommand = defineCommand({
  run: (argv) =>
    gateChairThenRun({
      argv,
      deps: productionChairGateDeps({ argv }),
      run: ({ argv: gated, evidence }) => runSweepPrompt({ argv: gated, evidence }),
      verb: "sweep-prompt",
    }),
});
export const supervisorStateCheckCommand = defineCommand({ run: runStateCheck });
