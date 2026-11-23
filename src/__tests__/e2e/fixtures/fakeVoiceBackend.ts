/**
 * A fake call backend for the voice window, standing in for everything past the page: `/api/talk/offer` (which would run
 * `slopweaver talk offer` and `src/talk/planSession.ts`), the call's routes and the transcript sink. Nothing reaches a
 * provider, `codex app-server` or the worker's home.
 *
 * - The voice page draws nothing in a plain browser, so an init script hands it the smallest bridge the shell's guard
 *   accepts (`site/lib/desktopShell.ts` `isDesktopBridge`): the overlay's role and its five methods, marked as the test
 *   instance's.
 * - The offer is answered by a second `RTCPeerConnection` in the same page, so the SDK's own `OpenAILiveWebRTC`
 *   negotiates, opens its data channel and goes live over loopback, with Chromium's fake microphone as its track. The
 *   fake holds that far peer by a Playwright handle, never on `window`.
 * - What the voice "says" is written onto that data channel in the plan call's vocabulary
 *   (`site/lib/talkPlanEvents.ts`), so the page folds and draws it exactly as it would a real call's.
 * - The call's event stream is held open until Stop, since a stream that ends reads as a dropped call. A call route
 *   this fake does not know is answered 409 and recorded, so a new dependency the page grows shows up by name.
 * - What this fake cannot do: a Playwright route answers once, whole, and never streams. So the real event stream's
 *   200 and its headers, sent at once (`site/app/api/talk/call/[id]/events/route.ts`), never arrive: the request stays
 *   pending until the page's hang-up aborts it (`releasePlanCall` aborts the follow before it posts Stop), and its
 *   `{"heartbeat":true}` frame every 15s never arrives either. The page reads a heartbeat as an entry nothing acts on
 *   (`site/lib/talkPlanEventsStream.ts`) and goes live without the stream's headers, so the call's flow here is the
 *   same; a page that began to act on either would need a streaming fake, not this one.
 */
import type { BrowserContext, JSHandle, Page, Route } from "@playwright/test";
import { z } from "zod";

import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";

/** The fake call's synthetic id, the one every call route names. */
const CALL_ID = "a0000006-0000-4000-8000-000000000007";

/** The turn id every scripted assistant line rides on, so a spec can find its row. */
export const FAKE_ASSISTANT_TURN_ID = "desktop-e2e-assistant";

/**
 * What the fake saw the page ask for.
 *
 * @internal
 */
export interface FakeVoiceObservations {
  /** Each offer's mode and test-instance marker, in order. */
  readonly offers: readonly { readonly instance: unknown; readonly mode: unknown }[];
  readonly stopRequests: number;
  /** Every line the page posted to the transcript sink, in order, as it sent them. */
  readonly transcriptLines: readonly unknown[];
  /** Asks the fake refused, by leaf: a call route it does not know, or a transcript batch the real route refuses. */
  readonly unexpected: readonly string[];
  /** The live call's own watches asking whether anything is due, by leaf, in order. */
  readonly watchAsks: readonly string[];
}

/**
 * The two watches every live plan call starts by itself (`site/components/voice/useMeetingWatch.ts`,
 * `useSteerRiskWatch.ts`), each answered with the whole body its route sends when nothing is due
 * (`site/app/api/talk/call/[id]/meeting-due/route.ts`, `steer-risk/route.ts`) — no shown meeting to refresh, here.
 * That is the world of an install with nothing due on either watch, chosen on purpose: a connected calendar with no
 * meeting due, and a hand register holding no unsaid at-risk steer. The seeded home has no Google grant, where the
 * real meeting-due route answers 502; the voice window's own call is what is under test here, never the calendar's
 * absence or a steer's announcement.
 */
const NOTHING_DUE: Readonly<Record<string, Record<string, unknown>>> = {
  "meeting-due": { already: false, meeting: null, ok: true, refreshed: [], unspoken: null },
  "steer-risk": { already: false, ok: true, said: null },
};

