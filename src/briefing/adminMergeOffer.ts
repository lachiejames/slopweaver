/**
 * The one rule about a card OFFERING an administrator merge: it never does.
 *
 * Owner ruling: an admin merge into the work repository is never a choice to put to the owner, because the
 * code that goes out to customers carries real risk, and because it is structurally impossible: code owners
 * is in force via branch protection rules. A card that offered it as an option, or told the owner to merge
 * past unapproved codeowners, asked a question whose answer is always no.
 *
 * MEASURED (`../live/github/reviewRules.ts` carries the reads): the branch in question is governed by
 * a repository RULESET whose `bypass_actors` is empty, so nothing — not `enforce_admins`, not admin
 * permission — merges past its `require_code_owner_review`. An option that names it is not a risky option; it
 * is an option that cannot be taken, which makes the card unanswerable while reading as a real choice. That
 * is the same defect `./ownHandAction.ts` refuses one field over.
 *
 * ## Why this refuses the phrase for EVERY repository, not just that one
 *
 * `AGENTS.md` rule 1 already says a session lands its own green pull request here without asking the owner, so an
 * admin merge on this repository is not a decision that belongs on a card either — it is work the fleet does.
 * Refusing the phrase outright therefore removes an unanswerable option on one repository and a question that
 * should never have been asked on the other, and a rule that narrows what a card may say never needs anyone's
 * authority. `github merge --admin` itself is untouched: it remains this repository's sole-CODEOWNER landing
 * path, and `../cli/commands/github/mergeAdminCore.ts` is where the route is judged.
 *
 * ## What this does NOT govern
 *
 * `what`, and every folded section. Those REPORT — a card explaining that this refusal landed has to be able
 * to name the flag it added — and a report is not an option the owner has to pick. The scope is the three fields
 * that put a choice in front of the owner: `options`, `lean` and `if silent`.
 */

/**
 * An administrator merge, in the forms an option is written in — the flag itself, and the phrase in its bare
 * and gerund forms.
 *
 * Past tense is deliberately outside the criterion, exactly as it is in `./ownHandAction.ts`: "we admin
 * merged it" reports something that already happened, and a report is not a choice waiting on the owner.
 */
const ADMIN_MERGE =
  /--admin\b|\badmin[\s-]*merg(?:e|es|ing)\b|\bmerg(?:e|es|ing)\s+(?:it\s+|this\s+|that\s+)?(?:as|with|using|through|via)\s+(?:an?\s+)?admin\b/i;

/**
 * The administrator-merge phrase a cell offers, when it carries one.
 *
 * @param text the cell's plain text, above the fold
 * @returns the offending phrase, or undefined when the cell offers no administrator merge
 */
export function adminMergeOffer({ text }: { text: string }): string | undefined {
  return ADMIN_MERGE.exec(text)?.[0];
}

/**
 * The shape that replaces an admin-merge option, worded once so the form and the gate cannot drift apart.
 *
 * It names the mechanism rather than the preference, because a composer told only "don't offer that" writes
 * the same option next week in different words.
 */
export const ADMIN_MERGE_ADVICE =
  "A base branch that requires a review is governed by branch protection or a repository ruleset, and a " +
  "ruleset's requirement is not something admin permission or enforce_admins can waive — so an admin merge " +
  "there is not a risky choice, it is one GitHub refuses. Offer the review instead: `slopweaver github " +
  "review-state` names who owes one and `slopweaver github pr request-review` asks them.";

/**
 * The gate's refusal for one cell that offers an administrator merge.
 *
 * @param cell what the composer should go and fix — `option B`, `lean`
 * @param phrase the offending phrase {@link adminMergeOffer} found
 * @returns one line naming the cell, the phrase and what replaces it
 */
export function adminMergeRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return `${cell} offers an administrator merge with "${phrase}". ${ADMIN_MERGE_ADVICE}`;
}
