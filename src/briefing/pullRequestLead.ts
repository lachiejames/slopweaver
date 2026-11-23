/**
 * An opening that leads with a pull request instead of the discussion — the one criterion every door that writes
 * something the owner or a teammate reads FIRST shares: the hand step's headline (`../hand/prLedHeadline.ts`), the Queue
 * ask's lead (`../handover/cardAlignment.ts`) and a parked Slack draft's first block
 * (`../cli/commands/slack/draftPrLead.ts`).
 *
 * The rule: never lead with the PR, lead with the discussion. A draft whose first block is a "Fix branch" link and
 * whose top line ends "need a reviewer for the fix" is the failure. The discussion is what was noticed, the
 * annotated screenshot and its link, and what it might mean; there is no PR in it. A found issue is validated and
 * handed to the owner, who decides whether to report it: this is organisation intelligence, not organisation fixing.
 *
 * ## The criterion, and why it is exactly this
 *
 * Two shapes, each a tell rather than a reading of intent:
 *
 * - **The opening IS a pull request.** Past any leading emoji or punctuation, the text starts on a GitHub pull,
 *   compare, commit or tree address, a bare `#NN`, a NUMBERED `PR` or `pull request` with its number, or `fix branch`/`fix
 *   PR`. That is the draft that prompted this: `🔗 Fix branch` above everything else.
 * - **It asks for a fix to be approved, reviewed or merged.** "need a reviewer for the fix", "approve the fix PR",
 *   "merge this fix", "land the fix PR", "approve the PR", "approve a GitHub pull address". An ask to act on
 *   a fix presumes the decision the conversation was for. "Land" counts only with the pull request named ("land the
 *   fix PR"), because "land the fix" alone is how a plan for our own tooling reads. Its bounds, exactly: the verb and
 *   the fix sit in ONE sentence (no `.`, `?`, `!` or newline between them); the fix is introduced by `the`, `a`,
 *   `this`, `our`, `my` or `your`, with at most 40 characters between the verb and that word ("approve, after the
 *   team reviews the evidence, the fix" puts 39 there, so it is caught); and "approve" with a pull request needs a singular
 *   `PR`/`pull request` or a GitHub pull address, at most 40 characters after the verb. An ask spread wider than that
 *   passes, as a paraphrase does.
 *
 * A markdown heading's marker is skipped like an emoji, so a heading of "PR" and its number opens on the pull request
 * it names.
 *
 * What it deliberately PASSES: a card ABOUT a pull request the owner or a colleague raised, opening on words ("Read the
 * breakdown of Jasper's uk stack PR …", "hey, could I grab a review on <PR>", "a reviewer for the PR"), because there
 * the pull request is the
 * subject rather than a fix put in front of the evidence; a "fix PR" named PAST the opening with no ask to act on it
 * ("Raise 9 vulnerability-fix pull requests …", the bump drive the owner asked for; a ledger row for our own tooling, which
 * the steer leaves unchanged); a position in a stack ("PR 2 of 2", "PR1"), which names no pull request, the same
 * reading `../handover/cardAlignment.ts` gives `PR3`; a plural backlog ("PRs backing up"), which names no one pull
 * request; the imperative "Fix …", which is a verb; and an UNNUMBERED "the PR …" or "the fix …", which as often names
 * a gate or a proposal ("The PR lead-row gate reads …", "The fix proposed in … is too narrow") as an artifact. The
 * last two were MEASURED: run over the live store (408 parked drafts, and 8935 texts — every
 * `question` and `summary` string on a row `slopweaver handover list --json` printed, so more texts than rows, each passed to
 * {@link pullRequestLead}), the unnumbered forms fired only on rows like those, while the numbered and linked forms
 * caught the proxy draft and
 * nothing a review ask or digest legitimately opens with. A false refusal costs one reword that leads with the
 * evidence, which is always possible, so no hatch is needed where a door has none of its own. Its known blind spots:
 * a NARRATIVE quoting such an ask ("a card asked the owner to approve a fix PR"), which it refuses, so reword it to describe
 * the defect; and an ask PARAPHRASED outside the closed vocabulary above ("take a look at the fix PR", "eyes on the
 * fix"), which it passes. That vocabulary is the computable case; any wider reading of intent stays the composer's
 * judgement, because every verb added past it also fires on a plan that merely names "the fix".
 *
 * Pure: text in, the offending phrase out.
 */

/**
 * Leading characters that are not words — an emoji, a bullet, punctuation, whitespace — skipped before the opening. A
 * keycap emoji (`1️⃣`, `#️⃣`) is a digit, `#` or `*` followed by U+20E3, so it is skipped as one emoji rather than
 * left behind as the digit it starts with.
 */
const NOT_A_WORD = /^(?:[\p{N}#*]️?⃣|[^\p{L}\p{N}#])+/u;

/** A markdown heading's marker (`## `), which a `#NN` keeps but an opening never is. */
const HEADING_MARKER = /^#{1,6}\s+/u;

/** An opening that is a pull request — see the module header for each alternative. */
const OPENS_ON_PULL_REQUEST =
  /^(?:https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/(?:pull|compare|commit|tree)\/\S*|#\d{2,}\b|fix\s+(?:pr|pull\s+request|branch)\b|(?:(?:the|a|this|our|my|your)\s+)?(?:pr|pull\s+request)\s*#?\d{2,}\b(?!\s+of\s+\d))/iu;

/** An ask to approve, review, merge or land a fix, or to approve a pull request — anywhere in the opening. */
const FIX_ASK =
  /\b(?:approve|review|merge)\b[^.?!\n]{0,40}?\b(?:the|a|this|our|my|your)\s+fix\b|\bland\b[^.?!\n]{0,40}?\b(?:the|a|this|our|my|your)\s+fix\s+(?:pr|pull\s+request)\b|\breviewers?\s+(?:for|on)\s+(?:the|a|this|our|my|your)\s+fix\b|\bapprove\b[^.?!\n]{0,40}?(?:\b(?:pr|pull\s+request)\b(?!s)|https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+)/iu;

/**
 * The words that make an opening lead with a pull request instead of the discussion.
 *
 * @param text the opening a door is about to write — a headline, a question's lead, a message's first block
 * @returns the offending phrase as written, or `undefined` when the opening leads with something else
 */
export function pullRequestLead({ text }: { text: string }): string | undefined {
  const opening = text.replace(NOT_A_WORD, "").replace(HEADING_MARKER, "").replace(NOT_A_WORD, "");
  const opens = OPENS_ON_PULL_REQUEST.exec(opening);
  if (opens !== null) {
    return opens[0].trim();
  }
  const asks = FIX_ASK.exec(text);
  return asks === null ? undefined : asks[0].trim();
}

/**
 * The one sentence every door prints when {@link pullRequestLead} finds a phrase, so the reword asked for reads the
 * same wherever it is refused.
 *
 * @param phrase the offending words {@link pullRequestLead} returned
 * @returns the reason, starting lower-case so a door can prefix what it judged
 */
export function pullRequestLeadReason({ phrase }: { phrase: string }): string {
  return (
    `leads with a pull request ("${phrase}") instead of the discussion: open on what was noticed and its evidence ` +
    "(the screenshot, annotated, and its link) and the conversation to have, and put a PR, if there is one, below " +
    "the fold, because the PR is never the lead"
  );
}
