/**
 * ONE CARD PER PAGE. A projected open-page card is dropped when a card already on the react-now block names
 * the same page, so a page a supervisor has already carded reaches the owner once rather than twice.
 *
 * ## What it cost
 *
 * The owner was asked twice about the same page (a reconnect card, a calendar page). The chair kept the
 * composed card and the `open-pages.json` entry in step by hand, one sweep at a time.
 *
 * MEASURED across `$SLOPWEAVER_HOME/supervisor-scratch`: of the 192 sweep directories holding both a live
 * `form.json` and a live `open-pages.json`, **14 composed react-now cards name a `subject.url` the same
 * sweep's document also carries as an entry** — five distinct pages. Reproduce from
 * `$SLOPWEAVER_HOME/supervisor-scratch`:
 *
 * ```bash
 * for d in handoff-*; do comm -12 \
 *   <(jq -r '.reactNow|(.meFacing+.teamFacing)[]|.subject.url//empty' "$d/form.json" 2>/dev/null | sort -u) \
 *   <(jq -r '.[].url//empty' "$d/open-pages.json" 2>/dev/null | sort -u) | sed "s|^|$d |"; done
 * ```
 *
 * **Say what that scan does NOT prove.** Every address it returns is a `claude.ai` artifact url, and
 * `./localCopySubject.ts` refuses one, so replaying those exact sweeps projects no card at all and folds
 * nothing. They measure the SHAPE — a composer and a document naming one
 * page — not a duplicate today's code would still render. The live surface is the 877 `file://` entries the
 * same scratch holds, any one of which becomes a card. `src/__tests__/unit/cli/briefingRender.test.ts` § "briefing render
 * --open-page-cards" is what proves the fold end to end on one.
 *
 * ## Why this is a FOLD and never a refusal
 *
 * `skills/supervisor/reference/open-page-cards.md` § "The flag is opt-in" settled the direction already: the
 * owner's page going dark mid-reaction is worse than the thing the refusal would be protecting them from, and a
 * duplicate card is by definition recoverable. So the second card simply does not appear, and the run SAYS
 * so — silence is how a `detail` came to be droppable for eleven days
 * (`./openPageEntry.ts`'s `decodeDetail` carries what that cost).
 *
 * ## Why the COMPOSED card wins, untouched
 *
 * "Fold into that card" means the projection yields nothing, never that its prose is merged into the card
 * the chair wrote. A merge would put sentences on the owner's card that no composer authored, which is the class of
 * defect every `injectProjections` refusal in `../cli/commands/briefing/renderCore.ts` exists to prevent.
 * The ranked band keeps the folded page's row either way: `./cardPremise.ts`'s `stillAsks` already drops a
 * card while `skills/supervisor/reference/one-index.md` deliberately keeps the row. This removes a CARD,
 * never an index row.
 *
 * ## Why one card per url is not a rule over COMPOSED cards
 *
 * One sweep's `form.json` carries FOUR me-facing cards whose subject is the same page url — four board
 * rows, one page listing all of them. That shape is legitimate and shipped, so the criterion can only ever
 * drop a PROJECTED card. A composer is never refused for carding one page twice.
 *
 * ## Exact string equality, deliberately
 *
 * Both addresses are written by the same hand into the same home: `slopweaver briefing card` writes the
 * entry's `url` and the composer pastes that address into the card's subject. A normaliser over trailing
 * slashes, case or fragments would be a criterion nobody has measured, and it would fold
 * `…/index.html#options-a` into `…/index.html#options-b`, which are two genuinely different subjects. If a
 * near-miss ever reaches the owner, the fix is the document, not a looser comparison here.
 *
 * ## The composed card wins, but may not contradict its page's marks
 *
 * The fold never checks what the composed card says. `./composedCardDrift.ts` does, for EVERY composed card
 * naming a marked page, folded here or not.
 *
 * Pure: a react-now block and the projected cards in, the kept cards and what was folded out.
 */

import { isRecord } from "../lib/parsers.js";
import type { BriefingCard } from "../outbound/briefing/types.js";

/** One page whose projected card was folded away, as the run's own diagnostic names it. */
export interface FoldedPage {
  /** The page as the owner would recognise it — the projected card's subject text, which is the entry's `label`. */
  readonly label: string;
  readonly url: string;
}

