/**
 * Independent witnesses that a spawn actually booted and its pickup command actually landed.
 *
 * ## Why more than one witness
 *
 * Until now a spawn had exactly ONE witness for both questions: a screen read. Measured three times,
 * that is not enough on its own, and it fails in two OPPOSITE directions:
 *
 * - **False positive**: the boot banner rendered, so the poll called it booted, while Claude's stdin was not
 *   yet accepting a paste — the pickup command was silently dropped.
 * - **False negative**: under concurrent cmux load `surface.read_text` answers `Failed to read terminal text`
 *   on every tick, so a dispatch that genuinely landed (the child went on to write real lifecycle events) was
 *   reported `dispatch-failed` with the whole poll budget spent on an unreadable surface.
 *
 * Both are answered by asking something OTHER than the rendering. cmux itself knows two things the screen
 * does not: it emits an `agent.hook.SessionStart` / `agent.hook.UserPromptSubmit` event when the child agent
 * actually boots and actually submits a prompt, and it records `latest_submitted_message` — its own account of
 * what it delivered to the surface, not a re-render a caller has to catch mid-flicker.
 *
 * A fourth source reads the rendering for something other than the line: a RUNNING TURN. MEASURED
 * (cmux 0.65.2, Claude Code 2.1.310), the footer read `esc to interrupt` on the first read after an Enter that
 * took, while the `UserPromptSubmit` event lagged it by 3.7 s behind the seat's SessionStart hooks.
 *
 * This module is the pure decision over those four sources; `./pickupWitnessWindow.ts` supplies them.
 */
import type { VisibleSessionHost } from "../supervisor/session.js";
import type { CmuxEvent } from "./events.js";
import { normalizeSentText, submittedMessageConfirmsSend } from "./sendEvidence.js";
import { runningTurnIsAssertable, screenShowsRunningTurn } from "./turnBusy.js";

/**
 * Which source confirmed something, so a caller can report HOW it knows rather than merely that it does.
 *
 * `composer` is not one of the chain below: it is `./pickupDelivery.ts`'s, named when the box was positively read
 * holding the pickup TYPED, an Enter was pressed on it, and the box then read empty — the emptied box being the one
 * claim left that was actually observed — and on a BOOT no other witness saw, once Claude's composer was read on the
 * surface (`claudeBootComposer.ts`).
 */
type WitnessSource = "event" | "submitted-message" | "running-turn" | "screen" | "composer";

/** One confirmation, naming its source. */
export interface Witness {
  readonly confirmed: true;
  readonly by: WitnessSource;
}

/**
 * Whether any of these events is the named hook firing for this workspace.
 *
 * Only the `received` phase counts: cmux emits `received` and then `completed` for the same firing, and a
 * caller asking "has it started" wants the first of those, not both.
 *
 * @param events the events collected since before the action being witnessed
 * @param workspaceId the workspace to scope to
 * @param names the hook names that would confirm it
 * @returns the witness, or `undefined` when none of them has fired
 */
export function witnessFromEvents({
  events,
  workspaceId,
  names,
}: {
  events: readonly CmuxEvent[];
  workspaceId: string;
  names: readonly string[];
}): Witness | undefined {
  const hit = events.some(
    (event) => event.workspaceId === workspaceId && names.includes(event.name) && event.phase !== "completed",
  );
  return hit ? { by: "event", confirmed: true } : undefined;
}

/**
 * Whether cmux's own record of the last text it delivered to a surface matches what was sent.
 *
 * `latest_submitted_message` is TRUNCATED with an ellipsis once it is long enough — measured live on a real
 * workspace row — so this compares it as a PREFIX rather than for equality. A pickup command is routinely
 * long enough for that to matter, and an equality check would have silently never matched.
 *
 * @param submitted cmux's `latest_submitted_message` for the workspace, if it has one
 * @param expected the exact text that was sent
 * @returns the witness, or `undefined` when cmux's record does not match
 */
export function witnessFromSubmitted({
  submitted,
  expected,
}: {
  submitted: string | undefined;
  expected: string;
}): Witness | undefined {
  return submittedMessageConfirmsSend({ latestSubmittedMessage: submitted, sentText: expected })
    ? { by: "submitted-message", confirmed: true }
    : undefined;
}

