/**
 * Why `slopweaver desktop e2e --call` could not place, drive or clean up a call. A scenario that ran and failed its
 * judgement is not one of these: it is a row of the report (`./e2eCallOutcome.ts`). Each `message` says what was found
 * and what to do, because a seat reads it and acts.
 */

import { ON_CALL_RULING } from "./onCallHold.js";

/** One reason the call leg refused, or a scenario could not be driven. */
export type E2eCallError =
  | { readonly code: "CALL_ALREADY_LIVE"; readonly message: string; readonly live: number }
  | { readonly code: "CALL_STILL_OPEN"; readonly message: string; readonly callIds: readonly string[] }
  | { readonly code: "CALL_OVERLAPPED"; readonly message: string; readonly callIds: readonly string[] }
  | {
      readonly code: "CONVERSATION_HELD";
      readonly message: string;
      readonly held: readonly { readonly id: string; readonly surface: "voice" | "typed" }[];
    }
  | { readonly code: "CONVERSATIONS_UNREADABLE"; readonly message: string }
  | { readonly code: "CALL_LOCK_HELD"; readonly message: string }
  | { readonly code: "LEASES_UNREADABLE"; readonly message: string }
  | { readonly code: "AUDIO_SYNTHESIS_FAILED"; readonly message: string }
  | { readonly code: "AUDIO_INVALID"; readonly message: string; readonly path: string }
  | { readonly code: "EVIDENCE_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CALL_LAUNCH_FAILED"; readonly message: string }
  | { readonly code: "CALL_CONTROL_MISSING"; readonly message: string; readonly control: string }
  | { readonly code: "CALL_NEVER_LIVE"; readonly message: string }
  | { readonly code: "CALL_INTERRUPTED"; readonly message: string }
  | { readonly code: "VOICE_WINDOW_UNCLEAR"; readonly message: string; readonly found: number }
  | { readonly code: "CALL_CLEANUP_FAILED"; readonly message: string }
  | { readonly code: "SEND_NOT_CLEAR"; readonly message: string };

/** Build an {@link E2eCallError}. */
export const E2eCallErrors = {
  audioInvalid: ({ path }: { path: string }): E2eCallError => ({
    code: "AUDIO_INVALID",
    message: `${path} is not a RIFF/WAVE file, so Chromium could not take it as a microphone — nothing was launched`,
    path,
  }),
  audioSynthesisFailed: ({ detail }: { detail: string }): E2eCallError => ({
    code: "AUDIO_SYNTHESIS_FAILED",
    message: `/usr/bin/say could not write the fake microphone's audio: ${detail}`,
  }),
  callAlreadyLive: ({ live }: { live: number }): E2eCallError => ({
    code: "CALL_ALREADY_LIVE",
    live,
    message:
      `${String(live)} voice call lease(s) are live on this machine — a call is up or being minted, so no test ` +
      `call is placed beside it; re-run once it has ended (${ON_CALL_RULING})`,
  }),
  callStillOpen: ({ callIds }: { callIds: readonly string[] }): E2eCallError => ({
    callIds,
    code: "CALL_STILL_OPEN",
    message:
      `${String(callIds.length)} call(s) no test instance placed were heard from recently and never ended ` +
      `(${callIds.join(", ")}) — one may be open in a console whose lease lapsed, so no test call is placed beside it`,
  }),
  callOverlapped: ({ callIds }: { callIds: readonly string[] }): E2eCallError => ({
    callIds,
    code: "CALL_OVERLAPPED",
    message:
      `${String(callIds.length)} call(s) no test instance placed were open while the last scenario ran ` +
      `(${callIds.join(", ")}) — a call of the owner's began after the preflight read, so the leg stops rather than place another`,
  }),
  callLockHeld: ({ detail }: { detail: string }): E2eCallError => ({
    code: "CALL_LOCK_HELD",
    message: `another \`desktop e2e --call\` holds the call leg's lock: ${detail}`,
  }),
  cleanupFailed: ({ detail }: { detail: string }): E2eCallError => ({
    code: "CALL_CLEANUP_FAILED",
    message: `a test call could not be proven ended, so no further call is placed: ${detail}`,
  }),
  conversationHeld: ({
    held,
  }: {
    held: readonly { readonly id: string; readonly surface: "voice" | "typed" }[];
  }): E2eCallError => {
    const voice = held.filter((one) => one.surface === "voice").length;
    const typed = held.length - voice;
    const named = [
      ...(voice > 0 ? [`${String(voice)} voice call(s)`] : []),
      ...(typed > 0 ? [`${String(typed)} typed conversation(s) not yet at rest`] : []),
    ].join(" and ");
    return {
      code: "CONVERSATION_HELD",
      held,
      message:
        `the console's call registry holds ${named}, with or without a live lease — a test call runs beside nothing ` +
        "but a typed conversation at rest, so none is placed; re-run once it has ended or gone quiet",
    };
  },
  conversationHeldForTypedOpen: ({
    held,
  }: {
    held: readonly { readonly id: string; readonly surface: "voice" | "typed" }[];
  }): E2eCallError => ({
    code: "CONVERSATION_HELD",
    held,
    message:
      `the console's call registry holds ${String(held.length)} conversation(s), with or without a live lease — this ` +
      "scenario opens a typed conversation, which replaces every typed one held, at rest or not, so it runs beside " +
      "none; re-run once each has ended",
  }),
  conversationsUnreadable: ({ detail }: { detail: string }): E2eCallError => ({
    code: "CONVERSATIONS_UNREADABLE",
    message: `${detail} — whether the console holds a conversation cannot be told, so no test call is placed`,
  }),
  controlMissing: ({ control }: { control: string }): E2eCallError => ({
    code: "CALL_CONTROL_MISSING",
    control,
    message: `the voice window showed no usable "${control}" control`,
  }),
  evidenceUnreadable: ({ path, detail }: { path: string; detail: string }): E2eCallError => ({
    code: "EVIDENCE_UNREADABLE",
    message: `could not read the call evidence at ${path}: ${detail}`,
    path,
  }),
  launchFailed: ({ detail }: { detail: string }): E2eCallError => ({
    code: "CALL_LAUNCH_FAILED",
    message: `could not launch the test instance for a call: ${detail}`,
  }),
  leasesUnreadable: ({ detail }: { detail: string }): E2eCallError => ({
    code: "LEASES_UNREADABLE",
    message: `${detail} — whether a call is live cannot be told, so no test call is placed`,
  }),
  interrupted: (): E2eCallError => ({
    code: "CALL_INTERRUPTED",
    message: "interrupted before Talk was pressed, so no call was placed",
  }),
  neverLive: ({ seconds }: { seconds: number }): E2eCallError => ({
    code: "CALL_NEVER_LIVE",
    message: `the call never showed its mute control within ${String(seconds)}s of the press`,
  }),
  sendNotClear: ({ detail }: { detail: string }): E2eCallError => ({
    code: "SEND_NOT_CLEAR",
    message: `the typed question was emptied unsent, because the read just before the send was not clear: ${detail}`,
  }),
  voiceWindowUnclear: ({ found }: { found: number }): E2eCallError => ({
    code: "VOICE_WINDOW_UNCLEAR",
    found,
    message: `${String(found)} live voice windows matched /voice; exactly one is crashed, so none was`,
  }),
} as const;

