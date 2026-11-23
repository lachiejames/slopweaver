/**
 * A Slack write privacy capability with a declared-empty policy: no private terms, no denylist, the committed
 * identifier rules. For a test of something else that constructs a real Slack write client; a test of the guard
 * itself builds `slackWritePrivacy({ home })` over a throwaway home instead.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import { ok } from "../lib/result.js";
import type { SlackWritePrivacy } from "../outbound/slack/writePrivacy.js";

/** Judges every write under a policy that declares no private term and no denylisted word. */
export const NO_TERMS_SLACK_PRIVACY: SlackWritePrivacy = {
  resolve: () => Promise.resolve(ok({ denylist: [], identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: [] })),
};
