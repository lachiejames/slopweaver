/**
 * The record a read of the owner's words gives — the one conversion every writer of a quote and every judge of one
 * shares: `handover quote` and `handover register` write it, and the relay-words guard compares a hand edit with it
 * (`../admit/relayWordsJudge.ts`). Below `src/cli/` so product code can reach it.
 *
 * Pure: a read in, a record out.
 */
import type { Result } from "#lib/result.js";

import { type HisWords, type HisWordsRecord, unreadOwnerWords } from "./hisWords.js";
import type { HisWordsError } from "./hisWordsErrors.js";

/**
 * The record a read gives: the words, or the anchor they would not read off and why.
 *
 * @param anchor the anchor that was read
 * @param read the resolver's answer
 * @returns the record to store
 */
export function recordOfRead({
  anchor,
  read,
}: {
  anchor: string;
  read: Result<HisWords, HisWordsError>;
}): HisWordsRecord {
  if (read.isErr()) {
    return unreadOwnerWords({ anchor, why: read.error.message });
  }
  return { hisWords: read.value, kind: "held" };
}
