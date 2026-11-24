/**
 * The console's one reading of the state home, and every path it serves from under it — the site's half of
 * `src/stateHome.ts`, which the site cannot import. `src/__tests__/unit/stateHome.guard.test.ts` refuses a home
 * path built anywhere else in `site/`, so a second resolution cannot drift from this one.
 *
 * The home is the one the console was STARTED with: `scripts/docs-site.sh` resolves `$SLOPWEAVER_HOME` the same
 * way. Nothing rebuildable is read from here — the console's saved readings and run records sit under the cache
 * root, named by the launcher (`./savedReadings.ts`, `src/cacheHome.ts`).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The home this console was started with: `$SLOPWEAVER_HOME` when set and not blank, else `~/.slopweaver`.
 *
 * @returns the absolute home
 */
export function consoleHome(): string {
  const fromEnv = process.env["SLOPWEAVER_HOME"];
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return resolve(fromEnv);
  }
  return join(homedir(), ".slopweaver");
}

/**
 * The files one transcript batch can write, which the route announces before it spawns the verb (`./writerIntent.ts`):
 * the card-landing ledger (`src/talk/cardLandingStore.ts`) and the call's own file (`src/talk/callStore.ts`). The
 * ledger's intent goes up first and comes down last, since every fence waits on the ledger last
 * (`src/talk/writerRunIntent.ts`).
 *
 * @param callId the call the batch is for, already read as a v4 UUID
 * @returns both paths under {@link consoleHome}, named so the ledger's is never picked by position
 */
export function consoleTranscriptWrites({ callId }: { callId: string }): {
  readonly ledger: string;
  readonly call: string;
} {
  const home = consoleHome();
  return { call: join(home, "talk", "calls", `${callId}.jsonl`), ledger: join(home, "talk", "card-landings.jsonl") };
}

/**
 * The paths under {@link consoleHome} the console serves files from, each written by the CLI, plus the one ledger the
 * console writes itself.
 *
 * @param home the state home, given only by a test that writes into a throwaway one
 * @returns the pages directory (`src/pages/publish.ts`), the draft-media store (`src/admit/slackDraftMediaStore.ts`),
 *   the hand-step picture store (`src/hand/shotStore.ts`), the channel-media store
 *   (`src/live/slack/channelMedia.ts`), and the console sync failure ledger the monitor sweep reads
 *   (`src/live/consoleSyncFailureStore.ts`) with its fallback at the home root for a row that ledger refused, both
 *   written by `./consoleSyncFailureAppend.ts` because the failure they record can be the CLI itself not starting;
 *   and the owner's private-terms file with its waiting proposals (`src/hygiene/privateTermsStore.ts`), read only by
 *   `./privateTermProposalRead.ts` for the open card that asks the owner to confirm them
 */
export function consoleHomePaths({ home = consoleHome() }: { home?: string } = {}): {
  readonly pages: string;
  readonly draftMedia: string;
  readonly handShots: string;
  readonly slackChannelMedia: string;
  readonly consoleSyncFailures: string;
  readonly consoleSyncFailureAppendFailures: string;
  readonly privateTerms: string;
  readonly privateTermProposals: string;
} {
  return {
    consoleSyncFailureAppendFailures: join(home, "console-sync-failure-append-failures.jsonl"),
    consoleSyncFailures: join(home, "live", "console-sync-failures.jsonl"),
    draftMedia: join(home, "queue", "slack-draft-media"),
    handShots: join(home, "hand-steps", "shots"),
    pages: join(home, "pages"),
    privateTermProposals: join(home, "hygiene", "private-term-proposals"),
    privateTerms: join(home, "hygiene", "private-terms.tsv"),
    slackChannelMedia: join(home, "live", "slack", "channel-media"),
  };
}
