/**
 * Open the orb messenger's typed conversation: the console voice's typed twin, on the owner's ChatGPT plan and nothing else.
 *
 * `slopweaver talk offer --typed` composes it exactly as it composes a call — the same delegated thread, tools,
 * writers, model and pack, plus the typed block on the thread's instructions — and `lib/talkPlanLaunch.ts` starts
 * that composition's `codex app-server` and opens the thread with no realtime session (`lib/talkTypedSession.ts`
 * says why). It is then a held call like any other: `/api/talk/call/[id]/{events,claim,answer,stop}` serve it
 * unchanged, and `/api/talk/call/[id]/say` sends what the owner types.
 *
 * The mint holds the console's rebuild swap like a call's does, and gives it back once the thread is open: a typed
 * conversation idles between messages for as long as the page is open, and a rebuild held that long is no rebuild.
 * One a rebuild ends is minted again on the owner's next send.
 *
 * The desktop test instance's page marks its body `instance: "e2e"`, as its offer does: its conversation is composed
 * with `--test-instance e2e`, so it reads no conversation typed into the messenger, is held as a test call, and opens
 * beside nothing of the owner's (`lib/talkArbiter.ts`), so a test typed open never replaces the owner's conversation.
 */
import { NextResponse } from "next/server";

import { isBag } from "../../../../lib/bag";
import { consoleHoldDir } from "../../../../lib/callLeaseFile";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { heldWhileMinting } from "../../../../lib/mintHold";
import { startPackKeeper } from "../../../../lib/packKeeper";
import { PLAN_CALL_LIMITS } from "../../../../lib/planCallContract";
import { mintCarriesStandingData } from "../../../../lib/relayGate";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { type ConversationInstance, instanceOfBody, typedWantedOf } from "../../../../lib/talkArbiter";
import { makeRoomFor } from "../../../../lib/talkCallRegistry";
import {
  cutMarked,
  OFFER_COMPOSE_TIMEOUT_MS,
  REFUSAL_SHOWN_MAX_CHARS,
  typedOfferArgvOf,
} from "../../../../lib/talkOffer";
import { openTypedSession } from "../../../../lib/talkPlanLaunch";
import { planCompositionOf } from "../../../../lib/talkPlanProtocol";

/** Never prerendered: it starts a live thread against a provider. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The press carries an empty object, or the test instance's mark; this refuses anything past a little room. */
const BODY_MAX_BYTES = 256;

/** The longest opening can take: the composition, then `initialize`, `account/read` and `thread/start`. */
const TYPED_OPEN_BOUND_MS = OFFER_COMPOSE_TIMEOUT_MS + 3 * PLAN_CALL_LIMITS.handshakeStepMs;

/** What the page is answered. */
export type TalkTypedResult =
  | {
      readonly ok: true;
      /** The console's id for the held conversation — what the events, say and stop routes take. */
      readonly callId: string;
      readonly threadId: string;
      readonly backendModel: string;
      readonly tools: readonly string[];
      readonly writers: readonly string[];
      /** Whether the thread holds third-party data from its start, so every relay of it is heard-only, as a call's. */
      readonly packed: boolean;
    }
  | { readonly ok: false; readonly notOpened: string };

/**
 * Compose with the verb, start the app-server, open the thread.
 *
 * @param signal the press's request signal, so a page gone mid-open stops the child
 * @param instance the owner's page, or the desktop test instance's
 * @returns what the page is answered
 */
async function typedLeg({
  instance,
  signal,
}: {
  instance: ConversationInstance;
  signal: AbortSignal;
}): Promise<TalkTypedResult> {
  const argv = typedOfferArgvOf({ instance });
  const ran = await spawnVerb({
    argv: [...argv],
    timeoutMs: OFFER_COMPOSE_TIMEOUT_MS,
    title: `slopweaver ${argv.join(" ")}`,
  });
  if (!ran.ok) {
    return notOpened({ why: `the conversation was never put to the ChatGPT plan: ${ran.notMeasured}` });
  }
  const read = planCompositionOf({ out: ran.out });
  if ("refused" in read) {
    return notOpened({ why: `the conversation was never put to the ChatGPT plan: ${read.refused}` });
  }
  const { composition } = read;
  // Again, now: a call may have started while the verb composed. Held by its instance in the same tick as this check.
  const busy = makeRoomFor({ wanted: typedWantedOf({ instance }), why: "a newer typed conversation replaced it" });
  if (busy !== undefined) {
    return notOpened({ why: busy });
  }
  const { callId, outcome } = await openTypedSession({ composition, instance, signal });
  if (outcome.kind !== "open") {
    return notOpened({ why: `the conversation could not start: ${outcome.reason}` });
  }
  return {
    backendModel: composition.backendModel,
    callId,
    ok: true,
    packed: mintCarriesStandingData({ continuity: composition.continuity, pack: composition.pack }),
    threadId: outcome.threadId,
    tools: composition.tools,
    writers: composition.writers,
  };
}

/**
 * Open one typed conversation, replacing any older one.
 *
 * Always 200 with a `TalkTypedResult` once the press itself is accepted, as `/api/talk/offer` is: the plan saying no
 * and a broken page are different facts.
 *
 * @param request the press, with an empty JSON body, or `{ instance: "e2e" }` from the desktop test instance
 * @returns the held conversation, or the stated reason there is none
 */
export async function POST(request: Request): Promise<NextResponse<TalkTypedResult>> {
  const headers = { "cache-control": "no-store" };
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json(notOpened({ why: refused }), { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      notOpened({ why: `the body is ${String(raw.length)} bytes; this route takes up to ${String(BODY_MAX_BYTES)}` }),
      { headers, status: 413 },
    );
  }
  const body = jsonOrUndefined({ raw });
  if (!isBag(body)) {
    return NextResponse.json(notOpened({ why: "the body is not a JSON object" }), { headers, status: 400 });
  }
  const marked = instanceOfBody({ body });
  if ("refused" in marked) {
    return NextResponse.json(notOpened({ why: marked.refused }), { headers, status: 400 });
  }
  const { instance } = marked;
  const busy = makeRoomFor({ wanted: typedWantedOf({ instance }), why: "a newer typed conversation replaced it" });
  if (busy !== undefined) {
    return NextResponse.json(notOpened({ why: busy }), { headers });
  }
  startPackKeeper();
  const result = await heldWhileMinting({
    boundMs: TYPED_OPEN_BOUND_MS,
    dir: consoleHoldDir(),
    mint: () => typedLeg({ instance, signal: request.signal }),
    nowMs: () => Date.now(),
    opened: () => false,
  });
  return NextResponse.json(result, { headers });
}

/**
 * The body read as JSON, or `undefined` when it is not JSON at all.
 *
 * @param raw the body as sent
 * @returns the parsed value, or `undefined`
 */
function jsonOrUndefined({ raw }: { raw: string }): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A conversation that did not open, its reason cut to what a page shows.
 *
 * @param why the reason
 * @returns the result
 */
function notOpened({ why }: { why: string }): TalkTypedResult {
  return { notOpened: cutMarked({ max: REFUSAL_SHOWN_MAX_CHARS, text: why }), ok: false };
}
