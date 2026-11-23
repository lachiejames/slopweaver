/**
 * The voice's half of the failure toast: which notice a finished tool call raises, and what the activity record says
 * when the console window cannot be handed one. What counts
 * as a failure is `site/lib/voiceFailureToast.ts`; where the toast sits, `site/components/console/VoiceFailureToasts.tsx`.
 */
import { type RefObject, useCallback } from "react";

import { type VoiceFailureNotice, type VoicePartialFailure, voiceFailureNoticeOf } from "../../lib/voiceFailureToast";
import type { ToolLine } from "./voiceContext";

/** Whether the console window was handed a failure, or why it could not be — an app built before the toast. */
export type VoiceFailureDelivery =
  { readonly kind: "reported" } | { readonly kind: "unavailable"; readonly why: string };

/** The voice window's seam that hands one notice to the console window. */
export type VoiceFailureReport = (input: { readonly notice: VoiceFailureNotice }) => VoiceFailureDelivery;

/**
 * The notice a tool call's FINAL outcome raises: an answer the plan call never took is a failure even when the tool
 * itself ran, so its reason replaces the tool's own.
 *
 * @param why the reason the plan call's answer was not delivered, when it was not
 * @returns the notice, or `undefined` when the call did all it tried
 */
export function toolFailureNotice({
  detail,
  partialFailures,
  refused,
  tool,
  why,
}: {
  detail: string;
  partialFailures: readonly VoicePartialFailure[];
  refused: boolean;
  tool: string;
  why: string | undefined;
}): VoiceFailureNotice | undefined {
  if (why !== undefined) {
    return voiceFailureNoticeOf({ outcome: { detail: why, kind: "tool", partialFailures, refused: true, tool } });
  }
  return voiceFailureNoticeOf({ outcome: { detail, kind: "tool", partialFailures, refused, tool } });
}

/**
 * Hand one notice to the console window, and say on the record when it could not be: a refused `failure notice`
 * line, never a second notice.
 *
 * @param report the voice window's seam; absent where no call runs — a browser tab, the console window itself
 * @returns the line to note, or `undefined` when the notice was handed over or there was nowhere to hand it
 */
export function deliverFailureNotice({
  notice,
  report,
}: {
  notice: VoiceFailureNotice | undefined;
  report: VoiceFailureReport | undefined;
}): ToolLine | undefined {
  if (notice === undefined || report === undefined) {
    return undefined;
  }
  const delivered = report({ notice });
  if (delivered.kind === "reported") {
    return undefined;
  }
  return { detail: delivered.why, ms: undefined, name: "failure notice", refused: true, usage: undefined };
}

/**
 * The provider's stable callback that hands a notice to the console window and notes the line an old shell earns.
 *
 * @param seamRef the voice window's live desktop seam, read at each call rather than captured
 * @param note writes one line to the call's activity record
 * @returns the callback; a notice of `undefined` is nothing to hand over
 */
export function useFailureNotice({
  note,
  seamRef,
}: {
  note: (input: { line: ToolLine }) => void;
  seamRef: RefObject<{ readonly reportFailure?: VoiceFailureReport } | undefined>;
}): (input: { notice: VoiceFailureNotice | undefined }) => void {
  return useCallback(
    ({ notice }: { notice: VoiceFailureNotice | undefined }): void => {
      const line = deliverFailureNotice({ notice, report: seamRef.current?.reportFailure });
      if (line !== undefined) {
        note({ line });
      }
    },
    [note, seamRef],
  );
}
