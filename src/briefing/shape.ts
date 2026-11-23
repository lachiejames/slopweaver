/**
 * The SHAPE half of the briefing gate — the rules the retired ranked-list page brought with it, read back
 * off the rendered bytes.
 *
 * A ranked list that talks mostly about old work leaves the owner unsure what to react to. What went wrong
 * can be useful, but it must not be more prominent than what the owner actually has to react to, and exact
 * timestamps for when the page was last refreshed and ready for review spare the owner asking whether the
 * artefact being read is up to date. Those rules became a gate on the ranked-list page, and the briefing's
 * react-now block absorbed that page's job, so the rules live here rather than dying with the page that
 * carried them.
 *
 * ## What harmonised, and the one rule that deliberately did not
 *
 * Three of them carry over unchanged in substance:
 *
 * - **react-now comes first, and nothing sits above it.** Checked as two things, because they fail
 *   differently: the react-now heading must be the first `<h2>` the page carries, and no card, row or fold
 *   may sit above it.
 * - **both instants are stated exactly**, in `../outbound/briefing/stamp.ts`'s own format. Not "a timestamp
 *   is present" — a page carrying only its render instant is exactly the page the owner stops trusting, because
 *   it looks current while the sweep behind it may be hours old.
 * - **the groupings are ordered and labelled.** Team-facing renders before me-facing, and each carries its
 *   own heading, because which grouping a card sits in is what tells the owner who ELSE sees the work
 *   ({@link BriefingReactNow}). It says nothing about permission (`AGENTS.md` rule 10); the order is
 *   audience, and readiness is what decides reading order.
 *
 * The fourth did NOT harmonise, and saying so is the point of writing it down. The ranked list required its
 * retrospective region to put ZERO words above the fold. The briefing's equivalent region is `done since you
 * last looked`, and `./caps.ts`'s `PAGE_UNFOLDED_BLOCKS_MAX` deliberately leaves room for five of the newest
 * landings to stay visible — a measured allowance, not an oversight. Two gates
 * disagreeing about the same region is the failure this repository keeps hitting, so the briefing's own
 * number wins and the ranked list's is not carried over. What answers the old-work complaint here is the
 * ORDER rule above: with react-now first, old work is below the thing the owner has to react to whether or
 * not it is folded.
 *
 * Pure: HTML in, defects out. `./check.ts` runs this beside the budget halves the page already owns.
 */
import { MELBOURNE_STAMP } from "../outbound/briefing/stamp.js";
import { ME_FACING_ID, TEAM_FACING_ID } from "../outbound/briefing/types.js";

/** Which shape rule the page broke. */
type BriefingShapeRule =
  "no-react-now-block" | "react-now-not-first" | "above-the-cards" | "missing-stamps" | "groupings-out-of-order";

/** One shape defect the page carries. */
interface BriefingShapeDefect {
  readonly rule: BriefingShapeRule;
  readonly reason: string;
}

/** What checking one briefing page's shape found. */
export interface BriefingShapeCheck {
  /** Whether the eyebrow states both instants, exactly. */
  readonly stamped: boolean;
  readonly defects: readonly BriefingShapeDefect[];
}

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const H2_OPEN = /<h2\b[^>]*>/i;

/**
 * The react-now heading, found by its own TEXT rather than by its `id`.
 *
 * Byte-for-byte the pattern `./reactNowCard.ts` finds the block with, and matched here for its reason: a
 * page rendered before section ids existed carries a bare `<h2>react now</h2>`, and this file is part of the
 * READER — it has to judge the hand-written pages that already exist, not only what `briefing render` emits.
 * An id-anchored search would have reported every one of them as carrying no react-now block at all.
 */
const REACT_NOW_HEADING = /<h2[^>]*>\s*react now\s*<\/h2>/i;

/** The blocks that may never sit above the cards: a card, a row of the owner's, or anything already folded away. */
const BLOCK_ABOVE = /<div class="(?:need|mine)"|<details\b/i;

/** The eyebrow's contract: both instants, both exact, in the order the page states them. */
const BOTH_STAMPS = new RegExp(`last refreshed ${MELBOURNE_STAMP.source} · ready for review ${MELBOURNE_STAMP.source}`);

/** Where the react-now heading opens, or -1 when the page carries none. */
function reactNowIndex({ html }: { html: string }): number {
  return html.search(REACT_NOW_HEADING);
}

/** Where the first `<h2>` on the page opens, or -1 when it carries none. */
function firstHeadingIndex({ html }: { html: string }): number {
  return html.search(H2_OPEN);
}

/** Every defect that says the cards are not first: no block at all, a heading ahead of it, or a block above. */
function orderingDefects({ html }: { html: string }): readonly BriefingShapeDefect[] {
  const index = reactNowIndex({ html });
  if (index < 0) {
    return [
      {
        reason:
          "the page carries no `<h2>react now</h2>` block, so nothing on it is marked as the thing you are " +
          "meant to react to. Render it through `slopweaver briefing render`.",
        rule: "no-react-now-block",
      },
    ];
  }
  const defects: BriefingShapeDefect[] = [];
  if (firstHeadingIndex({ html }) !== index) {
    defects.push({
      reason:
        "another section heading opens above the react-now block. What the owner is meant to react to comes first; " +
        "the owner's list, what landed and everything else is below it.",
      rule: "react-now-not-first",
    });
  }
  if (BLOCK_ABOVE.test(html.slice(0, index))) {
    defects.push({
      reason:
        "a card, a row or a fold sits above the react-now block. Nothing goes between the eyebrow and what " +
        "the owner is meant to react to — move it below.",
      rule: "above-the-cards",
    });
  }
  return defects;
}

/**
 * At most one defect, when the me-facing grouping renders ahead of the team-facing one.
 *
 * A page carrying only one grouping is correct however that grouping is labelled: the rule is about ORDER,
 * and one heading has no order to get wrong. A page carrying neither is the honest empty state.
 */
function groupingDefects({ html }: { html: string }): readonly BriefingShapeDefect[] {
  const team = html.search(new RegExp(`<h3[^>]*\\sid="${TEAM_FACING_ID}"`, "i"));
  const mine = html.search(new RegExp(`<h3[^>]*\\sid="${ME_FACING_ID}"`, "i"));
  if (team < 0 || mine < 0 || team < mine) {
    return [];
  }
  return [
    {
      reason:
        "the me-facing grouping renders above the team-facing one. Team-facing comes first: those are the " +
        "cards a colleague is on the other end of.",
      rule: "groupings-out-of-order",
    },
  ];
}

/**
 * Check one fleet-briefing page's shape: the cards first, both instants stated, the groupings in order.
 *
 * @param html the whole artifact file
 * @returns whether the page is stamped, and one defect per rule broken
 */
export function checkBriefingShape({ html }: { html: string }): BriefingShapeCheck {
  const page = html.replace(STYLE_OR_SCRIPT, " ");
  // Runs of whitespace collapse before the eyebrow is matched, because this is the READER's half: the
  // renderer emits that line whole, and a hand-written page — or one a formatter has wrapped — carries the
  // same words across a line break. Refusing that would be refusing the whitespace rather than the claim.
  const stamped = BOTH_STAMPS.test(page.replace(/\s+/g, " "));
  const defects = [...orderingDefects({ html: page }), ...groupingDefects({ html: page })];
  if (!stamped) {
    defects.push({
      reason:
        "the eyebrow does not state both instants exactly, as `last refreshed <stamp> · ready for review " +
        "<stamp>`. A page that cannot say how fresh it is costs the owner a question every time it is read.",
      rule: "missing-stamps",
    });
  }
  return { defects, stamped };
}
