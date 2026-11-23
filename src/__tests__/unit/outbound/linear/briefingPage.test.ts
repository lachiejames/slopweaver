import { describe, expect, it } from "vitest";

import { renderLinearBriefingPage } from "../../../../outbound/linear/briefingPage.js";
import { BRIEFING, COVERAGE, LOW_COMMENT } from "./briefingFixture.js";

const PAGE = renderLinearBriefingPage({ form: BRIEFING });

describe("renderLinearBriefingPage", () => {
  it("marks the question and the lean a card reads", () => {
    expect(PAGE).toContain(
      '<p data-card="question">Should I make 4 writes in Linear, all of them, the obvious ones, or the ones you name?</p>',
    );
    expect(PAGE).toContain(`<p data-card="lean">${BRIEFING.lean}</p>`);
  });

  it("states the counts in the lede, so the owner never adds them up", () => {
    expect(PAGE).toContain('<p class="lede">4 writes would make Linear match reality: 2 obvious, 2 less obvious.</p>');
  });

  it("shows the unread source above the read ones, and counts the gap", () => {
    const gap = PAGE.indexOf("NOT READ</span> · <strong>calendar</strong>");
    const firstRead = PAGE.indexOf("read</span> · <strong>linear-live</strong>");

    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(firstRead);
    expect(PAGE).toContain("1 source(s) not read, so this briefing may be missing writes.");
  });

  it("orders obvious cards before less obvious ones", () => {
    expect(PAGE.indexOf("ENG-9")).toBeLessThan(PAGE.indexOf("ENG-7"));
    expect(PAGE.indexOf("<h2>Obvious</h2>")).toBeLessThan(PAGE.indexOf("<h2>Less obvious</h2>"));
  });

  it("states times in the owner's zone, never as a machine instant", () => {
    expect(PAGE).toContain(
      "Composed Mon, 26 Oct 2026, 5:30 pm. Evidence read: everything since Sun, 25 Oct 2026, 5:30 pm, when Linear last matched.",
    );
    expect(PAGE).not.toContain("06:30:00Z");
  });

  it("shows the exact markdown a comment sends, escaped", () => {
    expect(PAGE).toContain("Shipped in #42; closing once the canary holds.");
    expect(PAGE).toContain("<summary>Exactly what Linear receives</summary><pre>");
  });

  it("draws a comment's markdown link and bare URL as links in the feed line, keeping the sent markdown below", () => {
    const summary = "a dupe of [RRRR-763](https://linear.app/x/issue/RRRR-763), see https://example.test/pr/1 <b>";
    const linked = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [
          {
            ...LOW_COMMENT,
            write: {
              comment: {
                artifact: { evidence: [{ label: "the thread", url: "https://example.test/thread/1" }], summary },
                fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
              },
              kind: "comment",
            },
          },
        ],
      },
    });

    expect(linked).toContain(
      '<p class="said">a dupe of <a href="https://linear.app/x/issue/RRRR-763">RRRR-763</a>, see ' +
        '<a class="raw" href="https://example.test/pr/1">https://example.test/pr/1</a> &lt;b&gt;</p>',
    );
    expect(linked).toContain("[RRRR-763](https://linear.app/x/issue/RRRR-763)");
  });

  it("keeps a markdown link's balanced parentheses inside the address, leaving none of it as text", () => {
    const linked = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [
          {
            ...LOW_COMMENT,
            write: {
              comment: {
                artifact: {
                  evidence: [{ label: "the thread", url: "https://example.test/thread/1" }],
                  summary: "before [label](https://example.test/a(b)foo) foo after",
                },
                fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
              },
              kind: "comment",
            },
          },
        ],
      },
    });

    expect(linked).toContain('<p class="said">before <a href="https://example.test/a(b)foo">label</a> foo after</p>');
  });

  it("never lets a quote in a markdown link's address into an href, linking only the bare URL before it", () => {
    const linked = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [
          {
            ...LOW_COMMENT,
            write: {
              comment: {
                artifact: {
                  evidence: [{ label: "the thread", url: "https://example.test/thread/1" }],
                  summary: '[x](https://example.test/a"b)',
                },
                fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
              },
              kind: "comment",
            },
          },
        ],
      },
    });

    expect(linked).toContain(
      '<p class="said">[x](<a class="raw" href="https://example.test/a">https://example.test/a</a>"b)</p>',
    );
  });

  it("leaves a stray bracket before a markdown link as text where it stood", () => {
    const linked = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [
          {
            ...LOW_COMMENT,
            write: {
              comment: {
                artifact: {
                  evidence: [{ label: "the thread", url: "https://example.test/thread/1" }],
                  summary: "before [literal [label](https://example.test) after",
                },
                fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
              },
              kind: "comment",
            },
          },
        ],
      },
    });

    expect(linked).toContain('<p class="said">before [literal <a href="https://example.test">label</a> after</p>');
  });

  it("shows a backslash-escaped bracket verbatim, linking only the bare URL inside it", () => {
    const linked = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [
          {
            ...LOW_COMMENT,
            write: {
              comment: {
                artifact: {
                  evidence: [{ label: "the thread", url: "https://example.test/thread/1" }],
                  summary: "before \\[label](https://example.test/x) after",
                },
                fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
              },
              kind: "comment",
            },
          },
        ],
      },
    });

    expect(linked).toContain(
      '<p class="said">before \\[label](<a class="raw" href="https://example.test/x">https://example.test/x</a>) after</p>',
    );
  });

  it("spaces a key from its title wherever a target is linked, not only in a card heading", () => {
    expect(PAGE).toContain(".lb .key{color:#6b6f76;font-weight:500;margin-right:6px}");
  });

  it("escapes a title carrying markup", () => {
    const hostile = renderLinearBriefingPage({
      form: {
        ...BRIEFING,
        proposals: [{ ...LOW_COMMENT, target: { ...LOW_COMMENT.target, title: "<script>x</script>" } }],
      },
    });

    expect(hostile).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(hostile).not.toContain("<script>");
  });

  it("says there is nothing to write when no proposal stands", () => {
    const empty = renderLinearBriefingPage({ form: { ...BRIEFING, coverage: COVERAGE, proposals: [] } });

    expect(empty).toContain('<p class="lede">Nothing to write. Linear already matches everything read.</p>');
    expect(empty).not.toContain("<h2>Obvious</h2>");
  });

  it("says the whole corpus was read when no briefing was ever applied in full", () => {
    const first = renderLinearBriefingPage({ form: { ...BRIEFING, evidenceSinceIso: null } });

    expect(first).toContain("Evidence read: the whole corpus, because no briefing has been applied in full yet.");
  });
});