/**
 * Why `desktop e2e`'s flags ask for part of the call leg it cannot place: without `--call`, which places no call, or
 * `card-read` with no card to read.
 */
export type E2eCallFlagError =
  | { readonly code: "HOLD_WITHOUT_CALL"; readonly message: string }
  | { readonly code: "CARD_WITHOUT_CALL"; readonly message: string }
  | { readonly code: "CARD_INVALID"; readonly message: string; readonly key: string }
  | { readonly code: "CARD_SCENARIO_WITHOUT_CARD"; readonly message: string }
  | { readonly code: "MIC_CANDIDATE_INVALID"; readonly message: string; readonly candidate: string }
  | { readonly code: "FIDELITY_WITHOUT_CANDIDATE"; readonly message: string }
  | { readonly code: "CANDIDATE_WITHOUT_FIDELITY"; readonly message: string }
  | { readonly code: "SCENARIO_WITHOUT_CALL"; readonly message: string; readonly ids: readonly string[] };

/** Build an {@link E2eCallFlagError}. */
export const E2eCallFlagErrors = {
  cardInvalid: ({ key }: { key: string }): E2eCallFlagError => ({
    code: "CARD_INVALID",
    key,
    message:
      "--call-card must be all, or card keys exactly as the console names them, comma-separated, each <kind>:<id> " +
      "(ask, hand, draft, post, review, import, pr, act or align, then up to 160 letters, digits, '.', '_' or " +
      "'-'); refused " +
      JSON.stringify(key),
  }),
  cardScenarioWithoutCard: (): E2eCallFlagError => ({
    code: "CARD_SCENARIO_WITHOUT_CARD",
    message: "--only card-read and card-read-typed need --call-card <kind>:<id>[,<kind>:<id>...] or --call-card all",
  }),
  candidateWithoutFidelity: (): E2eCallFlagError => ({
    code: "CANDIDATE_WITHOUT_FIDELITY",
    message:
      "--call-mic-candidate configures the transcription-fidelity scenario, so it needs --only transcription-fidelity",
  }),
  cardWithoutCall: (): E2eCallFlagError => ({
    code: "CARD_WITHOUT_CALL",
    message: "--call-card configures the call leg, so it needs --call",
  }),
  fidelityWithoutCandidate: (): E2eCallFlagError => ({
    code: "FIDELITY_WITHOUT_CANDIDATE",
    message:
      "--only transcription-fidelity compares a microphone setting against control, so it needs --call-mic-candidate " +
      "noise-suppression-off, auto-gain-off or both-off",
  }),
  holdWithoutCall: (): E2eCallFlagError => ({
    code: "HOLD_WITHOUT_CALL",
    message: "--call-hold-minutes configures the call leg, so it needs --call",
  }),
  micCandidateInvalid: ({ candidate }: { candidate: string }): E2eCallFlagError => ({
    candidate,
    code: "MIC_CANDIDATE_INVALID",
    message: `--call-mic-candidate must be noise-suppression-off, auto-gain-off or both-off; refused ${JSON.stringify(candidate)}`,
  }),
  scenarioWithoutCall: ({ ids }: { ids: readonly string[] }): E2eCallFlagError => ({
    code: "SCENARIO_WITHOUT_CALL",
    ids,
    message: `--only names call scenario(s) without --call, which places no call: ${ids.join(", ")}`,
  }),
} as const;

/** Why a log the call leg reads as evidence could not be parsed. */
export type E2eCallEvidenceError = {
  readonly code: "MALFORMED_LINE";
  readonly message: string;
  readonly lineIndex: number;
};

/** Build an {@link E2eCallEvidenceError}. */
export const E2eCallEvidenceErrors = {
  malformedLine: ({
    log,
    lineIndex,
    line,
  }: {
    log: string;
    lineIndex: number;
    line: string;
  }): E2eCallEvidenceError => ({
    code: "MALFORMED_LINE",
    lineIndex,
    message: `${log} line ${String(lineIndex + 1)} is not one it writes: ${line.slice(0, 200)}`,
  }),
} as const;
