/**
 * Whether `slopweaver desktop e2e` must hold because the owner is on a call — the pure half; the reads are
 * `src/cli/commands/desktop/onCallRead.ts`.
 *
 * The rule: a test call must never open on the owner's machine mid-call. E2e testing the desktop app is NOT refused by
 * default, only while the owner is on a call — a voice call lease live on any console, or a microphone in use by
 * another app (the owner's Zoom, Meet or Slack huddle holds the real device; the test instance's own microphone is
 * Chromium's fake one and never opens it).
 *
 * A HOLD, not a refusal with a hatch: being on a call is never overridden, so nothing reads one, and the message says
 * so. A call seen exits 4 (`EXIT_DEFERRED`: the same command is right once it ends). A read that fails holds too
 * (`ON_CALL_UNKNOWN`, exit 1) — reading a live call as absent is the one mistake this exists to prevent.
 */
import { err, ok, type Result } from "#lib/result.js";

/** The owner's ruling, as every hold names it. */
export const ON_CALL_RULING =
  "the owner's ruling: e2e testing the desktop app holds while the owner is on a call, and only then";

/** The line every hold ends on: there is no hatch, and what to do instead. */
const NO_HATCH =
  "This hold has no hatch: being on a call is never overridden. Nothing more is launched and no further test " +
  "call is placed; re-run unchanged once the call has ended.";

/** One audio capture device and whether another app holds it. */
export interface MicDevice {
  readonly name: string;
  readonly inUse: boolean;
}

/** Why `desktop e2e` holds: the owner is on a call, or whether they are cannot be told. */
export type OnCallHoldError =
  | {
      readonly code: "ON_CALL";
      readonly message: string;
      readonly liveCalls: number;
      readonly micsInUse: readonly string[];
    }
  | { readonly code: "ON_CALL_UNKNOWN"; readonly message: string; readonly detail: string };

/** Build an {@link OnCallHoldError}. */
export const OnCallHoldErrors = {
  onCall: ({ liveCalls, micsInUse }: { liveCalls: number; micsInUse: readonly string[] }): OnCallHoldError => {
    const found: string[] = [];
    if (liveCalls > 0) {
      found.push(`${String(liveCalls)} voice call lease(s) live on this machine`);
    }
    if (micsInUse.length > 0) {
      // A headset that is one device for input and output reads in use while it only plays audio: over-refusing is
      // the safe direction, and saying so keeps a seat from reading it as a broken check.
      found.push(
        `microphone(s) in use by another app: ${micsInUse.join(", ")} (a headset playing audio can read in use too)`,
      );
    }
    return {
      code: "ON_CALL",
      liveCalls,
      message: `desktop e2e held: the owner is on a call — ${found.join("; ")}. ${ON_CALL_RULING}. ${NO_HATCH}`,
      micsInUse,
    };
  },
  onCallUnknown: ({ detail }: { detail: string }): OnCallHoldError => ({
    code: "ON_CALL_UNKNOWN",
    detail,
    message:
      `desktop e2e held: whether the owner is on a call cannot be told (${detail}), so it is read as a call. ` +
      `${ON_CALL_RULING}. ${NO_HATCH}`,
  }),
} as const;

/**
 * Parse the microphone read's output: one `<name>\t<true|false>` line per audio capture device.
 *
 * @param text what the read printed
 * @returns every device, or why the output is not one the read writes
 */
export function parseMicDevices({ text }: { text: string }): Result<readonly MicDevice[], OnCallHoldError> {
  const devices: MicDevice[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }
    const tab = line.lastIndexOf("\t");
    const flag = line.slice(tab + 1).trim();
    if (tab <= 0 || (flag !== "true" && flag !== "false")) {
      return err(OnCallHoldErrors.onCallUnknown({ detail: `the microphone read printed ${JSON.stringify(line)}` }));
    }
    devices.push({ inUse: flag === "true", name: line.slice(0, tab) });
  }
  return ok(devices);
}

/**
 * Whether a stop is the on-call hold's own, either code — so a launch that read the owner was on a call is told apart from
 * one that failed.
 *
 * @param error a stop from the hold or from the call leg
 * @returns whether it is an {@link OnCallHoldError}
 */
export function isOnCallHold(error: { readonly code: string }): error is OnCallHoldError {
  return error.code === "ON_CALL" || error.code === "ON_CALL_UNKNOWN";
}

/**
 * Whether a stop is a HOLD — the owner was seen on a call, so the same command is right again once it ends — rather than a
 * fault. A read that failed is a fault: it holds too, but nothing was seen that will clear by itself.
 *
 * @param code the stop's code, from either the hold or the call leg's own refusals
 * @returns whether the stop was a call positively seen
 */
export function heldOnCall({ code }: { code: string }): boolean {
  return code === "ON_CALL" || code === "CALL_ALREADY_LIVE";
}

/**
 * Whether the owner is on a call, from what the reads found.
 *
 * @param liveCalls how many voice call leases are live on any console
 * @param mics every audio capture device the microphone read listed
 * @returns the hold, or `undefined` when the owner is not on a call
 */
export function onCallHold({
  liveCalls,
  mics,
}: {
  liveCalls: number;
  mics: readonly MicDevice[];
}): OnCallHoldError | undefined {
  const micsInUse = mics.filter((mic) => mic.inUse).map((mic) => mic.name);
  if (liveCalls === 0 && micsInUse.length === 0) {
    return undefined;
  }
  return OnCallHoldErrors.onCall({ liveCalls, micsInUse });
}
