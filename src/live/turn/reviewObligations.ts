/**
 * THE REVIEWER'S STANDING CHECKS, defined once — so the worker runs them on its own draft BEFORE review round 1,
 * and the reviewer's packet renders the same claims from the same constants.
 *
 * ## The measured failure this exists for
 *
 * Every first review round whose verdict survives in the replay fixtures came back `broken`: 7 of 7, and 13 of
 * 17 rounds overall (read with `slopweaver turn ledger --home <fixture>/home` over each
 * `src/__tests__/fixtures/replay/<slug>/`). A round measured a median of 12 minutes, review was
 * 49% of tag-to-answer on public turns, and the slowest recorded turn spent about two hours in review rounds.
 * The rounds broke on checks the WORKER could have run itself: six rounds on an answer that never
 * carried the link the ask was for; one unsupported claim out of fifteen; an answer contradicting
 * a reply three messages below the ask. The owner took the lean of the run that measured where a three-hour bot
 * turn spent its time: a first draft that passes the reviewer's standing checks before round 1, with no check
 * removed.
 *
 * ## Shared definitions, never shared conclusions
 *
 * The reviewer's packet is a deterministic function of the answer's bytes, the decision and the brief, and the
 * worker never writes a word the reviewer reads (`./review.ts`'s header). This module keeps that: the claim
 * TEXT is one constant each (the deliverable one beside the table it names, in
 * `../../admit/requestedDeliverables.ts`), rendered once for the worker here and once for the reviewer by
 * `./reviewVerdictSection.ts`. The worker sees one rendering; the packet renders the other; nothing
 * the worker concludes about its own draft flows back into the packet. A worker-written checklist file was
 * weighed and dropped — a box nobody can verify is ceremony, and the one part code CAN check (the thread tail)
 * is checked by code at round-1 open (`turn review`'s `reviewThreadPreflight.ts`, in the CLI tree).
 */
import { DELIVERABLE_STANDING_CLAIM, requestedDeliverablesOf } from "../../admit/requestedDeliverables.js";

/** The second standing claim: the thread tail. Every verdict classifies it, `impact` `high`. */
export const THREAD_STANDING_CLAIM = "the thread has not already answered or contradicted this";

/**
 * The checks a worker runs on its own validated draft BEFORE it opens review round 1 — the reviewer's two
 * standing claims and its read-pair duty on every live claim, in the order the reviewer meets them.
 *
 * The concrete artifact list is the same two-row table the send door and the packet's section 1 read
 * (`../../admit/requestedDeliverables.ts`), so a worker is never told a different list than its reviewer is.
 *
 * @param question the ask's own question text, which decides whether a concrete artifact is named
 * @returns the lines to print, in order
 */
export function firstDraftReviewLines({ question }: { question: string }): readonly string[] {
  const requested = requestedDeliverablesOf({ question });
  const concrete =
    requested.length === 0
      ? ["     No artifact class here is decidable from the question alone: re-read it and name what it asked for."]
      : requested.map((deliverable) => `     This ask requests: ${deliverable.what}`);
  return [
    "BEFORE REVIEW ROUND 1 — your reviewer classifies these first, and every first round on record broke on one",
    "of them (7 of 7, a median 12 minutes a round). Check your draft against each now:",
    `  1. \`${DELIVERABLE_STANDING_CLAIM}\``,
    "     List the artifacts the question asks to be HANDED and find each one in the answer. A missing one is",
    "     `broken` however sound the rest is.",
    ...concrete,
    `  2. \`${THREAD_STANDING_CLAIM}\``,
    "     Re-read the thread's TAIL now, every message after the ask. If a person already answered, or your",
    "     draft contradicts or duplicates what they wrote, fix the draft.",
    "     `turn review` re-reads the thread before round 1 opens and refuses while a human message newer than",
    "     your read is unread: pass --read-through <the newest human ts you read> (the ask's own ts when",
    "     nothing followed it). A message that moved the thread but touches no claim: re-run with --delta-cleared.",
    "  3. Every claim that rests on LIVE state names the read behind it: the exact verb, query or URL, and when",
    "     you ran it. Your reviewer re-runs that read; a claim with no read behind it is `unsupported`.",
  ];
}
