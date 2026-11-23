/*
 * The whole page: the eyebrow's two instants, the react-now block's honest empty state, the sections below the
 * recent block and their order, and the one property that matters most — what it emits, `briefing check` passes.
 */
import { describe, expect, it } from "vitest";

import { briefingRefused, checkBriefing, renderBriefingCheck } from "../../../../../briefing/check.js";
import { renderEyebrow } from "../../../../../outbound/briefing/eyebrow.js";
import { renderBriefing } from "../../../../../outbound/briefing/render.js";
import { FORM, NOW_ISO, text } from "./harness.js";

describe("the briefing renderer", () => {
  it("renders the eyebrow, states both instants exactly, and says sleep mode rather than implying it", () => {
    expect(renderEyebrow({ form: FORM })).toBe(
      '<div class="eyebrow">supervisor ws:598 (handoff-9012, opus, pinned 23:57) · last refreshed ' +
        "2026-09-02 11:12:00 AEST · ready for review 2026-09-02 11:40:00 AEST · rebuilt with each update</div>",
    );
    expect(renderEyebrow({ form: { ...FORM, header: { ...FORM.header, sleeping: true } } })).toContain(
      "· sleep mode, republished each time this page is rebuilt</div>",
    );
  });

  it("renders the empty react-now block as a real state rather than omitting it", () => {
    const html = renderBriefing({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] } } });

    expect(html).toContain(
      '<h2 id="react-now">react now</h2>\n<p class="sub">nothing open above the line right now</p>',
    );
    expect(html).toContain('<h2 id="recent">done since you last looked</h2>');
  });

  it("puts every section below the recent block inside a collapsed details", () => {
    const html = renderBriefing({ form: FORM });

    expect(html).toContain(
      "<details><summary>earlier today, in order</summary><div>\n" +
        '<div class="need" style="border-left-color:var(--ok)"><div class="q">A quiet sweep.</div></div>\n' +
        "</div></details>",
    );
    expect(html).toContain("<details><summary>history: 29 Aug</summary><div>\n");
  });

  it("renders Nothing stale, then freshness, then earlier today, then history, each under its own id", () => {
    const projected = ({ id, summary }: { id: string; summary: string }) => ({
      id,
      notes: [{ headline: text({ value: summary }) }],
      summary,
    });
    const html = renderBriefing({
      form: {
        ...FORM,
        freshness: projected({ id: "freshness", summary: "freshness gauge" }),
        nothingStale: projected({ id: "nothing-stale", summary: "0 known stale · all five surfaces seen" }),
      },
    });
    const order = [
      '<details id="nothing-stale"><summary>0 known stale · all five surfaces seen</summary>',
      '<details id="freshness"><summary>freshness gauge</summary>',
      "<details><summary>earlier today, in order</summary>",
      "<details><summary>history: 29 Aug</summary>",
    ].map((needle) => html.indexOf(needle));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
  });

  it("renders no Nothing stale section when the run asked for none", () => {
    expect(renderBriefing({ form: FORM })).not.toContain('id="nothing-stale"');
  });

  it("emits a page the shipped gate passes, and says what it measured", () => {
    const result = checkBriefing({
      applyBareRefs: true,
      applyFraming: true,
      applyVoice: true,
      html: renderBriefing({ form: FORM }),
      nowIso: NOW_ISO,
      rules: [],
    });

    expect(briefingRefused({ result })).toBe(false);
    expect(renderBriefingCheck({ result })).toEqual([
      "1 card(s) checked under react-now, no defects",
      "shape: react-now first, the groupings in order, both instants stated",
      "page: 57 words and 0 unfolded block(s) above the fold outside the cards, inside budget",
      "alignment: stated in 11 words above the fold",
      "sections: 6 level(s) outside the cards read, every fleet word glossed where you can see it",
      "autonomy ledger: nothing has been done autonomously, or the page was rendered without --autonomy-ledger",
      "one index: 0 row(s) of yours in 0 words, 0 artifact(s) linked, every anchor lands",
      "corrections: not stamped — a first publish, or a republish that skipped `briefing corrections`",
      "correction block: nothing is waiting on your mark, or the page was rendered without --owner-beliefs",
      "quiz: this sweep asked nothing, or the page was rendered without --knowledge-quiz",
      "bare references: none found",
      "fold residue: none found",
      "blocked on the owner: nothing waiting on them, or the ask-lifecycle log was not read",
      "gone quiet: every standing row is posting on its cadence, or the recipe store was not read",
      "live premises: no card names a pull request, or the freshness leg did not run",
    ]);
  });
});
