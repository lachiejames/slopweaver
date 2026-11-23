/**
 * Pure text helpers every briefing check shares: tags off, the fold applied, words and sentences counted.
 *
 * These sit in their own module because BOTH halves of the gate need them and they need them to agree. A
 * card's per-field cap and the page's total budget are the same measurement at two scales, so counting a
 * word one way in `./reactNowCard.ts` and another way in `./pageBudget.ts` would let a page pass whose
 * cards all failed, or the reverse.
 *
 * ## The fold is `<details>`, and it is what makes a cap fair
 *
 * Rule 7 caps what appears ABOVE the fold and says everything else is collapsed behind something the reader
 * chooses to expand. On this surface that something is a `<details>` element, so every cap MEASURED HERE
 * measures the text with every `<details>` body removed. A 500-word `what` is not refused for being 500
 * words; it is refused for putting 500 words where a reader cannot avoid them.
 *
 * ## No cap anywhere counts folded text
 *
 * The form does not hold a composed fold's paragraphs and list items to word and sentence caps of their own:
 * the owner reads a fold by choosing to open it, so a cap there refuses prose the owner opted into. A fold's
 * rules are the schema's (`../outbound/briefing/vocabulary.ts`'s `foldSchema`), never this module's.
 *
 * The asymmetry is deliberate rather than an omission to tidy up. This module reads rendered HTML, where a
 * fold a supervisor seat composed and a fold projecting the owner's own recorded question are the same
 * `<details>` element; a rule applied here would reach the owner's own words, which is the one thing a projection
 * must never have rewritten (`vocabulary.ts`'s `quotedFoldSchema` carries the same reasoning for the
 * bare-key-link rule). The form knows which schema built each fold and this file cannot, so anything about
 * what a fold CONTAINS is a schema rule, and fold-free measurement stays what these functions do.
 *
 * ## One required field now DEPENDS on that, so read this before moving the boundary
 *
 * `../outbound/briefing/types.ts`'s `BriefingAlignment.intake` is required and uncapped, and the only reason
 * it is safe to be uncapped is that the renderer puts it inside a `<details>` and `./alignment.ts` measures
 * `aboveFoldText`. That is a dependency on this contract, not a coincidence of it. A change that made any cap
 * count folded text would push a 44-word generated sentence against a 55-word cap it was never sized for.
 *
 * The failure would be loud but MISNAMED, which is the part worth knowing in advance:
 * `../__tests__/unit/briefing/generatedAlignment.test.ts` would report it as "the alignment line runs to N
 * words, over the cap", never as "a cap started counting folds". So the warning lives here, in the file
 * somebody has to edit to cause it, rather than only in the file that would fail.
 */

import { absentAs } from "#lib/absent.js";
// The ONE briefing import this file carries beside the absent helpers, a marker rather than a behaviour:
// `withoutQuoted` finds a fold by the role the renderer stamps on it, and a second spelling of that string
// here would be the two halves free to drift about which folds hold the owner's words.
import { QUOTED_NOTE_ID } from "../outbound/briefing/types.js";

// The splitter lives in a leaf the site lane can import without the rest of `src/`; its callers still read it here.
export { sentenceCount, splitSentences } from "./sentences.js";

/** An opening or closing tag of one named element, for the balanced scan below. */
function elementTags({ tag }: { tag: string }): RegExp {
  return new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
}

/** The handful of HTML entities this markup actually uses. */
const ENTITIES: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&mdash;": "—",
  "&nbsp;": " ",
  "&quot;": '"',
};

const ENTITY = /&amp;|&#39;|&quot;|&lt;|&gt;|&mdash;|&nbsp;/g;

/** The residue a truncating cut leaves — an ellipsis with nothing after it, in either spelling. */
const TRAILING_ELLIPSIS = /(?:…|\.\.\.)$/;

/** A ticket or pull-request key with nothing beside it: `#<n>`, `owner/repo#<n>`, `SUP-123`. */
const BARE_KEY = /^(?:[\w.-]+\/[\w.-]+#\d{1,7}|#\d{1,7}|[A-Z]{2,6}-\d{1,6})$/;

/**
 * Strip every tag, repeating the pass until none remain. A single pass over `<scr<script>ipt>` leaves
 * `<script>` behind — the nested delimiters only become adjacent once the inner tag is gone — so one
 * pass is an incomplete sanitization even though every caller here only reads the result as inert text.
 */
function stripTags({ html }: { html: string }): string {
  let current = html;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, " ");
  } while (current !== previous);
  return current;
}

/**
 * One HTML region as the plain text a reader sees: tags stripped, entities decoded, whitespace collapsed.
 *
 * @param html the region's markup
 * @returns the inert text
 */
