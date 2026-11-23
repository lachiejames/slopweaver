/**
 * The correction block's half of the briefing gate, read back off the RENDERED bytes.
 *
 * ## Why it is read back at all, when a schema already refused the form
 *
 * The same reason every other half of this gate exists: the form is one way onto this page and a
 * hand-written artifact is another. `./check.ts` is the reader for a page a session composed by hand, and a
 * block it could not judge would be a block the gate silently stopped covering the day somebody wrote one.
 * The two halves share their numbers through `./caps.ts`, so they cannot drift.
 *
 * ## The three rules, and why each is the one worth checking
 *
 * - **Every row carries a proposal id.** The id is what the owner SAYS BACK. "the second one, wrong" is not
 *   something `slopweaver knowledge answer` can take, and it stops meaning anything the moment the block
 *   re-renders in a different order. A row without one is a row the owner cannot answer, which makes the block
 *   decorative.
 * - **Every row offers all three marks.** The marks are `right`, `wrong` AND `partly`. A row
 *   offering two of them quietly forces a belief the fleet got half right into one of the wrong buckets,
 *   and `partly` is the arm that carries the owner's own wording — dropping it loses the correction, not just an
 *   option.
 * - **No more rows than the cap.** `./pageBudget.ts` counts this block's words but nothing counts its ROWS,
 *   and the queue this is fed from has 451 units behind it (`slopweaver knowledge voice --json`), so the
 *   block would quietly become the longest thing on a page whose whole design is that it is short.
 *
 * ## What it deliberately does NOT check
 *
 * It does not read the quote, the hold or the provenance line. All three are inside the fold, uncapped by
 * the fold rule, and a gate that measured them would be re-litigating a decision
 * `../outbound/briefing/ownerBeliefsSchema.ts` already records. It also cannot tell whether the claim is a
 * fair reading of what the owner said — that is the judgement the whole block exists to ASK the owner for, and a regular
 * expression that pretended to make it would be the thing this design refuses.
 *
 * Pure: HTML in, defects out.
 */
import { OWNER_BELIEFS_MAX_ROWS } from "./caps.js";
import { balancedElement } from "./text.js";

/**
 * Which rule the block broke.
 *
 * @internal — the shape {@link OwnerBeliefsDefect} carries; `./check.ts` reads the defect, never this type.
 */
export type OwnerBeliefsRule = "row-without-id" | "marks-incomplete" | "too-many-rows";

/**
 * One defect the correction block carries.
 *
 * @internal — reached through {@link OwnerBeliefsCheck}, which `./check.ts` names; no file imports it directly.
 */
export interface OwnerBeliefsDefect {
  readonly rule: OwnerBeliefsRule;
  readonly reason: string;
}

/** What checking one page's correction block found. */
export interface OwnerBeliefsCheck {
  /** How many beliefs the block renders. Zero when the page carries no block at all. */
  readonly rowsChecked: number;
  readonly defects: readonly OwnerBeliefsDefect[];
}

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The opening tag of one rendered belief. `.belief` is this block's own class — see
 * `../outbound/briefing/chrome.ts` for why it is not `.need`, `.mine`, `.ranked` or `.act`.
 *
 * Each row is then read to its BALANCED close rather than by a lazy regex, because every row contains a
 * `<details>` holding a `<div>` of its own — the exact shape `./text.ts`'s {@link balancedElement} exists
 * for, and the one a non-greedy match truncates at the first inner `</div>`.
 */
const BELIEF_ROW_OPEN = /<div class="belief">/g;

/** The `p-`-prefixed queue id on a row's visible line, which is what the owner's answer names. */
const BELIEF_ID = /<code>(p-[0-9a-f]{16})<\/code>/;

/** The three marks a row must offer, matched as the words beside their letters. */
const BELIEF_MARK_WORDS: readonly string[] = ["right", "wrong", "partly"];

/** What one rendered row says about itself: its proposal id, and which of the three marks it offers. */
interface RenderedBelief {
  readonly proposalId: string | undefined;
  readonly marks: number;
}

/** Every belief the page renders, in page order. */
function renderedBeliefs({ html }: { html: string }): readonly RenderedBelief[] {
  const beliefs: RenderedBelief[] = [];
  for (const open of html.matchAll(BELIEF_ROW_OPEN)) {
    const element = balancedElement({ html, start: open.index, tag: "div" });
    // An unclosed row is still a ROW the owner can see, so it is counted — with neither field read, which is what
    // makes the id and marks checks below report it rather than the count quietly dropping it.
    if (element === undefined) {
      beliefs.push({ marks: 0, proposalId: undefined });
      continue;
    }
    // Only the row's own line offers the marks; the fold below it is the owner's words, which may contain any of the
    // three as ordinary prose. Cutting at the fold is what keeps a quote saying "that's not right" from
    // counting as an offered mark.
    // A destructured default rather than an operator: `split` always yields a first element, and the
    // default is what says so to `noUncheckedIndexedAccess` without hiding a substitution.
    const [visible = element] = element.split("<details");
    beliefs.push({
      marks: BELIEF_MARK_WORDS.filter((word) => visible.includes(`</span> ${word}`)).length,
      proposalId: BELIEF_ID.exec(element)?.[1],
    });
  }
  return beliefs;
}

/** At most one defect, when a row renders without the id the owner's answer would have to name. */
function idDefects({ beliefs }: { beliefs: readonly RenderedBelief[] }): readonly OwnerBeliefsDefect[] {
  const missing = beliefs.filter((belief) => belief.proposalId === undefined).length;
  if (missing === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(missing)} belief(s) in the correction block render without their proposal id, so there is ` +
        "nothing for `slopweaver knowledge answer` to name when the owner marks one. Render the block through " +
        "`slopweaver briefing render --owner-beliefs`.",
      rule: "row-without-id",
    },
  ];
}

/** At most one defect, when a row offers fewer than all three of the owner's marks. */
function markDefects({ beliefs }: { beliefs: readonly RenderedBelief[] }): readonly OwnerBeliefsDefect[] {
  const short = beliefs.filter((belief) => belief.marks < BELIEF_MARK_WORDS.length).length;
  if (short === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(short)} belief(s) in the correction block offer fewer than all three of ` +
        `${BELIEF_MARK_WORDS.join(", ")}. All three are required, and \`partly\` is the arm that ` +
        "carries the owner's own wording — a row without it loses the correction, not just an option.",
      rule: "marks-incomplete",
    },
  ];
}

/** At most one defect, when the block shows more beliefs than the cap allows. */
function countDefects({ beliefs }: { beliefs: readonly RenderedBelief[] }): readonly OwnerBeliefsDefect[] {
  if (beliefs.length <= OWNER_BELIEFS_MAX_ROWS) {
    return [];
  }
  return [
    {
      reason:
        `the correction block renders ${String(beliefs.length)} beliefs, over the ` +
        `${String(OWNER_BELIEFS_MAX_ROWS)} this page shows. The queue keeps all of them — show the oldest ` +
        "open ones and let the block state how many it is not showing.",
      rule: "too-many-rows",
    },
  ];
}

/**
 * Check one fleet-briefing page's correction block.
 *
 * @param html the whole artifact file
 * @returns how many beliefs it renders, and one defect per rule broken
 */
export function checkOwnerBeliefs({ html }: { html: string }): OwnerBeliefsCheck {
  const beliefs = renderedBeliefs({ html: html.replace(STYLE_OR_SCRIPT, " ") });
  return {
    defects: [...idDefects({ beliefs }), ...markDefects({ beliefs }), ...countDefects({ beliefs })],
    rowsChecked: beliefs.length,
  };
}
