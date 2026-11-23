/*
 * `prBodyLeadRowsError` on a PR body: which cell spellings read as blank, what a link in a cell says, and which table
 * is judged when a fenced, quoted or commented example carries the pair the main table lacks.
 */
import { describe, expect, it } from "vitest";

import { prBodyLeadRowsError, requiredLeadRowsError } from "../../../../prformat/leadRows.js";
import { htmlBody, PAIR } from "./harness.js";

describe("prBodyLeadRowsError", () => {
  it("accepts the renderer's own spelling of the pair", () => {
    expect(prBodyLeadRowsError({ sourceProblem: true, body: htmlBody({ lead: PAIR }) })).toBe(undefined);
  });

  it("refuses a body with no lead rows", () => {
    expect(prBodyLeadRowsError({ sourceProblem: true, body: htmlBody({ lead: [] }) })).toContain("are none");
  });

  it("does not borrow a Risk row from the Next table or a comment", () => {
    const body = `<!-- <table><tr><td>Risk</td><td>x</td></tr> -->\n${htmlBody({ lead: [] })}`.replace(
      "Merge it.",
      "<strong>Risk</strong> is low",
    );
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not count a pair written below Problem", () => {
    const body = htmlBody({ lead: [] }).replace(
      "<tr>\n<td><strong>Solution</strong></td>",
      "<tr><td><strong>Risk</strong></td><td>x</td></tr>\n<tr><td><strong>Blast radius</strong></td><td>y</td></tr>\n<tr>\n<td><strong>Solution</strong></td>",
    );
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("reads a cell holding only a non-breaking space as empty", () => {
    const body = htmlBody({ lead: [PAIR[0]!, { label: "Blast radius", text: "&nbsp;" }] });
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Blast radius** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a cell of any blank spelling as empty", () => {
    const body = htmlBody({
      lead: [
        { label: "Risk", text: "&#xA0;" },
        { label: "Blast radius", text: "\u200b — " },
      ],
    });
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** and **Blast radius** row is empty. Say what it asks, plainly.",
    );
  });

  it("does not count a markdown link destination as something a cell says", () => {
    const body = [
      "| | |",
      "|---|---|",
      "| **Risk** | [ ](https://example.com/(hidden)letters) |",
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a character reference missing its semicolon as blank, since HTML decodes it anyway", () => {
    const body = htmlBody({
      lead: [
        { label: "Risk", text: "&nbsp" },
        { label: "Blast radius", text: "&#xA0" },
      ],
    });
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** and **Blast radius** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads an empty anchor as blank even when its title carries a >", () => {
    const empty = '<a href="https://example.com" title="Risk > details"></a>';
    const body = htmlBody({ lead: [{ label: "Risk", text: empty }, PAIR[1]!] });
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads an empty cell as blank even when the cell's own tag carries a quoted >", () => {
    const body = htmlBody({ lead: PAIR }).replace("<td>Low risk.</td>", '<td title="Risk > details"></td>');
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("does not count a link title holding a ) as something a cell says", () => {
    const body = [
      "| | |",
      "|---|---|",
      '| **Risk** | [](https://example.com "Step 1) details") |',
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a link title's escaped quote as part of the title", () => {
    const body = [
      "| | |",
      "|---|---|",
      String.raw`| **Risk** | [](https://example.com "Press \"Next\") to continue") |`,
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a reference label's escaped bracket as part of the label", () => {
    const body = [
      "| | |",
      "|---|---|",
      String.raw`| **Risk** | [ ][release\]notes] |`,
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
      "",
      String.raw`[release\]notes]: https://x.test/notes`,
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("keeps the words after a link whose URL carries an apostrophe", () => {
    const body = [
      "| | |",
      "|---|---|",
      "| **Risk** | [](https://x/it's) Low. |",
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("does not count a reference link's label as something a cell says, only its text", () => {
    const body = [
      "| | |",
      "|---|---|",
      "| **Risk** | [ ][risk] |",
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
      "",
      "[risk]: https://example.com",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("finds the Problem row behind a decorative emoji a hand-written body carries", () => {
    const body = htmlBody({ lead: [] }).replace("<strong>Problem</strong>", "📋 <strong>Problem</strong>");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("finds a Problem label the Problem checks accept with a colon, so the rule cannot be skipped", () => {
    const body = htmlBody({ lead: [] }).replace("<strong>Problem</strong>", "<strong>Problem:</strong>");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not borrow the pair from a tilde-fenced example table", () => {
    const example = htmlBody({ lead: PAIR });
    const body = `~~~html\n${example}\n~~~\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not borrow the pair from a backtick-fenced example table", () => {
    const body = `\`\`\`\`html\n${htmlBody({ lead: PAIR })}\n\`\`\`\`\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not borrow the pair from an indented fence", () => {
    const body = ` ~~~html\n${htmlBody({ lead: PAIR })}\n ~~~\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("judges every Problem table, so an example it cannot see as inert never lends its pair", () => {
    const body = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("judges a markdown main table even when an HTML example carries the pair", () => {
    const body = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>\n\n| | |\n|---|---|\n| **Problem** | A bug. |`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("reads ```word``` as inline code, not a fence that hides the main table", () => {
    const example = [
      "> | | |",
      "> | --- | --- |",
      "> | **Risk** | Low. |",
      "> | **Blast radius** | x |",
      "> | **Problem** | e |",
    ].join("\n");
    const body = `${example}\n\n\`\`\`description\`\`\`\n\n${htmlBody({ lead: [] })}\n\n\`\`\`\nnpm test\n\`\`\``;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not close a backtick fence with a shorter run or a tilde run", () => {
    const body = `\`\`\`\`\n${htmlBody({ lead: PAIR })}\n\`\`\`\n~~~~\n\`\`\`\`\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("refuses a body whose only Problem row is fenced, rather than skipping the rule", () => {
    const body = `~~~\n${htmlBody({ lead: [] })}\n~~~`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not let an unclosed fence hide the real table from the rule", () => {
    const body = `~~~\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not read an apostrophe in an autolink as an attribute quote that hides the table", () => {
    const body = `See <https://example.com/what's-new>.\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("does not let an autolink carrying =' hide the main table behind an example that has the pair", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>`;
    const body = `${example}\n\nSee <https://example.com/search?q='release>.\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("refuses when an unclosed attribute quote hides the main table behind an example that has the pair", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>`;
    const body = `${example}\n\n<span title="oops>\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("refuses rather than skipping when an unclosed attribute quote swallows the table", () => {
    const body = `<span title="oops>\n\n${htmlBody({ lead: [] })}`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("judges an indented or quoted markdown main table, so an HTML example cannot excuse it", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>`;
    const indented = [" | | |", " |---|---|", " | **Problem** | A bug. |"].join("\n");
    const quoted = ["> | | |", "> |---|---|", "> | **Problem:** | A bug. |"].join("\n");
    expect(
      [indented, quoted].map((table) => prBodyLeadRowsError({ sourceProblem: true, body: `${example}\n\n${table}` })),
    ).toStrictEqual([requiredLeadRowsError({ rows: [] }), requiredLeadRowsError({ rows: [] })]);
    expect(requiredLeadRowsError({ rows: [] })).toContain("are none");
  });

  it("judges a table between comment markers written as inline code", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>`;
    const body = `${example}\n\nThe opener is \`<!--\`.\n\n${htmlBody({ lead: [] })}\n\nThe closer is \`-->\`.`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("are none");
  });

  it("judges only drawn tables, so a fenced example missing the pair under a good main table is shown as code", () => {
    const body = `${htmlBody({ lead: PAIR })}\n\n\`\`\`html\n${htmlBody({ lead: [] })}\n\`\`\``;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("judges a markdown main table however GFM lets it be spelled (fallback review r3)", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>\n\n`;
    const tables = [
      "label | value\n---|---\n**Problem** | A bug.",
      "| | |\n|---|---|\n| Problem | A bug. |",
      "| | |\n|---|---|\n| *Problem* | A bug. |",
    ];
    expect(tables.map((table) => prBodyLeadRowsError({ sourceProblem: true, body: example + table }))).toStrictEqual([
      '**Risk** and **Blast radius** must be the first two rows of the main table, in that order, above Problem; the rows above Problem here are "label". Risk says how likely this breaks something and what; Blast radius says where it reaches, and where on the app to test it.',
      requiredLeadRowsError({ rows: [] }),
      requiredLeadRowsError({ rows: [] }),
    ]);
  });

  it("judges an HTML main table whose labels are <th> cells (fallback review r3)", () => {
    const example = `<blockquote>\n${htmlBody({ lead: PAIR })}\n</blockquote>\n\n`;
    const body = `${example}<table>\n<tr><th>Problem</th><td>A bug.</td></tr>\n</table>`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(requiredLeadRowsError({ rows: [] }));
  });
});
