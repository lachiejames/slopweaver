/**
 * The SDP exchange the browser's WebRTC helper delegates to this server, on the owner's ChatGPT plan and nothing else
 * (`lib/talkOffer.ts` says what a refusal shows).
 *
 * `slopweaver talk offer` composes the call, and `lib/talkPlanLaunch.ts` starts that composition's `codex
 * app-server`, hands it the browser's offer through `thread/realtime/start` and returns the answer SDP. The child is
 * held for the call's life in `lib/talkCallRegistry.ts`; `/api/talk/call/[id]/{events,answer,stop}` are the rest of
 * the call. The OpenAI SDK's `OpenAILiveWebRTC` is "application-owned SDP exchange": it hands the local offer to a
 * callback and takes an answer back, so the only thing that crosses into the page is an SDP answer.
 *
 * The whole mint runs under a call lease (`heldWhileMinting`), so a console rebuild never swaps the server out from
 * under a call still being composed — a rollover ahead of the 90-minute limit is exactly that moment.
 */
import { NextResponse } from "next/server";

import { isBag } from "../../../../lib/bag";
import { consoleHoldDir } from "../../../../lib/callLeaseFile";
import { type CallOpenMode, callOpenModeOf } from "../../../../lib/callRollover";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { heldWhileMinting } from "../../../../lib/mintHold";
import { refreshPackNow, startPackKeeper } from "../../../../lib/packKeeper";
import { mintCarriesStandingData } from "../../../../lib/relayGate";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { makeRoomFor } from "../../../../lib/talkCallRegistry";
import {
  OFFER_ANSWER_BOUND_MS,
  OFFER_COMPOSE_TIMEOUT_MS,
  offerArgvOf,
  offerResultOf,
  type PlanLeg,
  type TalkOfferResult,
} from "../../../../lib/talkOffer";
import { openPlanCall } from "../../../../lib/talkPlanLaunch";
import { planCompositionOf } from "../../../../lib/talkPlanProtocol";
import { DEFAULT_TALK_PLAN_VOICE, isTalkPlanVoice } from "../../../../lib/talkVoices";

export type { TalkOfferResult } from "../../../../lib/talkOffer";

/** Never prerendered: it mints a live session against a provider. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** An SDP offer is a few kilobytes; this refuses over 96 KiB before spawning. */
const BODY_MAX_BYTES = 96 * 1024;

/**
 * Compose with the verb, start the app-server, run the handshake. A composition the verb could not print is a
 * definitive refusal — no child was started.
 *
 * @param offer the browser's SDP offer
 * @param voice the plan voice
 * @param mode why the page is opening this call — the owner's press, a dropped call coming back, or a rollover in a pause
 * @param signal the press's request signal, so a page gone mid-handshake stops the child
 * @param wanted the owner's voice call, or the desktop test instance's, which starts beside nothing but typed
 *   conversations at rest
 * @returns the leg's outcome
 */
async function planLeg({
  offer,
  voice,
  mode,
  signal,
  wanted,
}: {
  offer: string;
  voice: string;
  mode: CallOpenMode;
  signal: AbortSignal;
  wanted: "voice" | "e2e-voice";
}): Promise<PlanLeg> {
  const argv = offerArgvOf({ mode, voice, wanted });
  const ran = await spawnVerb({
    argv: [...argv],
    timeoutMs: OFFER_COMPOSE_TIMEOUT_MS,
    title: `slopweaver ${offerArgvOf({ mode, voice: "<voice>", wanted }).join(" ")}`,
  });
  if (!ran.ok) {
    return { kind: "uncomposed", reason: ran.notMeasured, stopped: ran.exitCode === undefined };
  }
  const read = planCompositionOf({ out: ran.out });
  if ("refused" in read) {
    return { kind: "uncomposed", reason: read.refused, stopped: false };
  }
  // The desktop test's call is never the owner's reopen, whatever call of theirs ended a moment ago: its argv
  // carries `--test-instance e2e`, so the verb judged it against the test instance's own calls alone.
  const { composition } = read;
  // This call goes without the pack; rebuilding it now means the reconnect, the rollover ahead of the 90-minute
  // limit, or the next call carries one (`lib/packKeeper.ts`).
  if (isBag(composition.pack) && typeof composition.pack["leftOut"] === "string") {
    refreshPackNow();
  }
  // Again, now: a typed conversation may have opened while the verb composed.
  const busy = makeRoomFor({ wanted, why: "the owner started a voice call, which carries the conversation on" });
  if (busy !== undefined) {
    return { kind: "refused", reason: busy };
  }
  // Held by its instance in the same tick as the check above, so a typed send arriving next already reads past it.
  const instance = wanted === "e2e-voice" ? "e2e" : "owner";
  const { callId, outcome } = await openPlanCall({ composition, instance, mode, offerSdp: offer, signal });
  if (outcome.kind !== "open") {
    return outcome;
  }
  return {
    kind: "open",
    minted: {
      backendModel: composition.backendModel,
      callId,
      model: composition.model,
      ok: true,
      packed: mintCarriesStandingData({ continuity: composition.continuity, pack: composition.pack }),
      sdp: outcome.sdp,
      threadId: outcome.threadId,
      tools: composition.tools,
      voice: composition.voice,
      writers: composition.writers,
    },
  };
}

