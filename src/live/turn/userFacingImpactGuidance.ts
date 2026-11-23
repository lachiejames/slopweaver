/**
 * USER-FACING IMPACT — the brief and reviewer lines a "what did the customer see" ask gets, keyed on the question.
 *
 * ## The measured miss this exists for
 *
 * On an incident thread the owner found the screenshots and links unhelpful: they did not look
 * like failures from the customer's perspective, and the setup has to carry this rule because user-facing
 * impact is asked for often. The rejected answer sent staff-app replays, log panels and RUM error counts. What
 * the owner wanted, and had glimpsed on the worker's own screen, was the customer's own app replay paused on a red banner reading
 * "Something went wrong loading this page. Pull down to retry." It was one query away: the banner's copy is in the
 * client code, RUM records the customer's tap on it as an action whose target text is that copy, and the replay
 * opens at the action's own timestamp. The earlier worker had even photographed that frame, then led with the
 * staff sessions.
 *
 * ## Why this is guidance and not a gate
 *
 * Whether a picture shows the customer's app, a staff app or a Datadog panel is a judgement made by LOOKING at it.
 * Nothing in the answer form can decide it, so a door refusal would be a guess. That is the same reason
 * `./visualEvidenceGuidance.ts` is guidance, and the opposite of `../../admit/realArtifact.ts`, whose rule is
 * decidable from the form (a link run, or a stated reason).
 *
 * The keyword table is narrow on purpose. A false positive costs a few brief lines on an unrelated ask; a broad
 * token such as `customer` or `impact` would print them on most incident questions. Widen it on the next measured
 * miss, not before.
 */

import { visualEvidenceReviewLines } from "./visualEvidenceGuidance.js";

/**
 * The phrases that mark an ask as one about what a customer actually saw.
 *
 * @internal — exported so a test can assert the table's own contents rather than only its matches.
 */
export const USER_FACING_IMPACT_KEYWORDS: readonly string[] = [
  "user-facing",
  "user facing",
  "customer-facing",
  "customer impact",
  "user impact",
  "what did the user see",
  "what did users see",
];

/**
 * One case-insensitive matcher per keyword, bounded by a word edge at both ends. A bare substring test read
 * "what did users seem to prefer" as "what did users see", so a phrase only counts
 * where it stands as whole words. The edges are Unicode letter/number lookarounds, not `\b`, which is ASCII-only
 * and reads "user impacté" as ending at the `t`. Case is folded by lowercasing the question, never by the `i` flag,
 * which under `u` folds U+017F `ſ` to `s`. What this does not close: a question spelled with look-alike characters
 * matches nothing, and wording outside the table matches nothing, both by construction of a phrase table.
 */
const USER_FACING_IMPACT_MATCHERS: readonly RegExp[] = USER_FACING_IMPACT_KEYWORDS.map((keyword) => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u");
});

/**
 * Whether the question asks about user-facing impact. Case-insensitive whole-word match over the table.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns whether any keyword appears as whole words
 */
function asksUserFacingImpact({ question }: { question: string }): boolean {
  const lower = question.toLowerCase();
  return USER_FACING_IMPACT_MATCHERS.some((matcher) => matcher.test(lower));
}

/**
 * The composer's pre-flight for a user-facing impact ask, printed by both composing briefs after the
 * visual-evidence default it narrows.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns the lines to print, in order; empty when the question is not about user-facing impact
 */
export function userFacingImpactPreflightLines({ question }: { question: string }): readonly string[] {
  if (!asksUserFacingImpact({ question })) {
    return [];
  }
  return [
    "USER-FACING IMPACT — this ask is about what a CUSTOMER SAW, so lead with their screen:",
    "  1. The lead evidence is the customer app's own session replay, paused on the visible error UI and",
    "     photographed fullscreen with the replay timestamp in frame, plus a labelled link to that replay.",
    "  2. Find it copy-first: grep the client code for the error text the UI renders, search RUM actions and",
    "     views in the CUSTOMER app for that text, and open the replay at the matching action's own timestamp.",
    "     `browser open` the replay, `browser read` for the fullscreen control, `browser act --do click` to",
    "     press it (it photographs the result), then `browser image-record` before it goes in `images`.",
    "  3. Staff or internal-app replays, RUM error counts, log panels and graphs may corroborate BELOW the",
    "     customer frame. They never lead: none of them is what the customer saw.",
    "  4. If the failure was silent and no customer saw an error state, say so plainly. That IS the answer;",
    "     never substitute an internal screenshot for a customer one that does not exist.",
    "  5. Count people, not events: distinct sessions, or distinct customers where identity is proven.",
    "  Method and a worked example: skills/loop-bot/reference/user-facing-impact.md.",
  ];
}

/**
 * The reviewer's matching subsection, rendered between the absent-image ceiling (1b) and the present-image
 * check (1c) so the reviewer knows whose surface to look for before it opens each picture.
 *
 * @param question the question as asked
 * @returns the section's lines, in order; empty when the question is not about user-facing impact
 */
export function userFacingImpactReviewLines({ question }: { question: string }): readonly string[] {
  if (!asksUserFacingImpact({ question })) {
    return [];
  }
  return [
    "## 1b-i. A user-facing impact ask is answered with the CUSTOMER's screen",
    "",
    "This question asks what a customer saw. When you open the attached images (section 1c), check whether at",
    "least one shows the customer app itself at the visible error state, normally a replay frame of their",
    "session. Staff or admin sessions, RUM counts, log panels and graphs corroborate; they do not show what the",
    "customer saw.",
    "",
    "If the answer claims visible customer impact and every attached image is an internal surface, record that",
    "as a `high`-impact `unsupported` claim and mark the verdict `broken`. An answer that says plainly the",
    "failure was silent to the customer owes no customer screenshot, and section 1b's ceiling still governs an",
    "answer with no images at all.",
    "",
  ];
}

/**
 * The reviewer packet's image clauses that come BEFORE section 1c: the absent-image ceiling (1b), then, for an
 * impact ask, the whose-screen clause above. One call so `./review.ts` carries one seam for both.
 *
 * @param question the question as asked
 * @returns 1b, followed by the user-facing impact clause when the question raises it
 */
export function reviewImageClauseLines({ question }: { question: string }): readonly string[] {
  return [...visualEvidenceReviewLines(), ...userFacingImpactReviewLines({ question })];
}
