/**
 * `slopweaver proof cassette` — render a session-authored VHS tape to an `.mp4` a pull-request reader can
 * scrub, typed fast enough that nobody waits on it. What the tape may and may not carry, and why, is
 * `src/proof/cassette/tape.ts`; this module is the CLI edge: parse, refuse an output a checkout could carry,
 * render, confirm the file exists, strip its metadata, and write the capture receipt `github attach` requires —
 * the same version-2 receipt every capture verb writes, with the recording's transcript as its frame text
 * (`src/proof/cassette/receipt.ts`).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { slopweaverHome } from "../../../homeDir.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { finaliseCassetteVideo, type VideoFrameSize } from "../../../proof/cassette/finalise.js";
import { cassetteReceiptOf } from "../../../proof/cassette/receipt.js";
import { type CassetteIssue, cassetteTape, cassetteTranscriptPath } from "../../../proof/cassette/tape.js";
import { realVhsExec } from "../../../proof/yarnWhy/vhsExec.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { writeCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { PROOF_CASSETTE_USAGE, parseProofCassetteArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** What `proof cassette` reaches outside itself, injected so every refusal is provable without a real `vhs`. */
export interface ProofCassetteDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly log: Pick<Logger, "error" | "out">;
  /** The tape's text, or why it could not be read. */
  readonly readTape: (args: { path: string }) => Result<string>;
  /** Run one complete tape with `vhs` from `cwd`, clearing any earlier `out` first, or say why it failed. */
  readonly render: (args: { source: string; cwd: string; out: string }) => Result<void>;
  /** Whether the rendered file is on disk — VHS can exit 0 having written nothing. */
  readonly exists: (args: { path: string }) => boolean;
  /** Strip the rendered video's container metadata in place and read its frame size. */
  readonly finalise: (args: { path: string }) => Result<VideoFrameSize>;
  /** The finished video's bytes, which the receipt's digest names. */
  readonly readBytes: (args: { path: string }) => Result<Uint8Array>;
  /** The transcript VHS wrote beside the video, `null` when it wrote none. */
  readonly readTranscript: (args: { path: string }) => string | null;
  /** The instant the receipt records. */
  readonly nowIso: () => string;
}

