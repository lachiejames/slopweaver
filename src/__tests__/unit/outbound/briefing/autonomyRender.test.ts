import { describe, expect, it } from "vitest";

import { renderAutonomy } from "../../../../outbound/briefing/autonomyRender.js";
import { AUTONOMY_ID, type BriefingAutonomyRow } from "../../../../outbound/briefing/types.js";

/** One projected act, varying only what a case cares about. */
function row(over: Partial<BriefingAutonomyRow> = {}): BriefingAutonomyRow {
  return {
    actionId: "act-7",
    bySession: "wt/hand-note-panel",
    doneIso: "2026-09-20T14:51:08.996Z",
    kindLabel: "merged a pull request",
    sessionLabel: "hand-note-panel",
    subject: "acme/slopweaver#1043",
    subjectLabel: "#1043",
    why: "CI was green and the proof was gold",
    witness: "slopweaver github enqueue --number 1043",
    ...over,
  };
}

/** The whole section as one string, which is what a reader's browser actually receives. */
const html = ({ rows, notShown = 0 }: { rows: readonly BriefingAutonomyRow[]; notShown?: number }): string =>
  renderAutonomy({ autonomy: { notShown, rows } }).join("\n");

// The three cases on the section's unreadable-line sentence went with the count that drove it: the read carrying
// that count is gone, and a ledger with an unreadable row now refuses the render rather than reaching this block.
describe("renderAutonomy", () => {
  it("renders nothing at all when the register gave it no acts", () => {
    expect(renderAutonomy({ autonomy: { notShown: 0, rows: [] } })).toEqual([]);
  });

  it("puts the heading, the contract line and one row on the page", () => {
    const page = html({ rows: [row()] });
    expect(page).toContain(`<h2 id="${AUTONOMY_ID}">done for you, without asking</h2>`);
    expect(page).toContain("Each of these was obvious enough to do rather than ask about.");
    expect(page).toContain("merged a pull request");
    expect(page).toContain("<code>slopweaver github enqueue --number 1043</code>");
  });

  it("marks a row the owner has already steered, so it is not asked twice", () => {
    expect(html({ rows: [row({ steer: "do not do this unasked again" })] })).toContain(
      '<span class="steered">you have steered this</span>',
    );
  });

  it("says nothing about a steer on a row that has none", () => {
    expect(html({ rows: [row()] }).includes("you have steered this")).toBe(false);
  });

  it("says how many earlier acts it is not showing rather than implying it showed them all", () => {
    expect(html({ notShown: 6, rows: [row()] })).toContain(
      "6 earlier act(s) not shown — `slopweaver autonomy list` has all of them",
    );
  });

  it("links a bare reference in the why against the repository the act's own subject names", () => {
    const page = html({
      rows: [row({ subject: "https://github.com/lachiejames/slopweaver/pull/1351", why: "#1135 re-seeded it" })],
    });
    expect(page).toContain(
      '<strong>Why:</strong> <a href="https://github.com/lachiejames/slopweaver/issues/1135">#1135</a> re-seeded it',
    );
  });

  it("links the steer and the plain-words line against the subject too", () => {
    const page = html({
      rows: [
        row({
          said: "Closed #17777 as done.",
          steer: "fine, and #17777 again next time",
          subject: "https://github.com/acme/acme-admin/pull/17801",
        }),
      ],
    });
    expect(page).toContain(
      '<p class="said">Closed <a href="https://github.com/acme/acme-admin/issues/17777">#17777</a> as done.</p>',
    );
    expect(page).toContain('fine, and <a href="https://github.com/acme/acme-admin/issues/17777">#17777</a> again');
  });

  it("leaves a bare reference as text when the subject names no repository, rather than guessing one", () => {
    expect(html({ rows: [row({ why: "#1135 re-seeded it" })] })).toContain("<strong>Why:</strong> #1135 re-seeded it");
  });

  it("resolves against a repository the why itself links, over the subject's", () => {
    const page = html({
      rows: [
        row({
          subject: "https://github.com/lachiejames/slopweaver/pull/1351",
          why: "see https://github.com/acme/acme-admin/pull/17801 and #17777",
        }),
      ],
    });
    expect(page).toContain('<a href="https://github.com/acme/acme-admin/issues/17777">#17777</a>');
    expect(page).toContain('<a class="raw" href="https://github.com/acme/acme-admin/pull/17801">');
  });

  it("escapes a why carrying markup, so no register row can add tags to the page", () => {
    const page = html({ rows: [row({ why: "<script>x</script>" })] });
    expect(page).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(page.includes("<script>")).toBe(false);
  });
});
