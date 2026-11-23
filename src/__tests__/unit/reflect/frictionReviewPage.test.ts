import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { renderBriefMarkdown } from "../../../reflect/briefMarkdown.js";
import {
  CROSS_REF_FOLD_AFTER,
  frictionReviewPageSlug,
  renderFrictionReviewFragment,
} from "../../../reflect/frictionReviewPage.js";
import { FrictionReviewPageErrors } from "../../../reflect/frictionReviewPageErrors.js";

const DATE = "2026-10-13";
const HEAD = "<title>Self-improvement mining, 2026-10-13</title>\n<h1>Self-improvement mining, 2026-10-13</h1>";

/** A finding's id bullet as the writer emits it, and the list item the page makes of it. */
const ID_BULLET = "- finding id: `x`";
const ID_ITEM = "<li>finding id: <code>x</code></li>\n";

/** One report: the writer's heading for {@link DATE}, then `body`. */
function report({ body }: { body: string }): string {
  return `# Self-improvement mining, ${DATE}\n\n${body}`;
}

describe("frictionReviewPageSlug", () => {
  it("names a report day the way the hand-authored pages already are", () => {
    expect(unwrap(frictionReviewPageSlug({ date: "2026-10-13" }))).toBe("friction-review-13oct");
  });

  it("drops a leading zero from the day", () => {
    expect(unwrap(frictionReviewPageSlug({ date: "2026-09-05" }))).toBe("friction-review-5sep");
  });

  it("refuses a month that does not exist", () => {
    const refusal = unwrapErr(frictionReviewPageSlug({ date: "2026-13-01" }));
    expect(refusal).toStrictEqual(FrictionReviewPageErrors.notAReportDay({ date: "2026-13-01" }));
    expect(refusal.message).toBe('"2026-13-01" is not a report day (YYYY-MM-DD), so it names no friction review page');
  });

  it("refuses a day the calendar does not have, rather than rolling it over", () => {
    expect(unwrapErr(frictionReviewPageSlug({ date: "2026-02-30" }))).toStrictEqual(
      FrictionReviewPageErrors.notAReportDay({ date: "2026-02-30" }),
    );
    expect(unwrapErr(frictionReviewPageSlug({ date: "2026-10-32" }))).toStrictEqual(
      FrictionReviewPageErrors.notAReportDay({ date: "2026-10-32" }),
    );
    expect(unwrap(frictionReviewPageSlug({ date: "2028-02-29" }))).toBe("friction-review-29feb");
  });

  it("refuses a value that is not a day at all", () => {
    expect(unwrapErr(frictionReviewPageSlug({ date: "13oct" })).code).toBe("NOT_A_REPORT_DAY");
  });
});

