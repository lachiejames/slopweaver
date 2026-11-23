/**
 * One call scenario's test instance, from launch to the proof that every call it opened ended: the fake microphone,
 * the launch, the listeners, the log cursors, the leases it took, and the cleanup that runs whatever the scenario did.
 *
 * **Cleanup is the leg's safety rail, so it fails closed.** It hangs up, closes the instance, then waits until every
 * plan call the scenario opened has an end line, every transcript it wrote has an end, and no call lease is live. A
 * read that fails, or a wait that runs out, is a cleanup FAILURE, which stops the leg before another call is placed.
 * So is an unmarked transcript — one it tracked, or ANY that appeared in the shared store during the scenario, since
 * the store cannot say who wrote it: its words would read as the owner's. A call of the owner's placed mid-scenario stops the leg too,
 * as the lease check already does.
 */
import { join } from "node:path";

import type { ElectronApplication } from "playwright-core";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import {
  type E2eDesktopEvent,
  type E2ePlanCallLogEvent,
  openedPlanCalls,
  parseDesktopEventLog,
  parsePlanCallLog,
  unendedPlanCalls,
} from "../../../desktop/e2eCallEvidence.js";
import type { E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import type { E2eHeapSample } from "../../../desktop/e2eHeapTrend.js";
import type { E2eMicCapture } from "../../../desktop/e2eTranscriptFidelityCapture.js";
import type { E2eFidelityHold } from "../../../desktop/e2eTranscriptFidelityReport.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import { closeE2eApp } from "./e2eApp.js";
import { type LogCursor, liveLeaseIds, readAppended, transcriptEnd, transcriptMarked } from "./e2eCallEvidenceRead.js";
import { answeringVoicePage, hangUpAndClose } from "./e2eCallInstance.js";
import { type CallTracker, newTracker, trackCalls, until } from "./e2eCallPage.js";
import { preflightSession, transcriptIdsIn } from "./e2eCallPreflight.js";
import { pageView, type VoiceView } from "./e2eCallView.js";
import { launchInE2eContext } from "./e2eContext.js";
import type { FidelityMicrophone } from "./e2eTranscriptFidelityAudio.js";
import { readOnCallHold } from "./onCallRead.js";

/** How long cleanup waits for the console to end a call and its lease to lapse: a 60s lease, a 30s absent stream. */
const CLEANUP_CAP_MS = 150_000;

/**
 * How long nothing open must hold after the instance closes before cleanup counts it proven: an offer still in flight
 * at the close (a Talk pressed as an interrupt landed) reaches the console's log after the close, and a first poll
 * would read it as no call at all (Codex call-r3-cleanup-single-signal). The console writes a plan call's open line
 * when it answers the offer, so this bounds that wait rather than proving it.
 */
const CLEANUP_SETTLE_MS = 15_000;

/** How often a session notes which leases are live. */
const LEASE_NOTE_MS = 5000;

/** How long a fresh instance has to show its voice page. */
const VOICE_SHOWN_CAP_MS = 90_000;

/** What a session is launched from. */
export interface CallSessionSpec {
  readonly app: string;
  readonly checkout: string;
  /** The work context the console is put in at launch and every relaunch (`--context`); `undefined` leaves it be. */
  readonly context: E2eWorkContext | undefined;
  readonly home: string;
  /** Whether the instance draws its own Slopweaver Test menu bar icon, at launch and every relaunch. */
  readonly menuBar: boolean;
  /** The scenario's own folder for its microphone and its instance's saved state. */
  readonly scratch: string;
  readonly step: E2eCallStep;
}

/** One scenario's running instance and what it has seen. */
export interface CallSession {
  readonly spec: CallSessionSpec;
  /** The instance now; a relaunch replaces it. */
  app: ElectronApplication;
  /** Set when SIGINT or SIGTERM lands, so the drive presses Talk no more while cleanup runs. */
  interrupted: boolean;
  /** Set when the read before a Talk press or a relaunch found the owner on a call, so the leg HOLDS rather than fails. */
  onCallHold: OnCallHoldError | undefined;
  readonly userData: string;
  readonly fakeAudioPath: string;
  /** What a `transcription-fidelity` call's microphone played; `undefined` on every other scenario. */
  readonly fidelityMicrophone: FidelityMicrophone | undefined;
  /** What Chromium reported applying to each microphone the page opened, captured by `transcription-fidelity` only. */
  readonly micCaptures: E2eMicCapture[];
  /** Each hold a `transcription-fidelity` call measured; exactly one when the scenario reached its hold. */
  readonly fidelityHolds: E2eFidelityHold[];
  readonly tracker: CallTracker;
  readonly planCursor: LogCursor;
  readonly desktopCursor: LogCursor;
  /** Every transcript in the talk store before the launch: one written after it is this session's to prove ended. */
  readonly transcriptsBefore: ReadonlySet<string>;
  /** Every call id a read of the logs or the store has shown, so a later failed read still names it. */
  readonly seenCallIds: Set<string>;
  /** Every transcript a store read during the session showed written since launch, so one gone later is still judged. */
  readonly seenTranscriptIds: Set<string>;
  readonly heapSamples: E2eHeapSample[];
  /** Every lease id seen live while the session ran. */
  readonly leaseIds: string[];
  /** Why noting the leases failed, each time it did; the first is the one reported. */
  readonly leaseProblems: string[];
  readonly timer: ReturnType<typeof setInterval>;
}

/** Note which leases are live now into a session. */
function noteLeases({ session }: { session: CallSession }): void {
  const live = liveLeaseIds({ home: session.spec.home, nowMs: Date.now() });
  if (live.isErr()) {
    session.leaseProblems.push(live.error.message);
    return;
  }
  for (const id of live.value.filter((one) => !session.leaseIds.includes(one))) {
    session.leaseIds.push(id);
  }
}

/**
 * Write the microphone, take the cursors and launch the instance.
 *
 * @param spec what to launch
 * @returns the session, or why it could not start — the owner is on a call, among others — and nothing is running then
 */
export async function openCallSession({
  spec,
}: {
  spec: CallSessionSpec;
}): Promise<Result<CallSession, E2eCallError | OnCallHoldError>> {
  const preflight = preflightSession({
    checkout: spec.checkout,
    home: spec.home,
    scratch: spec.scratch,
    step: spec.step,
  });
  if (preflight.isErr()) {
    return err(preflight.error);
  }
  const { desktopCursor, fakeAudioPath, fidelityMicrophone, planCursor, transcriptsBefore } = preflight.value;
  const userData = join(spec.scratch, "user-data");
  // Read again at the last moment: the microphone took seconds to render since the leg's preflight.
  const held = readOnCallHold({ home: spec.home });
  if (held !== undefined) {
    return err(held);
  }
  const { app, checkout, context, menuBar } = spec;
  const launch = { app, checkout, fakeAudioPath, menuBar, userData };
  const launched = await launchInE2eContext({ context, launch });
  if (launched.isErr()) {
    return err(E2eCallErrors.launchFailed({ detail: launched.error }));
  }
  const tracker = newTracker();
  trackCalls({ app: launched.value, tracker });
  const session: CallSession = {
    app: launched.value,
    desktopCursor,
    fakeAudioPath,
    fidelityMicrophone,
    heapSamples: [],
    interrupted: false,
    leaseIds: [],
    leaseProblems: [],
    micCaptures: [],
    fidelityHolds: [],
    onCallHold: undefined,
    planCursor,
    seenCallIds: new Set(),
    seenTranscriptIds: new Set(),
    spec,
    timer: setInterval(() => {
      noteLeases({ session });
    }, LEASE_NOTE_MS),
    tracker,
    transcriptsBefore: new Set(transcriptsBefore),
    userData,
  };
  return ok(session);
}

/**
 * Launch the same bundle again over the same saved state, after {@link quitMidCall} or {@link hangUpAndProveEnded},
 * the way the owner reopens it.
 *
 * @param microphone a WAV to hear instead of the session's own, already rendered — a new file per launch, never one
 *   rewritten under a running instance; the session's own when absent
 * @returns nothing once relaunched, or why not
 */
export async function relaunchCallSession({
  session,
  microphone,
}: {
  session: CallSession;
  microphone?: string;
}): Promise<Result<void, E2eCallError>> {
  const { app, checkout, context, home, menuBar } = session.spec;
  // A relaunch is a launch too: the owner may have picked up a call since the scenario began. Not relaunched, and noted on
  // the session so the leg HOLDS, exit 4, once the call already placed is proven ended.
  const held = readOnCallHold({ home });
  if (held !== undefined) {
    session.onCallHold = held;
    return err(E2eCallErrors.launchFailed({ detail: held.message }));
  }
  let fakeAudioPath = session.fakeAudioPath;
  if (microphone !== undefined) {
    fakeAudioPath = microphone;
  }
  // The saved state carries the stored choice across, but the console a relaunch opens on is read again.
  const launch = { app, checkout, fakeAudioPath, menuBar, userData: session.userData };
  const launched = await launchInE2eContext({ context, launch });
  if (launched.isErr()) {
    return err(E2eCallErrors.launchFailed({ detail: launched.error }));
  }
  session.app = launched.value;
  trackCalls({ app: launched.value, tracker: session.tracker });
  return ok(undefined);
}

/**
 * The session's voice page, once it answers.
 *
 * @returns the page, or that none showed
 */
export async function voicePageOf({ session }: { session: CallSession }): Promise<Result<VoiceView, E2eCallError>> {
  const page = await answeringVoicePage({ app: session.app, capMs: VOICE_SHOWN_CAP_MS });
  return page === undefined
    ? err(E2eCallErrors.controlMissing({ control: "the voice window" }))
    : ok(pageView({ page }));
}

/** The logs' evidence appended since the session began. */
export interface CallLogEvidence {
  readonly planEvents: readonly E2ePlanCallLogEvent[];
  readonly desktopEvents: readonly E2eDesktopEvent[];
}

/**
 * Read and parse both logs' appended lines.
 *
 * @returns the events, or why a log could not be read or parsed
 */
export function readCallLogs({ session }: { session: CallSession }): Result<CallLogEvidence, E2eCallError> {
  const plan = readAppended({ cursor: session.planCursor }).andThen((text) =>
    parsePlanCallLog({ text }).mapErr((error) =>
      E2eCallErrors.evidenceUnreadable({ detail: error.message, path: session.planCursor.path }),
    ),
  );
  if (plan.isErr()) {
    return err(plan.error);
  }
  noteSeen({ callIds: openedPlanCalls({ events: plan.value }), session });
  const desktop = readAppended({ cursor: session.desktopCursor }).andThen((text) =>
    parseDesktopEventLog({ text }).mapErr((error) =>
      E2eCallErrors.evidenceUnreadable({ detail: error.message, path: session.desktopCursor.path }),
    ),
  );
  if (desktop.isErr()) {
    return err(desktop.error);
  }
  return ok({ desktopEvents: desktop.value, planEvents: plan.value });
}

/**
 * The calls not yet proven ended, or why that cannot be told.
 *
 * @returns a sentence naming what is still open, `undefined` once nothing is
 */
function stillOpen({ session }: { session: CallSession }): string | undefined {
  const logs = readCallLogs({ session });
  if (logs.isErr()) {
    return unreadable({ detail: logs.error.message, session });
  }
  const planIds = [...new Set([...session.tracker.planCallIds, ...openedPlanCalls({ events: logs.value.planEvents })])];
  const unended = unendedPlanCalls({ callIds: planIds, events: logs.value.planEvents });
  if (unended.length > 0) {
    return `plan call(s) with no end line: ${unended.join(", ")}`;
  }
  const live = liveLeaseIds({ home: session.spec.home, nowMs: Date.now() });
  if (live.isErr()) {
    return unreadable({ detail: live.error.message, session });
  }
  if (live.value.length > 0) {
    return `call lease(s) still live: ${live.value.join(", ")}`;
  }
  // The store, not only the requests Playwright saw: a recovered renderer's transcript can reach the console unseen
  // (Codex call-r3-cleanup-single-signal).
  const now = transcriptIdsIn({ home: session.spec.home });
  if (now.isErr()) {
    return unreadable({ detail: now.error.message, session });
  }
  const written = now.value.filter((callId) => !session.transcriptsBefore.has(callId));
  noteSeen({ callIds: written, session });
  for (const callId of written) {
    session.seenTranscriptIds.add(callId);
  }
  for (const callId of new Set([...session.tracker.transcriptCallIds, ...written])) {
    const end = transcriptEnd({ callId, home: session.spec.home });
    if (end.isErr()) {
      return unreadable({ detail: end.error.message, session });
    }
    if (end.value === undefined) {
      return `transcript ${callId} has no end`;
    }
  }
  return undefined;
}

/**
 * A read that failed, with the calls the session saw placed, so a STOPPED line names them even when the evidence that
 * would prove them ended cannot be read (Codex call-r3-cleanup-single-signal).
 *
 * @param detail why the read failed
 * @returns the sentence
 */
function unreadable({ detail, session }: { detail: string; session: CallSession }): string {
  const placed = new Set([
    ...session.tracker.planCallIds,
    ...session.tracker.transcriptCallIds,
    ...session.seenCallIds,
  ]);
  const named = placed.size === 0 ? "none seen" : [...placed].join(", ");
  return `${detail} — the calls this scenario placed: ${named}`;
}

/**
 * Remember call ids a read showed, so a later failed read still names them — a recovered renderer's call can be in
 * the log alone, never in the tracker (Codex call-r3-cleanup-single-signal-v2).
 *
 * @param callIds the ids the read showed
 */
function noteSeen({ callIds, session }: { callIds: readonly string[]; session: CallSession }): void {
  for (const callId of callIds) {
    session.seenCallIds.add(callId);
  }
}

/**
 * Wait until every call the session opened so far is proven ended: an end line for each plan call, an end for each
 * transcript, no lease live.
 *
 * @returns `undefined` once proven, else what was still open at the cap
 */
async function waitAllEnded({ session }: { session: CallSession }): Promise<string | undefined> {
  noteLeases({ session });
  const startedMs = Date.now();
  let open: string | undefined;
  await until({
    capMs: CLEANUP_CAP_MS,
    test: async () => {
      open = stillOpen({ session });
      return open === undefined && Date.now() - startedMs >= CLEANUP_SETTLE_MS;
    },
  });
  if (open !== undefined) {
    return `after ${String(CLEANUP_CAP_MS / 1000)}s: ${open}`;
  }
  return undefined;
}

/**
 * End the session: hang up, close, and wait until every call it opened is proven ended.
 *
 * @returns `undefined` once proven, else why not — which stops the leg
 */
export async function closeCallSession({ session }: { session: CallSession }): Promise<string | undefined> {
  noteLeases({ session });
  clearInterval(session.timer);
  await hangUpAndClose({ app: session.app });
  const open = await waitAllEnded({ session });
  if (open !== undefined) {
    return open;
  }
  const unmarked = unmarkedTranscript({ session });
  if (unmarked !== undefined) {
    return unmarked;
  }
  const [problem] = session.leaseProblems;
  return problem;
}

/**
 * Close the instance as a quit does, mid-call and with no hang-up, and wait for the console to end what it left.
 *
 * @returns `undefined` once every call is proven ended and marked, else what was still open or unmarked
 */
export async function quitMidCall({ session }: { session: CallSession }): Promise<string | undefined> {
  await closeE2eApp({ app: session.app });
  const open = await waitAllEnded({ session });
  if (open !== undefined) {
    return open;
  }
  return unmarkedTranscript({ session });
}

/**
 * Hang up as the owner does, close the instance, and wait until every call so far is proven ended and marked — the same proof
 * the leg's cleanup takes, between two calls of one scenario, so the next press is never beside a call not proven over.
 *
 * @returns `undefined` once every call is proven ended and marked, else what was still open or unmarked
 */
export async function hangUpAndProveEnded({ session }: { session: CallSession }): Promise<string | undefined> {
  await hangUpAndClose({ app: session.app });
  const open = await waitAllEnded({ session });
  if (open !== undefined) {
    return open;
  }
  return unmarkedTranscript({ session });
}

/**
 * The first transcript this session tracked, or that appeared in the store while it ran, that is NOT marked as the test
 * instance's — whose speech every reader would take as the owner's words — or why the store could not be read. A failure stops
 * the leg, as an unproven end does; one of the owner's placed mid-scenario is caught here as it is by the lease check.
 *
 * @returns the sentence, `undefined` when every such transcript is marked
 */
function unmarkedTranscript({ session }: { session: CallSession }): string | undefined {
  const now = transcriptIdsIn({ home: session.spec.home });
  if (now.isErr()) {
    return unreadable({ detail: now.error.message, session });
  }
  const written = now.value.filter((callId) => !session.transcriptsBefore.has(callId));
  for (const callId of new Set([...session.tracker.transcriptCallIds, ...written])) {
    const marked = transcriptMarked({ callId, home: session.spec.home });
    if (marked.isErr()) {
      return unreadable({ detail: marked.error.message, session });
    }
    if (!marked.value) {
      return `transcript ${callId}'s open line does not carry the desktop e2e marker (origin.instance "e2e"), so its words would read as the owner's`;
    }
  }
  return undefined;
}
