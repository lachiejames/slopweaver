/**
 * THE HEADER EYEBROW — who is on watch, how fresh the page is, and which half of it is not.
 *
 * Its own module because the eyebrow is the one part of the page three separate gates read BACK out of the
 * rendered HTML: `../../briefing/shape.ts`'s `BOTH_STAMPS` matches the two instants as one contiguous
 * phrase, `./corrections.ts` finds the whole element with a non-greedy `<div class="eyebrow">[\s\S]*?</div>`,
 * and `src/__tests__/unit/outbound/briefing/rendererVoice.test.ts` holds its fixed words to the same
 * vocabulary rule a composer meets. Each of those is a reason a clause may not move, and keeping them
 * beside the three functions they constrain is the point of the split.
 */

import { staleSnapshotClause } from "../../briefing/snapshotAge.js";
import { escapeText } from "./escape.js";
import { stampMelbourne } from "./stamp.js";
import type { BriefingForm, BriefingHeader } from "./types.js";

/**
 * The freshness half of the eyebrow: both instants, stated exactly, in the order the gate reads them.
 *
 * The FORMAT is contract — `../../briefing/shape.ts` recognises a stamp by `./stamp.ts`'s own
 * `MELBOURNE_STAMP` and refuses a page carrying fewer than two. Two instants rather than one, because a page
 * rendered a minute ago over a pass recorded four hours ago is stale in the only sense the owner
 * cares about and a single timestamp cannot say so.
 *
 * @internal — one clause of {@link renderEyebrow}; exported so a test can pin the format the gate reads.
 * @param header the form's header
 * @returns the freshness clause, without the surrounding eyebrow
 */
export function renderStamps({ header }: { header: BriefingHeader }): string {
  const refreshed = stampMelbourne({ iso: header.refreshedIso });
  const ready = stampMelbourne({ iso: header.readyIso });
  return `last refreshed ${refreshed} · ready for review ${ready}`;
}

/**
 * The header eyebrow: who is on watch, and exactly how fresh the page is.
 *
 * Rule 7 of the supervisor contract makes this the staleness signal, so it is unconditional. Sleep mode is
 * STATED rather than implied by a quiet page, because a page that looks the same asleep and dead is the
 * failure the eyebrow exists to prevent.
 *
 * @param form the whole form
 * @returns the eyebrow's HTML
 */
export function renderEyebrow({ form }: { form: BriefingForm }): string {
  const { workspace, handoff, model, pinnedAt, sleeping } = form.header;
  const who = `supervisor ${workspace} (${handoff}, ${model}, pinned ${pinnedAt})`;
  // PLAIN WORDS, and the renderer is held to them exactly as a composer is. It read "refreshed every sweep"
  // until the card gate's vocabulary rule was put over the whole page: `sweep` is
  // one of `../../briefing/fleetJargon.ts`'s registered fleet words, so the page's own furniture was using a
  // word it would have refused a composer for. `src/__tests__/unit/outbound/briefing/rendererVoice.test.ts`
  // is what keeps every fixed line here inside the same rule.
  const tail = sleeping ? "sleep mode, republished each time this page is rebuilt" : "rebuilt with each update";
  const text = `${who} · ${renderStamps({ header: form.header })} · ${tail}`;
  // The stale clause goes AFTER the whole freshness half, never inside it: `../../briefing/shape.ts`'s
  // `BOTH_STAMPS` matches `last refreshed <stamp> · ready for review <stamp>` as one contiguous phrase, so
  // anything spliced between the two instants makes the page fail the gate that reads its own eyebrow back.
  // A `<span>` rather than a `<div>`, because `./corrections.ts` finds this element with a NON-GREEDY
  // `<div class="eyebrow">[\s\S]*?</div>` and a nested div would end that match early.
  return `<div class="eyebrow">${escapeText({ text })}${renderStaleSnapshots({ header: form.header })}</div>`;
}

/**
 * The eyebrow's red clause: one per half of this page whose snapshot was past the ceiling.
 *
 * Empty on every ordinary page. It appears only when `briefing render`'s stale-snapshot hatch was taken —
 * the run refuses otherwise — and that is what stops the override from publishing a day-old section under a
 * current-looking header, which is the failure the owner reported.
 *
 * @internal — one clause of {@link renderEyebrow}; exported so a test can pin what the owner actually meets.
 * @param header the form's header
 * @returns the clauses' HTML, empty when every snapshot was fresh
 */
export function renderStaleSnapshots({ header }: { header: BriefingHeader }): string {
  const stale = header.staleSnapshots;
  if (stale === undefined || stale.length === 0) {
    return "";
  }
  return stale
    .map((one) => {
      const text = ` · ${staleSnapshotClause({ ageMs: one.ageMs, label: one.label })}`;
      return `<span class="stale">${escapeText({ text })}</span>`;
    })
    .join("");
}
