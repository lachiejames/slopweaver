/**
 * `slopweaver talk verb` — the console voice's gateway to the verbs a seat can call, read-only bar the effects
 * `src/talk/modelReads.ts` names as kept, none of which an argument aims.
 *
 * The voice's `verb` tool runs this with the model's `{ noun, verb, args }` as one opaque `--request`. It checks
 * the request against the closed list in `src/talk/modelReads.ts`, then runs the verb as a CHILD `slopweaver`
 * process — this install's own `bin/slopweaver` — so the child passes every standing ruling gate and its own
 * parser exactly as it would from a seat. Nothing here calls a verb's module directly.
 *
 * The child is stopped once a stream passes a byte ceiling, and killed on a deadline shorter than the console's own tool timeout, so what comes back is always one JSON document
 * saying what ran, how it exited and what it printed — `src/talk/verbOutput.ts` shapes it.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { childDeadlineEnv } from "#lib/childDeadline.js";
import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { MODEL_READS, resolveModelRead } from "../../../talk/modelReads.js";
import { shippedVoiceReach } from "../../../talk/shippedReach.js";
import { type CapturedStream, spillWanted, VERB_OUTPUT_MAX_BYTES, verbAnswer } from "../../../talk/verbOutput.js";
import { writeVerbSpill } from "../../../talk/verbSpill.js";
import { refusalLines } from "../../../talk/voiceReach.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { canonicalNoun } from "../../nounAliases.js";
import { parseVerbArgs } from "./verbArgs.js";
import { TALK_VERB_USAGE } from "./verbUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "verb", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How long the child may run. The console kills a tool at 20 s and says only that it timed out, so the
 * gateway stops first and hands back what the child printed and that it was stopped.
 */
const CHILD_DEADLINE_MS = 16_000;

/** How much of each stream the child may write before it is stopped; the answer keeps far less. */
const CAPTURE_MAX_BYTES = 1024 * 1024;

/**
 * Run the `talk verb` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkVerb(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_VERB_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVerbArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_VERB_USAGE });
    return EXIT_USAGE;
  }
  const { request } = parsed.value;
  const resolved = resolveModelRead({ request });
  if (resolved.isErr()) {
    resolved.error.forEach((message) => {
      logger.error({ msg: `talk verb: ${message}` });
    });
    // A verb off the list gets the derived WHY — whether it exists, what it does, what the voice can use instead —
    // route last, because the console hands the model the newest lines of a failure.
    const noun = canonicalNoun({ noun: request.noun });
    if (!MODEL_READS.some((read) => read.noun === noun && read.verb === request.verb)) {
      refusalLines({ noun: request.noun, reach: shippedVoiceReach(), verb: request.verb }).forEach((line) => {
        logger.error({ msg: `talk verb: ${line}` });
      });
    }
    return EXIT_ERROR;
  }
  const childArgv = resolved.value;
  const ran = runVerbChildOver({ childArgv, childCommand: installedVerbCommand() });
  const shape = {
    command: childArgv.join(" "),
    exitCode: ran.exitCode,
    maxBytes: VERB_OUTPUT_MAX_BYTES,
    stderr: ran.stderr,
    stdout: ran.stdout,
    timedOut: ran.timedOut,
    tookMs: ran.tookMs,
  };
  const first = verbAnswer({ ...shape, spill: null, spillFailure: null });
  let answer = first;
  if (spillWanted({ answer: first, captureComplete: ran.complete })) {
    const kept = writeVerbSpill({ home: slopweaverHome(), id: randomUUID(), nowMs: Date.now(), text: ran.stdout.text });
    answer = kept.match(
      (spill) => verbAnswer({ ...shape, spill, spillFailure: null }),
      (problem) => verbAnswer({ ...shape, spill: null, spillFailure: problem.message }),
    );
  }
  if (parsed.value.json) {
    logger.out({ line: JSON.stringify(answer) });
    return EXIT_OK;
  }
  logger.out({ line: `talk verb: ${answer.command} exited ${String(answer.exitCode)} in ${String(answer.tookMs)} ms` });
  logger.out({ line: answer.stdout.text });
  return EXIT_OK;
}

/** One finished child. */
export interface ChildRun {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Whether it exited by itself with every byte it wrote captured: no deadline, no capture ceiling, no spawn error. */
  readonly complete: boolean;
  readonly stdout: CapturedStream;
  readonly stderr: CapturedStream;
  readonly tookMs: number;
}

