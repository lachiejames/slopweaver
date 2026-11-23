/**
 * How `./gitRun.ts`'s git runner reads what a child gave back: its stdout strictly decoded, and its failure as
 * a plain io-shaped error naming the step, the exit code or the bound it was killed at.
 *
 * Split out of `./gitDiff.ts` when giving its runner a per-call bound pushed that file past the size ratchet.
 * The seam is real: this module turns a finished child into a value or an error, and `./gitRun.ts` runs the
 * child.
 */

import { isRecord } from "../lib/parsers.js";

/** Thrown when git's bytes are not valid UTF-8, so the caller can refuse rather than review mojibake. */
export class InvalidUtf8Error extends Error {}

/**
 * Re-throw a git failure as a plain error, DROPPING the `status` field.
 *
 * `toIngestError` classifies anything carrying a `status` as `kind: "http"`, and a `child_process` error's
 * `status` is its exit code — so a git failure was being reported as an HTTP error in the ledger. An exit
 * code is not a status code, and a ledger that says `http` about a local `git` call is lying quietly.
 * The exit code is preserved in the message, where it belongs.
 *
 * @param error what the child call threw
 * @param label what to call this step in the message
 * @param timeoutMs the bound the child ran under, named when it was killed at it
 * @returns the error to throw in its place
 */
export function asIoError({ error, label, timeoutMs }: { error: unknown; label: string; timeoutMs: number }): Error {
  if (error instanceof InvalidUtf8Error) {
    return error;
  }
  // Node reports a child killed at its bound as `code: "ETIMEDOUT"`, with no exit status to name.
  if (isRecord(error) && error["code"] === "ETIMEDOUT") {
    return new Error(`${label} timed out: still running after ${String(timeoutMs / 60_000)} minutes`);
  }
  const status = isRecord(error) ? error["status"] : undefined;
  const stderr = isRecord(error) ? error["stderr"] : undefined;
  const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim().slice(0, 300) : "";
  const code = typeof status === "number" ? ` (exit ${String(status)})` : "";
  return new Error(`${label} failed${code}${detail.length > 0 ? `: ${detail}` : ""}`);
}

/**
 * Decode bytes as UTF-8, refusing rather than substituting U+FFFD for anything malformed.
 *
 * @param bytes the child's captured stdout
 * @param label what to call this step in the refusal
 * @returns the decoded text
 */
export function decodeStrict({ bytes, label }: { bytes: Buffer; label: string }): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidUtf8Error(`${label} produced bytes that are not valid UTF-8`);
  }
}
