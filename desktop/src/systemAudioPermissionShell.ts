/**
 * Run the System Audio Recording helper (`native/SystemAudioPermission.swift`): `preflight` reads where macOS stands
 * and never prompts; `request` raises macOS's prompt and waits for the owner's answer. The decisions are
 * `systemAudioPermission.ts`; this file only runs the process.
 */
import { execFile } from "node:child_process";

import { err, type Result, ResultAsync } from "neverthrow";

import { type PermissionGuideError, PermissionGuideErrors, type SystemAudioHelperVerb } from "./errors";
import type { MacAccessStatus } from "./permissionGuide";
import { parseSystemAudioHelperResult } from "./systemAudioPermission";

/** A preflight is one local TCC lookup: anything slower than this is a hang. */
const PREFLIGHT_TIMEOUT_MS = 3000;

/**
 * A request waits on the owner. Bounded so a callback TCC never delivers cannot hold the guide forever; stopping the helper
 * does not take macOS's own prompt down, so the guide keeps re-reading and ticks it off if the owner answers after.
 */
const REQUEST_TIMEOUT_MS = 5 * 60_000;

/** The helper prints one word; anything near this is not it. */
const MAX_OUTPUT_BYTES = 4096;

/**
 * How long past its timeout a killed helper may take to be reported, before the read ends without it: a process
 * that left its output open to another one can hold `execFile`'s callback after the kill.
 */
const KILL_GRACE_MS = 1000;

/**
 * Run one helper verb, with no shell and nothing on stdin.
 *
 * @param helperPath the helper's absolute path (`helperPathOf`)
 * @param verb which verb
 * @param timeoutMs how long it may run
 * @returns the status it answered, or why there is none
 */
function runHelper({
  helperPath,
  verb,
  timeoutMs,
}: {
  helperPath: string;
  verb: SystemAudioHelperVerb;
  timeoutMs: number;
}): ResultAsync<MacAccessStatus, PermissionGuideError> {
  const ran = new Promise<Result<MacAccessStatus, PermissionGuideError>>((resolve) => {
    // A read that never ends would hold every read joined to it, so the deadline does not wait on the callback. A
    // second resolve is a no-op, so whichever comes first is the answer.
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(err(PermissionGuideErrors.helperTimedOut({ timeoutMs, verb })));
    }, timeoutMs + KILL_GRACE_MS);
    // SIGKILL rather than execFile's SIGTERM, which a helper could ignore.
    const child = execFile(
      helperPath,
      [verb],
      { encoding: "utf8", killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT_BYTES, timeout: timeoutMs },
      (error, stdout, stderr) => {
        clearTimeout(deadline);
        if (error === null) {
          resolve(parseSystemAudioHelperResult({ code: 0, stderr, stdout }));
          return;
        }
        // Checked before `killed`: Node kills a child that overflows its buffer too, and that is not a timeout.
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve(err(PermissionGuideErrors.helperMalformed({ stderr, stdout })));
          return;
        }
        if (error.killed) {
          resolve(err(PermissionGuideErrors.helperTimedOut({ timeoutMs, verb })));
          return;
        }
        if (error.code === "ENOENT") {
          resolve(err(PermissionGuideErrors.helperMissing({ path: helperPath })));
          return;
        }
        if (typeof error.code === "number" || error.signal !== undefined) {
          const exitCode = typeof error.code === "number" ? error.code : null;
          resolve(err(PermissionGuideErrors.helperFailed({ exitCode, stderr })));
          return;
        }
        resolve(err(PermissionGuideErrors.helperStartFailed({ cause: error, path: helperPath, verb })));
      },
    );
    child.stdin?.end();
  });
  return new ResultAsync(ran);
}

/**
 * Where macOS stands on System Audio Recording for this app. Never prompts.
 *
 * @param helperPath the helper's absolute path
 * @returns the status, or why it could not be read
 */
export function preflightSystemAudio({
  helperPath,
}: {
  helperPath: string;
}): ResultAsync<MacAccessStatus, PermissionGuideError> {
  return runHelper({ helperPath, timeoutMs: PREFLIGHT_TIMEOUT_MS, verb: "preflight" });
}

/**
 * Raise macOS's System Audio Recording prompt — once per app; asked again, macOS answers without one — and wait for
 * the owner's answer.
 *
 * @param helperPath the helper's absolute path
 * @returns `granted` or `denied`, or why macOS did not ask
 */
export function requestSystemAudio({
  helperPath,
}: {
  helperPath: string;
}): ResultAsync<MacAccessStatus, PermissionGuideError> {
  return runHelper({ helperPath, timeoutMs: REQUEST_TIMEOUT_MS, verb: "request" });
}
