/**
 * The TRUSTED TIER — step (c) of the tag decision tree: whether an admitted asker is one of the people the
 * owner works with daily, which is enough on its own to investigate an ask no general ruling of the owner's covers.
 *
 * PURE: a list and an identity in, a verdict out. The tree that reads it is `../turn/tagDecisionTree.ts`.
 *
 * ## Membership is a SOURCE, never a name in this repository
 *
 * The criterion so far is people the owner works with daily, with more trust and rapport. Membership is not
 * decided: it comes from CRITERIA the owner settles first, and the owner's reaction to a briefing proposing names
 * per criterion decides it. So the code reads a file under `$SLOPWEAVER_HOME` and knows nobody: whoever
 * settles the owner's answer writes the file, and an install whose file is absent has nobody on the tier, so
 * every unruled ask from a non-member waits on the owner — step (d).
 *
 * ## Failing closed here means "not trusted", never "not answered"
 *
 * The who-may-tag gate (`./whitelist.ts`) fails closed by refusing everyone. This tier cannot: it only ever
 * ADDS a licence to investigate, so its closed state is simply "nobody is on it", and the ask falls through
 * to waiting on the owner, which is the tree's safe default (ambiguous means no). A file that exists and does not
 * parse is still reported as unreadable, so a broken edit is visible rather than silently demoting everyone.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

/** The file the trusted tier lives in, under `$SLOPWEAVER_HOME`. Never in this repository: it holds real user ids. */
export const TRUSTED_TIER_FILE = "trusted-askers.json";

/** The loaded tier: a list, or the fact that it is absent or could not be read. */
export type TrustedTier =
  | { readonly kind: "absent" }
  | { readonly kind: "list"; readonly identities: readonly string[] }
  | { readonly kind: "unreadable"; readonly why: string };

/** Whether one asker is on the tier, and, when they are not, the reason in words a brief line can carry. */
export type AskerTrust = { readonly trusted: true } | { readonly trusted: false; readonly why: string };

const NOT_AN_ARRAY = `${TRUSTED_TIER_FILE} must be a JSON array of Slack user id strings`;

const trustedTierSchema = z.array(
  z
    .string({ error: NOT_AN_ARRAY })
    .regex(/^\S+$/, `every entry in ${TRUSTED_TIER_FILE} must be a non-empty Slack user id with no whitespace`),
  { error: NOT_AN_ARRAY },
);

/**
 * Parse an already-decoded JSON value into the tier's identities.
 *
 * Strict for the same reason the who-may-tag list is: one malformed entry refuses the WHOLE file rather than
 * being dropped, because a silently dropped entry is a person the owner believes is trusted and is not. Duplicates
 * collapse, first-seen order kept.
 *
 * @param value a parsed JSON value (e.g. from `readFileSync` + `parseJson`)
 * @returns the deduplicated identities, or every reason the file was refused
 */
export function parseTrustedTier({ value }: { value: unknown }): Result<readonly string[]> {
  const parsed = trustedTierSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  return ok([...new Set(parsed.data)]);
}

/**
 * Whether one asker is on the trusted tier.
 *
 * Exact Slack id match only, exactly as the who-may-tag gate matches. Every state that is not a hit says why,
 * so the brief can tell the session whether "not trusted" means "not on a list the owner settled" or "no list yet".
 *
 * @param userId the Slack user id that addressed the bot
 * @param tier the loaded tier
 * @returns trusted, or not trusted with the reason
 */
export function askerTrust({ userId, tier }: { userId: string; tier: TrustedTier }): AskerTrust {
  if (tier.kind === "absent") {
    return { trusted: false, why: `no ${TRUSTED_TIER_FILE} under $SLOPWEAVER_HOME — nobody is on the tier yet` };
  }
  if (tier.kind === "unreadable") {
    return { trusted: false, why: `${TRUSTED_TIER_FILE} could not be read (${tier.why}) — nobody counts as trusted` };
  }
  if (tier.identities.includes(userId)) {
    return { trusted: true };
  }
  return { trusted: false, why: `\`${userId}\` is not on ${TRUSTED_TIER_FILE}` };
}
