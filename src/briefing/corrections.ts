/**
 * The READER half of the corrections mechanism: whether a stamped page's own claims add up.
 *
 * `../outbound/briefing/corrections.ts` computes the marks from the diff. This file is what makes that
 * property visible ON THE PAGE rather than only in the seat that ran the compare — the exact gap the row's
 * own finding named. A strip could claim three marked places while the page carried four, and nothing a
 * reader or a gate could see would have said so.
 *
 * ## What can be checked here, and what cannot
 *
 * This half has one file. It cannot know whether the marks match a real diff — that needs the previously
 * published bytes, and re-running the compare is what `slopweaver briefing corrections --verify` is for. What
 * it CAN check is every claim the page makes about itself, and a hand-authored strip fails all of them
 * together: the count it states must equal the marks actually on the page, every jump it offers must land on
 * an element that exists, it must say which published version it compared against, and a page carrying marks
 * with no strip at all is a page whose marks nobody can navigate.
 *
 * That is the pattern this repository already uses for a consistency claim — a grep sees a stale literal but
 * never a stale SUM, so the invariant is parsed and asserted rather than eyeballed.
 *
 * Pure: HTML in, defects out.
 */
import { STRIP_MAX_JUMPS } from "../outbound/briefing/corrections.js";
import {
  AGAINST_ATTRIBUTE,
  CORRECTION_ATTRIBUTE,
  MARKED_ATTRIBUTE,
  stripElementTags,
} from "../outbound/briefing/correctionsStrip.js";
import { declaredIds, type TagAttribute, tagAttributes, tagSources } from "../outbound/briefing/htmlTokens.js";

/**
 * Which claim the stamped page broke.
 *
 * @internal — the rule names `./check.ts` prints; no caller outside the briefing gate names one.
 */
export type CorrectionsRule =
  "count-mismatch" | "marks-without-strip" | "strip-without-provenance" | "jump-does-not-land" | "jumps-over-cap";

/**
 * One defect a stamped page carries.
 *
 * @internal — the row shape {@link checkCorrections} returns and the gate's renderer reads.
 */
export interface CorrectionsDefect {
  readonly rule: CorrectionsRule;
  readonly reason: string;
}

/** What checking one page's correction marks found. */
export interface CorrectionsCheck {
  /** Whether the page carries a corrections strip at all — false for a first publish, which is correct. */
  readonly stamped: boolean;
  /** How many spots on the page actually carry a mark. */
  readonly marks: number;
  /** What the strip says it marked, or undefined when there is no strip. */
  readonly claimed: number | undefined;
  readonly defects: readonly CorrectionsDefect[];
}

/** A sha the strip states it compared against, which is the one claim here with a SHAPE to check. */
const AGAINST_VALUE = /^sha256:[0-9a-f]{64}$/;

/** Every real TAG on the page, each with the attributes its author or the stamp actually wrote on it. */
function pageTags({ html }: { html: string }): readonly (readonly TagAttribute[])[] {
  return tagSources({ html }).map((tag) => tagAttributes({ tag }));
}

/**
 * How many spots carry a mark, counted off the scan rather than off the bytes.
 *
 * Not a nicety: the corrections stylesheet contains the literal `[data-corr="new"]` twice, and a page is
 * free to have a paragraph ABOUT a mark or a comment holding one. The whole gate here is a count agreeing
 * with a count, so a reader that counts anything but real attributes is a reader measuring itself — and a
 * page that says the true number then fails its own gate is the worse of the two failures, because it is
 * the correct page that gets refused.
 */
function pageMarks({ html }: { html: string }): number {
  return pageTags({ html }).filter((attributes) =>
    attributes.some((one) => one.name === CORRECTION_ATTRIBUTE && (one.value === "changed" || one.value === "new")),
  ).length;
}

/** One defect per jump link in the strip that points at an element the page does not carry. */
function jumpDefects({ html, strip }: { html: string; strip: readonly string[] }): readonly CorrectionsDefect[] {
  // The same set the stamp avoids colliding with, read from the same place, so the two halves cannot drift.
  const anchors = declaredIds({ html });
  const jumps = strip
    .flatMap((tag) => tagAttributes({ tag }))
    .filter((attribute) => attribute.name === "href" && attribute.value.startsWith("#"))
    .map((attribute) => attribute.value.slice(1));
  const defects: CorrectionsDefect[] = jumps
    .filter((anchor) => !anchors.has(anchor))
    .map((anchor) => ({
      reason:
        `the corrections strip offers a jump to \`#${anchor}\`, and no element on the page carries that ` +
        "id. Re-stamp with `slopweaver briefing corrections` rather than editing the strip.",
      rule: "jump-does-not-land" as const,
    }));
  if (jumps.length > STRIP_MAX_JUMPS) {
    defects.push({
      reason:
        `the corrections strip names ${String(jumps.length)} jumps, over the cap of ` +
        `${String(STRIP_MAX_JUMPS)}. The marks stay on the page; the strip stops listing them.`,
      rule: "jumps-over-cap",
    });
  }
  return defects;
}

/**
 * Check one page's correction marks against every claim the page makes about them.
 *
 * A page with neither marks nor a strip is a FIRST publish and passes with no defects — there is no earlier
 * version for it to be wrong about.
 *
 * @param html the whole artifact file
 * @returns the two counts, whether the page is stamped at all, and one defect per claim broken
 */
export function checkCorrections({ html }: { html: string }): CorrectionsCheck {
  const marks = pageMarks({ html });
  const strip = stripElementTags({ html });
  if (strip === undefined) {
    const defects: readonly CorrectionsDefect[] =
      marks === 0
        ? []
        : [
            {
              reason:
                `${String(marks)} spot(s) carry a correction mark and the page has no corrections strip, so ` +
                "nothing tells the reader how many there are or where they sit. Re-stamp with `slopweaver briefing " +
                "corrections`.",
              rule: "marks-without-strip",
            },
          ];
    return { claimed: undefined, defects, marks, stamped: false };
  }
  // The strip's own opening tag is the first of its tags, and it is where both claims are written.
  const claims = tagAttributes({ tag: strip[0]! });
  const claimedText = claims.find((attribute) => attribute.name === MARKED_ATTRIBUTE)?.value;
  const claimed = claimedText === undefined ? undefined : Number(claimedText);
  const defects: CorrectionsDefect[] = [...jumpDefects({ html, strip })];
  if (claimed === undefined || claimed !== marks) {
    defects.push({
      reason:
        `the corrections strip claims ${claimed === undefined ? "no count at all" : String(claimed)} marked ` +
        `spot(s) and the page carries ${String(marks)}. The marks are computed, so a disagreement means the ` +
        "strip or the page was hand-edited after the stamp.",
      rule: "count-mismatch",
    });
  }
  const against = claims.find((attribute) => attribute.name === AGAINST_ATTRIBUTE)?.value;
  if (against === undefined || !AGAINST_VALUE.test(against)) {
    defects.push({
      reason:
        "the corrections strip does not say which published version it compared against. Without " +
        `\`${AGAINST_ATTRIBUTE}\` nobody can re-run the compare that produced these marks.`,
      rule: "strip-without-provenance",
    });
  }
  return { claimed, defects, marks, stamped: true };
}
