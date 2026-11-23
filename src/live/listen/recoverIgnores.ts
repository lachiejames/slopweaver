/**
 * The exclusions the PERMANENT IGNORE registries decide for one recovery candidate — `deliberately-ignored`
 * and `deliberately-ignored-conversation`.
 *
 * Split out of `./recover.ts`'s classifier so that file stays under the file-size ratchet; the measured
 * incident and the reasoning for each exclusion live in `./recover.ts`'s header.
 */
import { type IgnoredAsk, isIgnoredAsk } from "../ask/ignore.js";
import { type IgnoredConversation, isIgnoredConversation } from "../ask/ignoredConversation.js";
import type { RecoveryCandidate, RecoveryExclusion } from "./recover.js";

/**
 * The permanent-ignore exclusions that apply to one candidate — the ask itself, then its whole conversation.
 *
 * @param candidate the message to classify
 * @param ignored the permanent ignore registry, already folded; a candidate it names is `deliberately-ignored`
 * @param ignoredConversations the permanent conversation-ignore registry, already folded; a candidate whose
 *   channel it names is `deliberately-ignored-conversation`
 * @returns the ignore exclusions that apply, and a sentence per exclusion, in test order
 */
export function ignoreExclusions({
  candidate,
  ignored,
  ignoredConversations,
}: {
  candidate: RecoveryCandidate;
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
}): { readonly exclusions: readonly RecoveryExclusion[]; readonly why: readonly string[] } {
  const exclusions: RecoveryExclusion[] = [];
  const why: string[] = [];
  if (isIgnoredAsk({ askIdentity: candidate, ignored })) {
    exclusions.push("deliberately-ignored");
    why.push(`\`slopweaver turn ignore\` was run for exactly this ask (${candidate.channel}, ${candidate.messageTs})`);
  }
  if (isIgnoredConversation({ channel: candidate.channel, ignored: ignoredConversations })) {
    exclusions.push("deliberately-ignored-conversation");
    why.push(`\`slopweaver turn ignore-conversation\` was run for this whole conversation (${candidate.channel})`);
  }
  return { exclusions, why };
}
