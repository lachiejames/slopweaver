/**
 * The pure half of the console voice: what a session is allowed to do next, and how one server event
 * becomes a thing to do.
 *
 * It is split out from `components/voice/VoiceProvider.tsx` so it can be tested. The provider owns a peer connection, a
 * microphone and React state, none of which a unit test may touch; everything below is a function of its
 * arguments, and that is where the decisions that actually matter live — whether a late arrival still
 * belongs to the running session, and what one tool's answer hands the model.
 */
import { type WebRTCConnectionEvent, WebRTCError, type WebRTCErrorCode } from "openai/live/webrtc";
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

/**
 * Whether a result that has just arrived still belongs to the session that asked for it.
 *
 * ## The whole reason this is a named function
 *
 * Stop is not a flag that gates tool DISPATCH; it is a generation counter, and every asynchronous
 * acquisition in the provider checks it — the microphone, the SDP exchange, and each tool call. The failure it
 * closes is specific and was found in review before it shipped: a `getUserMedia` prompt the owner answers AFTER
 * pressing Stop resolves into a session that no longer exists, and the tracks it returns are live. Gating
 * only the tool loop would have left the microphone open on a stopped session, which is the one thing on
 * this page that has to be impossible.
 *
 * So the rule is: capture the generation before the first `await`, and re-check it after every one. A
 * stale caller cleans up what it just acquired and returns; it never writes state.
 *
 * @param mine the generation captured before the await
 * @param current the provider's generation now
 * @returns whether the caller may still act
 */
export function stillMine({ mine, current }: { mine: number; current: number }): boolean {
  return mine === current;
}

/**
 * Compare the tool names the verb declared against the ones this page knows how to run — and, separately,
 * which of them WRITE.
 *
 * `src/talk/talkToolSchemas.ts` tells the model what tools exist; `site/lib/talkTools.ts` decides what
 * happens when one is called. They live in two Yarn projects and nothing static can compare them, so the
 * comparison is made once per session, at the moment the verb's report arrives, and a disagreement refuses
 * the session rather than surfacing later as a tool call that answers "no such tool".
 *
 * The writers are compared as well because agreeing on names is not agreeing on what they do: a tool the
 * verb declares a writer and this page runs as a read would reach the board without the relay gate.
 *
 * @param declared what `talk offer` says it told the model about
 * @param runnable what this page can actually dispatch
 * @param declaredWriters which of `declared` the verb says write
 * @param runnableWriters which of `runnable` this page runs through the relay gate
 * @returns `undefined` when they agree, else the sentence naming both sides
 */
export function refuseOnToolDrift({
  declared,
  runnable,
  declaredWriters,
  runnableWriters,
}: {
  declared: readonly string[];
  runnable: readonly string[];
  declaredWriters: readonly string[];
  runnableWriters: readonly string[];
}): string | undefined {
  const onlyDeclared = declared.filter((name) => !runnable.includes(name));
  const onlyRunnable = runnable.filter((name) => !declared.includes(name));
  const writersAgree =
    declaredWriters.length === runnableWriters.length &&
    declaredWriters.every((name) => runnableWriters.includes(name));
  if (onlyDeclared.length === 0 && onlyRunnable.length === 0 && writersAgree) {
    return undefined;
  }
  const parts: string[] = [];
  if (!writersAgree) {
    parts.push(
      `the verb declares [${declaredWriters.join(", ")}] as writers and this page gates [${runnableWriters.join(", ")}]`,
    );
  }
  if (onlyDeclared.length > 0) {
    parts.push(`the model would be told about ${onlyDeclared.join(", ")}, which this page cannot run`);
  }
  if (onlyRunnable.length > 0) {
    parts.push(`this page can run ${onlyRunnable.join(", ")}, which the model is not told about`);
  }
  return `the tool lists disagree: ${parts.join("; ")}. The schemas in src/talk/talkToolSchemas.ts and site/lib/talkTools.ts have drifted.`;
}

