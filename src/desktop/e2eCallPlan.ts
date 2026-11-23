/**
 * What `slopweaver desktop e2e --call` places, in order: real voice calls on a visible test instance, each one a
 * scenario the renderer-crash fix and the ordinary call path have to survive. Pure; the driver is
 * `src/cli/commands/desktop/e2eCallDriver.ts`.
 *
 * The requirement: every change to the desktop app is proven end to end, calls included, so a regression cannot ship.
 * The ordinary walk (`./e2ePlan.ts`) looks and never presses; this leg presses Talk, so it runs only when `--call`
 * asks for it.
 *
 * What is said on a call is written to the owner's talk store, so every call the test instance places is MARKED: its
 * windows carry the instance argument, the page sends it with every batch, and `talk transcript` stamps
 * `origin.instance: "e2e"` on the open line (`src/talk/callOrigin.ts`), so `talk unread`, continuity, the chat thread
 * and card landing never take its speech as the owner's — and the leg stops on a transcript that is not marked. Every prompt but `call-live`'s
 * also says it is an automated test, for whoever reads the file itself; `call-live` is a bare greeting
 * ({@link CALL_LIVE_PROMPT}), because announcing a test is exactly what would hide the greeting the voice answers.
 */
import { resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import type { E2eCardStepId } from "./e2eCardReadPlan.js";
import { type DesktopE2eError, DesktopE2eErrors } from "./e2eErrors.js";
import { type E2eStep, pickSteps } from "./e2ePlan.js";
import {
  type E2eMicCandidate,
  type E2eTranscriptFidelitySpec,
  FIDELITY_CALL_CAP_MS,
  TRANSCRIPT_FIDELITY_CORPUS,
  transcriptFidelitySchedule,
} from "./e2eTranscriptFidelityCorpus.js";

/** One call scenario, by id. */
export type E2eCallStepId =
  | "call-live"
  | "launcher-voice"
  | "queue-search"
  | "call-holds"
  | "long-task-mid-call"
  | "card-read"
  | "card-read-typed"
  | "card-reading-hold"
  | "card-next"
  | "fleet-ask"
  | "draft-read-back"
  | "renderer-killed"
  | "typing-after-drop"
  | "relaunch"
  | "update-swap-resume"
  | "renderer-killed-twice"
  | "renderer-killed-connecting"
  | "call-reopen"
  | "transcription-fidelity";

/** One call scenario: what the fake microphone says, and how long the scenario may take. */
export interface E2eCallStep {
  readonly kind: "call";
  readonly id: E2eCallStepId;
  /** What the fake microphone says, looped with {@link E2eCallStep.silenceMs} of silence after it. */
  readonly prompt: string;
  /** The silence after each saying, so the voice has room to answer before it hears the prompt again. */
  readonly silenceMs: number;
  /** How long the scenario waits for its awaited state — live, an answer, a recovery — before failing. */
  readonly capMs: number;
  /** How long a held call is held; zero for every scenario but `call-holds`. */
  readonly holdMs: number;
  /**
   * The card key (`<kind>:<id>`) `card-read` and `card-read-typed` ask about, from `--call-card` or the console's
   * inventory (`./e2eCardReadPlan.ts`); `undefined` on every other scenario. Carried here so the drive and its witness
   * never recover it by parsing the prompt's prose.
   */
  readonly cardKey: string | undefined;
  /**
   * Which call of the paired microphone comparison this is (`./e2eTranscriptFidelityCorpus.ts`); absent on every
   * scenario but `transcription-fidelity`, whose microphone is the versioned script rather than {@link E2eCallStep.prompt}.
   */
  readonly fidelity?: E2eTranscriptFidelitySpec;
}

/** The hold `--call-hold-minutes` defaults to: five minutes over the owner's real earlier-call history, the renderer-crash witness. */
export const CALL_HOLD_DEFAULT_MINUTES = 5;

/** The longest hold accepted. */
const CALL_HOLD_MAX_MINUTES = 30;

/** Every call scenario id, in the order the leg places them. */
export const CALL_STEP_IDS: readonly E2eCallStepId[] = [
  "call-live",
  "queue-search",
  "call-holds",
  "long-task-mid-call",
  "card-read",
  "card-read-typed",
  "card-reading-hold",
  "card-next",
  "fleet-ask",
  "draft-read-back",
  "launcher-voice",
  "renderer-killed",
  "typing-after-drop",
  "relaunch",
  "update-swap-resume",
  "renderer-killed-twice",
  "renderer-killed-connecting",
  "call-reopen",
  "transcription-fidelity",
];

/** The words a short scenario's microphone says. */
const SHORT_PROMPT = "This is an automated end to end test of the desktop app. Please reply with one short sentence.";

/**
 * What `call-live`'s microphone says: only a greeting, the way the owner opens a call, which
 * the voice once answered alone with "Hi there. I'm ChatGPT…" (`src/talk/colleagueGreetingLines.ts`). The leg proves the
 * call went live and answered, then judges the voice's first final segment off the call store and FAILS a product
 * name, a self-introduction, a list of what it can do or more than a few words (`./e2eGreetingJudge.ts`).
 */
export const CALL_LIVE_PROMPT = "Hello.";

/**
 * The silence after `call-live`'s greeting: past twice {@link AWAIT_CAP_MS}, since the step waits one cap for the call
 * to go live and a second for the answer, so Chromium's loop never says it a second time while the scenario waits and
 * the answer read afterwards is the one to a single greeting. A judgement value.
 */
const CALL_LIVE_SILENCE_MS = 200_000;

/** How long a scenario waits for a call to go live, for an answer, or for a recovery to reconnect. */
const AWAIT_CAP_MS = 90_000;

/**
 * How long `queue-search` waits, from typing its question, for the thread's one-word answer: the gateway's 16s child
 * deadline, the console's 20s tool timeout, a typed conversation's opening and the writing either side.
 */
const QUEUE_SEARCH_CAP_MS = 120_000;

/**
 * A card key's id, as spoken: the part after `<kind>:` with every `-`, `_` and `.` a space, the way speech-to-text
 * hears it — `hand:acme-sample-note` is "acme sample note".
 *
 * @param cardKey the Queue card key, `<kind>:<id>`
 * @returns the id's words
 */
export function cardIdWords({ cardKey }: { cardKey: string }): string {
  const id = cardKey.slice(cardKey.indexOf(":") + 1);
  return id.replaceAll(/[-_.]/gu, " ");
}

/**
 * The marker every typed turn of the call leg opens with, which the transcript must carry back exactly.
 *
 * @param nonce the run's own token
 * @returns the marker
 */
export function typedMarker({ nonce }: { nonce: string }): string {
  return `E2E typed ${nonce}`;
}

/**
 * The challenge `card-read` types into the live call after its first answer: a plain push-back that names no tool and
 * does not say to re-read, so what sends the call back to the card is the console's own challenged-card line,
 * not the test's wording. Past the marker it is only what the owner would say: a sentence announcing a test made the
 * voice answer it as a message ABOUT the test ("The automated test says it doesn't think that problem is real…"),
 * which is not the push-back the console's line is for.
 *
 * @param nonce the run's own token, carried as {@link typedMarker}
 * @returns the message
 */
export function cardReadChallenge({ nonce }: { nonce: string }): string {
  return `${typedMarker({ nonce })}: I don't think that problem is real. What does the card actually claim?`;
}

/**
 * What `fleet-ask`'s microphone says: an ask for fleet work, the shape the voice once answered with "I'll get you that
 * briefing", though the fleet produces briefings and the voice does not. It asks for real work too, so the thinking model's answer is handed back for the voice to say in its own words —
 * where the subject swapped. The leg proves the call answered; who the voice said will write the briefing is read off
 * the call file afterwards (`docs/console/voice-holds-to-the-record.md`).
 */
export const FLEET_ASK_PROMPT =
  "This is an automated end to end test. I want a briefing on what the lint rules in the Slopweaver source actually " +
  "enforce. Look at the lint configuration, then tell me in two sentences what you found and who will write that briefing.";

/**
 * What `draft-read-back`'s microphone says: a draft dictated as the owner, fillers and all, asked for "in my voice" and
 * to be read back — the shape of a call that answers by speaking AS the owner instead of reading
 * the draft back (`src/talk/quotedDraftLines.ts`). The draft is about the test
 * itself, so the line it leaves on the owner's running list says what it is, and it asks for `DRAFT_READ_BACK_WORDS`
 * by name, "test" only in its opening. The leg proves the voice quoted a draft carrying them
 * (`./e2eDraftReadBackRows.ts`); whether it read the draft in its own register, never the owner's, is read off the call
 * file afterwards.
 */
export const DRAFT_READ_BACK_PROMPT =
  "This is an automated end to end test. Um, can you draft me a two line Slack message to a colleague, like, with " +
  "the words test and no rush in it, saying the end to end test of the desktop app ran, and, yeah, there's no rush " +
  "on their review. Keep it concise and in my voice, then read the draft back to me.";

/**
 * `draft-read-back`'s silence before its words, past the shared lead. MEASURED: the leg went live about 23 s after the
 * call file opened and the first words were heard 4 s after that, so under the
 * shared 15 s lead the call heard the prompt only from "And, and, yeah, there's no rush" on. Repro: the `open` and first
 * `segment` lines of `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl` beside `report.json`'s `planEvents` under
 * `$SLOPWEAVER_HOME/proof/desktop-e2e/<run>`. Twice that ~23 s gap, inside the leg's 240 s cap.
 */
const DRAFT_READ_BACK_LEAD_MS = 45_000;

/**
 * The silence before a step's words: `draft-read-back`'s own lead, else the shared one the caller passes. Only that leg
 * is given its own, because a prompt whose first half is lost cannot be drafted at all, and its cap has room.
 *
 * @param id the step
 * @param standard the shared lead, `LEAD_SILENCE_MS` in `src/cli/commands/desktop/e2eCallAudio.ts`
 * @returns how long the microphone is silent before the words
 */
export function microphoneLeadMs({ id, standard }: { id: E2eCallStepId; standard: number }): number {
  if (id === "draft-read-back") {
    return DRAFT_READ_BACK_LEAD_MS;
  }
  return standard;
}

/** A scenario that asks the call for real work mid-call, so its answer takes minutes rather than seconds. */
function longTaskStep({ id, prompt }: { id: E2eCallStepId; prompt: string }): E2eCallStep {
  return { capMs: 240_000, cardKey: undefined, holdMs: 0, id, kind: "call", prompt, silenceMs: 180_000 };
}

/**
 * Every call scenario but the card ones, in leg order. The card scenarios are planned per card
 * (`./e2eCardReadPlan.ts`), because what they read is this install's own state, never a repository constant.
 *
 * @param holdMinutes how long `call-holds` holds its call
 * @returns the scenarios
 */
export function e2eCallSteps({ holdMinutes }: { holdMinutes: number }): readonly E2eCallStep[] {
  const short = ({ id }: { id: E2eCallStepId }): E2eCallStep => ({
    capMs: AWAIT_CAP_MS,
    cardKey: undefined,
    holdMs: 0,
    id,
    kind: "call",
    prompt: SHORT_PROMPT,
    silenceMs: 20_000,
  });
  return [
    { ...short({ id: "call-live" }), prompt: CALL_LIVE_PROMPT, silenceMs: CALL_LIVE_SILENCE_MS },
    // Places no call — its question is typed with none up — so its microphone is never heard.
    { ...short({ id: "queue-search" }), capMs: QUEUE_SEARCH_CAP_MS },
    {
      capMs: AWAIT_CAP_MS,
      cardKey: undefined,
      holdMs: holdMinutes * 60_000,
      id: "call-holds",
      kind: "call",
      prompt: "This is an automated end to end test holding the call open. Please answer in one short sentence.",
      silenceMs: 40_000,
    },
    longTaskStep({
      id: "long-task-mid-call",
      prompt:
        "This is an automated end to end test. Please look in the Slopweaver source code for how the desktop app " +
        "recovers a voice call when the voice window's renderer crashes, then explain it in two sentences.",
    }),
    longTaskStep({ id: "fleet-ask", prompt: FLEET_ASK_PROMPT }),
    longTaskStep({ id: "draft-read-back", prompt: DRAFT_READ_BACK_PROMPT }),
    // Started by a launcher's `slopweaver://voice` rather than a Talk press (`desktop/docs/launcher-commands.md`).
    short({ id: "launcher-voice" }),
    short({ id: "renderer-killed" }),
    short({ id: "typing-after-drop" }),
    short({ id: "relaunch" }),
    short({ id: "update-swap-resume" }),
    short({ id: "renderer-killed-twice" }),
    short({ id: "renderer-killed-connecting" }),
    // A's microphone, said once with `call-live`'s silence so A carries one answered line; B's and C's are rendered by
    // its drive (`e2eCallReopenScenario.ts`).
    { ...short({ id: "call-reopen" }), silenceMs: CALL_LIVE_SILENCE_MS },
  ];
}

/**
 * The paired microphone comparison's six calls, in the schedule's counterbalanced order. Never part of a default leg:
 * six seven-minute calls answer one question, asked by naming it with `--only transcription-fidelity` and a
 * `--call-mic-candidate`.
 *
 * @param candidate the variant compared against control; none places no call
 * @returns the calls
 */
function transcriptFidelitySteps({ candidate }: { candidate: E2eMicCandidate | undefined }): readonly E2eCallStep[] {
  if (candidate === undefined) {
    return [];
  }
  return transcriptFidelitySchedule({ candidate }).map((fidelity) => ({
    capMs: FIDELITY_CALL_CAP_MS,
    cardKey: undefined,
    fidelity,
    holdMs: 0,
    id: "transcription-fidelity",
    kind: "call",
    prompt: TRANSCRIPT_FIDELITY_CORPUS.utterances[0]!.text,
    silenceMs: 0,
  }));
}

/** The steps one run takes: the walk's and the call leg's, and any id that names neither. */
export interface DesktopE2ePick {
  readonly walk: readonly E2eStep[];
  /** The call scenarios but the card ones, which are planned per card (`./e2eCardReadPlan.ts`). */
  readonly calls: readonly E2eCallStep[];
  /** Which card scenarios were asked for, in leg order: the two reads with `--call` and no `--only`. */
  readonly cardSurfaces: readonly E2eCardStepId[];
  /** Ids that name no step at all. */
  readonly unknown: readonly string[];
  /** Call scenario ids named without `--call`, which never places a call. */
  readonly needsCall: readonly string[];
  /** Card scenario ids named with `--call` but no `--call-card`. */
  readonly needsCard: readonly string[];
  /** `transcription-fidelity` named with `--call` but no `--call-mic-candidate`: nothing to compare control against. */
  readonly needsCandidate: readonly string[];
}

/** The call scenarios that read a card, so cannot be placed without one, in leg order. */
const CARD_SCENARIOS: readonly E2eCardStepId[] = ["card-read", "card-read-typed", "card-reading-hold", "card-next"];

/**
 * The card scenarios a leg with no `--only` places per card. `card-reading-hold` and `card-next` run only when named: a third call on
 * every card of an inventory sweep would push a sweep of twenty cards past its lock's twelve hours at the caps
 * (`./e2eCardInventory.ts`), for a property one card proves.
 */
const DEFAULT_CARD_SCENARIOS: readonly E2eCardStepId[] = ["card-read", "card-read-typed"];

/**
 * Pick one run's steps. No `--only` is the whole walk, then every call scenario when `--call` is on — the card ones only
 * when a card is named; with `--only`, the named ones in their own orders, a call id is legal only beside `--call`,
 * and a card scenario only beside a card.
 *
 * @param call whether `--call` was given
 * @param carded whether `--call-card` named a card, or `all`
 * @param holdMinutes the hold `call-holds` takes
 * @param micCandidate the `--call-mic-candidate` variant `transcription-fidelity` compares against control
 * @param only the ids asked for, empty for every step
 * @returns the picked steps and the ids that could not be picked
 */
export function pickDesktopE2eSteps({
  call,
  carded,
  holdMinutes,
  micCandidate,
  only,
}: {
  call: boolean;
  carded: boolean;
  holdMinutes: number;
  micCandidate?: E2eMicCandidate | undefined;
  only: readonly string[];
}): DesktopE2ePick {
  const everyCall = e2eCallSteps({ holdMinutes });
  if (only.length === 0) {
    const calls = call ? everyCall : [];
    const cardSurfaces = call && carded ? [...DEFAULT_CARD_SCENARIOS] : [];
    return {
      calls,
      cardSurfaces,
      needsCall: [],
      needsCandidate: [],
      needsCard: [],
      unknown: [],
      walk: pickSteps({ only: [] }).steps,
    };
  }
  const callIds = new Set<string>(CALL_STEP_IDS);
  const walkIds = only.filter((id) => !callIds.has(id));
  const askedCalls = only.filter((id) => callIds.has(id));
  const askedCards = CARD_SCENARIOS.filter((id) => askedCalls.includes(id));
  const walk = walkIds.length === 0 ? { steps: [], unknown: [] } : pickSteps({ only: walkIds });
  const picked = { needsCall: [], needsCandidate: [], unknown: walk.unknown, walk: walk.steps };
  if (!call) {
    return { ...picked, calls: [], cardSurfaces: [], needsCall: askedCalls, needsCard: [] };
  }
  const fidelityAsked = askedCalls.includes("transcription-fidelity");
  if (fidelityAsked && micCandidate === undefined) {
    return { ...picked, calls: [], cardSurfaces: [], needsCandidate: ["transcription-fidelity"], needsCard: [] };
  }
  const fidelity = fidelityAsked ? transcriptFidelitySteps({ candidate: micCandidate }) : [];
  const calls = [...everyCall.filter((step) => askedCalls.includes(step.id)), ...fidelity];
  if (!carded) {
    return { ...picked, calls, cardSurfaces: [], needsCard: askedCards };
  }
  return { ...picked, calls, cardSurfaces: askedCards, needsCard: [] };
}

/**
 * Read `--call-hold-minutes`: a whole number of minutes, one to thirty.
 *
 * @param text the flag's value
 * @returns the minutes, or why the value is refused
 */
export function parseHoldMinutes({ text }: { text: string }): Result<number> {
  const minutes = Number(text);
  if (!/^\d+$/u.test(text) || minutes < 1 || minutes > CALL_HOLD_MAX_MINUTES) {
    return err([`--call-hold-minutes takes a whole number from 1 to ${String(CALL_HOLD_MAX_MINUTES)}, not ${text}`]);
  }
  return ok(minutes);
}

/**
 * The checkout a run reads its console from, refused when the call leg would place calls on a console that is not
 * the owner's: `talk transcript` refuses such a console writing the live talk store, so its call's transcript never
 * ends and the leg could only STOP on it after spending a real call (`--checkout <worktree> --call`).
 *
 * The owner's is ANY checkout their profile declares, the same list the console gate reads (`resolveConsoleOrigin`),
 * never only the one this repository's origin picks first.
 *
 * @param calling whether the leg places any call: a scenario, or a card the console's inventory names
 * @param checkout the checkout the run resolved
 * @param declared every main checkout the owner's profile declares, whose consoles are the owner's
 * @returns the checkout, or why the call leg will not run on it
 */
export function callLegCheckout({
  calling,
  checkout,
  declared,
}: {
  calling: boolean;
  checkout: string;
  declared: readonly string[];
}): Result<string, DesktopE2eError> {
  if (!calling || declared.some((path) => resolve(path) === resolve(checkout))) {
    return ok(checkout);
  }
  return err(DesktopE2eErrors.callConsoleNotOwners({ checkout, declared }));
}

/**
 * The words typed into a recovered call: a nonce the transcript must carry back exactly.
 *
 * @param nonce the run's own token
 * @returns the message
 */
export function typedProbe({ nonce }: { nonce: string }): string {
  return `${typedMarker({ nonce })}: this is an automated end to end test, reply with acknowledged`;
}

/**
 * The Queue question `queue-search` types with no call up: the one a typed conversation's search once timed out
 * on ("is there a queue card for me to ask this question?"), asking for one word the judge can read
 * (`./e2eCallQueueSearch.ts`), carrying the nonce its turn is found by. It names `talk find-card` because the path
 * under test is that verb inside the budget, not the thread's choice of tool.
 *
 * @param nonce the run's own token
 * @returns the message
 */
export function queueSearchQuestion({ nonce }: { nonce: string }): string {
  return (
    `E2E typed ${nonce}: this is an automated end to end test. Is there a Queue card for me to ask for access to our ` +
    "Apple developer account? Check with the talk find-card verb, then reply with exactly one word and nothing else: " +
    "FOUND if the search returned a card, NONE if it returned nothing, or FAILED if the search timed out or failed."
  );
}