/** The handle a spec drives the fake through. */
export interface FakeVoiceBackend {
  /** Let the held offer answer, so the call goes from connecting to live. */
  readonly releaseOffer: () => void;
  /** Have the voice say one line, over the data channel, as one whole assistant turn. */
  readonly sendAssistantTranscript: (input: { readonly text: string }) => Promise<void>;
  readonly observations: () => FakeVoiceObservations;
  readonly dispose: () => Promise<void>;
}

/** The far end of the call, living in the page: its peer, and its side of the data channel once open. */
interface FarPeer {
  readonly peer: RTCPeerConnection;
  readonly opened: Promise<RTCDataChannel>;
}

/** What the fake counts and holds across one test, written by its routes and read by the handle. */
interface FakeState {
  readonly offers: { readonly instance: unknown; readonly mode: unknown }[];
  readonly transcriptLines: unknown[];
  readonly unexpected: string[];
  readonly watchAsks: string[];
  stopRequests: number;
  far: JSHandle<FarPeer> | undefined;
}

/** A one-shot latch: a promise and the function that settles it. */
interface Latch {
  readonly open: () => void;
  readonly opened: Promise<void>;
}

/** The offer's body, the fields the fake reads (`site/components/voice/mintOffer.ts` posts them). */
const OFFER_BODY = z.object({ instance: z.unknown(), mode: z.unknown(), sdp: z.string(), voice: z.string() });

/**
 * Decode the offer's body.
 *
 * @param body the request's raw JSON
 * @returns the SDP, voice, mode and marker it carried; a body missing the SDP or the voice throws
 */
function offerOf({ body }: { body: string | null }): z.infer<typeof OFFER_BODY> {
  const parsed: unknown = JSON.parse(String(body));
  return OFFER_BODY.parse(parsed);
}

/**
 * Answer the opening window's post the way the real route does for a fresh call (`reopen-reminder/route.ts`): only a
 * reopened call has a reminder to arm, so `{"action":"ready"}` is answered `unavailable` and the page watches nothing;
 * any other body gets the route's own 400 and is recorded.
 *
 * @param route the intercepted opening-window post
 * @param state the fake's state, where a refused body is recorded
 */
async function answerReopenReminder({ route, state }: { route: Route; state: FakeState }): Promise<void> {
  const parsed: unknown = JSON.parse(String(route.request().postData()));
  if (!z.strictObject({ action: z.literal("ready") }).safeParse(parsed).success) {
    state.unexpected.push("reopen-reminder");
    const refused = 'the body names no action: send {"action":"ready"} or {"action":"speech"}';
    await route.fulfill({ json: { ok: false, refused }, status: 400 });
    return;
  }
  await route.fulfill({ json: { ok: true, outcome: "unavailable" } });
}

/** A transcript batch as the real route first checks it (`site/lib/talkTranscript.ts` `parseTalkTranscriptRequest`). */
const TRANSCRIPT_BODY = z.object({ callId: z.string(), lines: z.array(z.unknown()).min(1) });

/**
 * Answer one transcript batch the way the real route does: how many lines went in, or the route's refusal for a batch
 * with no call id or no lines.
 *
 * @param route the intercepted transcript post
 * @param state the fake's state, which keeps every line posted
 */
async function answerTranscript({ route, state }: { route: Route; state: FakeState }): Promise<void> {
  const parsed: unknown = JSON.parse(String(route.request().postData()));
  const batch = TRANSCRIPT_BODY.safeParse(parsed);
  if (!batch.success) {
    state.unexpected.push("transcript");
    await route.fulfill({ json: { outcome: "refused", why: "the body carries no callId and lines" }, status: 400 });
    return;
  }
  state.transcriptLines.push(...batch.data.lines);
  await route.fulfill({ json: { appended: batch.data.lines.length, outcome: "done" } });
}

/**
 * The mint the page checks (`site/components/voice/mintOffer.ts`): synthetic ids, the request's voice, the far peer's
 * answer, and the tool and writer names derived from the same list `planSession.ts` declares, so the page's own drift
 * check still runs.
 *
 * @param answerSdp the far peer's SDP answer
 * @param voice the voice the page asked for
 * @returns the JSON body `/api/talk/offer` answers with
 */
