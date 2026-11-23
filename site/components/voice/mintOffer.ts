/**
 * The SDP trade `OpenAILiveWebRTC`'s `exchangeSdp` makes: the browser's offer to `/api/talk/offer`, which runs
 * `slopweaver talk offer` on this machine, and the answer back — refused unless the mint names the same tools and
 * writers this page can run. The offer asks the owner's ChatGPT plan for a call in `voice`, and a plan refusal is shown as
 * the plan's own word (`site/lib/talkOffer.ts`). Its own file so `VoiceProvider.tsx` stays under the line cap; the
 * reasons are that file's module doc.
 */
import { type Bag, isBag, str, strings } from "../../lib/bag";
import type { CallOpenMode } from "../../lib/callRollover";
import { TALK_TOOL_NAMES, TALK_WRITER_NAMES } from "../../lib/talkTools";
import { refuseOnToolDrift } from "../live/talkSession";
import { stopPlanCall } from "./planCallClient";
import { said } from "./talkToolCalls";
import type { LiveMeta } from "./voiceContext";

/**
 * Trade one offer for the minted session's answer.
 *
 * @param offer the browser's SDP offer
 * @param signal aborts the trade when the connection gives up on it
 * @param voice the ChatGPT voice the call speaks in
 * @param mode why the page is opening this call, so the voice is told to carry on, or to wait silently after a rollover
 * @param instance `"e2e"` on the desktop test instance, whose call the console refuses beside any conversation it holds
 * @returns the SDP answer, what was minted, and whether the context pack rode in
 */
export async function mintOffer({
  offer,
  signal,
  voice,
  mode,
  instance,
}: {
  offer: string;
  signal: AbortSignal;
  voice: string;
  mode: CallOpenMode;
  instance: "e2e" | undefined;
}): Promise<{
  readonly sdp: string;
  readonly minted: LiveMeta;
  readonly packed: boolean;
}> {
  // Each leg's failure is said as that leg, because `setupFailureOf` shows the innermost message verbatim and
  // a bare "Failed to fetch" does not say it was the console server, not OpenAI, that never answered.
  let response: Response;
  try {
    response = await fetch("/api/talk/offer", {
      body: offerBody({ instance, mode, offer, voice }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });
  } catch (cause) {
    throw new Error(`the console server did not answer the mint: ${String(cause)}`, { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`the mint answered HTTP ${String(response.status)} with something that is not JSON`, { cause });
  }
  const result: Bag = isBag(body) ? body : {};
  if (result["ok"] !== true) {
    throw new Error(said({ value: str({ bag: result, key: "notMinted" }), whenAbsent: "the session was not minted" }));
  }
  try {
    return checked({ result });
  } catch (cause) {
    // A plan call this page will not connect to is stopped now, not left to the server's absent-stream grace.
    const callId = str({ bag: result, key: "callId" });
    if (callId !== undefined) {
      stopPlanCall({ callId, keepalive: false });
    }
    throw cause;
  }
}

/**
 * The offer's JSON body: `instance` rides only on the desktop test instance's offer, so the owner's own carries none.
 *
 * @param offer the browser's SDP offer
 * @returns the body
 */
export function offerBody({
  instance,
  mode,
  offer,
  voice,
}: {
  instance: "e2e" | undefined;
  mode: CallOpenMode;
  offer: string;
  voice: string;
}): string {
  if (instance === undefined) {
    return JSON.stringify({ mode, sdp: offer, voice });
  }
  return JSON.stringify({ instance, mode, sdp: offer, voice });
}

/** The minted answer, refused unless its tools are this page's own and it names the call it opened. */
function checked({ result }: { result: Bag }): {
  readonly sdp: string;
  readonly minted: LiveMeta;
  readonly packed: boolean;
} {
  const declared = strings({ bag: result, key: "tools" });
  const declaredWriters = strings({ bag: result, key: "writers" });
  if (declared === undefined || declaredWriters === undefined) {
    throw new Error("the mint answered without the tool names and writers this page checks its own list against");
  }
  const drift = refuseOnToolDrift({
    declared,
    declaredWriters,
    runnable: TALK_TOOL_NAMES,
    runnableWriters: TALK_WRITER_NAMES,
  });
  if (drift !== undefined) {
    throw new Error(drift);
  }
  const minted = mintedOf({ result });
  return {
    minted,
    packed: result["packed"] !== false,
    sdp: String(result["sdp"]),
  };
}

/** What was minted. The call's thread stands in for a session id until the session names one. */
function mintedOf({ result }: { result: Bag }): LiveMeta {
  const callId = str({ bag: result, key: "callId" });
  const threadId = str({ bag: result, key: "threadId" });
  if (callId === undefined || threadId === undefined) {
    throw new Error("the mint answered a plan call without the call and thread it opened");
  }
  return {
    backendModel: String(result["backendModel"]),
    callId,
    model: String(result["model"]),
    sessionId: threadId,
    threadId,
    voice: String(result["voice"]),
  };
}