/**
 * How much of one tool's answer is sent back to the model, in UTF-8 bytes of the serialised answer. Beyond this it is
 * reading, not talking.
 *
 * Bytes, not characters, because the answer is also kept on the call file, and
 * a call line rides `/api/talk/transcript`, whose body is capped at 64 KiB of UTF-8 for the browser's `keepalive`
 * (`../../lib/talkTranscript.ts`). Counted in characters, 24,576 three-byte characters is 72 KiB — over that body
 * alone. Counted in bytes, even an answer of nothing but `"` and `\` escapes to 48 KiB on the line, under the 60 KiB a
 * batch takes (`talkTranscript.test.ts`).
 */
export const TOOL_OUTPUT_MAX = 24 * 1024;

/**
 * What a call file keeps for an answer that was an image: a fixed stand-in, never the image's bytes. The model was
 * handed a picture; the file says so and stays a text record of a size the transcript route can carry.
 */
export const IMAGE_TOOL_ANSWER = "[an image answer was handed to the model; image bytes were not stored]";

/** The answer serialised to nothing: `JSON.stringify` returns `undefined` for `undefined`, a function or a symbol. */
export interface NoAnswerError {
  readonly code: "NO_ANSWER";
  readonly message: string;
}

/** The answer could not be serialised at all: `JSON.stringify` threw, on a cycle or a bigint. */
export interface UnserialisableAnswerError {
  readonly code: "UNSERIALISABLE_ANSWER";
  readonly message: string;
  /** What `JSON.stringify` threw, carried rather than formatted: reading it could throw in turn. */
  readonly cause: unknown;
}

/** The answer serialised past {@link TOOL_OUTPUT_MAX}, so none of it was sent. */
export interface OverCapAnswerError {
  readonly code: "OVER_CAP";
  readonly message: string;
  readonly tool: string;
  /** The serialised answer's size, in the UTF-8 bytes {@link TOOL_OUTPUT_MAX} counts. */
  readonly bytes: number;
}

/** Why one tool's answer could not become the text the model is handed. */
export type ToolOutputError = NoAnswerError | OverCapAnswerError | UnserialisableAnswerError;

/** The one place a {@link ToolOutputError} is built. */
export const ToolOutputErrors = {
  noAnswer: ({ kind }: { kind: string }): NoAnswerError => ({
    code: "NO_ANSWER",
    message: `the tool produced ${kind}, which serialises to nothing; this page has no answer to hand the model`,
  }),
  overCap: ({ tool, bytes }: { tool: string; bytes: number }): OverCapAnswerError => ({
    bytes,
    code: "OVER_CAP",
    message: `${tool} answered ${String(bytes)} bytes, over this page's ${String(TOOL_OUTPUT_MAX)}-byte tool cap, so none of it was sent`,
    tool,
  }),
  unserialisable: ({ cause, kind }: { cause: unknown; kind: string }): UnserialisableAnswerError => ({
    cause,
    code: "UNSERIALISABLE_ANSWER",
    message: `the tool produced ${kind}, which could not be serialised; this page has no answer to hand the model`,
  }),
} as const;

