/**
 * What a landing press says about OUR OWN open walkthrough threads.
 *
 * The press does not resolve them itself: its child `github enqueue` does, immediately before its mutation
 * (`./walkthroughStep.ts`), so a direct enqueue and a landing press clear them the same way and at the same
 * point — before the queue ENTRY, which `acme/acme-admin`'s queue refuses over an open conversation.
 * `../../../review/walkthroughClearance.ts` carries the measurement and the owner's ruling.
 */

/**
 * The clause a DRY RUN prints about the threads a real press's enqueue would resolve first, or the empty string.
 *
 * A dry run that hides a write the real run would make is a lie about what `--press` is going to do, which
 * is the same reason `pressJudgment.ts`'s `waiverClause` has a `would` tense at all.
 *
 * @param threadIds our own open threads, as the press-time read found them
 * @returns the clause, already prefixed with its own separator, or the empty string
 */
export function wouldClearClause({ threadIds }: { threadIds: readonly string[] }): string {
  if (threadIds.length === 0) {
    return "";
  }
  return `; its enqueue would first resolve ${String(threadIds.length)} of our own open walkthrough thread(s)`;
}
