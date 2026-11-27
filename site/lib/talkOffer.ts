/**
 * What `/api/talk/offer` answers: a call on the owner's ChatGPT plan, or the plan's refusal shown plainly in the call widget.
 *
 * The ChatGPT plans fund everything and no platform API usage does, so nothing else is minted when the plan says no
 * — no second funding, no fallback model, no fallback voice. "Definitive" and "ambiguous" are `talkPlanCall.ts`'s line: a refusal before any realtime session could
 * exist, against a timeout or exit after `thread/realtime/start` was sent, when a plan session may be live and the
 * right move is to try again rather than read it as the plan's word.
 *
 * "Definitive" means no session can exist, not that the plan said no: an app-server that exited or never answered
 * `initialize` is definitive too. So a refusal reads "the call could not start", and its reason names who said no —
 * Codex's own answer, the login check, or the app-server's fate. A call `talk offer` never composed is neither: the
 * plan was never asked. Measured: a console rebuild killed the composer and /talk said "the ChatGPT plan refused this
 * call: … exited null".
 *
 * Pure, so the wording is `site/__tests__/unit/talkOffer.test.ts` rather than a hope.
 */
import type { CallOpenMode } from "./callRollover";
import { clauseAfter } from "./clauseJoin";
import { PLAN_CALL_LIMITS } from "./planCallContract";

/**
 * Sixty seconds for `slopweaver talk offer` to print its composition. This is the one console route that waits on a
 * provider round trip rather than on a local read, and a session mint that takes longer than a minute is one the owner has
 * already given up on.
 */
export const OFFER_COMPOSE_TIMEOUT_MS = 60_000;

/**
 * The longest `/api/talk/offer` can take to answer a press, every bound it keeps added up: the composition, the three
 * handshake requests before realtime (`initialize`, `account/read`, `thread/start`), then `thread/realtime/start`.
 *
 * The page's WebRTC setup waits past this, so what the call widget shows is always the route's own answer. Measured:
 * with the owner's plan at its weekly limit, the SDK's default 30-second setup window closed first and /talk read
 * "OpenAI did not finish connecting the call within 30 seconds" while the route was still waiting on the plan's answer.
 */
export const OFFER_ANSWER_BOUND_MS =
  OFFER_COMPOSE_TIMEOUT_MS + 3 * PLAN_CALL_LIMITS.handshakeStepMs + PLAN_CALL_LIMITS.realtimeStartMs;

/**
 * How long the page's WebRTC setup waits, passed to `OpenAILiveWebRTC.connect`: the route's longest answer plus
 * fifteen seconds for gathering candidates before it and bringing the audio link up after.
 */
export const PAGE_SETUP_TIMEOUT_MS = OFFER_ANSWER_BOUND_MS + 15_000;

/** A plan call the console holds. */
export interface TalkMinted {
  readonly ok: true;
  readonly sdp: string;
  readonly model: string;
  readonly backendModel: string;
  readonly voice: string;
  readonly tools: readonly string[];
  readonly writers: readonly string[];
  readonly packed: boolean;
  /** The console's own id for the held call — what the events, answer and stop routes take. */
  readonly callId: string;
  readonly threadId: string;
}

/** What `/api/talk/offer` answers. */
export type TalkOfferResult = TalkMinted | { readonly ok: false; readonly notMinted: string };

/**
 * The plan leg's outcome. `uncomposed` is a call `slopweaver talk offer` never finished composing: that verb makes no
 * network call, so the plan was never asked and nothing it said may be shown as its refusal. `stopped` says the
 * composer was killed or timed out rather than exiting with its own answer — the case where pressing again works.
 */
export type PlanLeg =
  | { readonly kind: "open"; readonly minted: TalkMinted }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly reason: string }
  | { readonly kind: "uncomposed"; readonly reason: string; readonly stopped: boolean };

/** The most of the plan's refusal the call widget shows; an app-server error can run to megabytes, a line on a page cannot. */
export const REFUSAL_SHOWN_MAX_CHARS = 2000;

/**
 * The `slopweaver talk offer` argv a mint runs: a dropped call coming back carries `--reconnect`, a long call rolled
 * over in a pause `--rollover`, and the owner's press neither. The desktop test instance's call carries `--test-instance e2e`,
 * so its reopen reminder is judged against the test instance's own calls and never the owner's.
 *
 * @param voice the plan voice, already checked against the picker's list
 * @param mode why the page is opening this call
 * @param wanted the owner's voice call, or the desktop test instance's
 * @returns the argv after `slopweaver`
 */
export function offerArgvOf({
  voice,
  mode,
  wanted,
}: {
  voice: string;
  mode: CallOpenMode;
  wanted: "voice" | "e2e-voice";
}): readonly string[] {
  const argv = ["talk", "offer", "--voice", voice, "--json"];
  if (mode !== "fresh") {
    argv.push(`--${mode}`);
  }
  if (wanted === "e2e-voice") {
    argv.push("--test-instance", "e2e");
  }
  return argv;
}

/**
 * The `slopweaver talk offer --typed` argv a typed open runs. The desktop test instance's carries `--test-instance e2e`,
 * so its composition reads no conversation typed into the messenger (`src/talk/continuityCalls.ts` `callsForMint`).
 *
 * @param instance the owner's page, or the desktop test instance's
 * @returns the argv after `slopweaver`
 */
export function typedOfferArgvOf({ instance }: { instance: "owner" | "e2e" }): readonly string[] {
  const argv = ["talk", "offer", "--typed", "--json"];
  if (instance === "e2e") {
    argv.push("--test-instance", "e2e");
  }
  return argv;
}

/**
 * The page's answer for one plan leg: the call, or why there is none, the refusal cut at
 * {@link REFUSAL_SHOWN_MAX_CHARS} and saying so.
 *
 * @param leg what the plan leg came back with
 * @returns what the page is answered
 */
export function offerResultOf({ leg }: { leg: PlanLeg }): TalkOfferResult {
  if (leg.kind === "open") {
    return leg.minted;
  }
  const reason = cutMarked({ max: REFUSAL_SHOWN_MAX_CHARS, text: leg.reason });
  if (leg.kind === "ambiguous") {
    return {
      notMinted: clauseAfter({ clause: "the plan may still have a session open, so try again", joint: ";", reason }),
      ok: false,
    };
  }
  if (leg.kind === "uncomposed") {
    let said = reason;
    if (leg.stopped) {
      said = clauseAfter({ clause: "nothing reached the plan, so press again", joint: ";", reason });
    }
    return { notMinted: `the call was never put to the ChatGPT plan: ${said}`, ok: false };
  }
  return { notMinted: `the call could not start: ${reason}`, ok: false };
}

/**
 * A text cut to at most `max` characters, saying where when it was. Characters are code points, never UTF-16 units,
 * so a cut never splits a surrogate pair and a text of exactly `max` characters is never called cut.
 *
 * @param text what to bound
 * @param max the most characters kept before the marker
 * @returns the text whole, or its head and a marker naming the cut
 */
export function cutMarked({ text, max }: { text: string; max: number }): string {
  let kept = 0;
  let end = 0;
  for (const character of text) {
    if (kept === max) {
      return `${text.slice(0, end)}… (cut at ${String(max)} characters)`;
    }
    kept += 1;
    end += character.length;
  }
  return text;
}