/**
 * Serialise one tool's answer for the model, bounded — or refuse, typed, when there is nothing to serialise or too
 * much of it.
 *
 * A bound is needed on this side as well as in the verb because the verb's budget is over what it READS, and a page
 * tool has no verb. Each page tool fits its own answer inside {@link TOOL_OUTPUT_MAX} (`read_page` through
 * `pageRead`, `action_items` through `fitActionItems`), so this bound is the backstop. Never cut silently: a model
 * handed a cut-off JSON document will either fail to parse it or, worse, read the surviving half as the whole answer.
 *
 * ## Why an over-cap answer is a refusal naming the tool, not "ask for less"
 *
 * Measured: `action_items` answered past the cap, the model was handed
 * `{"truncated":"…ask for less of it"}` from a tool that takes no arguments, and the call log still said "18 shown,
 * refused: false". The voice told the owner "the live lookup is failing on size" and could open nothing. A refusal is
 * logged as one, and its one line names which tool and which cap, so it can be said aloud and fixed.
 *
 * ## Why an unserialisable answer is a value, not a throw
 *
 * Measured: a `read_screen` that succeeded carried its frame as an image and left the
 * text answer `undefined`, `JSON.stringify(undefined)` returned `undefined`, and reading its `.length` threw
 * inside the tool loop — so no `function_call_output` was ever sent and the voice said "still trying" to a
 * frame it never received. A throw here loses the whole answer; a typed refusal can still be read out.
 *
 * @param answer whatever the tool produced
 * @param tool the tool's name, said in an over-cap refusal
 * @returns the string sent back as the function call's output, or why there is none
 */
export function toolOutputOf({ answer, tool }: { answer: unknown; tool: string }): string | ToolOutputError {
  // `unknown`, because the lib types `JSON.stringify` as always returning a string, and it does not.
  let whole: unknown;
  try {
    whole = JSON.stringify(answer);
  } catch (cause) {
    return ToolOutputErrors.unserialisable({ cause, kind: typeof answer });
  }
  if (typeof whole !== "string") {
    return ToolOutputErrors.noAnswer({ kind: typeof answer });
  }
  const bytes = new TextEncoder().encode(whole).length;
  if (bytes <= TOOL_OUTPUT_MAX) {
    return whole;
  }
  return ToolOutputErrors.overCap({ bytes, tool });
}

/**
 * What one answered tool call hands the model as its `function_call_output`: the image when the tool
 * produced one, else the serialised answer, else a refusal the model can read out.
 *
 * The image is checked FIRST because a screen read's whole answer is the image; its text answer is
 * deliberately absent. A text answer beside an image is never sent at all, so the cap — which bounds the text
 * the model is handed — has nothing to judge there. Every branch yields an output, because a call
 * that gets no answer leaves the Live session waiting on it while one that gets a reason can say that reason aloud.
 *
 * @param answer the tool's text answer, serialised when there is no image
 * @param image the tool's image output, sent as it is — never stringified
 * @param tool the tool's name, said in an over-cap refusal
 * @returns the output to send, and the failure when the answer could not be serialised or was over the cap
 */
export function functionCallOutputOf({
  answer,
  image,
  tool,
}: {
  answer: unknown;
  image: ResponseFunctionCallOutputItemList | undefined;
  tool: string;
}): { output: string | ResponseFunctionCallOutputItemList; failure: ToolOutputError | undefined } {
  if (image !== undefined) {
    return { failure: undefined, output: image };
  }
  const text = toolOutputOf({ answer, tool });
  if (typeof text === "string") {
    return { failure: undefined, output: text };
  }
  return { failure: text, output: JSON.stringify({ refused: text.message }) };
}

/**
 * What a call file keeps as one tool's answer: the exact text the model was handed, or {@link IMAGE_TOOL_ANSWER} when
 * it was handed an image. The only conversion persistence makes — the text is never re-serialised from the tool's own
 * answer, so a wrong spoken answer can be traced to exactly what the model read. A text output is already inside {@link TOOL_OUTPUT_MAX}, so `file_read`'s credential masking carries over.
 *
 * @param output what {@link functionCallOutputOf} handed the model
 * @returns the text the call file keeps
 */
export function callFileToolAnswerOf({ output }: { output: string | ResponseFunctionCallOutputItemList }): string {
  if (typeof output === "string") {
    return output;
  }
  return IMAGE_TOOL_ANSWER;
}

