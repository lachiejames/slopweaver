/**
 * A react-now card's SUBJECT: whether its link points back at the briefing page itself, and how a card with
 * no page of its own names that absence.
 *
 * ## The defect, measured
 *
 * A card's subject url once pointed at `#react-now` on the artifact page the owner was already reading, so
 * clicking the link only led back to the same page. A link to the page being read has no point, so the
 * form refuses it.
 *
 * It was never one card: 53 of the 149 saved `form.json` files carry 78 such subjects between them, every
 * fragment one of `recent`, `react-now` or `react-now-me`. Reproduce the 78 from
 * `$SLOPWEAVER_HOME/supervisor-scratch` with
 * `grep -rhoE '"url": "[^"]+#(react-now|recent|react-now-me|alignment|your-list)"' --include form.json .`,
 * and the 53 by swapping `-rhoE` for `-rlE`.
 *
 * ## Why the test is the FRAGMENT and not the page's own url
 *
 * A form does not know the artifact it will be published as. `briefing render` takes no `--artifact`, and on
 * a first publish there is no id yet to compare against — so an exact "this url is my url" test has no input
 * unless one is invented, and an invented one would miss the first publish or block it.
 *
 * What it tests instead is the FIXED section ids a briefing page renders
 * ({@link FIXED_SECTION_IDS}) — `#react-now`, `#alignment`, `#recent` and their siblings. That criterion
 * stands on its own rather than as a proxy: a react-now block is a LIST OF CARDS, so a subject pointing at
 * one is not naming what its card is about whosever page it belongs to, and when it is this page — the
 * measured case, all 78 of them — it sends the reader to what they are already reading. An `anchor` run is the
 * form's own way to move within the page.
 *
 * ## What it deliberately does NOT catch
 *
 * A composer's own collapsed-section id. Two briefing pages can both carry a section called
 * `the-queue-saga`, so refusing that fragment would refuse a legitimate link to the OTHER page's section on
 * no evidence — the review that found this rejected an earlier criterion for exactly that. So a self-link
 * at a composer's own section passes, which is the honest failure direction: this misses a case rather than
 * taking the whole rendered briefing away from the owner over one that was fine.
 *
 * Pure: markup and a url in, a verdict out. No filesystem, no network.
 */
import type { BriefingCard } from "../outbound/briefing/types.js";
import { FIXED_SECTION_IDS } from "../outbound/briefing/types.js";

/** What a card's rendered subject line carries: its words, and its link when it has one. */
export interface RenderedCardSubject {
  readonly text: string;
  /** The subject's own page, absent on a `no page` subject. */
  readonly url: string | undefined;
}

/**
 * The words a card uses when its subject has no page of its own.
 *
 * @internal — the prefix {@link isNoPageSubjectText} tests and both refusals quote.
 */
export const NO_PAGE_PREFIX = "no page";

/** The subject line the renderer emits under a card's question, linked. */
const SUBJECT_LINKED = /<div class="bg">\s*<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/div>/;

/**
 * The same line with no link on it — what a `no page` subject renders as.
 *
 * Tempered-greedy rather than lazy, so `redos-check` passes it. MEASURED by a Codex review on hostile DIRECT
 * input — a string of repeated `<div class="bg">` prefixes with no close — at roughly 0.22/0.73/3.00/12.35 ms
 * for 100/200/400/800 prefixes, so it is quadratic in that shape. It is left as it is because nothing feeds
 * it that shape: every caller passes ONE card that `./cardSpans.ts`'s `extractCards` already read to its
 * own balanced close, which is what excludes an unclosed div. Reproduce by calling `renderedCardSubject`
 * directly with `'<div class="bg">'.repeat(n)`.
 */
const SUBJECT_PLAIN = /<div class="bg">((?:(?!<\/div>)[\s\S])*)<\/div>/;

/**
 * Every character reference the renderer itself emits into an href.
 *
 * `escapeAttribute` (`../outbound/briefing/render.ts`) writes exactly these four and no others: `&amp;` for
 * a literal `&`, as `?a=1&b=2` carries, and `&lt;`, `&gt;`, `&quot;` for the three characters that would
 * otherwise break out of a double-quoted attribute. All four are legitimate output, so the rule below must
 * remove them before it judges what is left — an eighth review pass caught the version that removed only
 * `&amp;` refusing a page the renderer had just produced, which is the one failure a gate over the owner's briefing
 * cannot afford.
 */
const RENDERED_REFERENCES = /&(?:amp|lt|gt|quot);/g;