/**
 * Whether a screen visibly contains the text that was sent — the fallback, kept because it is the only
 * witness that works when cmux's event stream is unreachable.
 *
 * **MEASURED: this witness cannot see a pickup line at all, and that is load-bearing rather than
 * a defect to widen.** A Claude Code composer hard-wraps a long line and indents each continuation, so the
 * break falls mid-token — a real capture read `…-pickup-measur` / newline / `  ement.md`, which collapsing
 * whitespace turns into `measur ement.md` and can never turn back. Every pickup command is long enough for
 * that. The consequence is the right one: a line TYPED INTO THE COMPOSER AND NEVER SUBMITTED is visibly on
 * the screen, and this must not report it delivered, because it has not been. Widening the comparison to
 * ignore whitespace entirely would confirm exactly that stranded line and turn `cmux/spawn.ts`'s honest
 * `unwitnessed` into a false success. The remedy for a stranded line is `pickupWitnessWindow.ts`'s
 * `resubmitPickupThenWitness`, which SUBMITS it rather than claiming it arrived.
 *
 * Reproduce the wrap with `slopweaver cmux read-screen --workspace <ref>` on any session holding a long
 * prompt, submitted or not.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @param expected the exact text that was sent
 * @returns the witness, or `undefined`
 */
export function witnessFromScreen({
  screen,
  expected,
}: {
  screen: string | undefined;
  expected: string;
}): Witness | undefined {
  if (screen === undefined) {
    return undefined;
  }
  return normalizeSentText({ text: screen }).includes(normalizeSentText({ text: expected }))
    ? { by: "screen", confirmed: true }
    : undefined;
}

/**
 * Whether a FRESHLY BOOTED seat's screen shows a turn running — which, on a seat that has been handed nothing
 * but its pickup, can only be the pickup's.
 *
 * Valid on a fresh seat ONLY, and that is why it lives in the pickup chain and nowhere else: on a session that
 * was already working, a running turn says nothing about the line just sent (`./turnBusy.ts`'s header). Asked
 * only of a host with a measured busy footer (`runningTurnIsAssertable`), because `screenShowsRunningTurn`
 * matches every host's footer on any screen: a Codex seat showing Claude Code's text would otherwise answer
 * with a pattern nobody measured on it.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @param host which model CLI the seat booted, so only its own measured footer can answer
 * @returns the witness, or `undefined`
 */
export function witnessFromRunningTurn({
  screen,
  host,
}: {
  screen: string | undefined;
  host: VisibleSessionHost;
}): Witness | undefined {
  if (!runningTurnIsAssertable({ host })) {
    return undefined;
  }
  return screenShowsRunningTurn({ screen }) ? { by: "running-turn", confirmed: true } : undefined;
}

/**
 * Ask every witness for a freshly booted seat's pickup in order and return the first that confirms — events,
 * then cmux's delivery record, then a running turn, then the line on the screen.
 *
 * The ORDER is the whole point and is not cosmetic: the two cheap, load-immune sources are consulted before
 * the ones that read a rendering that throws under load, so the failure mode that produced three false
 * negatives cannot recur while either of the others is answering.
 *
 * @param events the events collected since before the action being witnessed
 * @param workspaceId the workspace to scope the event check to
 * @param eventNames the hook names that would confirm it
 * @param submitted cmux's `latest_submitted_message` for the workspace
 * @param screen the surface's rendered text, or `undefined` when unreadable
 * @param expected the exact text that was sent
 * @param host which model CLI the seat booted, for the running-turn witness
 * @returns the first confirmation, or `undefined` when nothing confirms yet
 */
export function firstWitness({
  events,
  workspaceId,
  eventNames,
  submitted,
  screen,
  expected,
  host,
}: {
  events: readonly CmuxEvent[];
  workspaceId: string;
  eventNames: readonly string[];
  submitted: string | undefined;
  screen: string | undefined;
  expected: string;
  host: VisibleSessionHost;
}): Witness | undefined {
  const fromEvents = witnessFromEvents({ events, names: eventNames, workspaceId });
  if (fromEvents !== undefined) {
    return fromEvents;
  }
  const fromSubmitted = witnessFromSubmitted({ expected, submitted });
  if (fromSubmitted !== undefined) {
    return fromSubmitted;
  }
  const fromRunningTurn = witnessFromRunningTurn({ host, screen });
  if (fromRunningTurn !== undefined) {
    return fromRunningTurn;
  }
  return witnessFromScreen({ expected, screen });
}
