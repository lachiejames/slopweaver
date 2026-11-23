/**
 * The voice's window asks the console window on screen for the Queue it holds (`voiceQueueShell.ts`): what
 * crosses, and how main judges a reply. The snapshot is one JSON string the console built, carried opaque under a
 * bound, as a page's reading is (`desktopBridge.ts` `parsePageIdentity`); main never reads what is inside it.
 *
 * That is why: a voice window answering `action_items` from its own copy of the registers, held quiet through the
 * call, lists cards the console window's Queue stopped drawing hours before. Pure.
 */

/** The longest snapshot main carries, in UTF-16 code units (`site/lib/queueScreenVoice.ts`, the same bound). */
export const VOICE_QUEUE_WIRE_MAX_CHARS = 8 * 1024 * 1024;

/** How long main waits for the console window's reply before telling the voice it did not arrive. */
export const VOICE_QUEUE_DEADLINE_MS = 2000;

/** One reply off the console window: the request it answers, and its snapshot or `null` for none. */
export interface VoiceQueueReply {
  readonly id: string;
  readonly snapshot: string | null;
}

/** What main hands the voice's window: the console window's snapshot, or why there is none. */
export type VoiceQueueAnswer =
  { readonly kind: "served"; readonly snapshot: string } | { readonly kind: "unreached"; readonly why: string };

/**
 * One reply off the console window.
 *
 * @param value what its preload sent
 * @returns the reply, or `undefined` for anything that is not exactly one — a snapshot past the bound included
 */
export function parseVoiceQueueReply({ value }: { value: unknown }): VoiceQueueReply | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const keys = Object.keys(record);
  if (!keys.every((key) => key === "id" || key === "snapshot")) {
    return undefined;
  }
  const { id, snapshot } = record;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    return undefined;
  }
  if (snapshot === undefined || snapshot === null) {
    return { id, snapshot: null };
  }
  if (typeof snapshot !== "string" || snapshot.length > VOICE_QUEUE_WIRE_MAX_CHARS) {
    return undefined;
  }
  return { id, snapshot };
}

/** How one ask of the console window ended, before main answers the voice. */
export type VoiceQueueAsk =
  | { readonly kind: "replied"; readonly reply: VoiceQueueReply; readonly tabNow: string }
  | { readonly kind: "navigated" }
  | { readonly kind: "deadline" }
  | { readonly kind: "no-tab" };

/**
 * What one ask comes to: a reply from the tab still in front is served; a reply from a tab the owner left, or a page that
 * navigated under the ask, is asked again of the tab in front now; anything else is said as not arriving, never
 * answered from anywhere else.
 *
 * @param ask how the ask ended
 * @param askedTab the tab that was in front when it was asked
 * @returns the answer, or `retry` to ask the tab in front once more
 */
export function voiceQueueOutcome({
  ask,
  askedTab,
}: {
  ask: VoiceQueueAsk;
  askedTab: string | undefined;
}): VoiceQueueAnswer | "retry" {
  if (ask.kind === "no-tab") {
    return { kind: "unreached", why: "no console window is open to read the Queue from" };
  }
  if (ask.kind === "deadline") {
    return {
      kind: "unreached",
      why: `the console window did not answer within ${String(VOICE_QUEUE_DEADLINE_MS)} ms`,
    };
  }
  if (ask.kind === "navigated" || ask.tabNow !== askedTab) {
    return "retry";
  }
  if (ask.reply.snapshot === null) {
    return {
      kind: "unreached",
      why: "the console window holds no Queue to hand over: its page was built before it could, or past the bound",
    };
  }
  return { kind: "served", snapshot: ask.reply.snapshot };
}

/**
 * The answer after a second ask that moved again: the screen moved twice under one question, said so.
 *
 * @returns the answer
 */
export function movedTwiceAnswer(): VoiceQueueAnswer {
  return { kind: "unreached", why: "the console window changed page or tab twice while it was asked" };
}
