/**
 * What `slack draft` refuses before any mode runs (`./draftRun.ts`): a session never shown the owner's voice brief
 * revising words in their name, and a `record --row` no board row holds. Neither reads the draft register, stdin or
 * Slack, so both sit in front of the mode switch rather than inside one mode's shell. An as-me RECORD is briefed in
 * `./draftRecordEntry.ts` instead, because other verbs reach the recorder without passing this dispatcher.
 */
import type { SlackDraftOptions } from "./draftCore.js";
import { draftUsageExit } from "./draftRecordRun.js";
import { rowDocMissing } from "./draftRowDoc.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { voiceBriefingExit } from "./voiceBriefingGate.js";

/**
 * Refuse a draft invocation before its mode runs, or let it through.
 *
 * A `restore` is not briefed: it puts back words a session was already admitted with.
 *
 * @param deps the environment and clock the briefing gate reads
 * @param parsed the parsed invocation
 * @returns the exit code once a refusal is printed, else `undefined`
 */
export function draftAdmissionExit({
  deps,
  parsed,
}: {
  deps: Pick<SlackDraftDeps, "doorEnv" | "nowIso">;
  parsed: SlackDraftOptions;
}): number | undefined {
  const unbriefed = voiceBriefingExit({
    applies: parsed.mode === "revise",
    env: deps.doorEnv(),
    home: parsed.home,
    now: deps.nowIso,
  });
  if (unbriefed !== undefined) {
    return unbriefed;
  }
  if (parsed.mode === "record" && parsed.row !== undefined) {
    const missing = rowDocMissing({ home: parsed.home, row: parsed.row });
    if (missing !== undefined) {
      return draftUsageExit({ errors: [missing] });
    }
  }
  return undefined;
}
