/**
 * The autonomy ledger's half of the briefing gate, read back off the RENDERED bytes.
 *
 * ## Why it is read back at all, when a schema already refused the form
 *
 * The same reason every other half of this gate exists: the form is one way onto this page and a hand-written
 * artifact is another. `./check.ts` is the reader for a page a session composed by hand, and a section it
 * could not judge would be a section the gate silently stopped covering the day somebody wrote one. The two
 * halves share their numbers through `./caps.ts`, so they cannot drift.
 *
 * ## The three rules, and why each is the one worth checking
 *
 * - **Every row carries an act id.** The id is what the owner NAMES when giving a steer — "the enqueue one" is not
 *   something `slopweaver autonomy steer` can take. A row without one is a row the owner cannot react to, which
 *   makes the whole section decorative.
 * - **Newest first.** The owner asked for it, and it is the property a reader cannot verify by
 *   looking: two stamps three seconds apart read the same at a glance.
 * - **No more rows than the cap.** `./pageBudget.ts` counts this section's words but nothing else counts its
 *   ROWS, and a busy morning is exactly when the section would quietly become the longest thing on a page
 *   whose whole design is that it is short.
 *
 * ## What it deliberately does NOT check
 *
 * It does not read `why`, `witness` or the owner's steer. All three are inside the fold, uncapped by the
 * fold ruling, and a gate that measured them would be re-litigating a decision `../outbound/briefing/schema.ts`
 * already records. It also cannot tell whether a row is TRUE — the witness is what makes an act checkable,
 * and checking it means opening the link, which is the owner's job and not a regular expression's.
 *
 * Pure: HTML in, defects out.
 */
import { AUTONOMY_MAX_ROWS } from "./caps.js";
import { balancedElement } from "./text.js";

/**
 * Which rule the section broke.
 *
 * @internal — the shape {@link AutonomyCheckDefect} carries; `./check.ts` reads the defect, never this type.
 */
export type AutonomyCheckRule = "row-without-id" | "out-of-order" | "too-many-rows";

/**
 * One defect the autonomy ledger section carries.
 *
 * @internal — reached through {@link AutonomyCheck}, which `./check.ts` names; no file imports it directly.
 */
export interface AutonomyCheckDefect {
  readonly rule: AutonomyCheckRule;
  readonly reason: string;
}

/** What checking one page's autonomy ledger found. */
export interface AutonomyCheck {
  /** How many acts the section renders. Zero when the page carries no section at all. */
  readonly rowsChecked: number;
  readonly defects: readonly AutonomyCheckDefect[];
}

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The opening tag of one rendered act. `.act` is this section's own class — see
 * `../outbound/briefing/chrome.ts` for why it is not `.need`, `.mine` or `.ranked`.
 *
 * Each row is then read to its BALANCED close rather than by a lazy regex, because every row contains a
 * `<details>` holding a `<div>` of its own — the exact shape `./text.ts`'s {@link balancedElement} exists
 * for, and the one a non-greedy match truncates at the first inner `</div>`.
 */
const ACT_ROW_OPEN = /<div class="act">/g;

/** The `act <id>` the fold's provenance line carries, which is what a steer names. */
const ACT_ID = /·\s*act\s+([A-Za-z0-9][A-Za-z0-9.-]*)/;

/** The Melbourne stamp on a row's visible line — the date and time, which is all an ordering needs. */
const ACT_STAMP = /<span class="bg">(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

/** What one rendered row says about itself: its act id and the instant on its own line. */
interface RenderedAct {
  readonly actionId: string | undefined;
  readonly stamp: string | undefined;
}

/** Every act the page renders, in page order. */
function renderedActs({ html }: { html: string }): readonly RenderedAct[] {
  const acts: RenderedAct[] = [];
  for (const open of html.matchAll(ACT_ROW_OPEN)) {
    const element = balancedElement({ html, start: open.index, tag: "div" });
    // An unclosed row is still a ROW the owner can see, so it is counted — with neither field read, which is what
    // makes the id check below report it rather than the count quietly dropping it.
    if (element === undefined) {
      acts.push({ actionId: undefined, stamp: undefined });
      continue;
    }
    acts.push({ actionId: ACT_ID.exec(element)?.[1], stamp: ACT_STAMP.exec(element)?.[1] });
  }
  return acts;
}

/** At most one defect, when a row renders without the id a steer would have to name. */
function idDefects({ acts }: { acts: readonly RenderedAct[] }): readonly AutonomyCheckDefect[] {
  const missing = acts.filter((act) => act.actionId === undefined).length;
  if (missing === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(missing)} act(s) in the autonomy ledger render without their act id, so there is nothing ` +
        "for `slopweaver autonomy steer` to name when the owner reacts to one. Render the section through " +
        "`slopweaver briefing render --autonomy-ledger`.",
      rule: "row-without-id",
    },
  ];
}

/**
 * At most one defect, when the section is not newest first.
 *
 * Compared as STRINGS rather than parsed instants, which is exact here rather than lazy: every stamp comes
 * from `../outbound/briefing/stamp.ts` in one fixed `YYYY-MM-DD HH:MM:SS` shape resolved in one zone, and
 * that shape sorts lexicographically the way it sorts chronologically. A row whose stamp this could not read
 * contributes nothing, because the id check above is what catches a malformed row.
 */
function orderDefects({ acts }: { acts: readonly RenderedAct[] }): readonly AutonomyCheckDefect[] {
  const stamps = acts.flatMap((act) => (act.stamp === undefined ? [] : [act.stamp]));
  const ordered = stamps.every((stamp, index) => {
    const previous = stamps[index - 1];
    return previous === undefined || previous >= stamp;
  });
  if (ordered) {
    return [];
  }
  return [
    {
      reason:
        "the autonomy ledger's acts are not newest first. The register folds them in that order already, so " +
        "a page in any other order was re-sorted on the way here — and the owner reads the top row as the last " +
        "thing the fleet did.",
      rule: "out-of-order",
    },
  ];
}

/** At most one defect, when the section shows more acts than the cap allows. */
function countDefects({ acts }: { acts: readonly RenderedAct[] }): readonly AutonomyCheckDefect[] {
  if (acts.length <= AUTONOMY_MAX_ROWS) {
    return [];
  }
  return [
    {
      reason:
        `the autonomy ledger renders ${String(acts.length)} acts, over the ${String(AUTONOMY_MAX_ROWS)} this ` +
        "page shows. The register keeps all of them — show the newest and let the section state how many it " +
        "is not showing.",
      rule: "too-many-rows",
    },
  ];
}

/**
 * Check one fleet-briefing page's autonomy ledger section.
 *
 * @param html the whole artifact file
 * @returns how many acts it renders, and one defect per rule broken
 */
export function checkAutonomy({ html }: { html: string }): AutonomyCheck {
  const acts = renderedActs({ html: html.replace(STYLE_OR_SCRIPT, " ") });
  return {
    defects: [...idDefects({ acts }), ...orderDefects({ acts }), ...countDefects({ acts })],
    rowsChecked: acts.length,
  };
}
