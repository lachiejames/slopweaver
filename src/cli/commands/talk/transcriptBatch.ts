/**
 * `talk transcript`'s batch on the way in: read from stdin (`--entries-file -`, the console's route) or a named file
 * (a hand run), then masked against the private denylist before anything is appended (`src/talk/callSanitise.ts`).
 * The console pipes its batch so the unmasked lines are never staged on disk, where a SIGKILL between write and
 * cleanup would have left them.
 */
import { loadDenylistResult, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseCallBatch, readCallBatch } from "../../../talk/callBatch.js";
import { type CallOrigin, stampCallOrigin } from "../../../talk/callOrigin.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { type SanitisedCallBatch, sanitiseCallBatch } from "../../../talk/callSanitise.js";
import { type CallSanitiseError, CallSanitiseErrors } from "../../../talk/callSanitiseErrors.js";
import { type TalkError, TalkErrors } from "../../../talk/errors.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/** `--entries-file -`: the batch arrives on stdin. */
export const STDIN_FILE = "-";

/** A batch masked for the call file, with the denylist it was masked against. */
export type MaskedBatch = SanitisedCallBatch & { readonly denylist: readonly string[] };

/**
 * The batch, read whole and parsed — every line a call line, or none.
 *
 * @param entriesFile `-` for stdin, else the batch file's path
 * @param input what stdin is, so a test hands one in
 * @returns the entries, or why the batch was not read or is refused
 */
export async function readBatch({
  entriesFile,
  input,
}: {
  entriesFile: string;
  input?: AsyncIterable<string | Uint8Array>;
}): Promise<Result<readonly CallEntry[], TalkError>> {
  if (entriesFile !== STDIN_FILE) {
    return readCallBatch({ path: entriesFile });
  }
  let text: string;
  try {
    text = await readStdin(input === undefined ? {} : { input });
  } catch (cause) {
    // A stdin that failed part-way is never parsed: its first lines would read as the whole batch.
    return err(TalkErrors.pathUnreadable({ cause, path: "stdin" }));
  }
  return parseCallBatch({ source: "stdin", text });
}

/**
 * The batch masked against the home's private denylist, loaded only now — after a stdin wait — so a denylist written
 * meanwhile still masks it. An absent denylist masks credential classes alone; an unreadable one refuses the batch.
 *
 * @param entries the batch, origin stamped
 * @param home the home whose denylist applies
 * @returns the lines to append, what masking did and the denylist it masked against — which the store judges the
 * stamped batch by once more — or why nothing may be appended
 */
export function sanitiseBatch({
  entries,
  home,
}: {
  entries: readonly CallEntry[];
  home: string;
}): Result<MaskedBatch, CallSanitiseError> {
  const load = loadDenylistResult({ home });
  if (load.kind === "unreadable") {
    return err(CallSanitiseErrors.denylistUnreadable({ why: unreadableDenylistMessage({ load }) }));
  }
  const denylist = load.kind === "loaded" ? load.lines : [];
  return sanitiseCallBatch({ denylist, entries }).map((sanitised) => ({ ...sanitised, denylist }));
}

/**
 * The batch read, stamped with the console's origin and masked — or why not, with the exit the verb reports it under.
 *
 * @param entriesFile `-` for stdin, else the batch file's path
 * @param origin the console writing the batch, absent on a hand run, which is not stamped
 * @param home the home whose denylist applies
 * @returns the lines to append and what masking did, or the refusal and its exit code
 */
export async function maskedBatch({
  entriesFile,
  origin,
  home,
}: {
  entriesFile: string;
  origin: CallOrigin | undefined;
  home: string;
}): Promise<Result<MaskedBatch, { readonly error: TalkError | CallSanitiseError; readonly exit: number }>> {
  const read = await readBatch({ entriesFile });
  if (read.isErr()) {
    // A stdin that could not be read may read next time; a batch refused as malformed never will. The route answers a
    // usage exit 422 and every other failure 503, which keeps the words on the page (`unappendedStatus`).
    const exit = read.error.code === "PATH_UNREADABLE" && entriesFile === STDIN_FILE ? EXIT_ERROR : EXIT_USAGE;
    return err({ error: read.error, exit });
  }
  // The server's origin goes on every open line, whatever the page sent: the page never says where it was served from.
  let stamped = read.value;
  if (origin !== undefined) {
    stamped = stampCallOrigin({ entries: stamped, origin });
  }
  // Masked after stamping, so nothing reaches the file unjudged. Both failures leave the batch for the page to post
  // again: a denylist being rewritten, or a pathological match, is not the batch being malformed.
  const sanitised = sanitiseBatch({ entries: stamped, home });
  if (sanitised.isErr()) {
    return err({ error: sanitised.error, exit: EXIT_ERROR });
  }
  return ok(sanitised.value);
}
