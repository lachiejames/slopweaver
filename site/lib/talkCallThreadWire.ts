/**
 * One call-thread journal entry as this server hands it to `slopweaver talk call-thread-append` — the WIRE shape
 * `src/talk/callThreadEntry.ts` validates, restated here because `site/` never imports `src/`. The verb refuses a
 * whole batch for one entry outside it, so every bound the verb checks is checked here first and an entry that would
 * fail it is never queued (`wireCapture`), rather than one bad id stopping the journal for the rest of the call.
 */

/** The notifications the journal keeps: a turn's frames and every completed item, never a delta. */
export const CALL_THREAD_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "turn/started",
  "turn/completed",
  "item/completed",
]);

/** The longest Codex id or tool name the verb takes. */
const ID_MAX = 200;

/** What one entry records. */
export type CallThreadCapture =
  | { readonly kind: "thread-start-requested"; readonly params: unknown; readonly surface: "voice" | "typed" }
  | { readonly kind: "thread-started"; readonly threadId: string }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | {
      readonly kind: "tool-answer";
      readonly arguments: string;
      readonly contentItems: readonly unknown[];
      readonly success: boolean;
      readonly threadId: string;
      readonly tool: string;
      readonly toolCallId: string;
      readonly turnId: string | null;
    };

/** One entry, as staged in a batch. */
export interface CallThreadWireEntry {
  readonly version: 1;
  /** Unique per entry, so a batch posted again after an unknown outcome is written once. */
  readonly writeId: string;
  readonly callId: string;
  readonly receivedAtIso: string;
  readonly capture: CallThreadCapture;
}

/**
 * Whether a Codex id or tool name is one the verb takes.
 *
 * @param value the id
 * @returns `true` when it is 1 to 200 characters
 */
function idFits({ value }: { value: string }): boolean {
  return value.length > 0 && value.length <= ID_MAX;
}

/**
 * The capture as the verb will take it: absent params as `null` — JSON drops an `undefined` key, and the verb's
 * strict envelope requires it — and `undefined` for one whose ids the verb would refuse.
 *
 * @param capture what was recorded
 * @returns the capture to queue, or `undefined` when the verb would refuse its batch for it
 */
export function wireCapture({ capture }: { capture: CallThreadCapture }): CallThreadCapture | undefined {
  if (capture.kind === "thread-start-requested" || capture.kind === "notification") {
    if (capture.params === undefined) {
      return { ...capture, params: null };
    }
    return capture;
  }
  if (capture.kind === "thread-started") {
    return idFits({ value: capture.threadId }) ? capture : undefined;
  }
  const ids = [capture.threadId, capture.tool, capture.toolCallId];
  const turnFits = capture.turnId === null || idFits({ value: capture.turnId });
  return ids.every((value) => idFits({ value })) && turnFits ? capture : undefined;
}