function mintOf({ answerSdp, voice }: { answerSdp: string; voice: string }): Record<string, unknown> {
  return {
    backendModel: "fake-backend-model",
    callId: CALL_ID,
    model: "fake-live-model",
    ok: true,
    packed: false,
    sdp: answerSdp,
    threadId: "thread-desktop-e2e",
    tools: TALK_TOOLS.map((tool) => tool.name),
    voice,
    writers: TALK_TOOLS.filter((tool) => tool.kind === "relay" || tool.kind === "draft").map((tool) => tool.name),
  };
}

/**
 * One whole assistant turn in the plan call's data-channel vocabulary: opened empty, one delta, the voice's own
 * fragment, then done carrying the whole line.
 *
 * @param text the line
 * @returns the events, in order
 */
function assistantTurn({ text }: { text: string }): readonly Record<string, unknown>[] {
  const id = FAKE_ASSISTANT_TURN_ID;
  return [
    { turn: { id, role: "assistant", transcript: "" }, type: "turn.created" },
    { delta: text, turn_id: id, type: "turn.delta" },
    { item: { text }, type: "output_transcript.added" },
    { turn: { id, role: "assistant", transcript: text }, type: "turn.done" },
  ];
}

/**
 * A latch that starts shut.
 *
 * @returns the promise and its opener
 */
