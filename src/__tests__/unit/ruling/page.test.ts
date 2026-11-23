/**
 * The register's one page: categories in order, current rulings with what they replaced folded under them, and every
 * word from the register escaped — never linked, linted or reworded. Synthetic words only.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { renderRulingPage } from "../../../ruling/page.js";
import { projectRulings, type RulingRecord } from "../../../ruling/registry.js";

/** A row, overridable per test. */
function row(over: Partial<RulingRecord> = {}): RulingRecord {
  return {
    category: "landing",
    decidedOn: "2026-01-05",
    id: "ruling-aaaaaaaaaaaa",
    origin: { kind: "record" },
    recordedIso: "2026-01-05T10:00:00.000Z",
    replaces: [],
    schemaVersion: 1,
    words: "two review passes, no third",
    ...over,
  };
}

/** The page for some rows. */
function pageOf({ rows }: { rows: readonly RulingRecord[] }): string {
  return unwrap(renderRulingPage({ projection: unwrap(projectRulings({ file: "/synthetic/r.jsonl", rows })) }));
}

describe("renderRulingPage", () => {
  it("says so when the register is empty", () => {
    expect(pageOf({ rows: [] })).toBe("<title>Rulings</title><h1>Rulings</h1><p>No rulings are recorded yet.</p>");
  });

  it("escapes markup in the words and keeps a call id and a clock time as literal text", () => {
    const words = 'ship <script>alert("x")</script> & say so at 07:30Z\n  second line';
    const html = pageOf({ rows: [row({ anchor: "talk-call:00000000-0000-4000-8000-000000000003#turn_Ab", words })] });
    expect(html).toContain(
      '<blockquote style="white-space: pre-wrap">ship &lt;script&gt;alert("x")&lt;/script&gt; &amp; say so at 07:30Z\n  second line</blockquote>',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("<code>talk-call:00000000-0000-4000-8000-000000000003#turn_Ab</code>");
  });

  it("escapes a category and a context", () => {
    const html = pageOf({ rows: [row({ context: "on <b>page</b>" })] });
    expect(html).toContain("on &lt;b&gt;page&lt;/b&gt;");
  });

  it("draws categories alphabetically and folds a replaced ruling under its replacement", () => {
    const html = pageOf({
      rows: [
        row({ category: "privacy", id: "ruling-bbbbbbbbbbbb", words: "keep it local" }),
        row({ words: "the old landing rule" }),
        row({ id: "ruling-cccccccccccc", replaces: ["ruling-aaaaaaaaaaaa"], words: "the new landing rule" }),
      ],
    });
    expect(html.indexOf("<h2>landing")).toBeLessThan(html.indexOf("<h2>privacy"));
    expect(html).toContain("<h2>landing <small>(1 current)</small></h2>");
    const folded = html.slice(html.indexOf("<details>"), html.indexOf("</details>"));
    expect(folded).toContain("Replaced 1 earlier ruling(s)");
    expect(folded).toContain("the old landing rule");
    expect(html.indexOf("the new landing rule")).toBeLessThan(html.indexOf("<details>"));
  });

  it("leaves out a category whose only ruling was replaced from another category", () => {
    const html = pageOf({
      rows: [
        row({ category: "old-topic" }),
        row({ category: "privacy", id: "ruling-bbbbbbbbbbbb", replaces: ["ruling-aaaaaaaaaaaa"] }),
      ],
    });
    expect(html).not.toContain("<h2>old-topic");
    expect(html).toContain("1 current ruling(s) in 1 categories");
  });
});
