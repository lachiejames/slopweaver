/**
 * Every channel this install's recipe rows carry the owner's own recorded approval for — the effectful shell the
 * DOOR's half of the scheduled-post channel rule reads.
 *
 * The definitions directory IS the register. There is deliberately no second store, and the reason is the
 * one `./definition.ts`'s header already gives for the definitions living outside the repository: an
 * approval names a real Slack conversation id, which `hygiene/scan.ts` refuses in any tracked file wherever
 * `IDENTIFIER_VERDICT` reads `refuse`, so it has to live under `$SLOPWEAVER_HOME` anyway. A store of its own would be a second uncommitted file with
 * the same constraint and one more thing for a reader to find stale.
 *
 * A row's approval is READ here and never judged: whether it admits a particular firing is
 * `./postTarget.ts`'s question, asked with the recipe in hand. This module answers only "has the owner
 * approved this channel for anything", which is the most the wire can support — see
 * `../../outbound/slack/scheduledPostChannel.ts`.
 *
 * An absent or unreadable directory answers an EMPTY list, so a scheduled post on an install with no rows
 * is refused anywhere but the owner's DM rather than admitted everywhere. `loadRecipeDefinitions` already treats an
 * absent directory as an empty roster for the same reason, and a malformed row is simply not in it — a row
 * nobody can parse has approved nothing.
 */
import { stateHomePaths } from "../../stateHome.js";
import { loadRecipeDefinitions } from "./definitionStore.js";

/**
 * Every channel any parsable recipe row records the owner's approval for, deduped, in sorted order.
 *
 * Sorted rather than in roster order so a refusal that lists them reads the same on two runs — a set whose
 * order follows a directory listing is one nobody can diff.
 *
 * @param home the state home whose definitions directory holds the rows
 * @returns every approved channel id, deduped and sorted
 */
export function approvedScheduledChannelsOf({ home }: { readonly home: string }): readonly string[] {
  const { definitions } = loadRecipeDefinitions({
    board: null,
    directory: stateHomePaths({ home }).live.recipe.definitionsDir,
  });
  const channels = new Set<string>();
  for (const definition of definitions) {
    // An `if` rather than a `?? []`: `no-silent-fallback` refuses every `??` in this tree,
    // and an absent approval list is a state worth reading as one rather than as an empty one.
    if (definition.channelApprovals === undefined) {
      continue;
    }
    for (const approval of definition.channelApprovals) {
      channels.add(approval.channel);
    }
  }
  return [...channels].toSorted();
}
