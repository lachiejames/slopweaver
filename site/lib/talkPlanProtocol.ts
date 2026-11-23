/**
 * The wire half of a Talk call on the owner's ChatGPT plan, pure: `codex app-server`'s newline-delimited JSON-RPC, the
 * composition `slopweaver talk offer` prints, and the few messages the console reads.
 *
 * Everything here is a function of its input, so each rule is a unit test rather than a property of a live
 * child. The child itself is `talkPlanLaunch.ts`; the conversation it carries is `talkPlanSession.ts`.
 *
 * A delegated turn's notices are `talkPlanProtocolTurns.ts`; its token usage, step kind and tool calls are
 * `talkPlanProtocolItems.ts`.
 *
 * The shapes are codex-cli 0.157.1's own (`codex app-server generate-ts`), measured on a live call
 * (`src/talk/planSession.ts`'s header). A server REQUEST carries both `id` and `method`; a response
 * carries `id` and exactly one of `result`/`error`; a notification carries `method` and no `id`.
 */
import { type Bag, isBag, str, strings, sub } from "./bag";
import type { VoiceProvenanceLedger } from "./talkVoiceProvenance";

/** A JSON-RPC id. The console only ever mints numbers; the server's own requests may use either. */
export type RpcId = number | string;

/** One line from the app-server, classified. */
export type AppServerInbound =
  | { readonly kind: "response"; readonly id: RpcId; readonly result: unknown }
  | { readonly kind: "response-error"; readonly id: RpcId; readonly message: string }
  | { readonly kind: "request"; readonly id: RpcId; readonly method: string; readonly params: unknown }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown };

/** The longest line the console will parse. A tool call carrying a screen frame is the largest thing sent. */
export const APP_SERVER_LINE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Classify one line, or say why it is not one the protocol allows.
 *
 * @param line one line of the app-server's stdout, without its newline
 * @returns the message, or the sentence naming what was wrong with it
 */
export function decodeAppServerLine({
  line,
}: {
  line: string;
}): { readonly inbound: AppServerInbound } | { readonly refused: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { refused: `the app-server wrote a line that is not JSON, beginning \`${line.slice(0, 80)}\`` };
  }
  if (!isBag(parsed)) {
    return { refused: "the app-server wrote JSON that is not an object" };
  }
  const id = rpcIdOf({ value: parsed["id"] });
  const method = str({ bag: parsed, key: "method" });
  if (method !== undefined && id !== undefined) {
    return { inbound: { id, kind: "request", method, params: parsed["params"] } };
  }
  if (method !== undefined) {
    return { inbound: { kind: "notification", method, params: parsed["params"] } };
  }
  if (id === undefined) {
    return { refused: "the app-server wrote a message with neither an id nor a method" };
  }
  const hasResult = "result" in parsed;
  const error = sub({ bag: parsed, key: "error" });
  if (hasResult === (error !== undefined)) {
    return {
      refused: `the app-server answered ${String(id)} with ${hasResult ? "both a result and an error" : "neither a result nor an error"}`,
    };
  }
  if (error !== undefined) {
    const message = str({ bag: error, key: "message" });
    if (message === undefined) {
      return { inbound: { id, kind: "response-error", message: "an error with no message" } };
    }
    return { inbound: { id, kind: "response-error", message } };
  }
  return { inbound: { id, kind: "response", result: parsed["result"] } };
}

/**
 * A JSON-RPC id, or `undefined` for anything that is not one.
 *
 * @param value the `id` field as parsed
 * @returns the id, or `undefined`
 */
function rpcIdOf({ value }: { value: unknown }): RpcId | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return undefined;
}

/**
 * Splits a byte stream into lines, holding a partial line until its newline arrives and refusing one that
 * grows past {@link APP_SERVER_LINE_MAX_BYTES} rather than buffering without bound.
 */
export class LineBuffer {
  private held = "";