describe("renderFrictionReviewFragment", () => {
  it("renders every shape the report writer emits", () => {
    const markdown = report({
      body: [
        "5 surfaced of 25 candidate class(es).",
        "",
        "## Surfaced",
        "",
        "### handover amend — 8.0",
        "",
        "1 run(s) amended a live brief: `scope-changed`",
        "",
        "- 1 this window",
        "- board: b-row, a-row",
        "",
        "Reconciling these is the dispatched session's job,",
        "not this file's.",
        "",
      ].join("\n"),
    });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      [
        HEAD,
        "<p>5 surfaced of 25 candidate class(es).</p>",
        "<h2>Surfaced</h2>",
        "<h3>handover amend — 8.0</h3>",
        "<p>1 run(s) amended a live brief: <code>scope-changed</code></p>",
        "<ul>\n<li>1 this window</li>\n<li>board: b-row, a-row</li>\n</ul>",
        "<p>Reconciling these is the dispatched session's job, not this file's.</p>",
        "",
      ].join("\n"),
    );
  });

  it("escapes markup in prose, bullets and code, so a ledger string never becomes an element", () => {
    const markdown = report({ body: "<b>x</b> & `<i>y</i>`\n\n- <script>z</script>\n" });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<p>&lt;b&gt;x&lt;/b&gt; &amp; <code>&lt;i&gt;y&lt;/i&gt;</code></p>\n` +
        "<ul>\n<li>&lt;script&gt;z&lt;/script&gt;</li>\n</ul>\n",
    );
  });

  it("keeps an unmatched backtick as a literal rather than turning the rest of the line into code", () => {
    const markdown = report({ body: "`a` then `b\n" });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<p><code>a</code> then \`b</p>\n`,
    );
  });

  it("writes a machine instant in the owner's own zone, so the page carries no raw timestamp", () => {
    const markdown = report({ body: "Window 2026-10-12T19:58:59.995Z .. 2026-10-13T19:58:59.995Z, read x 1.\n" });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<p>Window 13 Oct, 6:58 am AEDT .. 14 Oct, 6:58 am AEDT, read x 1.</p>\n`,
    );
  });

  it("keeps instant-shaped text that names no real instant as the report wrote it, rather than throwing", () => {
    const fragment = unwrap(
      renderFrictionReviewFragment({ date: DATE, markdown: report({ body: "Window 2026-99-99T99:99:99Z.\n" }) }),
    );
    expect(fragment).toBe(`${HEAD}\n<p>Window 2026-99-99T99:99:99Z.</p>\n`);
  });

  it("keeps a cross-reference inline at the fold threshold", () => {
    const rows = Array.from({ length: CROSS_REF_FOLD_AFTER }, (_, index) => `row-${String(index)}`).join(", ");
    const fragment = unwrap(
      renderFrictionReviewFragment({ date: DATE, markdown: report({ body: `- board: ${rows}\n` }) }),
    );
    expect(fragment).toBe(`${HEAD}\n<ul>\n<li>board: ${rows}</li>\n</ul>\n`);
  });

  it("folds a cross-reference one row past the threshold behind its count", () => {
    const count = CROSS_REF_FOLD_AFTER + 1;
    const rows = Array.from({ length: count }, (_, index) => `row-${String(index)}`).join(", ");
    const fragment = unwrap(
      renderFrictionReviewFragment({ date: DATE, markdown: report({ body: `- memory: ${rows}\n` }) }),
    );
    expect(fragment).toBe(
      `${HEAD}\n<ul>\n<li><details><summary>memory: ${String(count)} rows</summary>${rows}</details></li>\n</ul>\n`,
    );
  });

  it("keeps the finding id visible, folds the cross-reference behind the ranking summary and the evidence behind its count", () => {
    const markdown = report({
      body: [
        "- finding id: `a-class-run-journal` (grade it: `slopweaver reflect grade a-class-run-journal keep|adjust|drop`)",
        "- board: nothing recorded",
        "- evidence: first <line>",
        "- evidence: second line",
        "",
      ].join("\n"),
    });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<ul>\n` +
        "<li>finding id: <code>a-class-run-journal</code> (grade it: <code>slopweaver reflect grade a-class-run-journal keep|adjust|drop</code>)</li>\n" +
        "<li><details><summary>how the fleet ranked it, and what already covers it</summary><ul><li>board: nothing recorded</li></ul></details></li>\n" +
        "<li><details><summary>evidence: 2 lines</summary><ul><li>first &lt;line&gt;</li><li>second line</li></ul></details></li>\n" +
        "</ul>\n",
    );
  });

  it("keeps adversarial evidence inside its fold: a board: or # payload is neither a cross-reference nor a heading", () => {
    const markdown = report({
      body: [
        ID_BULLET,
        "- evidence: board: a, b, c",
        "- evidence: # not a heading",
        "- evidence: has `code` and <b>",
        "",
      ].join("\n"),
    });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<ul>\n${ID_ITEM}<li><details><summary>evidence: 3 lines</summary><ul>` +
        "<li>board: a, b, c</li><li># not a heading</li><li>has <code>code</code> and &lt;b&gt;</li>" +
        "</ul></details></li>\n</ul>\n",
    );
  });

  it("folds two evidence runs split by another bullet into two separate details", () => {
    const markdown = report({ body: [ID_BULLET, "- evidence: one", "- board: x", "- evidence: two", ""].join("\n") });
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      `${HEAD}\n<ul>\n${ID_ITEM}` +
        "<li><details><summary>evidence: 1 line</summary><ul><li>one</li></ul></details></li>\n" +
        "<li><details><summary>how the fleet ranked it, and what already covers it</summary><ul><li>board: x</li></ul></details></li>\n" +
        "<li><details><summary>evidence: 1 line</summary><ul><li>two</li></ul></details></li>\n</ul>\n",
    );
  });

  it("folds a single evidence line too, and says '1 line' not '1 lines'", () => {
    const fragment = unwrap(
      renderFrictionReviewFragment({ date: DATE, markdown: report({ body: `${ID_BULLET}\n- evidence: only line\n` }) }),
    );
    expect(fragment).toBe(
      `${HEAD}\n<ul>\n${ID_ITEM}<li><details><summary>evidence: 1 line</summary><ul><li>only line</li></ul></details></li>\n</ul>\n`,
    );
  });

  it("leaves the written-out 'none recorded' evidence line unfolded, since there is nothing to expand", () => {
    const fragment = unwrap(
      renderFrictionReviewFragment({
        date: DATE,
        markdown: report({ body: `${ID_BULLET}\n- evidence: none recorded\n` }),
      }),
    );
    expect(fragment).toBe(`${HEAD}\n<ul>\n${ID_ITEM}<li>evidence: none recorded</li>\n</ul>\n`);
  });

  it("does not fold an 'evidence: ' bullet in a list that is no finding's, such as a could-not-see residue", () => {
    const fragment = unwrap(
      renderFrictionReviewFragment({ date: DATE, markdown: report({ body: "- evidence: a residue line\n" }) }),
    );
    expect(fragment).toBe(`${HEAD}\n<ul>\n<li>evidence: a residue line</li>\n</ul>\n`);
  });

  it("END TO END: the id and evidence the writer emits reach the published page", () => {
    const markdown = renderBriefMarkdown({
      brief: {
        backlog: [],
        couldNotVerify: [],
        grades: [],
        heldUnmeasured: 0,
        seenRows: [],
        sources: [],
        suppressed: 0,
        surfaced: [
          {
            baseImpact: 3,
            closedAtIso: undefined,
            closedBy: undefined,
            daysSeen: 1,
            finding: {
              classKey: "c",
              consequence: "Work sat waiting on your answer for 9.0h across 1 question(s); the longest wait was 9.0h",
              cost: 1,
              coveredBy: [],
              evidence: ["the evidence line"],
              firstSeenIso: "2026-10-12T01:00:00.000Z",
              impact: 3,
              knownBy: [],
              lastSeenIso: "2026-10-12T02:00:00.000Z",
              locus: "l",
              occurrences: 1,
              refutedBy: [],
              safety: 1,
              source: "run-journal",
              summary: "s",
            },
            grade: undefined,
            id: "c-run-journal",
            priorSurfacings: 0,
            score: 3,
          },
        ],
        tsIso: "2026-10-13T06:30:00.000Z",
        window: { fromIso: "2026-10-12T06:30:00.000Z", toIso: "2026-10-13T06:30:00.000Z" },
      },
      date: DATE,
    }).join("\n");
    const fragment = unwrap(renderFrictionReviewFragment({ date: DATE, markdown }));
    expect(fragment).toContain("<li>finding id: <code>c-run-journal</code>");
    expect(fragment).toContain(
      "<li><details><summary>evidence: 1 line</summary><ul><li>the evidence line</li></ul></details></li>",
    );
  });

  it("END TO END: the page OPENS each finding on its cost and pattern, and folds the ranking the owner cannot grade", () => {
    const markdown = renderBriefMarkdown({
      brief: {
        backlog: [],
        couldNotVerify: [],
        grades: [],
        heldUnmeasured: 0,
        seenRows: [],
        sources: [],
        suppressed: 0,
        surfaced: [
          {
            baseImpact: 3,
            closedAtIso: undefined,
            closedBy: undefined,
            daysSeen: 3,
            finding: {
              classKey: "c",
              consequence: "Work sat waiting on your answer for 9.0h across 4 question(s); the longest wait was 6.0h",
              cost: 2,
              coveredBy: ["a-board-row"],
              evidence: [],
              firstSeenIso: "2026-10-12T01:00:00.000Z",
              impact: 3,
              knownBy: [],
              lastSeenIso: "2026-10-12T02:00:00.000Z",
              locus: "handover question",
              occurrences: 4,
              refutedBy: [],
              safety: 4,
              source: "run-journal",
              summary: "4 run(s) stopped to ask the owner the same class of question",
            },
            grade: undefined,
            id: "c-run-journal",
            priorSurfacings: 2,
            score: 6,
          },
        ],
        tsIso: "2026-10-13T06:30:00.000Z",
        window: { fromIso: "2026-10-12T06:30:00.000Z", toIso: "2026-10-13T06:30:00.000Z" },
      },
      date: DATE,
    }).join("\n");
    const fragment = unwrap(renderFrictionReviewFragment({ date: DATE, markdown }));
    const heading = "<h3>Work sat waiting on your answer for 9.0h across 4 question(s); the longest wait was 6.0h</h3>";
    const pattern = "<p>SYSTEMIC — 4 times this window, seen on 3 different days in all</p>";
    const happened = "<p>What happened: 4 run(s) stopped to ask the owner the same class of question</p>";
    expect(fragment).toContain(`${heading}\n${pattern}\n${happened}`);
    expect(fragment).toContain("<h2>How to grade</h2>");
    expect(fragment).toContain(
      "<li><details><summary>how the fleet ranked it, and what already covers it</summary><ul>" +
        "<li>fleet ordering, not a grade: 6.0 = impact 3 (3 before recurrence) x safety 4 / cost 2, " +
        "from run-journal at handover question; surfaced 2 times before</li>" +
        "<li>board: a-board-row</li><li>memory: nothing recorded</li></ul></details></li>",
    );
    expect(fragment).not.toContain("— 6.0");
  });

  it("refuses a file with no title heading rather than publishing an untitled page", () => {
    expect(unwrapErr(renderFrictionReviewFragment({ date: DATE, markdown: "just prose\n" }))).toStrictEqual(
      FrictionReviewPageErrors.noReportHeading(),
    );
  });

  it("refuses a report whose heading names a different day from its filename", () => {
    const markdown = "# Self-improvement mining, 2026-10-12\n\nbody\n";
    const refusal = unwrapErr(renderFrictionReviewFragment({ date: DATE, markdown }));
    expect(refusal).toStrictEqual(
      FrictionReviewPageErrors.headingDayMismatch({
        expected: "Self-improvement mining, 2026-10-13",
        heading: "Self-improvement mining, 2026-10-12",
      }),
    );
    expect(refusal.message).toBe(
      'the report\'s heading is "Self-improvement mining, 2026-10-12", not "Self-improvement mining, 2026-10-13" as its filename says',
    );
  });

  it("renders the real writer's empty-day report", () => {
    const markdown = renderBriefMarkdown({
      brief: {
        backlog: [],
        couldNotVerify: ["the ledger is absent"],
        grades: [],
        heldUnmeasured: 0,
        seenRows: [],
        sources: [{ findings: 0, rowsRead: 0, source: "run-journal" }],
        suppressed: 0,
        surfaced: [],
        tsIso: "2026-10-13T19:58:59.995Z",
        window: { fromIso: "2026-10-12T19:58:59.995Z", toIso: "2026-10-13T19:58:59.995Z" },
      },
      date: DATE,
    }).join("\n");
    expect(unwrap(renderFrictionReviewFragment({ date: DATE, markdown }))).toBe(
      [
        HEAD,
        "<p>0 surfaced of 0 candidate classes; 0 in the backlog; 0 dropped by a terminal grade.</p>",
        "<p>Window 13 Oct, 6:58 am AEDT .. 14 Oct, 6:58 am AEDT, read run-journal 0.</p>",
        "<h2>How to grade</h2>",
        "<p>Each finding opens on what it measurably cost you or the fleet, then says whether it is a one-off or systemic.</p>",
        "<ul>",
        "<li>keep — that cost is worth the fleet fixing; it stays on the list until a fix closes it</li>",
        "<li>adjust — the problem is real but the cost or the framing here is wrong; say which, and it stays on the list</li>",
        "<li>drop — an acceptable cost, or noise; it is never shown to you again (the underlying thing is not fixed)</li>",
        "</ul>",
        "<p>The fleet ordering under each finding is how the miner sorted them, not a grade and not a score out of ten.</p>",
        "<h2>Surfaced</h2>",
        "<p>Nothing this window. A quiet pass is a good pass.</p>",
        "<h2>What this run could not see</h2>",
        "<ul>\n<li>the ledger is absent</li>\n</ul>",
        "<p>Reconciling these against the handover board — which docs are stale, which overlap, which diverged — " +
          "is the dispatched session's job, not this file's. This is the evidence it starts from.</p>",
        "",
      ].join("\n"),
    );
  });
});
