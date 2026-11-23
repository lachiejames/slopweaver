/**
 * The mention resolution the Linear write ORCHESTRATION tests run against.
 *
 * Three shells now take a mention resolver as an injected edge, and every one of their tests is about
 * something else — the ledger, the door, the fields-only guard. They all want the same thing from it: a
 * roster that knows nobody and is freshly derived, so no form in those suites mentions anyone and the gate
 * is a no-op. Written once here rather than three times, because three copies of a fixture drift into three
 * slightly different definitions of "empty".
 *
 * Resolution and refusal themselves are tested for real in `unit/outbound/linear/mentionIndex.test.ts`.
 */
import type { LinearMentionResolution } from "../outbound/linear/mentionIndex.js";

/**
 * A resolution in which nothing resolves, from a fresh but empty roster.
 *
 * @param keys the keys the body asked for — echoed back as candidate-less misses
 * @returns the resolution
 */
export function emptyMentionResolution({ keys }: { keys: readonly string[] }): LinearMentionResolution {
  return {
    candidates: new Map(keys.map((key) => [key, []])),
    heldRequested: [],
    memberLookups: new Map(),
    resolved: new Map(),
    roster: {
      addressableKeys: 0,
      collisions: [],
      derivedPeople: 0,
      freshness: { kind: "fresh" },
      heldPeople: 0,
    },
  };
}
