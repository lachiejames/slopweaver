/*
 * `prBodyLeadRowsError` on a PR body: where a GFM or HTML table starts and ends, how many cells a row has, and how
 * code spans and fences inside an open table change what GitHub draws as its lead pair.
 */
import { describe, expect, it } from "vitest";

import { prBodyLeadRowsError, requiredLeadRowsError } from "../../../../prformat/leadRows.js";
import { htmlBody, PAIR } from "./harness.js";

describe("prBodyLeadRowsError", () => {
  it("accepts a GFM table with no outer pipes and a cell holding an escaped pipe", () => {
    const body = "**Risk** | Low \\| contained\n---|---\n**Blast radius** | One page.\n**Problem** | A bug.";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("accepts a Blast radius cell holding its own table, and an HTML header row left blank", () => {
    const inner = "<table><tr><td>Settings page.</td></tr></table>";
    const body = htmlBody({ lead: [PAIR[0]!, { label: "Blast radius", text: inner }] }).replace(
      "<table>\n<tr>\n<td><strong>Risk",
      "<table>\n<tr><th></th><th></th></tr>\n<tr>\n<td><strong>Risk",
    );
    expect(body).toContain("<th></th>");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("reads a cell holding only a hint comment as blank, even when the comment carries a > (fallback review r3)", () => {
    const hints = ["<!-- say how likely -> and what breaks -->", "<!-- e.g. p99 > 2s -->"];
    const bodies = hints.map((hint) => htmlBody({ lead: [{ label: "Risk", text: hint }, PAIR[1]!] }));
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      "the **Risk** row is empty. Say what it asks, plainly.",
      "the **Risk** row is empty. Say what it asks, plainly.",
    ]);
    const markdown = [
      "| | |",
      "|---|---|",
      "| **Risk** | <!-- low -> high --> |",
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ sourceProblem: true, body: markdown })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("never lets lines above a GFM table's header lend it the pair (fallback review r3)", () => {
    const main = ["| | |", "|---|---|", "| **Problem** | A bug. |", "| **Solution** | A fix. |"].join("\n");
    const above = [
      "> | | |\n> |---|---|\n> | **Risk** | Low. |\n> | **Blast radius** | One page. |",
      "    | **Risk** | Low. |\n    | **Blast radius** | One page. |",
      "**Risk** | Low.\n**Blast radius** | One page.",
      "| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | One page. |\n### Notes | read below",
    ];
    expect(above.map((lines) => prBodyLeadRowsError({ sourceProblem: true, body: `${lines}\n${main}` }))).toStrictEqual(
      above.map(() => requiredLeadRowsError({ rows: [] })),
    );
  });

  it("does not read an inner table's rows as the outer table's pair (fallback review r3)", () => {
    const inner = htmlBody({ lead: PAIR }).split("<table>")[2]!.split("<tr>\n<td><strong>Problem")[0]!;
    const body = `<table>\n<tr><td><table>${inner}</table></td></tr>\n<tr><td>Problem</td><td>A bug.</td></tr>\n</table>`;
    expect(inner).toContain("Blast radius");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain("Risk says how likely");
  });

  it("ends a GFM table at a thematic break, a list item or an HTML block, never joining two tables (fallback review r3)", () => {
    const pair = "| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | One page. |";
    const main = "| | |\n|---|---|\n| **Problem** | A bug. |";
    const breaks = ["---", "***", "- a note", "1. a note", "<div>"];
    expect(
      breaks.map((line) => prBodyLeadRowsError({ sourceProblem: true, body: `${pair}\n${line}\n${main}` })),
    ).toStrictEqual(breaks.map(() => requiredLeadRowsError({ rows: [] })));
  });

  it("reads a tab-indented line as the indented code that ends a table (fallback review r3)", () => {
    const pair = "| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | One page. |";
    const main = "| | |\n|---|---|\n| **Problem** | A bug. |";
    const lines = ["\tslopweaver github pr --edit lead", "  \tcode"];
    expect(
      lines.map((line) => prBodyLeadRowsError({ sourceProblem: true, body: `${pair}\n${line}\n${main}` })),
    ).toStrictEqual(lines.map(() => requiredLeadRowsError({ rows: [] })));
  });

  it("keeps a table going across a line of non-breaking spaces, and reads an autolink cell as saying its address", () => {
    const body =
      "| | |\n|---|---|\n| **Risk** | Low. |\n\u00a0\n| **Blast radius** | <https://app/settings> |\n| **Problem** | A bug. |";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("reads a line holding only a carriage return as the blank line that ends a table", () => {
    const body =
      "| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | x |\n\r\n| | |\n|---|---|\n| **Problem** | A bug. |";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(requiredLeadRowsError({ rows: [] }));
  });

  it("reads the cells after a <tr> indented into code as the implicit row a browser draws them in", () => {
    const body = htmlBody({ lead: PAIR }).replace(
      "<tr>\n<td><strong>Blast radius",
      "\n    <tr>\n<td><strong>Blast radius",
    );
    expect(body).toContain("\n\n    <tr>");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("refuses rather than skipping a Problem row that only indented code holds", () => {
    const body = `intro\n\n    <table><tr><td>Problem</td><td>A bug.</td></tr></table>`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(requiredLeadRowsError({ rows: [] }));
  });

  it("ends a table in a list item at a line indented less than it (fallback review r3)", () => {
    const pair = "- Lead\n\n  | | |\n  |---|---|\n  | **Risk** | Low. |\n  | **Blast radius** | One page. |";
    const body = `${pair}\nSee the table below.\n| | |\n|---|---|\n| **Problem** | A bug. |`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(requiredLeadRowsError({ rows: [] }));
  });

  it("reads an unclosed < as text, never a tag swallowing the next table (fallback review r3)", () => {
    const pair = "| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | only requests under <p95 latency |";
    const body = `${pair}\n\n| Before -> after | |\n|---|---|\n| **Problem** | A bug. |`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain(
      'the rows above Problem here are "Before -> after".',
    );
    expect(prBodyLeadRowsError({ sourceProblem: true, body: `${pair}\n| **Problem** | A bug. |` })).toBe(undefined);
  });

  it("reads only as many cells as a GFM header has (fallback review r3)", () => {
    const body = "| |\n|---|\n| **Risk** | Low. |\n| **Blast radius** | One page. |\n| **Problem** | A bug. |";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** and **Blast radius** row is empty. Say what it asks, plainly.",
    );
  });

  it("does not crash on a line holding only a pipe", () => {
    expect(prBodyLeadRowsError({ sourceProblem: true, body: `|\n${htmlBody({ lead: PAIR })}` })).toBe(undefined);
  });

  it("reads *Risk*, _Risk_ and __Risk__ labels as the Risk they render as", () => {
    const labels = ["*Risk*", "_Risk_", "__Risk__", "***Risk***"];
    const bodies = labels.map(
      (label) => `| | |\n|---|---|\n| ${label} | Low. |\n| _Blast radius_ | x |\n| **Problem** | A bug. |`,
    );
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual(
      labels.map(() => undefined),
    );
  });

  it("reads a processing instruction as markup that says nothing", () => {
    const body = "| | |\n|---|---|\n| **Risk** | <?todo?> |\n| **Blast radius** | x |\n| **Problem** | A bug. |";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("accepts a Next table and a main table split by a thematic break", () => {
    const body =
      "| | |\n|---|---|\n| 👉 **Next** | Merge it. |\n---\n| | |\n|---|---|\n| **Risk** | Low. |\n| **Blast radius** | One page. |\n| **Problem** | A bug. |";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("does not pull a piped prose line above the header into the table", () => {
    const body = [
      "Checked on Chrome | Safari",
      "| | |",
      "|---|---|",
      "| **Risk** | Low. |",
      "| **Blast radius** | x |",
      "| **Problem** | A bug. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("refuses a piped Problem line no GFM table draws, since the Problem checks still read it", () => {
    const body = ["| **Risk** | Low. |", "| **Blast radius** | x |", "| **Problem** | A bug. |"].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(requiredLeadRowsError({ rows: [] }));
  });

  it("reads fenced or code-spanned rows inside an open table as the code GitHub draws them, not its lead pair", () => {
    const risk = "<tr><td><strong>Risk</strong></td><td>Low.</td></tr>";
    const blast = "<tr><td><strong>Blast radius</strong></td><td>Settings page.</td></tr>";
    const rest = ["<tr><td><strong>Problem</strong></td><td>A bug.</td></tr>", "</table>"];
    const fenced = ["<table>", "", "```", risk, blast, "```", "", ...rest].join("\n");
    const spanned = ["<table>", "", `\`${risk}${blast}\``, "", ...rest].join("\n");
    expect(prBodyLeadRowsError({ sourceProblem: true, body: fenced })).toBe(requiredLeadRowsError({ rows: [] }));
    expect(prBodyLeadRowsError({ sourceProblem: true, body: spanned })).toBe(requiredLeadRowsError({ rows: [] }));
  });

  it("reads the implicit row a <td> straight after <table> opens as the table's first row (fallback review r3, round 11)", () => {
    const rows =
      "<tr><td>Risk</td><td>a</td></tr><tr><td>Blast radius</td><td>a</td></tr><tr><td>Problem</td><td>a</td>";
    expect(prBodyLeadRowsError({ sourceProblem: true, body: `<table><td>x${rows}` })).toContain(
      'the rows above Problem here are "x", "Risk"',
    );
  });

  it("judges a drawn row whose only cell is Problem (fallback review r3, round 11 fuzz)", () => {
    const body = "<table><tr><td>Summary</td><td>x</td></tr><tr><td>Problem</td></tr></table>";
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain('the rows above Problem here are "Summary"');
  });

  it("never lets literal backticks in an HTML block merge two tables and lend the first one's pair", () => {
    const body = [
      "<table>",
      "<tr><td><strong>Risk</strong></td><td>Low.</td></tr>",
      "<tr><td><strong>Blast radius</strong></td><td>The ` shortcut.</td></tr>",
      "</table>",
      "<table>",
      "<tr><td><strong>Before</strong></td><td>Pressing ` did nothing.</td></tr>",
      "<tr><td><strong>Problem</strong></td><td>A bug.</td></tr>",
      "</table>",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain('the rows above Problem here are "Before"');
  });

  it("reads a span closed by a backtick inside a comment or an attribute, which the tag rewrite deletes", () => {
    const rows =
      "<tr><td><strong>Risk</strong></td><td>Low.</td></tr><tr><td><strong>Blast radius</strong></td><td>Page.</td></tr>";
    const rest = ["<tr><td><strong>Problem</strong></td><td>A bug.</td></tr>", "</table>"];
    const closers = ["<!-- ` -->", "<i title='`'>x</i>"];
    expect(
      closers.map((closer) =>
        prBodyLeadRowsError({
          sourceProblem: true,
          body: ["<table>", "", `\`${rows} ${closer}`, "", ...rest].join("\n"),
        }),
      ),
    ).toStrictEqual([requiredLeadRowsError({ rows: [] }), requiredLeadRowsError({ rows: [] })]);
  });

  it("refuses a table whose leading rows sit inside backticks GitHub draws literally, never promoting a later pair", () => {
    const body = [
      "<table>",
      "<caption>Press ` to open</caption>",
      "<tr><td><strong>Risk</strong></td><td></td></tr>",
      "<tr><td><strong>Blast radius</strong></td><td>` again</td></tr>",
      "<tr><td><strong>Risk</strong></td><td>Low.</td></tr>",
      "<tr><td><strong>Blast radius</strong></td><td>Settings page.</td></tr>",
      "<tr><td><strong>Problem</strong></td><td>A bug.</td></tr>",
      "</table>",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("accepts a Problem example shown inside code under a drawn table carrying the pair", () => {
    const table = [
      "<table>",
      "<tr><td>Risk</td><td>Low.</td></tr>",
      "<tr><td>Blast radius</td><td>One page.</td></tr>",
      "<tr><td>Problem</td><td>A bug.</td></tr>",
      "</table>",
    ];
    expect(
      prBodyLeadRowsError({ body: [...table, "", "```html", ...table, "```"].join("\n"), sourceProblem: true }),
    ).toBe(undefined);
  });

  it("refuses a body whose only Problem the source reader finds is one no table draws (fallback review r12)", () => {
    const body = "<!--<td>Problem</td><td>hidden</td>-->\n\nprose";
    expect([true, false].map((sourceProblem) => prBodyLeadRowsError({ body, sourceProblem }))).toStrictEqual([
      requiredLeadRowsError({ rows: [] }),
      undefined,
    ]);
  });
});