  /**
   * Take one chunk of stdout.
   *
   * @param chunk the text that arrived
   * @returns every complete line it finished, CR stripped, blank lines dropped — or the overflow
   */
  push({ chunk }: { chunk: string }): { readonly lines: readonly string[] } | { readonly overflow: number } {
    this.held += chunk;
    const parts = this.held.split("\n");
    this.held = parts.pop()!;
    if (this.held.length > APP_SERVER_LINE_MAX_BYTES) {
      return { overflow: this.held.length };
    }
    const lines = parts.map((part) => (part.endsWith("\r") ? part.slice(0, -1) : part)).filter((part) => part !== "");
    return { lines };
  }
}

/**
 * One request line.
 *
 * @param id the id the response will carry
 * @returns the line, newline included
 */
export function rpcRequestLine({ id, method, params }: { id: number; method: string; params: unknown }): string {
  return `${JSON.stringify({ id, method, params })}\n`;
}

/**
 * One notification line.
 *
 * @returns the line, newline included
 */
export function rpcNotificationLine({ method }: { method: string }): string {
  return `${JSON.stringify({ method })}\n`;
}

/**
 * One response line, answering a request the SERVER made.
 *
 * @param id the server request's own id
 * @returns the line, newline included
 */
export function rpcResultLine({ id, result }: { id: RpcId; result: unknown }): string {
  return `${JSON.stringify({ id, result })}\n`;
}

/**
 * One error line, refusing a request the SERVER made that the console never answers — anything but a tool call.
 *
 * @param id the server request's own id
 * @param message what the refusal says
 * @returns the line, newline included
 */
export function rpcErrorLine({ id, message }: { id: RpcId; message: string }): string {
  return `${JSON.stringify({ error: { code: -32601, message }, id })}\n`;
}

/** How one request the console made of the child ended: answered, refused, out of time, or the call ended first. */
export type RpcOutcome =
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "ended"; readonly reason: string };

/** One of the console's own writes the voice may say, and why it was made, which the call's provenance keeps. */
export interface OwnWrite {
  readonly method: "thread/realtime/appendSpeech" | "thread/realtime/appendText";
  readonly params: unknown;
  /** Which funnel wrote it, as the thinking thread reads it. */
  readonly source: "spoken-line" | "developer-message";
  readonly text: string;
  /** What set it off, in words the thinking model can repeat to the owner. */
  readonly why: string;
}

/**
 * Whether a write of the console's may have reached the voice: answered, out of time (a late answer nothing hears), or
 * ended under while in flight. A refusal said nothing, and nor did a write the call was already over for, since
 * `request` never sends one.
 *
 * @param outcome how the request ended
 * @param wasLive whether the call was still running when the request was made
 * @returns whether the session may have taken it
 */
export function mayHaveBeenTaken({ outcome, wasLive }: { outcome: RpcOutcome; wasLive: boolean }): boolean {
  if (outcome.kind === "ended") {
    return wasLive;
  }
  return outcome.kind !== "error";
}

/**
 * One of the console's own writes, its text and `why` recorded in the call's provenance BEFORE the request: a turn
 * steered while it is out carries it. One that may have been taken ({@link mayHaveBeenTaken}) stays; one
 * refused, never sent, or that threw before it went out said nothing and is withdrawn.
 *
 * @param key the entry's key, unique to this write, which withdraws it
 * @param atMs the instant the request goes out
 * @param wasLive whether the call was still running when it did
 * @param send makes the request
 * @param onTaken runs once a write may have been taken
 * @returns how the session answered
 */
export async function writeWithProvenance({
  write,
  key,
  atMs,
  wasLive,
  ledger,
  send,
  onTaken,
}: {
  write: OwnWrite;
  key: string;
  atMs: number;
  wasLive: boolean;
  ledger: VoiceProvenanceLedger;
  send: (write: OwnWrite) => Promise<RpcOutcome>;
  onTaken: () => void;
}): Promise<RpcOutcome> {
  const { source, text, why } = write;
  ledger.record({ atMs, key, source, text, why });
  let taken = false;
  try {
    const outcome = await send(write);
    taken = mayHaveBeenTaken({ outcome, wasLive });
    return outcome;
  } finally {
    if (taken) {
      onTaken();
    } else {
      ledger.retract({ key });
    }
  }
}