function latch(): Latch {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Fulfil a route the page may already have abandoned: Stop aborts the event stream's fetch as it posts `/stop`.
 *
 * @param route the held route
 * @param body what to answer, when it is still wanted
 */
async function fulfilQuietly({ route, body }: { route: Route; body: string }): Promise<void> {
  try {
    await route.fulfill({ body, contentType: "application/x-ndjson", status: 200 });
  } catch (cause) {
    if (!String(cause).includes("aborted") && !String(cause).includes("closed")) {
      throw cause;
    }
  }
}

/**
 * Hand every page in the context the smallest desktop bridge the voice page accepts, as the overlay.
 *
 * @param context the test's browser context
 */
async function installBridge({ context }: { context: BrowserContext }): Promise<void> {
  await context.addInitScript(() => {
    const ignore = (): void => undefined;
    const unsubscribe = (): (() => void) => ignore;
    Object.defineProperty(window, "slopweaverDesktop", {
      value: {
        instance: "e2e",
        onOverlayCommand: unsubscribe,
        onPageIdentity: unsubscribe,
        publishPageIdentity: ignore,
        reportOverlayStatus: ignore,
        requestOverlay: ignore,
        role: "overlay",
      },
    });
  });
}

/**
 * Answer the page's offer from a second peer in the same page, once its ICE gathering is complete.
 *
 * @param page the page placing the call
 * @param sdp the page's SDP offer
 * @returns a handle to the far peer, and its SDP answer
 */
async function answerFromFarPeer({
  page,
  sdp,
}: {
  page: Page;
  sdp: string;
}): Promise<{ readonly answerSdp: string; readonly far: JSHandle<FarPeer> }> {
  const far = await page.evaluateHandle(
    async ({ offerSdp }) => {
      const peer = new RTCPeerConnection({ iceServers: [] });
      const opened = new Promise<RTCDataChannel>((resolve) => {
        peer.addEventListener("datachannel", ({ channel }) => {
          if (channel.readyState === "open") {
            resolve(channel);
            return;
          }
          channel.addEventListener(
            "open",
            () => {
              resolve(channel);
            },
            { once: true },
          );
        });
      });
      await peer.setRemoteDescription({ sdp: offerSdp, type: "offer" });
      await peer.setLocalDescription(await peer.createAnswer());
      await new Promise<void>((resolve) => {
        if (peer.iceGatheringState === "complete") {
          resolve();
          return;
        }
        peer.addEventListener("icegatheringstatechange", () => {
          if (peer.iceGatheringState === "complete") resolve();
        });
      });
      return { opened, peer };
    },
    { offerSdp: sdp },
  );
  const answerSdp = await far.evaluate(({ peer }) => peer.localDescription!.sdp);
  return { answerSdp, far };
}

/**
 * Close the far peer, if a call was ever answered; a page already gone has nothing left to close.
 *
 * @param state the fake's state, carrying the far peer's handle
 */
async function closeFarPeer({ state }: { state: FakeState }): Promise<void> {
  const far = state.far;
  if (far === undefined) {
    return;
  }
  await far
    .evaluate(({ peer }) => {
      peer.close();
    })
    .catch(() => undefined);
}

/**
 * Answer one of the call's own routes: the held event stream, Stop, a watch asking what is due, or a 409 naming an
 * unknown leaf.
 *
 * @param route the intercepted call route
 * @param state the fake's state, where each ask is counted
 * @param ended the latch Stop opens, releasing the event stream
 */
async function answerCallRoute({
  route,
  state,
  ended,
}: {
  route: Route;
  state: FakeState;
  ended: Latch;
}): Promise<void> {
  const leaf = new URL(route.request().url()).pathname.split("/").at(-1)!;
  if (leaf === "events") {
    await ended.opened;
    await fulfilQuietly({ body: "", route });
    return;
  }
  if (leaf === "stop") {
    state.stopRequests += 1;
    ended.open();
    await closeFarPeer({ state });
    await route.fulfill({ json: { ok: true, wasLive: true } });
    return;
  }
  if (leaf === "reopen-reminder") {
    await answerReopenReminder({ route, state });
    return;
  }
  const nothingDue = NOTHING_DUE[leaf];
  if (nothingDue !== undefined) {
    state.watchAsks.push(leaf);
    await route.fulfill({ json: nothingDue });
    return;
  }
  state.unexpected.push(leaf);
  await route.fulfill({ json: { ok: false, why: `the fake call backend does not answer ${leaf}` }, status: 409 });
}

/**
 * Route the offer, the transcript sink and the call's routes to the fake.
 *
 * @param page the page whose talk routes the fake answers
 * @param state the fake's state
 * @param offerGate the latch the spec opens to let the held offer answer
 * @param ended the latch Stop opens
 */
async function routeTalk({
  page,
  state,
  offerGate,
  ended,
}: {
  page: Page;
  state: FakeState;
  offerGate: Latch;
  ended: Latch;
}): Promise<void> {
  await page.route("**/api/talk/offer", async (route) => {
    const offer = offerOf({ body: route.request().postData() });
    state.offers.push({ instance: offer.instance, mode: offer.mode });
    const { answerSdp, far } = await answerFromFarPeer({ page, sdp: offer.sdp });
    state.far = far;
    await offerGate.opened;
    await route.fulfill({ json: mintOf({ answerSdp, voice: offer.voice }) });
  });
  await page.route("**/api/talk/transcript", async (route) => {
    await answerTranscript({ route, state });
  });
  await page.route(`**/api/talk/call/${CALL_ID}/*`, async (route) => {
    await answerCallRoute({ ended, route, state });
  });
}

/**
 * Install the fake on a page before it opens `/voice`.
 *
 * @param context the test's browser context, which carries the bridge's init script
 * @param page the page whose talk routes the fake answers
 * @returns the handle to release the offer, script speech, read what the page asked for, and clean up
 */
export async function installFakeVoiceBackend({
  context,
  page,
}: {
  context: BrowserContext;
  page: Page;
}): Promise<FakeVoiceBackend> {
  const state: FakeState = {
    far: undefined,
    offers: [],
    stopRequests: 0,
    transcriptLines: [],
    unexpected: [],
    watchAsks: [],
  };
  const offerGate = latch();
  const ended = latch();
  await installBridge({ context });
  await routeTalk({ ended, offerGate, page, state });
  return {
    dispose: async () => {
      ended.open();
      offerGate.open();
      await closeFarPeer({ state });
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
    observations: () => ({
      offers: [...state.offers],
      stopRequests: state.stopRequests,
      transcriptLines: [...state.transcriptLines],
      unexpected: [...state.unexpected],
      watchAsks: [...state.watchAsks],
    }),
    releaseOffer: () => {
      offerGate.open();
    },
    sendAssistantTranscript: async ({ text }) => {
      const far = state.far;
      if (far === undefined) {
        throw new Error("no offer has been answered, so the voice has no channel to speak on");
      }
      for (const event of assistantTurn({ text })) {
        await far.evaluate(
          async ({ opened }, { wire }) => {
            (await opened).send(wire);
          },
          { wire: JSON.stringify(event) },
        );
      }
    },
  };
}
