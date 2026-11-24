/**
 * What a plan call streams the page about its Codex turn's wait on the model: how long one wait ran, and what
 * app-server said beside the turn's items. Both are written into the call file, so the next long silence is split
 * from the call record alone. Their own module so `./planCallContract.ts` does not grow.
 *
 * MEASURED, the incident that asked for them: on one call three waits of 346s, 326s and 233s ran between the request
 * going out and the model's first item, no tool running, and nothing in the call file said so — splitting them took
 * Codex's own log database (`~/.codex-N/logs_2.sqlite`, rows `handle_output_item_done` per thread).
 */

/**
 * A Codex turn waited at least the orb's stall horizon (`STALL_MS`, `./voiceActivityState.ts`) for the model, with no
 * item running: from the turn's start or an item's completion to the next item's start or the turn's end
 * (`./talkPlanModelWait.ts`).
 */
export interface PlanModelWaitEvent {
  readonly kind: "model-wait";
  readonly turnId: string;
  readonly waitMs: number;
}

/**
 * What app-server said of a Codex turn beside its items (`codexNoticeOf`, `./talkPlanProtocolTurns.ts`): the
 * model's reply dropped and Codex is re-sending (`retry`), dropped for good (`failure`), or a `warning` on the thread,
 * which names no turn (`null`). Never the call's `error`: none of these is the voice's, and the turn's own failure
 * still arrives on its completion.
 */
export interface PlanCodexNoticeEvent {
  readonly kind: "codex-notice";
  readonly level: "retry" | "failure" | "warning";
  readonly turnId: string | null;
  readonly message: string;
}
