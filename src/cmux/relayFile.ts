/**
 * A relay too long to paste goes as a FILE, and the session is sent one short line naming it.
 *
 * ## The failure this exists to end
 *
 * `cmux send` pastes the text, then presses Enter. On a long paste Claude Code can lose a contiguous MIDDLE
 * chunk of it, keep the head and the tail, submit what is left as one message — and the verb still answers
 * `submitted`. The seat receiving it cannot tell a sentence that ends early from one that was cut.
 *
 * MEASURED over every supervisor `cmux send` whose text could be matched to the
 * user turn the TARGET session's own transcript recorded: 125 relays, 123 byte-identical, 2 missing a middle
 * chunk. Both were silent.
 *
 * | Sent (chars) | Received head | Received tail | Dropped | Verb said               |
 * | ------------ | ------------- | ------------- | ------- | ----------------------- |
 * | 1,418        | 96            | 400           | 922     | `submitted`, via RESCUE |
 * | 2,695        | 163           | 1,517         | 1,015   | `submitted`             |
 *
 * Whole deliveries reached 1,852 characters, so length alone does not decide it — it is intermittent above a
 * line, and luck below 1,852 is not a property. Both dropped chunks were over 800 characters, which is where
 * Claude Code starts collapsing a paste into a `[Pasted text #N]` placeholder (the composer read-back
 * `./reach.ts` measured); below that no chunk can be collapsed, so none can be lost that way.
 *
 * ## Why a file, and not a read-back or chunks
 *
 * No byte-exact witness of what the session received exists on the send path: the composer collapses exactly
 * the long paste in question, so its text cannot match what was sent (`./reach.ts`), and cmux's own
 * `latest_submitted_message` stops at 240 characters (`./sendEvidence.ts`). Chunking would split one relay into
 * several turns, each a partial instruction the seat may act on before the next arrives. A file is exact by
 * construction and CAN be read back byte for byte, which is the one verification this path can actually do.
 *
 * Repro of the measurement: match each `cmux send "<text>"` in `~/.claude/projects/**\/*.jsonl` to the first
 * user record in another transcript within an hour that starts with the same 50 characters, then compare the
 * two after collapsing whitespace.
 */
import { resolve } from "node:path";

import { sha256Text } from "#lib/hash.js";

/**
 * The most `cmux send` ever types in one paste, in UTF-16 code units (`String.length`), COUNTING the newline
 * `sendLine` appends — so the longest relay pasted inline is one character shorter than this.
 *
 * The measurement is this module's header: both silent middle-drops lost a chunk longer than this, and Claude
 * Code does not collapse a paste at or under it.
 */
export const RELAY_INLINE_MAX_CHARS = 800;

/** How many hex digits of the digest the file name and the pointer line carry. */
const DIGEST_PREFIX_HEX = 12;

/** How a relay will travel: pasted as it is, or written to a file and pointed at. */
export type RelayPlan =
  { readonly kind: "inline" } | { readonly kind: "file"; readonly chars: number; readonly sha256: string };

/**
 * Decide whether a relay can be pasted inline or has to go as a file.
 *
 * @param text the exact text the caller asked to send
 * @returns `inline` when it and its newline fit {@link RELAY_INLINE_MAX_CHARS}, otherwise `file` with its length and digest
 */
export function planRelay({ text }: { text: string }): RelayPlan {
  if (pastesWhole({ line: text })) {
    return { kind: "inline" };
  }
  return { chars: text.length, kind: "file", sha256: sha256Text({ text }).slice("sha256:".length) };
}

/**
 * Where a relay file is written: one file per relay in `stateHomePaths().cmuxRelays`, named for the instant and
 * the digest prefix, so two different relays in the same second land apart.
 *
 * ABSOLUTE whatever `relaysDir` is: the pointer line is read by a session in a different working directory, so a
 * relative `--home` would name a file that session cannot find.
 *
 * @param relaysDir the relay directory `stateHomePaths` names
 * @param nowIso the instant the relay was sent, as an ISO string
 * @param sha256 the relay text's hex digest
 * @returns the absolute path the relay text is written to, resolved against this process's working directory
 */