/** Read a tape off disk. */
function readTape({ path }: { path: string }): Result<string> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (cause: unknown) {
    return err([`cannot read the tape ${path}: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
}

/** Read the finished video's bytes. */
function readBytes({ path }: { path: string }): Result<Uint8Array> {
  try {
    return ok(readFileSync(path));
  } catch (cause: unknown) {
    return err([`cannot read the rendered video ${path}: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
}

/** Read the transcript, or `null` when VHS wrote none. */
function readTranscript({ path }: { path: string }): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

/**
 * Write the built tape to a throwaway directory, run it, and remove the directory either way.
 *
 * An earlier render at `out`, and its transcript, are removed first, so what is on disk after the run is THIS run's.
 */
function renderWithVhs({ source, cwd, out }: { source: string; cwd: string; out: string }): Result<void> {
  rmSync(out, { force: true });
  rmSync(cassetteTranscriptPath({ out }), { force: true });
  const scratch = mkdtempSync(join(tmpdir(), "slopweaver-cassette-"));
  const vhs = realVhsExec();
  try {
    const tapePath = join(scratch, "cassette.tape");
    vhs.writeTape({ path: tapePath, source });
    vhs.runTape({ cwd, tapePath });
    return ok(undefined);
  } catch (cause: unknown) {
    return err([`vhs failed: ${cause instanceof Error ? cause.message : String(cause)}`]);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * The lines a refused tape prints: every issue, then — when one of them is the slow-typing POLICY refusal —
 * the escape hatch that waives it, since a tape that only types slowly would otherwise have rendered.
 */
function cassetteRefusal({ issues }: { issues: readonly CassetteIssue[] }): readonly string[] {
  const messages = issues.map((issue) => issue.message);
  if (!issues.some((issue) => issue.kind === "slow-typing")) {
    return messages;
  }
  return [
    ...messages,
    ...hatchRefusalLines({
      detail: "drop the slow TypingSpeed, @-speed or PlaybackSpeed setting and the cassette types at 5ms",
      hatch: hatchFor({ id: "slow-cassette" }),
    }),
  ];
}

/** Print each failure under the verb's name and return the failing exit code. */
function failed({ log, messages }: { log: ProofCassetteDeps["log"]; messages: readonly string[] }): number {
  for (const message of messages) {
    log.error({ msg: `proof cassette: ${message}` });
  }
  return EXIT_ERROR;
}

/** Print a usage failure and return the usage exit code. */
function usage({ log, messages }: { log: ProofCassetteDeps["log"]; messages: readonly string[] }): number {
  for (const message of messages) {
    log.error({ msg: message });
  }
  log.error({ msg: PROOF_CASSETTE_USAGE });
  return EXIT_USAGE;
}

/**
 * Run `proof cassette`: parse, refuse an output a checkout could carry, build the tape, render, confirm.
 *
 * @param rest the arguments after the verb
 * @param deps the tape read, the render, the invocation's place and the output channels
 * @returns the exit code
 */
export function runProofCassette({ rest, deps }: { rest: readonly string[]; deps: ProofCassetteDeps }): number {
  const { log } = deps;
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: PROOF_CASSETTE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProofCassetteArgs({ rest });
  if (parsed.isErr()) {
    return usage({ log, messages: parsed.error });
  }
  const tape = stringFlag({ name: "tape", parsed: parsed.value });
  const out = stringFlag({ name: "out", parsed: parsed.value });
  if (tape === undefined || out === undefined) {
    return usage({
      log,
      messages: [
        ...(tape === undefined ? ["--tape is required"] : []),
        ...(out === undefined ? ["--out is required"] : []),
      ],
    });
  }
  const cwdFlag = stringFlag({ name: "cwd", parsed: parsed.value });
  const runIn = cwdFlag === undefined ? deps.cwd : resolve(deps.cwd, cwdFlag);
  const absoluteOut = isAbsolute(out) ? out : resolve(deps.cwd, out);
  return renderCassette({ absoluteOut, deps, runIn, tape });
}

/** Refuse an output a checkout could carry, build the tape, render it from `runIn`, and confirm the file. */
function renderCassette({
  absoluteOut,
  deps,
  runIn,
  tape,
}: {
  absoluteOut: string;
  deps: ProofCassetteDeps;
  runIn: string;
  tape: string;
}): number {
  const { log } = deps;
  const placement = refuseProofOutputInTree({
    cwd: deps.cwd,
    env: deps.env,
    home: deps.home,
    output: absoluteOut,
  });
  if (placement.isErr()) {
    return failed({ log, messages: placement.error });
  }
  const source = deps.readTape({ path: resolve(deps.cwd, tape) });
  if (source.isErr()) {
    return failed({ log, messages: source.error });
  }
  const built = cassetteTape({
    allowSlowTyping: deps.env["SLOPWEAVER_ALLOW_SLOW_CASSETTE"] === "1",
    out: absoluteOut,
    source: source.value,
  });
  if (built.isErr()) {
    return failed({ log, messages: cassetteRefusal({ issues: built.error }) });
  }
  const rendered = deps.render({ cwd: runIn, out: absoluteOut, source: built.value });
  if (rendered.isErr()) {
    return failed({ log, messages: rendered.error });
  }
  if (!deps.exists({ path: absoluteOut })) {
    return failed({ log, messages: [`vhs exited cleanly but wrote no ${absoluteOut}`] });
  }
  return recordCassette({ absoluteOut, deps, tape, tapeSource: source.value });
}

/**
 * Strip the rendered video, write its capture receipt, and name the two steps left before it can be attached. A
 * receipt that cannot be written removes the video, so no unreceipted recording is left looking finished.
 */
function recordCassette({
  absoluteOut,
  deps,
  tape,
  tapeSource,
}: {
  absoluteOut: string;
  deps: ProofCassetteDeps;
  tape: string;
  tapeSource: string;
}): number {
  const { log } = deps;
  const frame = deps.finalise({ path: absoluteOut });
  if (frame.isErr()) {
    return failed({ log, messages: frame.error });
  }
  const bytes = deps.readBytes({ path: absoluteOut });
  if (bytes.isErr()) {
    return failed({ log, messages: bytes.error });
  }
  const transcriptPath = cassetteTranscriptPath({ out: absoluteOut });
  const receipt = cassetteReceiptOf({
    bytes: bytes.value,
    capturedAtIso: deps.nowIso(),
    frame: frame.value,
    out: absoluteOut,
    tape: resolve(deps.cwd, tape),
    tapeSource,
    transcript: deps.readTranscript({ path: transcriptPath }),
    transcriptPath,
  });
  const filed = writeCaptureRecord({ home: deps.home, record: receipt });
  if (filed.isErr()) {
    rmSync(absoluteOut, { force: true });
    return failed({
      log,
      messages: [`the capture receipt could not be written, so the video was removed: ${filed.error.message}`],
    });
  }
  log.out({ line: absoluteOut });
  log.out({ line: `  capture receipt ${receipt.captureId}; frame text from ${transcriptPath}` });
  if (receipt.frameText.kind === "incomplete") {
    log.error({
      msg: `proof cassette: frame text incomplete (${receipt.frameText.reasons.join("; ")}) — github attach will refuse this recording`,
    });
  }
  log.out({
    line:
      `next: read the transcript, then record what the recording shows: slopweaver browser image-record ` +
      `--form <form>, citing capture id ${receipt.captureId}`,
  });
  log.out({
    line: `next: slopweaver github attach upload --file ${absoluteOut} --repo <owner/name> --number <pr> --proves "<one line>"`,
  });
  return EXIT_OK;
}

/**
 * The production edges for `proof cassette`.
 *
 * @returns the real tape read, `vhs` render and filesystem check
 */
export function productionProofCassetteDeps(): ProofCassetteDeps {
  return {
    cwd: process.cwd(),
    env: process.env,
    exists: ({ path }) => existsSync(path),
    finalise: finaliseCassetteVideo,
    home: slopweaverHome(),
    log: logger,
    nowIso: () => new Date().toISOString(),
    readBytes,
    readTape,
    readTranscript,
    render: renderWithVhs,
  };
}

/** `slopweaver proof cassette`. */
export const proofCassetteCommand = defineCommand({
  run: (argv) => runProofCassette({ deps: productionProofCassetteDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
