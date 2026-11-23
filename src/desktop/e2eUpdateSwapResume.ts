/**
 * What `update-swap-resume` is judged on, past the call coming back by itself: exactly one new call, and the shell's
 * own line saying it handed the voice window the restart owed for THIS instance's ended call. Pure; the drive is
 * `src/cli/commands/desktop/e2eCallUpdateSwapScenario.ts`.
 *
 * The requirement: when the owner presses "End call, update & restart call", the call ends and a new call starts
 * again by itself, never waiting for the owner to press Talk.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import type { E2eDesktopEvent } from "./e2eCallEvidence.js";

/** The part of the shell's `state.json` the scenario reads: the restart a call ended for an update is owed. */
const owedSchema = z.object({ resumeVoice: z.object({ sinceIso: z.string().min(1) }) });

/**
 * The instant the test instance saved for the call it ended for the update — the key its `update-resume` lines carry.
 * The event log is shared with the owner's own app, so this key, and never a time window, is what tells the instance's line
 * from one the owner's app wrote.
 *
 * @param text the test instance's own `state.json`, read straight after the shell answered the end-call
 * @returns the saved `sinceIso`, or why the file does not say one is owed
 */
export function owedSinceIso({ text }: { text: string }): Result<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return err([
      `the test instance's state.json is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const owed = owedSchema.safeParse(parsed);
  if (!owed.success) {
    return err(["the test instance's state.json owes no restart after the shell ended its call for the update"]);
  }
  return ok(owed.data.resumeVoice.sinceIso);
}

/**
 * Why the restarted call does not prove the shell restarted it, or `undefined` when it does.
 *
 * @param events the desktop shell's events since the scenario began — a log the owner's own app writes too
 * @param addedPlanCalls the plan calls opened after the call was ended for the update
 * @param sinceIso the instant the test instance saved for the call it ended ({@link owedSinceIso})
 * @returns the sentence, `undefined` when exactly one call came back and the shell logged handing over that restart
 */
export function updateResumeProblem({
  events,
  addedPlanCalls,
  sinceIso,
}: {
  events: readonly E2eDesktopEvent[];
  addedPlanCalls: number;
  sinceIso: string;
}): string | undefined {
  if (addedPlanCalls !== 1) {
    return `the update's restart opened ${String(addedPlanCalls)} plan calls, not exactly one`;
  }
  const handed = events.some(
    (event) =>
      event.kind === "update-resume" &&
      event.instance === "e2e" &&
      event.decision === "handed" &&
      event.sinceIso === sinceIso,
  );
  if (!handed) {
    return `a call came back, but the desktop shell logged no update-resume line handing over the restart owed since ${sinceIso}`;
  }
  return undefined;
}
