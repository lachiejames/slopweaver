/**
 * The effectful edge of the tag decision tree: read this install's general rulings and trusted tier, and render
 * the tree for one asker. `turn brief` and `turn resume` both print it, and both read the files live rather than
 * from the brief, so a ruling or a tier the owner settled since the brief was written is the one the session sees.
 */
import { askerTrust } from "../listen/trustedTier.js";
import { loadTrustedTier } from "../listen/trustedTierStore.js";
import { loadGeneralRulings } from "./generalRulingsStore.js";
import { tagDecisionTreeLines } from "./tagDecisionTree.js";

/**
 * Render the tag decision tree for one asker from this install's own files.
 *
 * @param home the state home holding `general-rulings.json` and `trusted-askers.json`
 * @param userId the asker's Slack user id, looked up on the trusted tier
 * @returns the tree's lines, ready to print
 */
export function tagDecisionTreeFor({ home, userId }: { home: string; userId: string }): readonly string[] {
  return tagDecisionTreeLines({
    rulings: loadGeneralRulings({ home }),
    trust: askerTrust({ tier: loadTrustedTier({ home }), userId }),
  });
}