/** What a verb child is launched as: an executable, and the arguments that precede the verb's own. */
export interface VerbChildCommand {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

/** This install's own `bin/slopweaver`, the only command {@link runTalkVerb} ever launches. */
function installedVerbCommand(): VerbChildCommand {
  return {
    executable: join(installedTreeRoot({ importMetaUrl: import.meta.url }), "bin", "slopweaver"),
    prefixArgs: [],
  };
}

/**
 * Run `<childCommand> <childArgv>` the way `supervisor scratch` runs its reads: synchronously, killed on the
 * deadline, and stopped once a stream passes {@link CAPTURE_MAX_BYTES} — the answer keeps a small fraction of
 * that, so a child still writing past it has already said more than the voice is handed.
 *
 * The command is a parameter so the subprocess lane can stand a verb child over an in-memory register, there
 * being no store in any lane; {@link runTalkVerb} always passes the installed binary, and nothing an argument,
 * a flag or the environment carries can choose another.
 *
 * @param childArgv the verb's own argv, noun first
 * @param childCommand the executable and fixed leading arguments the verb runs under
 * @returns how the child ended and what it printed
 */
export function runVerbChildOver({
  childArgv,
  childCommand,
}: {
  childArgv: readonly string[];
  childCommand: VerbChildCommand;
}): ChildRun {
  const began = Date.now();
  const ran = spawnSync(childCommand.executable, [...childCommand.prefixArgs, ...childArgv], {
    // GIT_OPTIONAL_LOCKS=0: a read such as `fleet status` runs `git status` in other sessions' worktrees, which
    // otherwise refreshes — WRITES — their index.
    // The kill instant goes down too, so a verb whose read grows with a register sizes itself to answer before it.
    env: {
      ...quietLauncherEnv(),
      GIT_OPTIONAL_LOCKS: "0",
      ...childDeadlineEnv({ deadlineAtMs: began + CHILD_DEADLINE_MS }),
    },
    killSignal: "SIGKILL",
    maxBuffer: CAPTURE_MAX_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_DEADLINE_MS,
  });
  const code: unknown = ran.error === undefined ? undefined : Reflect.get(ran.error, "code");
  const timedOut = code === "ETIMEDOUT";
  let failure = "";
  if (code === "ENOBUFS") {
    failure = `talk verb: the verb printed over ${String(CAPTURE_MAX_BYTES)} bytes and was stopped; ask for less\n`;
  } else if (ran.error !== undefined && !timedOut) {
    failure = `talk verb: ${ran.error.message}\n`;
  }
  return {
    complete: ran.error === undefined && ran.status !== null,
    exitCode: ran.status,
    stderr: captured({ bytes: ran.stderr, extra: failure }),
    stdout: captured({ bytes: ran.stdout, extra: "" }),
    timedOut,
    tookMs: Date.now() - began,
  };
}

/** One captured stream as text, a trailing partial character held back so a cut never ends in a replacement mark. */
function captured({ bytes, extra }: { bytes: Buffer | null; extra: string }): CapturedStream {
  // A child that never started has no stream at all, only the reason `extra` carries.
  if (bytes === null) {
    return { bytes: Buffer.byteLength(extra, "utf8"), text: extra };
  }
  const text = new StringDecoder("utf8").write(bytes) + extra;
  return { bytes: bytes.length + Buffer.byteLength(extra, "utf8"), text };
}

export const talkVerbCommand = defineCommand({ run: runTalkVerb });