/**
 * One request's fate in words, for a request whose answer the caller could not use.
 *
 * @param outcome the fate
 * @returns the sentence
 */
export function fateOf({ outcome }: { outcome: RpcOutcome }): string {
  switch (outcome.kind) {
    case "result":
      return "it answered without the field the console needs";
    case "error":
      return outcome.message;
    case "timeout":
      return "no answer in time";
    case "ended":
      return outcome.reason;
    default: {
      const never: never = outcome;
      return String(never);
    }
  }
}

/**
 * The thread id out of a `thread/start` result (`{ thread: { id } }`).
 *
 * @returns the id, or `undefined` when the result carries none
 */
export function threadIdOf({ result }: { result: unknown }): string | undefined {
  const thread = isBag(result) ? sub({ bag: result, key: "thread" }) : undefined;
  return thread === undefined ? undefined : str({ bag: thread, key: "id" });
}

/**
 * A string field of a notification's params, for the handful the console reads (`sdp`, `message`, `reason`).
 *
 * @param params the notification's params
 * @param key the field
 * @returns the string, or `undefined`
 */
export function paramString({ params, key }: { params: unknown; key: string }): string | undefined {
  return isBag(params) ? str({ bag: params, key }) : undefined;
}

/**
 * Whether `account/read` says the app-server is signed in to a ChatGPT plan — the one login a call may ride. An
 * API-key login is a definitive refusal, never a call.
 *
 * @param result the `account/read` result
 * @returns `undefined` for a ChatGPT login, else the sentence naming what it is instead
 */
export function planAccountRefusal({ result }: { result: unknown }): string | undefined {
  if (!isBag(result)) {
    return "account/read answered something that is not an object";
  }
  const account = sub({ bag: result, key: "account" });
  if (account === undefined) {
    return "Codex is not signed in: run `codex login` with the owner's ChatGPT account";
  }
  const type = str({ bag: account, key: "type" });
  if (type !== "chatgpt") {
    return `Codex is signed in with ${String(type)}, not a ChatGPT plan`;
  }
  return undefined;
}

/** The composition `talk offer` prints, as far as the console acts on it. */
export interface PlanComposition {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly unsetEnv: readonly string[];
  /** The routed register row's `$CODEX_HOME`, set on the child so that row's plan pays — never the ambient one. */
  readonly codexHome: string;
  /** That row's register alias, for the log line. */
  readonly planAlias: string;
  readonly thread: Bag;
  readonly realtime: Bag;
  readonly model: string;
  readonly backendModel: string;
  readonly voice: string;
  readonly tools: readonly string[];
  readonly writers: readonly string[];
  /** The report's own `pack` and `continuity`, for the relay gate's standing-data reading. */
  readonly pack: unknown;
  readonly continuity: unknown;
  /** The reminder a reopened call hands the voice after the owner's silent window, `null` for any other call. */
  readonly reopenReminder: PlanReopenReminder | null;
}

/** A reopened call's reminder as the mint composed it (`src/talk/reopenReminder.ts`). */
export interface PlanReopenReminder {
  readonly previousCallId: string;
  readonly previousEndedIso: string;
  /** The developer message the voice is handed, its exchange included. */
  readonly text: string;
}

/**
 * The report's `reopenReminder`: `null`, or every field a non-empty string. A report from a verb older than the
 * field carries none, which is no reminder; anything else is refused, so no stray object reaches the voice.
 *
 * @param bag the parsed report
 * @returns the reminder, `null`, or the refusal's words
 */
