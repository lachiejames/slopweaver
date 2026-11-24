/**
 * The call-file lines a Codex turn's wait on the model leaves: how long a long wait ran, and what app-server said
 * beside the turn's items. Their own module so `./planWiringLines.ts` does not grow. Count them over the call files:
 * `grep -E '"name":"(model-wait|codex-retry|codex-error|codex-warning)"' $SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 */
import type { PlanCodexNoticeEvent, PlanModelWaitEvent } from "../../lib/talkPlanCodexEvents";
import type { ToolLine } from "./voiceContext";

/** Each app-server notice level's line name. */
const NOTICE_NAMES = { failure: "codex-error", retry: "codex-retry", warning: "codex-warning" } as const;

/**
 * The call-file line one wait or notice leaves. A long wait reads `turn <id> waited <N>s for the model's reply`, whole
 * seconds rounded down; a notice names its turn when it has one, and only a failure is marked refused.
 *
 * @param event the wait or notice the call streamed
 * @returns the line
 */
export function codexWaitLine({ event }: { event: PlanModelWaitEvent | PlanCodexNoticeEvent }): ToolLine {
  if (event.kind === "model-wait") {
    const seconds = Math.floor(event.waitMs / 1000);
    const detail = `turn ${event.turnId} waited ${String(seconds)}s for the model's reply`;
    return { detail, ms: undefined, name: "model-wait", refused: false, usage: undefined };
  }
  let detail = event.message;
  if (event.turnId !== null) {
    detail = `turn ${event.turnId}: ${event.message}`;
  }
  if (event.level === "retry") {
    detail += "; Codex is re-sending";
  }
  return {
    detail,
    ms: undefined,
    name: NOTICE_NAMES[event.level],
    refused: event.level === "failure",
    usage: undefined,
  };
}