/** What {@link foldCardedPages} answers: the cards to append, and the pages that no longer need one. */
export interface OpenPageFold {
  readonly cards: readonly BriefingCard[];
  readonly folded: readonly FoldedPage[];
}

/** The two groupings a react-now block carries cards in, in the order the page renders them. */
const GROUPINGS = ["teamFacing", "meFacing"] as const;

/**
 * The page one UNVALIDATED card names, or nothing when it names none.
 *
 * Unvalidated on purpose: this runs inside `injectProjections`, which is upstream of the schema, and a form
 * that will be refused a moment later must not make the fold throw on the way there. A card with no subject,
 * or the `no page` subject `../outbound/briefing/subjectForm.ts` allows, names no page and answers nothing.
 *
 * @param card one member of a react-now grouping, whatever a composer wrote there
 * @returns the `subject.url` it carries, or `undefined`
 */
function composedCardUrl({ card }: { card: unknown }): string | undefined {
  const subject = isRecord(card) ? card["subject"] : undefined;
  const url = isRecord(subject) ? subject["url"] : undefined;
  if (typeof url === "string" && url.length > 0) {
    return url;
  }
  return undefined;
}

/**
 * Every page the composed block already cards.
 *
 * Both groupings count — a page carded team-facing and projected me-facing is still two cards on one page.
 *
 * @param block the form's `reactNow` value, whatever a composer wrote there
 * @returns every `subject.url` already on the block
 */
function cardedPageUrls({ block }: { block: unknown }): ReadonlySet<string> {
  const urls = new Set<string>();
  if (!isRecord(block)) {
    return urls;
  }
  for (const grouping of GROUPINGS) {
    const cards = block[grouping];
    if (!Array.isArray(cards)) {
      continue;
    }
    for (const url of cards.map((card) => composedCardUrl({ card }))) {
      if (url !== undefined) {
        urls.add(url);
      }
    }
  }
  return urls;
}

/**
 * Drop every projected card whose page is already carded, and say which pages those were.
 *
 * A page carded by an EARLIER projected card folds on the same rule, which is what makes this one criterion
 * rather than two: `slopweaver briefing card` refuses a url an entry already names
 * (`./openPageRow.ts`), but `./openArtifacts.ts` carries no dedupe at all, so a hand-edited
 * `open-pages.json` holding one url twice reaches the projection with two ranked rows behind it.
 *
 * @param block the form's `reactNow` value, carrying whatever the composer and `--open-prs` already put there
 * @param cards the projected open-page cards, in the order `./openArtifacts.ts` ranked them
 * @returns the cards still worth appending, and one {@link FoldedPage} per card dropped
 */
export function foldCardedPages({ block, cards }: { block: unknown; cards: readonly BriefingCard[] }): OpenPageFold {
  const carded = new Set(cardedPageUrls({ block }));
  const kept: BriefingCard[] = [];
  const folded: FoldedPage[] = [];
  for (const card of cards) {
    // The SUBJECT is bound once and branched on, so the `text` a fold reports comes from the same value the
    // url did. A `??` back to the url when there is no text would be exactly the silent substitution
    // `no-silent-fallback` bans (`.claude/rules/typescript-patterns.md`).
    const subject = card.subject;
    if (subject?.url === undefined) {
      kept.push(card);
      continue;
    }
    const url = subject.url;
    if (carded.has(url)) {
      folded.push({ label: subject.text, url });
      continue;
    }
    carded.add(url);
    kept.push(card);
  }
  return { cards: kept, folded };
}

/**
 * The diagnostics naming every page whose second card was folded away.
 *
 * One line per page rather than a count, for `../cli/commands/briefing/renderDiagnostics.ts`'s `heldBackLines`'
 * reason: the operator's next question is always which one. Nothing at all when nothing folded, so a quiet
 * render prints nothing it does not mean.
 *
 * @param folded what the fold removed
 * @returns the lines to print as diagnostics, empty when every projected card was kept
 */
export function foldedPageLines({ folded }: { folded: readonly FoldedPage[] }): readonly string[] {
  if (folded.length === 0) {
    return [];
  }
  return [
    `--open-page-cards folded ${String(folded.length)} page(s) the react-now block already cards, ` +
      "so each reaches the owner once:",
    ...folded.map((page) => `  ${page.label}: ${page.url}`),
  ];
}
