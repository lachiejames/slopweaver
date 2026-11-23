/**
 * The ONE-INDEX half of the briefing gate: the owner's own list, the artifacts the page sends them to, and every
 * in-page anchor between them.
 *
 * ## Two artifact bands, two counts
 *
 * `p.await` is the STANDING band — a handful of durable surfaces somebody chose to put on the page — and it
 * is capped at three. `p.ranked` is the react-now index of every page a session left open on the owner, capped at
 * `OPEN_ARTIFACTS_MAX_ITEMS` instead. One band under one cap hides the pile: fifteen open pages against a cap
 * of three did not curate it, it hid twelve of
 * it. A ranked, validity-marked index is the opposite of a link farm, so it does not share the link farm's
 * bound.
 *
 * The owner wants one place to look, and the answer is one VIEW over the existing
 * registers rather than one merged register. That makes the page bigger by two sections, so each arrives with
 * its own budget — `../outbound/briefing/schema.ts` refuses a FORM that breaks one, and this refuses a page
 * that broke one however it was written. Same split as every other rule in this gate, and for the same
 * reason: the schema cannot read a page a session hand-wrote or an older render produced.
 *
 * ## The anchor rule is the one only a PAGE can check
 *
 * The form knows every section it is about to render, so it can refuse an anchor into a section that will not
 * exist. A page has already been rendered, and an `href="#todays-rulings"` pointing at no `id` is a link that
 * silently scrolls nowhere — the exact failure progressive disclosure inside one page introduces, and one no
 * reader would report because nothing appears to happen. So it is checked on both sides rather than trusted
 * to the writer.
 *
 * Pure: HTML in, defects out.
 */
import {
  AWAITING_MAX_ITEMS,
  OPEN_ARTIFACTS_MAX_ITEMS,
  YOUR_LIST_ABOVE_FOLD_MAX_WORDS,
  YOUR_LIST_MAX_ROWS,
} from "./caps.js";
import { aboveFoldText, balancedElement, unfolded, wordCount } from "./text.js";

/** Which one-index rule the page broke. */
type OneIndexRule = "your-list-rows" | "your-list-words" | "awaiting-items" | "ranked-items" | "dead-anchor";

/** One one-index defect the page carries. */
interface OneIndexDefect {
  readonly rule: OneIndexRule;
  readonly reason: string;
}

/** What checking one artifact's one-index sections found. */
export interface OneIndexCheck {
  /** How many rows of the owner's own list the page carries. */
  readonly yourListRows: number;
  /** How many words those rows put above the fold. */
  readonly yourListWords: number;
  /** How many other artifacts the page sends the owner to from the unranked standing band. */
  readonly awaitingItems: number;
  /** How many open pages the ranked react-now index carries. */
  readonly rankedItems: number;
  readonly defects: readonly OneIndexDefect[];
}

const MINE_DIV_OPEN = /<div class="mine"[^>]*>/g;
const AWAIT_OPEN = /<p class="await"[^>]*>/g;
const RANKED_OPEN = /<p class="ranked"[^>]*>/g;
const ELEMENT_ID = /\sid="(?<id>[^"]*)"/g;
const FRAGMENT_HREF = /<a href="#(?<target>[^"]*)"/g;
const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Every `div.mine` row on the page, each read to its balanced close. */
function yourRows({ html }: { html: string }): readonly string[] {
  const rows: string[] = [];
  for (const open of html.matchAll(MINE_DIV_OPEN)) {
    const element = balancedElement({ html, start: open.index, tag: "div" });
    if (element !== undefined) {
      rows.push(element);
    }
  }
  return rows;
}

/** Every `id` the page defines, which is the set an in-page anchor may point into. */
function pageIds({ html }: { html: string }): ReadonlySet<string> {
  return new Set(
    [...html.matchAll(ELEMENT_ID)].flatMap((match) => (match.groups?.["id"] === undefined ? [] : [match.groups["id"]])),
  );
}

/** Every in-page anchor target the page carries, duplicates included. */
function anchorTargets({ html }: { html: string }): readonly string[] {
  return [...html.matchAll(FRAGMENT_HREF)].flatMap((match) =>
    match.groups?.["target"] === undefined ? [] : [match.groups["target"]],
  );
}

/** At most one defect, naming every target the page carries no `id` for. */
function deadAnchorDefects({ html }: { html: string }): readonly OneIndexDefect[] {
  const ids = pageIds({ html });
  const dead = [...new Set(anchorTargets({ html }).filter((target) => !ids.has(target)))].toSorted();
  if (dead.length === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(dead.length)} in-page anchor target(s) name no element on this page: ${dead.map((target) => `#${target}`).join(", ")}. ` +
        "A link that scrolls nowhere reads as a page that ignored the click — give the section an `id`, or " +
        "point the anchor at one that exists.",
      rule: "dead-anchor",
    },
  ];
}

/**
 * Check one fleet-briefing artifact's one-index sections against their own budgets.
 *
 * @param html the whole artifact file
 * @returns the three counts and one defect per budget broken
 */
export function checkOneIndex({ html }: { html: string }): OneIndexCheck {
  const page = html.replace(STYLE_OR_SCRIPT, " ");
  const rows = yourRows({ html: page });
  const yourListWords = rows.reduce((total, row) => total + wordCount({ text: aboveFoldText({ html: row }) }), 0);
  const awaitingItems = [...unfolded({ html: page }).matchAll(AWAIT_OPEN)].length;
  const rankedItems = [...unfolded({ html: page }).matchAll(RANKED_OPEN)].length;
  const defects: OneIndexDefect[] = [];
  if (rows.length > YOUR_LIST_MAX_ROWS) {
    defects.push({
      reason:
        `your list carries ${String(rows.length)} rows, over the cap of ${String(YOUR_LIST_MAX_ROWS)}. ` +
        "Show fewer, and state the count it is not showing rather than dropping them silently.",
      rule: "your-list-rows",
    });
  }
  if (yourListWords > YOUR_LIST_ABOVE_FOLD_MAX_WORDS) {
    defects.push({
      reason:
        `your list puts ${String(yourListWords)} words above the fold, over the cap of ` +
        `${String(YOUR_LIST_ABOVE_FOLD_MAX_WORDS)}. Every other row on the page is competing with these.`,
      rule: "your-list-words",
    });
  }
  if (awaitingItems > AWAITING_MAX_ITEMS) {
    defects.push({
      reason:
        `the page sends you to ${String(awaitingItems)} other artifacts, over the cap of ` +
        `${String(AWAITING_MAX_ITEMS)}. A one-index page that lists every surface is an index of indexes.`,
      rule: "awaiting-items",
    });
  }
  if (rankedItems > OPEN_ARTIFACTS_MAX_ITEMS) {
    defects.push({
      reason:
        `the ranked open-artifact index carries ${String(rankedItems)} pages, over the cap of ` +
        `${String(OPEN_ARTIFACTS_MAX_ITEMS)}. An index longer than the card list it sits above has stopped ` +
        "being an index of what to react to next.",
      rule: "ranked-items",
    });
  }
  return {
    awaitingItems,
    defects: [...defects, ...deadAnchorDefects({ html: page })],
    rankedItems,
    yourListRows: rows.length,
    yourListWords,
  };
}