export function relayFilePath({
  relaysDir,
  nowIso,
  sha256,
}: {
  relaysDir: string;
  nowIso: string;
  sha256: string;
}): string {
  const stamp = nowIso.replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
  return resolve(relaysDir, `${stamp}-${sha256.slice(0, DIGEST_PREFIX_HEX)}.txt`);
}

/**
 * The one short line sent in place of a relay too long to paste.
 *
 * It names the length and digest so the reader can tell it has the whole thing, and says READ IT ALL before
 * acting, because the whole point is that the instruction is in the file and not in this line.
 *
 * @param path the relay file
 * @param chars the relay's length
 * @param sha256 the relay text's hex digest
 * @returns the line to paste
 */
export function relayPointerLine({ path, chars, sha256 }: { path: string; chars: number; sha256: string }): string {
  return (
    `Relay of ${chars} characters, sent as a file because a paste this long can silently lose its middle. ` +
    `Read ALL of it before acting: ${path} (sha256 ${sha256.slice(0, DIGEST_PREFIX_HEX)})`
  );
}

/** The relay file could not be written or read back. */
export interface RelayFileIoError {
  readonly code: "RELAY_FILE_IO";
  readonly message: string;
  readonly path: string;
}

/** The relay file read back, but not byte for byte what was written. */
export interface RelayFileMismatchError {
  readonly code: "RELAY_FILE_MISMATCH";
  readonly message: string;
  readonly path: string;
}

/** The pointer line naming the file would itself be too long to paste — a home path this deep defeats the fix. */
export interface RelayPointerTooLongError {
  readonly code: "RELAY_POINTER_TOO_LONG";
  readonly message: string;
  readonly path: string;
}

/** Why a relay too long to paste could not be staged as a file. Nothing was typed in any of them. */
export type RelayFileError = RelayFileIoError | RelayFileMismatchError | RelayPointerTooLongError;

/** What every refusal says after its own reason: nothing reached the session, and what to do instead. */
function refusalTail({ chars }: { chars: number }): string {
  return (
    `The text is ${chars} characters, over the ${RELAY_INLINE_MAX_CHARS} a paste carries whole (its newline included), so it was not ` +
    `pasted and NOTHING was typed. Put the whole relay in a file the session can read and send one line naming ` +
    `its absolute path.`
  );
}

export const RelayFileErrors = {
  io: ({ chars, detail, path }: { chars: number; detail: string; path: string }): RelayFileIoError => ({
    code: "RELAY_FILE_IO",
    message: `the relay file ${path} could not be written or read back (${detail}). ${refusalTail({ chars })}`,
    path,
  }),
  mismatch: ({ chars, path }: { chars: number; path: string }): RelayFileMismatchError => ({
    code: "RELAY_FILE_MISMATCH",
    message: `the relay file ${path} did not read back byte for byte. ${refusalTail({ chars })}`,
    path,
  }),
  pointerTooLong: ({
    chars,
    path,
    pointerChars,
  }: {
    chars: number;
    path: string;
    pointerChars: number;
  }): RelayPointerTooLongError => ({
    code: "RELAY_POINTER_TOO_LONG",
    message: `the line naming ${path} would be ${pointerChars} characters, itself too long to paste whole. ${refusalTail({ chars })}`,
    path,
  }),
} as const;

/**
 * Whether a line pastes whole — `sendLine` appends a newline to whatever it types, so that counts too. The one
 * test both the relay itself and the pointer line that replaces it must pass.
 *
 * @param line the line about to be typed
 * @returns true when the line and its newline stay within {@link RELAY_INLINE_MAX_CHARS}
 */
export function pastesWhole({ line }: { line: string }): boolean {
  return line.length + 1 <= RELAY_INLINE_MAX_CHARS;
}