/**
 * The sentence a failed session start shows the owner: the reason, not the wrapper around it.
 *
 * ## The failure this closes
 *
 * `OpenAILiveWebRTC.connect` wraps whatever the SDP callback or `setRemoteDescription` threw in a
 * `WebRTCError` whose message is always "Could not establish the WebRTC connection." and keeps the thrown
 * value on `cause`. Showing `message` alone therefore replaced every stated refusal with that one sentence.
 * Measured: the owner's offer came back `ok: false` with a stated refusal naming what was missing, and the
 * page read "Could not establish the WebRTC connection", which sent the diagnosis to ICE and the answer SDP
 * instead of to the refusal.
 *
 * So the innermost stated reason wins, and the wrapper is shown only when it wraps nothing that speaks — and
 * then in plain words for the SDK's own failure kinds ({@link PLAIN_WEBRTC_FAILURE}), because "The WebRTC
 * peer connection ended." names the library, not what broke.
 *
 * @param cause whatever `connect` rejected with
 * @returns the most specific non-empty message on the cause chain
 */
export function setupFailureOf({ cause }: { cause: unknown }): string {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  // Only the SDK's wrapper is looked through: any other error's message is already its author's own words.
  if (!(cause instanceof WebRTCError) && cause.message !== "") {
    return cause.message;
  }
  const inner: unknown = cause.cause;
  if (inner instanceof Error && inner.message !== "") {
    return setupFailureOf({ cause: inner });
  }
  if (typeof inner === "string" && inner !== "") {
    return inner;
  }
  if (cause instanceof WebRTCError) {
    const plain = PLAIN_WEBRTC_FAILURE[cause.code];
    if (plain !== undefined) {
      return plain;
    }
  }
  return cause.message;
}

/** The SDK failure kinds a bare wrapper can carry, said as what broke rather than which class noticed. */
const PLAIN_WEBRTC_FAILURE: Partial<Record<WebRTCErrorCode, string>> = {
  connection_closed: "OpenAI closed the connection before the call was set up",
  timeout: "OpenAI did not finish connecting the call in time",
  transport_failed: "the audio link between this machine and OpenAI failed; the network path did not hold",
};

/** Why the SDK says a connection ended; it exports the event but not this union by name. */
type CloseReason = Extract<WebRTCConnectionEvent, { type: "closed" }>["reason"];

/** Each way a connection ends, in the words the pill shows. `local` is the owner's own hang-up and shows nothing. */
const PLAIN_CLOSE: Record<Exclude<CloseReason, "local">, string> = {
  aborted: "the call was cancelled before it connected",
  failed: "the audio link between this machine and OpenAI failed",
  remote: "OpenAI ended the call",
  timeout: "OpenAI did not finish connecting the call in time",
};

/**
 * What one connection lifecycle event does to the call: the line to stop it with, or nothing.
 *
 * ## The failure this closes
 *
 * A start failed and the pill read only "the connection closed — failed". The SDK's
 * `failSetup` rejects `connect()` and then, SYNCHRONOUSLY, emits `closed`. A handler that stopped on that
 * `closed` ran first and moved the generation on, so when the rejection — which carries the real reason, the
 * mint's refusal among them — reached `connect`'s catch a microtask later, the call was no longer its to
 * report, and {@link setupFailureOf} never ran. While the call is still being set up the answer is therefore
 * always nothing: `connect`'s rejection is the one report.
 *
 * @param event the connection event
 * @param settingUp whether `connect()` has yet to settle, so its rejection will report any setup failure
 * @returns the stop line, or `undefined` when this event does not end the call here
 */
export function connectionStopWhy({
  event,
  settingUp,
}: {
  event: WebRTCConnectionEvent;
  settingUp: boolean;
}): string | undefined {
  if (settingUp) {
    return undefined;
  }
  if (event.type === "error" && event.fatal) {
    return setupFailureOf({ cause: event.error });
  }
  if (event.type === "closed" && event.reason !== "local") {
    return PLAIN_CLOSE[event.reason];
  }
  return undefined;
}