export function plainText({ html }: { html: string }): string {
  return stripTags({ html })
    .replace(ENTITY, (entity) => absentAs({ value: ENTITIES[entity], whenAbsent: entity }))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The element of `tag` starting at `start`, matched by COUNTING nested opens and closes.
 *
 * A non-greedy regex cannot do this, and the difference is not academic: `<details>a<details>b</details>c
 * </details>` closes at the first `</details>`, so a lazy match ends after `b` and leaves `c</details>`
 * behind as text a caller then reads as being above the fold. That is exactly what a fleet briefing does —
 * a folded history section whose entries carry folds of their own — and the symptom was a page reporting
 * 149 unfolded blocks and 13,155 words above the fold when every one of them sat inside a collapsed
 * section. Reproduce with `slopweaver briefing check` over any page carrying a fold inside a fold.
 *
 * @param html the markup to scan
 * @param start the index of the element's opening tag
 * @param tag the element name
 * @returns the element and everything inside it, or undefined when it never closes
 */
export function balancedElement({
  html,
  start,
  tag,
}: {
  html: string;
  start: number;
  tag: string;
}): string | undefined {
  const tags = elementTags({ tag });
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return html.slice(start, match.index + match[0].length);
    }
  }
  return undefined;
}

/** Every index at which an opening tag of `tag` appears. */
function openIndexes({ html, tag }: { html: string; tag: string }): readonly number[] {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  return [...html.matchAll(open)].map((match) => match.index);
}

/**
 * One HTML region with every QUOTED fold removed — the folds holding the owner's own recorded words.
 *
 * The three whole-page prose rules that read inside a fold — `./pageBudget.ts`'s packed-enumeration and
 * truncated-ellipsis budgets, and `./bareRef.ts`'s scan — are each worded as an instruction to a composer
 * ("use a real list", "write the whole thing", "put the title beside the key"). None of them is an act
 * available over text nobody here wrote, so running them across a projection of the owner's own turns would
 * refuse the whole briefing over how the OWNER punctuated a sentence, with no fix short of rewriting them.
 *
 * MEASURED over the live tick ledger's 895 distinct recorded turns (repro:
 * `jq -r '.ownerTurns.turns[]?.text' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl" | sort -u`):
 * one ends in an ellipsis and one packs three inline enumerators. The writer's side scopes the same two
 * rules out of `../outbound/briefing/vocabulary.ts`'s `quotedLine`, so the two halves agree.
 *
 * It is a fold's own `data-section` role rather than a region, for the reason
 * `./sectionQualityHtml.ts` reads the owner's list by role: a reader of the rendered bytes has no other way to tell
 * whose words a fold holds. Everything a projection COMPOSED around the owner's words — the note's headline, the
 * fold's own summary — stays, so this exempts the quotation and nothing else.
 *
 * @param html the region's markup
 * @returns the markup with every quoted fold taken out
 */
export function withoutQuoted({ html }: { html: string }): string {
  let out = "";
  let cursor = 0;
  for (const start of openIndexes({ html, tag: "details" })) {
    if (start < cursor || !QUOTED_FOLD_OPEN.test(html.slice(start, html.indexOf(">", start) + 1))) {
      continue;
    }
    const element = balancedElement({ html, start, tag: "details" });
    out += `${html.slice(cursor, start)} `;
    cursor = element === undefined ? html.length : start + element.length;
  }
  return out + html.slice(cursor);
}

/** The opening tag of a fold the renderer marked as holding the owner's own words. */
const QUOTED_FOLD_OPEN = new RegExp(`<details\\b[^>]*\\sdata-section="${QUOTED_NOTE_ID}"`, "i");

/**
 * One HTML region with every `<details>` element removed, so what remains is what a reader meets without
 * expanding anything.
 *
 * Removal walks the OUTERMOST folds only, because a fold inside a fold is already gone with its parent —
 * see {@link balancedElement} for the defect a lazy regex caused here.
 *
 * @param html the region's markup
 * @returns the markup above the fold
 */
export function unfolded({ html }: { html: string }): string {
  let out = "";
  let cursor = 0;
  for (const start of openIndexes({ html, tag: "details" })) {
    if (start < cursor) {
      continue;
    }
    const element = balancedElement({ html, start, tag: "details" });
    out += `${html.slice(cursor, start)} `;
    cursor = element === undefined ? html.length : start + element.length;
  }
  return out + html.slice(cursor);
}

/**
 * One HTML region's above-the-fold plain text: the fold applied, then the tags stripped.
 *
 * @param html the region's markup
 * @returns the text a reader cannot avoid reading
 */
export function aboveFoldText({ html }: { html: string }): string {
  return plainText({ html: unfolded({ html }) });
}

/**
 * How many words `text` carries.
 *
 * @param text plain text, already stripped of markup
 * @returns the word count
 */
export function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Whether `text` ends in an ellipsis with nothing after it — the residue a truncating cut leaves, in either
 * spelling. A page that never truncates has no honest use for one: real prose that trails off still leaves
 * nothing for a reader to recover, so this refuses the shape itself rather than trying to tell a deliberate
 * one from a cut one.
 *
 * @param text plain text, already stripped of markup
 * @returns true when the trimmed text ends in `…` or `...`
 */
export function endsInEllipsis({ text }: { text: string }): boolean {
  return TRAILING_ELLIPSIS.test(text.trim());
}

/**
 * Whether `text` is nothing but a ticket or pull-request key — `#<n>`, `owner/repo#<n>`, `SUP-123` — with no
 * title beside it. A reader who meets only the key has to open the link to know what it names.
 *
 * @param text the candidate link label
 * @returns true when the whole trimmed string is a bare key
 */
export function isBareKeyLabel({ text }: { text: string }): boolean {
  return BARE_KEY.test(text.trim());
}
