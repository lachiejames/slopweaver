/**
 * What a `talk relay` CARRIES, read off its flags: the voice's reading or the reads that dropped it, their words alone
 * or typed, a picture or the one reason there is none, and the copy-tray offer they reacted to — with every way those
 * flags get each other wrong.
 *
 * Split from `relayArgs.ts`, which parses the rest of the verb, along the seam the content flags already formed: they
 * are judged together and nothing else in the parse reads them, and the Screen Recording reason carried that file
 * past the file-size ratchet.
 */
import { stringOf, stringOr } from "./flagValues.js";

/** The content flags of a parsed `talk relay`, every one read off the argv as given. */
export interface RelayContent {
  /** The voice's reading, or `undefined` when `--say` was not passed. */
  readonly say: string | undefined;
  readonly readAfter: readonly string[];
  readonly wordsAlone: boolean;
  readonly typed: boolean;
  readonly screen: string | undefined;
  readonly screenFailed: boolean;
  readonly screenNotTaken: boolean;
  readonly screenRecordingOff: boolean;
  readonly offeredFile: string | undefined;
}

/**
 * The comma-separated `--read-after` sources, trimmed, with empty entries dropped.
 *
 * @param value the raw flag value, absent when the flag was not passed
 * @returns the source names in the order given
 */
function readAfterOf({ value }: { value: string | boolean | undefined }): string[] {
  return stringOr({ fallback: "", value })
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source !== "");
}

/**
 * What a relay's content flags get wrong together: the voice's reading, the reads that dropped it, their words
 * alone, or their typed words — exactly one of them — and a picture or the one reason there is none, never two. A
 * typed steer has no look at their screen, so it takes no screen reason: an image they did not attach is its own reason.
 * A copy-tray offer rides a spoken relay only: words-alone and typed carry nothing the voice wrote.
 *
 * @returns every problem found, empty when the pairing holds
 */
function relayContentProblems({
  say,
  readAfter,
  wordsAlone,
  typed,
  screen,
  screenFailed,
  screenNotTaken,
  screenRecordingOff,
  offeredFile,
}: RelayContent): string[] {
  const problems: string[] = [];
  const shapes = [say !== undefined, readAfter.length > 0, wordsAlone, typed].filter(Boolean).length;
  if (shapes === 0) {
    problems.push(
      "talk relay needs --say <words>, --read-after <tool,...> when the voice read something after they spoke, " +
        "--words-alone when a first relay of the turn was refused, or --typed when they typed the steer on the console",
    );
  }
  if (shapes > 1) {
    problems.push(
      "talk relay takes one of --say, --read-after, --words-alone or --typed: after a read or a refusal the voice's reading is dropped and only their words go, and a typed steer has no reading at all",
    );
  }
  if ([screen !== undefined, screenFailed, screenNotTaken, screenRecordingOff].filter(Boolean).length > 1) {
    problems.push(
      "talk relay takes one of --screen <webp-file>, --screen-failed, --screen-not-taken or --screen-recording-off, never two",
    );
  }
  if (typed && (screenFailed || screenNotTaken || screenRecordingOff)) {
    problems.push(
      "talk relay --typed takes no --screen-failed, --screen-not-taken or --screen-recording-off: a typed steer takes no look at their screen, and a missing image is one they did not attach",
    );
  }
  if (offeredFile !== undefined && (wordsAlone || typed)) {
    problems.push(
      "talk relay --offered-file rides a spoken relay only: --words-alone and --typed carry their words and nothing the voice wrote",
    );
  }
  return problems;
}

/**
 * Read a relay's content flags, appending every problem with them to the parse's running list.
 *
 * @param problems the parse's running list, which each refusal is appended to
 * @param values the parsed flags
 * @returns the content as given, valid only when no problem was appended
 */
export function relayContentOf({
  problems,
  values,
}: {
  problems: string[];
  values: Readonly<Record<string, string | boolean>>;
}): RelayContent {
  const content: RelayContent = {
    offeredFile: stringOf({ value: values["offered-file"] }),
    readAfter: readAfterOf({ value: values["read-after"] }),
    say: stringOf({ value: values["say"] }),
    screen: stringOf({ value: values["screen"] }),
    screenFailed: values["screen-failed"] === true,
    screenNotTaken: values["screen-not-taken"] === true,
    screenRecordingOff: values["screen-recording-off"] === true,
    typed: values["typed"] === true,
    wordsAlone: values["words-alone"] === true,
  };
  problems.push(...relayContentProblems(content));
  return content;
}
