/**
 * Fakes for the live Codex account read (`src/codex/accountLive.ts`) — plain functions of the reader's own
 * type, never a mock. A test that routes, ranks or decides a quota passes one of these, so what it asserts is
 * the decision over a live answer it chose rather than whatever the machine running it is signed into.
 */
import type { ReadCodexAccountsLive } from "../codex/accountLive.js";
import type { CodexAccountLive } from "../codex/accountLiveParse.js";

/** The reason every fake `unreadable` row carries, so an assertion can name it. */
const FAKE_UNREADABLE_REASON = "no live read in this test";

/**
 * One store whose live read did not happen — the state every reader was in before the live read existed.
 *
 * @param codexHome the store the row names
 * @param readAtIso the instant the read was judged at
 * @returns the unreadable row
 */
export function unreadableLive({ codexHome, readAtIso }: { codexHome: string; readAtIso: string }): CodexAccountLive {
  return { codexHome, kind: "unreadable", readAtIso, reason: FAKE_UNREADABLE_REASON };
}

/**
 * A reader answering each store from a table, and `unreadable` for any store the table does not name.
 *
 * @param byHome each store's answer, keyed by its directory; its own `readAtIso` is replaced by the read's
 * @returns the fake reader
 */
export function liveReaderFrom({
  byHome = {},
}: {
  byHome?: Readonly<Record<string, CodexAccountLive>>;
} = {}): ReadCodexAccountsLive {
  return ({ codexHomes, readAtIso }) =>
    codexHomes.map((codexHome) => {
      const answer = byHome[codexHome];
      if (answer === undefined) {
        return unreadableLive({ codexHome, readAtIso });
      }
      return { ...answer, codexHome, readAtIso };
    });
}