/**
 * Any character reference at all, once the one the renderer emits has been removed.
 *
 * Seven Codex review passes walked this family, and the first six of them walked it one SPELLING at a time —
 * `&#35;`, `&#x23;`, `&num;`, the semicolonless `&#35`, and then `&sol;`, which is not a delimiter at all but
 * still makes the bytes and the resolved link disagree. Enumerating is a race the next spelling wins, so the
 * rule is the opposite of a list: strip the ones the renderer writes ({@link RENDERED_REFERENCES}), and
 * REFUSE on any `&` that remains. Every character reference starts with one — so this costs a page the
 * renderer produced nothing, and it closes every spelling,
 * including ones nobody has thought of, on the hand-written pages the page reader exists for.
 */
const ANY_REFERENCE = /&/;

/** `no page` at the very start, lowercase, and not the start of a longer word such as `no pages`. */
const NO_PAGE = /^no page\b/;

/**
 * Whether a subject's words declare that it has no page of its own.
 *
 * Case-sensitive and anchored: the card says `no page` in the reader's own lowercase voice, so `No page` and
 * `no pages` are both refused rather than quietly accepted as near-misses.
 *
 * @param text the subject's visible words
 * @returns whether the subject names the absence of a page
 */
export function isNoPageSubjectText({ text }: { text: string }): boolean {
  return NO_PAGE.test(text);
}

/**
 * Whether a rendered subject's href is written plainly, with no character reference a browser would decode
 * into something other than what the bytes say.
 *
 * The four references the renderer itself writes are removed first and do not count. See
 * {@link RENDERED_REFERENCES} and {@link ANY_REFERENCE} for why everything else is refused rather than
 * decoded.
 *
 * @param url the href as it appears in the rendered bytes
 * @returns whether a reader and a browser will resolve the same link
 */
export function isPlainSubjectUrl({ url }: { url: string }): boolean {
  return !ANY_REFERENCE.test(url.replace(RENDERED_REFERENCES, ""));
}

/**
 * The correction a subject link written with a character reference gets.
 *
 * @returns the refusal body, without a leading subject so each half can name its own path
 */
export function subjectEncodedLinkRefusal(): string {
  return (
    "carries an HTML character reference, so what a browser resolves is not what the link says — the way " +
    "`&#35;` and `&num;` spell a `#` that lands back on this page. Write the url plainly, or drop it, begin " +
    `the subject's text with \`${NO_PAGE_PREFIX}\`, and put the deciding detail in \`detail\`.`
  );
}

/** Every fixed briefing section id, as a set, so the test below is one lookup rather than a scan. */
const BRIEFING_SECTIONS: ReadonlySet<string> = new Set(FIXED_SECTION_IDS);

/**
 * The briefing section a subject url points at, when it points at one at all.
 *
 * Percent-decoding is deliberate and is the one bypass worth closing: `#react%2Dnow` and `#react-now` scroll
 * to the same heading, so a criterion reading raw bytes would pass the first. A malformed escape decodes to
 * nothing rather than throwing — this reads hand-written pages too, and a reader that throws on bad markup
 * has taken the check away rather than performed it.
 *
 * @param url the subject's link
 * @returns the section it points at, or `undefined` when it points at anything else
 */
export function briefingTargetOfSubjectUrl({ url }: { url: string }): string | undefined {
  const decoded = url.replace(RENDERED_REFERENCES, (whole) => (whole === "&amp;" ? "&" : whole));
  const hash = decoded.indexOf("#");
  if (hash === -1) {
    return undefined;
  }
  const raw = decoded.slice(hash + 1);
  let fragment = raw;
  try {
    fragment = decodeURIComponent(raw);
  } catch {
    fragment = raw;
  }
  return BRIEFING_SECTIONS.has(fragment) ? fragment : undefined;
}

/**
 * The correction a self-linking subject gets, shared by the form and the page reader so the two halves
 * cannot word the same refusal differently.
 *
 * @param target the anchor id the subject pointed at
 * @returns the refusal body, without a leading subject so each half can name its own path
 */
export function subjectSelfLinkRefusal({ target }: { target: string }): string {
  return (
    `points at a briefing page's own \`#${target}\` section, which is a block of cards rather than ` +
    "anything a card is about — and when it is this page, it sends you back to what you are already reading. " +
    "Use an `anchor` run to move you within this page; otherwise drop the url, begin the subject's text " +
    `with \`${NO_PAGE_PREFIX}\`, and put the deciding detail in \`detail\`.`
  );
}

/**
 * Whether a rendered subject's href is an absolute url — the same bar the form's own `z.url()` sets.
 *
 * This is the one place the two halves could drift, and it took three Codex review passes to find the whole
 * class rather than its members. `href=""`, `href="#"`, `href="#anything"`, `href="/path"` and a
 * protocol-relative `href="//host/path"` all resolve against the page the reader is ON, so every one of them
 * is the self-link with its evidence removed — and the form refuses each as `Invalid URL` while a reader
 * checking only for a fixed fragment let them through. Testing for ABSOLUTE closes them together, instead of
 * one shape per review round.
 *
 * @param url the href as it appears in the rendered bytes
 * @returns whether it names a page of its own
 */