function reopenReminderOf({ bag }: { bag: Bag }): PlanReopenReminder | null | { readonly refused: string } {
  if (!("reopenReminder" in bag) || bag["reopenReminder"] === null) {
    return null;
  }
  const value = sub({ bag, key: "reopenReminder" });
  const previousCallId = value === undefined ? undefined : str({ bag: value, key: "previousCallId" });
  const previousEndedIso = value === undefined ? undefined : str({ bag: value, key: "previousEndedIso" });
  const text = value === undefined ? undefined : str({ bag: value, key: "text" });
  if (
    previousCallId === undefined ||
    previousCallId === "" ||
    previousEndedIso === undefined ||
    previousEndedIso === "" ||
    text === undefined ||
    text === ""
  ) {
    return { refused: "well-formed reopen reminder" };
  }
  return { previousCallId, previousEndedIso, text };
}

/**
 * Read the verb's plan report, refusing any shape it does not document.
 *
 * @param out everything the verb wrote to stdout
 * @returns the composition, or the sentence naming the missing part
 */
export function planCompositionOf({
  out,
}: {
  out: string;
}): { readonly composition: PlanComposition } | { readonly refused: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return {
      refused: `talk offer printed something that is not JSON, beginning \`${out.trim().slice(0, 120)}\``,
    };
  }
  if (!isBag(parsed)) {
    return { refused: "talk offer printed a report that is not a plan composition" };
  }
  const appServer = sub({ bag: parsed, key: "appServer" });
  const thread = sub({ bag: parsed, key: "thread" });
  const realtime = sub({ bag: parsed, key: "realtime" });
  const parts = compositionParts({ appServer, bag: parsed });
  if (appServer === undefined || thread === undefined || realtime === undefined || "refused" in parts) {
    return {
      refused: `talk offer's report carries no ${"refused" in parts ? parts.refused : "launch, thread or realtime start"}`,
    };
  }
  const reopenReminder = reopenReminderOf({ bag: parsed });
  if (reopenReminder !== null && "refused" in reopenReminder) {
    return { refused: `talk offer's report carries no ${reopenReminder.refused}` };
  }
  return {
    composition: {
      ...parts,
      continuity: parsed["continuity"],
      pack: parsed["pack"],
      realtime,
      reopenReminder,
      thread,
    },
  };
}

/**
 * The flat string and list fields of a plan report.
 *
 * @param bag the parsed report
 * @param appServer its `appServer` object, if any
 * @returns the fields, or the name of the first one missing
 */
function compositionParts({
  bag,
  appServer,
}: {
  bag: Bag;
  appServer: Bag | undefined;
}):
  | Omit<PlanComposition, "thread" | "realtime" | "pack" | "continuity" | "reopenReminder">
  | { readonly refused: string } {
  const executable = appServer === undefined ? undefined : str({ bag: appServer, key: "executable" });
  const argv = appServer === undefined ? undefined : strings({ bag: appServer, key: "argv" });
  const unsetEnv = appServer === undefined ? undefined : strings({ bag: appServer, key: "unsetEnv" });
  const codexHome = appServer === undefined ? undefined : str({ bag: appServer, key: "codexHome" });
  const planAlias = appServer === undefined ? undefined : str({ bag: appServer, key: "planAlias" });
  const model = str({ bag, key: "model" });
  const backendModel = str({ bag, key: "backendModel" });
  const voice = str({ bag, key: "voice" });
  const tools = strings({ bag, key: "tools" });
  const writers = strings({ bag, key: "writers" });
  if (executable === undefined || argv === undefined || unsetEnv === undefined) {
    return { refused: "app-server launch" };
  }
  // Required, never defaulted: a report naming no routed home would launch on the ambient login, which is the
  // very plan the register exists to stop paying when the owner has paused or capped it.
  if (codexHome === undefined || codexHome === "" || planAlias === undefined || planAlias === "") {
    return { refused: "routed plan home" };
  }
  if (model === undefined || backendModel === undefined || voice === undefined) {
    return { refused: "model or voice" };
  }
  if (tools === undefined || writers === undefined) {
    return { refused: "tool names" };
  }
  return { argv, backendModel, codexHome, executable, model, planAlias, tools, unsetEnv, voice, writers };
}
