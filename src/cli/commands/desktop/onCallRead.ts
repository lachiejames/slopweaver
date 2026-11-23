/**
 * The two reads behind `desktop e2e`'s on-call hold (`../../../desktop/onCallHold.ts`): every console's voice call
 * leases, and whether another app holds a microphone.
 *
 * The microphone is read through AVFoundation from JavaScript for Automation, which ships with macOS: each audio
 * capture device's `inUseByAnotherApplication`. `$.AVCaptureDevice` is undefined in JXA even after importing
 * AVFoundation, so the class is looked up by name. Measured on the owner's Mac, off a call, every device `false`:
 *
 *   SLOPWEAVER_ALLOW_BASH=1 osascript -l JavaScript -e 'ObjC.import("AVFoundation"); const d =
 *     $.NSClassFromString("AVCaptureDevice").devicesWithMediaType("soun"); d.objectAtIndex(0).inUseByAnotherApplication'
 *
 * Listing devices needs no microphone permission, so the read raises no prompt.
 */
import { execFileSync } from "node:child_process";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { liveLeaseIdsOf, malformedLeaseCount } from "../../../desktop/e2eCallEvidence.js";
import {
  type MicDevice,
  type OnCallHoldError,
  OnCallHoldErrors,
  onCallHold,
  parseMicDevices,
} from "../../../desktop/onCallHold.js";
import { callLeaseTexts } from "./e2eCallEvidenceRead.js";

/** Prints `<name>\t<inUseByAnotherApplication>` for every audio capture device. */
const MIC_READ_SCRIPT = [
  'ObjC.import("AVFoundation");',
  'const devices = $.NSClassFromString("AVCaptureDevice").devicesWithMediaType("soun");',
  "const lines = [];",
  "for (let i = 0; i < devices.count; i++) {",
  "  const device = devices.objectAtIndex(i);",
  '  lines.push(device.localizedName.js + "\\t" + String(device.inUseByAnotherApplication));',
  "}",
  'lines.join("\\n");',
].join("\n");

/** How long the microphone read may take before it counts as unreadable. */
const MIC_READ_TIMEOUT_MS = 15_000;

/**
 * Run the microphone read.
 *
 * @returns what it printed, or why it could not run
 */
function micReadText(): Result<string, OnCallHoldError> {
  try {
    return ok(
      execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", MIC_READ_SCRIPT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: MIC_READ_TIMEOUT_MS,
      }),
    );
  } catch (error) {
    return err(OnCallHoldErrors.onCallUnknown({ detail: `the microphone read failed: ${errorMessage({ error })}` }));
  }
}

/**
 * Every audio capture device and whether another app holds it.
 *
 * @returns the devices, or the hold an unreadable answer is
 */
function readMics(): Result<readonly MicDevice[], OnCallHoldError> {
  return micReadText().andThen((text) => parseMicDevices({ text }));
}

/**
 * Whether the owner is on a call, from the reads handed in — the clock FIRST, the lease files on BOTH sides of the microphone
 * read, and every copy of both lease reads judged together. The microphone read is a subprocess of up to
 * MIC_READ_TIMEOUT_MS and a lease read a millisecond one, so a lease written during the slow read is seen by the second
 * (Codex oncall-r7), one removed during it was seen by the first (Codex rebase-hold-05), and all are judged by the
 * instant the read BEGAN, so one live then cannot age out during it (Codex rebase-hold-02). An earlier clock and a
 * second read only ever count more leases live: over-holding is the safe direction. A read that fails is a hold too.
 *
 * @param readMics every audio capture device and whether another app holds it, `osascript` in production
 * @param readLeaseTexts every copy of every call lease file's text, unmerged, the filesystem in production
 * @param nowMs the clock the leases are judged by, read once before either read
 * @param ownLiveCalls the live calls the test instance itself holds at this read, whose leases cannot be told from the owner's:
 * that many distinct live leases are allowed, and one more holds. A torn lease holds whatever this is.
 * @returns the hold, or `undefined` when the owner is not on a call
 */
export function onCallHoldOf({
  readMics: readMicDevices,
  readLeaseTexts,
  nowMs,
  ownLiveCalls = 0,
}: {
  readMics: () => Result<readonly MicDevice[], OnCallHoldError>;
  readLeaseTexts: () => Result<readonly string[], { readonly message: string }>;
  nowMs: () => number;
  ownLiveCalls?: number;
}): OnCallHoldError | undefined {
  const startedMs = nowMs();
  const before = readLeaseTexts();
  if (before.isErr()) {
    return OnCallHoldErrors.onCallUnknown({ detail: before.error.message });
  }
  const mics = readMicDevices();
  if (mics.isErr()) {
    return mics.error;
  }
  const after = readLeaseTexts();
  if (after.isErr()) {
    return OnCallHoldErrors.onCallUnknown({ detail: after.error.message });
  }
  const leases = [...before.value, ...after.value];
  // A lease that does not parse cannot be judged expired, so it may be the owner's call: never read as none.
  // Each read's own count, never their sum: one torn file is read twice.
  const malformed = Math.max(
    malformedLeaseCount({ leases: before.value }),
    malformedLeaseCount({ leases: after.value }),
  );
  if (malformed > 0) {
    return OnCallHoldErrors.onCallUnknown({
      detail: `${String(malformed)} call lease file(s) did not parse as a lease`,
    });
  }
  const live = liveLeaseIdsOf({ leases, nowMs: startedMs });
  // Copies under both roots and from both reads are judged unmerged, so one call can be listed more than once: count
  // its id once.
  //
  // What the allowance does not close, stated where it is decided:
  // it is a COUNT, because a lease carries nothing that tells the test's from the owner's. So before a crash, a call of the owner's
  // with no microphone in use passes when a test call's lease is absent (expired, removed, never written) and the owner's
  // fills that slot, or when the owner's lease carries the same call id as the test's — ids are random UUIDs, so only a
  // constructed lease does. Closing it needs a lease that names its console instance, which the console does not
  // write.
  const liveCalls = Math.max(0, new Set(live).size - ownLiveCalls);
  return onCallHold({ liveCalls, mics: mics.value });
}

/**
 * Whether the owner is on a call now: a live voice call lease on any console beyond the test's own, or a microphone another
 * app holds. A read that fails is a hold too.
 *
 * @param home the state home whose legacy docs-site directory is also read for leases
 * @param ownLiveCalls the live calls the test instance holds right now, whose leases cannot be told from the owner's:
 * none at a press, one before a crash scenario's recovered successor call
 * @returns the hold, or `undefined` when the owner is not on a call
 */
export function readOnCallHold({
  home,
  ownLiveCalls = 0,
}: {
  home: string;
  ownLiveCalls?: number;
}): OnCallHoldError | undefined {
  return onCallHoldOf({
    nowMs: () => Date.now(),
    ownLiveCalls,
    readLeaseTexts: () => callLeaseTexts({ home }),
    readMics,
  });
}
