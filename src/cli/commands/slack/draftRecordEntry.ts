/**
 * The one entry to `slack draft record --as me` for every caller, `slack draft` itself and the verbs that park a
 * draft in-process (`workstreams loop-in`, `github reviewer-ask`). The voice-briefing gate sits HERE rather than in
 * the dispatcher, because a caller that reaches the recorder without passing the dispatcher would otherwise park new
 * words in the owner's name from a session never shown their voice brief (`./voiceBriefingGate.ts`).
 */
import type { DraftRecordOptions } from "./draftCore.js";
import { recordBriefedDraft } from "./draftRecordRun.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { voiceBriefingExit } from "./voiceBriefingGate.js";

/**
 * Refuse an unbriefed session, then compose as the owner and park.
 *
 * @param deps the injected world, carrying no send edge
 * @param options the parsed invocation
 * @returns the process exit code
 */
export async function runDraftRecord({
  deps,
  options,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
}): Promise<number> {
  const unbriefed = voiceBriefingExit({
    applies: options.actor === "me",
    env: deps.doorEnv(),
    home: options.home,
    now: deps.nowIso,
  });
  if (unbriefed !== undefined) {
    return unbriefed;
  }
  return recordBriefedDraft({ deps, options });
}