export function isAbsoluteSubjectUrl({ url }: { url: string }): boolean {
  return URL.canParse(url);
}

/**
 * Whether one subject is legal on the `no page` rule: it has a page, or its words say it has none.
 *
 * @param subject the card's subject
 * @returns whether the subject declares itself either way
 */
export function subjectDeclaresItsPage({
  subject,
}: {
  subject: { readonly text: string; readonly url?: string | undefined };
}): boolean {
  return subject.url !== undefined || isNoPageSubjectText({ text: subject.text });
}

/**
 * What the form says when a url-less subject does not declare itself.
 *
 * Here rather than inline in `../outbound/briefing/schema.ts` for the same reason the walk below is: that
 * file sits against its own size ratchet, and a rule's words belong with its criterion.
 */
export const NO_PAGE_REQUIRED_MESSAGE =
  `a subject with no \`url\` must begin with \`${NO_PAGE_PREFIX}\`, so the card says outright that there is no ` +
  "page to open rather than leaving a title that looks like a link somebody dropped.";

/** What the form says when a card offers the owner nowhere to go for the detail that decides it. */
export const NOWHERE_TO_GO_MESSAGE =
  "a decision card offers nowhere to go for the detail that decides it — give it a `detail` fold or a " +
  `\`subject.url\`. A \`${NO_PAGE_PREFIX}\` subject names the absence of a page; it does not supply the ` +
  "detail. Four capped cells are not enough to answer from.";

/**
 * The correction a subject link that names no page of its own gets.
 *
 * @returns the refusal body, without a leading subject so each half can name its own path
 */
export function subjectRelativeLinkRefusal(): string {
  return (
    "carries a link with no page of its own — a browser resolves it against the page it is already on, " +
    `which is the self-link with nothing on it to see. Drop the url, begin the subject's text with ` +
    `\`${NO_PAGE_PREFIX}\`, and put the deciding detail in \`detail\`.`
  );
}

/**
 * The subject line one rendered card carries, if it carries one.
 *
 * Three states rather than two, because `../briefing/prPremise.ts` needs to tell them apart: a card with NO
 * subject falls back to the first pull-request link in its fold, while a card whose subject deliberately
 * says `no page` has already answered the question and must not have a cited pull request promoted into its
 * premise.
 *
 * @param cardHtml one card's markup, from its `div.need` open to its balanced close
 * @returns the subject's words and link, or `undefined` when the card renders no subject line
 */
export function renderedCardSubject({ cardHtml }: { cardHtml: string }): RenderedCardSubject | undefined {
  // Both groups are unconditional in their own pattern, so a match guarantees them — the assertions are the
  // honest spelling of that, rather than an empty-string coalesce that would invent a subject with no words.
  const linked = SUBJECT_LINKED.exec(cardHtml);
  if (linked !== null) {
    return { text: linked[2]!, url: linked[1]! };
  }
  const plain = SUBJECT_PLAIN.exec(cardHtml);
  if (plain !== null) {
    return { text: plain[1]!, url: undefined };
  }
  return undefined;
}

/** One card whose subject links back into a briefing page, named by where the form carries it. */
export interface SubjectSelfLinkIssue {
  /** The form path the issue sits at, ready for a Zod `addIssue`. */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Every react-now card whose `subject.url` points at a briefing page's own section.
 *
 * Lives here rather than inline in `../outbound/briefing/schema.ts` because that file crossed its own
 * size ratchet, and this is the seam: the criterion, its refusal and the walk that applies it are one idea.
 * It returns EVERY offender rather than the first, so a composer fixes them in one pass instead of one
 * publish at a time.
 *
 * @param meFacing the me-facing grouping's cards, in order
 * @param teamFacing the team-facing grouping's cards, in order
 * @returns one issue per offending card, team-facing first, each at its own form path
 */
export function subjectSelfLinkIssues({
  meFacing,
  teamFacing,
}: {
  meFacing: readonly BriefingCard[];
  teamFacing: readonly BriefingCard[];
}): readonly SubjectSelfLinkIssue[] {
  const groupings = [
    { cards: teamFacing, key: "teamFacing" },
    { cards: meFacing, key: "meFacing" },
  ] as const;
  return groupings.flatMap((grouping) =>
    grouping.cards.flatMap((card, index) => {
      const url = card.subject?.url;
      const target = url === undefined ? undefined : briefingTargetOfSubjectUrl({ url });
      if (target === undefined) {
        return [];
      }
      return [
        {
          message: `this card's \`subject.url\` ${subjectSelfLinkRefusal({ target })}`,
          path: ["reactNow", grouping.key, index, "subject", "url"],
        },
      ];
    }),
  );
}