/**
 * Trade one SDP offer for an answer.
 *
 * Always 200 with a `TalkOfferResult` body once the press itself is accepted, for the reason every tile on
 * this console uses: a provider that would not answer and a page that is broken are different facts, and
 * an HTTP error makes them look the same.
 *
 * @param request the press, whose JSON body is `{ mode, sdp, voice }` — voice a plan voice, checked against the
 *   picker's list; `mode` one of `fresh`, `reconnect` or `rollover`, refused when absent or anything else
 * @returns the SDP answer and what the call was minted as, or the stated reason it was not
 */
export async function POST(request: Request): Promise<NextResponse<TalkOfferResult>> {
  const headers = { "cache-control": "no-store" };
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json(refusal({ notMinted: refused }), { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      refusal({
        notMinted: `the offer is ${String(raw.length)} bytes; this route carries up to ${String(BODY_MAX_BYTES)}`,
      }),
      { headers, status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(refusal({ notMinted: "the body is not JSON" }), { headers, status: 400 });
  }
  if (!isBag(body) || typeof body["sdp"] !== "string" || body["sdp"] === "") {
    return NextResponse.json(refusal({ notMinted: "the body carries no sdp string" }), { headers, status: 400 });
  }
  const offer = body["sdp"];
  // Checked here against the list the picker draws, and again by the verb, so a hand-built body names a voice the
  // plan speaks or is refused before a spawn. An absent voice is the plan's default, never a present wrong one.
  const voice = "voice" in body ? body["voice"] : DEFAULT_TALK_PLAN_VOICE;
  if (typeof voice !== "string" || !isTalkPlanVoice({ name: voice })) {
    return NextResponse.json(refusal({ notMinted: `${String(voice)} is not a plan voice the picker offers` }), {
      headers,
      status: 400,
    });
  }
  // Absent or unknown is refused, never read as a press: a body that cannot say why it is minting is not the page's.
  const mode = callOpenModeOf({ value: body["mode"] });
  if (mode === undefined) {
    return NextResponse.json(
      refusal({ notMinted: `${String(body["mode"])} is not a mint mode: one of fresh, reconnect or rollover` }),
      { headers, status: 400 },
    );
  }
  // Absent is the owner's call; `e2e` is the desktop test instance's; anything else is refused, never read as either.
  // An own property only: an inherited one is never the page's word.
  const instance = Object.hasOwn(body, "instance") ? body["instance"] : undefined;
  if (instance !== undefined && instance !== "e2e") {
    return NextResponse.json(
      refusal({ notMinted: "the body's instance is not one this route reads: absent, or e2e" }),
      {
        headers,
        status: 400,
      },
    );
  }
  const wanted = instance === "e2e" ? "e2e-voice" : "voice";
  // One conversation at a time (`lib/talkArbiter.ts`): an idle typed one ends here, before `talk offer` composes,
  // so what the owner typed is already written down as the call's continuity; one still answering refuses the call, and
  // a test call up is ended. The test instance's call ends nothing: a voice call, or a typed conversation not at rest,
  // refuses it, and it runs beside one at rest without touching it.
  const busy = makeRoomFor({ wanted, why: "the owner started a voice call, which carries the conversation on" });
  if (busy !== undefined) {
    return NextResponse.json(refusal({ notMinted: busy }), { headers });
  }
  startPackKeeper();
  const leg = await heldWhileMinting({
    boundMs: OFFER_ANSWER_BOUND_MS,
    dir: consoleHoldDir(),
    mint: () => planLeg({ mode, offer, signal: request.signal, voice, wanted }),
    nowMs: () => Date.now(),
    opened: (held) => held.kind === "open",
  });
  return NextResponse.json(offerResultOf({ leg }), { headers });
}

/**
 * A refusal of the press itself — nothing was attempted.
 *
 * @param notMinted why
 * @returns the result
 */
function refusal({ notMinted }: { notMinted: string }): TalkOfferResult {
  return { notMinted, ok: false };
}
