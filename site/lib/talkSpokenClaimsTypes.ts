/**
 * The acts and claim shapes the voice's spoken claims are read into, split out of `./talkSpokenClaims.ts`, which
 * re-exports every one it exported before.
 */

import type { FleetPromiseClaim } from "./talkFleetPromises";
import type { RunningListClaim } from "./talkRunningListClaims";

/** The acts a done claim names, each in the past form the voice says it in. */
export const OUTCOME_ACTS = ["sent", "posted", "merged", "approved", "released", "landed", "went up"] as const;

/** One act a done claim names. */
export type OutcomeAct = (typeof OUTCOME_ACTS)[number];

/**
 * The acts whose words mean something else as often as a done thing — "the plane landed", "we landed on B", "the count
 * went up" — so a mention of one counts only in a clause naming a thing the console does: "the PR landed", "the post
 * went up". The class is read at all because the owner's words for it are "posted, went up,
 * landed, merged, sent".
 */
export const ARTIFACT_ACTS: ReadonlySet<OutcomeAct> = new Set(["landed", "went up"]);

/** The things whose landing or going up is the console's act, one of which an {@link ARTIFACT_ACTS} clause names. */
export const ARTIFACT_NOUNS = new Set([
  "pr",
  "prs",
  "pull",
  "post",
  "posts",
  "message",
  "messages",
  "reply",
  "replies",
  "draft",
  "drafts",
  "batch",
  "digest",
  "fix",
  "fixes",
  "change",
  "changes",
  "patch",
  "bump",
  "bumps",
  "commit",
  "announcement",
  "comment",
  "review",
  "update",
  "top-up",
]);

/**
 * A claim the voice made that the call can check. `words` is the sentence it stood in, as said. A `repeated-ask` is
 * a question put to the owner again after they spoke to it (`./talkRepeatedAsk.ts`), kept as a claim grounding like the others.
 */
export type SpokenClaim =
  SentenceClaim | { readonly kind: "repeated-ask"; readonly words: string; readonly start: number };

/**
 * A claim one sentence carries on its own: a done claim, a PR number, fleet work promised as the voice's own, or a
 * draft said to be on the owner's running list.
 */
export type SentenceClaim =
  | { readonly kind: "outcome"; readonly act: OutcomeAct; readonly words: string; readonly start: number }
  | { readonly kind: "pr-number"; readonly claimed: number; readonly words: string; readonly start: number }
  | FleetPromiseClaim
  | RunningListClaim;

/** An ungrounded claim as a closed shape, never words. */
export type ClaimShape =
  | { readonly kind: "outcome"; readonly act: OutcomeAct }
  | { readonly kind: "pr-number"; readonly claimed: number }
  | { readonly kind: "repeated-ask" }
  | { readonly kind: "fleet-promise" }
  | { readonly kind: "running-list" };

/**
 * The shapes the call corrects aloud: a done claim nothing grounds, fleet work the voice promised as its own, and a
 * draft said to be on the owner's running list with no offer landed that the owner has not moved on from.
 */
export type CorrectableClaimShape = Extract<ClaimShape, { kind: "outcome" | "fleet-promise" | "running-list" }>;

/** What the page posts for an ungrounded claim: its shape, and where it was said so a retried post is one entry. */
export type ClaimGrounding = ClaimShape & { readonly key: string };
