/**
 * A react-now card's subject may never be a MARKDOWN DOCUMENT — a finding reaches the owner as a rendered
 * page or not at all.
 *
 * ## The defect, measured
 *
 * A finding card's subject url was `file:///…/.slopweaver/handovers/<finding-slug>.md` — the finding's own
 * handover doc, opened raw in a browser tab. A markdown file in front of the owner is hard to react to; a
 * proper page to react to is the rule, because with the extra details in view the answer would not
 * necessarily fall into A, B or C.
 *
 * It was never one card. Reproduce from `$SLOPWEAVER_HOME/supervisor-scratch`:
 *
 * ```bash
 * grep -rlE 'file:///[^"]+handovers/[^"]+[.]md' --include='*.html' . | wc -l                      # 361 rendered briefings
 * grep -rhoE '<a href="file:///[^"]+handovers/[^"]+[.]md"' --include='*.html' . | sort -u | wc -l  # 15 distinct docs
 * grep -oE '"url": "file:///[^"]+handovers/[^"]+"' handoff-<n>/open-pages.json | wc -l           # 5 still live
 * ```
 *
 * (`[^"]+handovers` rather than `[^"]*` + `/handovers` in the commands, because a slash-star closes this
 * comment — the two spellings match the same lines.)
 *
 * Every one came through `open-pages.json`: a supervisor with a finding row and no page put the row's doc
 * where a page's address goes, and `./openPageCards.ts` copied it straight into the card's subject.
 *
 * ## The criterion is the DOCUMENT, not the directory
 *
 * The measured class is a handover doc, and a test for `/handovers/` would catch every measured case. It is
 * not the rule, because the reason is not the directory: a markdown file anywhere opens as raw text in a
 * browser, with the four things a decision needs — what was measured, why it matters, the candidate causes,
 * the options with their cost — buried in prose the owner has to read top to bottom. So the test is the url's PATH
 * ending in `.md`, lowercased, with query and fragment stripped by the URL parser first: `…/x.md#what` is
 * the same file. A url that does not parse is left to the other subject rules, which already refuse it.
 *
 * ## Where it bites, and why FOUR places
 *
 * The self-link rule (`./cardSubject.ts`) refuses at the form and at the rendered page;
 * this rule adds the `--open-artifacts` reader, because that is where the measured card actually came from.
 * A reader-level refusal at `./openArtifacts.ts`'s `decodeReading` covers both the ranked index band and the
 * projected card, and it names EVERY offending entry in one pass so a sweep fixes the document once. The
 * form's `superRefine` and `./reactNowCard.ts`'s `checkSubject` keep a hand-written form and a hand-written
 * page honest. That a refusal at the reader takes the next render red until the five live entries are
 * dropped or re-pointed is the intended act, not a side effect: a finding with no page has no business in
 * the open-pages document (`skills/handover/reference/one-board.md` § A finding is a row too).
 *
 * Pure: a url in, a verdict out. No filesystem, no network.
 */

import type { BriefingCard } from "../outbound/briefing/types.js";

/**
 * Whether a subject url names a markdown document.
 *
 * Scheme-agnostic on purpose: a `file:` handover doc is the measured case, but an `https:` raw-markdown link
 * is the same raw text in the same tab. A url the parser cannot read answers `false` — the absolute-url rule
 * in `./cardSubject.ts` owns that refusal, and two rules firing on one defect is a wall.
 *
 * @param url the subject's link
 * @returns whether the url's path ends in `.md`, ignoring case, query and fragment
 */
export function isMarkdownSubjectUrl({ url }: { url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  return new URL(url).pathname.toLowerCase().endsWith(".md");
}

/**
 * The four things a finding page carries, named once so every refusal quotes the same contract.
 *
 * @internal — quoted by {@link markdownSubjectRefusal} and by the reader's refusal in `./openArtifacts.ts`.
 */
export const FINDING_PAGE_CONTRACT =
  "what was measured, why it matters, the candidate causes, and the options with their cost";

/**
 * The correction a markdown-document subject gets, shared by the form, the reader and the page checker so
 * the three halves cannot drift on what they tell a composer to do.
 *
 * @returns the refusal body, without a leading subject so each caller can name its own path
 */
export function markdownSubjectRefusal(): string {
  return (
    "links a markdown document, which opens as raw text you have to read top to bottom rather than a page " +
    "you can react to. Publish the finding as a page — `slopweaver page publish <slug> " +
    `--page <fragment>.html --review <id>\` — carrying ${FINDING_PAGE_CONTRACT}, and link that page instead; or drop the ` +
    "card until the page exists."
  );
}

/** One card whose subject links a markdown document, named by where the form carries it. */
export interface MarkdownSubjectIssue {
  /** The form path the issue sits at, ready for a Zod `addIssue`. */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Every react-now card, in either grouping, whose `subject.url` names a markdown document.
 *
 * Both groupings rather than only me-facing, although a finding card is me-facing by construction: the owner is
 * the reader of every card on this page, and a team-facing card sending them to raw text is the same defect
 * with a different audience label. It returns EVERY offender so a composer fixes them in one pass.
 *
 * @param meFacing the me-facing grouping's cards, in order
 * @param teamFacing the team-facing grouping's cards, in order
 * @returns one issue per offending card, team-facing first, each at its own form path
 */
export function markdownSubjectIssues({
  meFacing,
  teamFacing,
}: {
  meFacing: readonly BriefingCard[];
  teamFacing: readonly BriefingCard[];
}): readonly MarkdownSubjectIssue[] {
  const groupings = [
    { cards: teamFacing, key: "teamFacing" },
    { cards: meFacing, key: "meFacing" },
  ] as const;
  return groupings.flatMap((grouping) =>
    grouping.cards.flatMap((card, index) => {
      const url = card.subject?.url;
      if (url === undefined || !isMarkdownSubjectUrl({ url })) {
        return [];
      }
      return [
        {
          message: `this card's \`subject.url\` ${markdownSubjectRefusal()}`,
          path: ["reactNow", grouping.key, index, "subject", "url"],
        },
      ];
    }),
  );
}
