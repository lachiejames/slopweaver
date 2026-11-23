/**
 * The fixtures here are SYNTHETIC, and that is a rule rather than a convenience.
 *
 * The grammar they exercise was censused from 38 real page bodies of the owner's live workspace, but no byte
 * of that workspace appears below: real Notion prose carries customer names, staff member names and internal
 * domains, and this repository may not contain a private identifier even fragmented. So the SHAPES are real
 * and the CONTENT is invented — which is also what makes each assertion readable, since a reader can see the
 * input that produced it.
 */
import { describe, expect, it } from "vitest";

import type { NotionMdContainer, NotionMdMention, NotionMdTable } from "../../../../corpus/notion/markdownNodes.js";
import { childrenText } from "../../../../corpus/notion/markdownProjection.js";
import { projectNotionMarkdown } from "../../../../corpus/notion/projectNotionMarkdown.js";

/** The first node of a given kind, for a test that has just asserted the tree holds one. */
const firstOfKind = <T extends { kind: string }>({
  nodes,
  kind,
}: {
  nodes: readonly { kind: string }[];
  kind: string;
}): T => nodes.find((node) => node.kind === kind) as T;

describe("projectNotionMarkdown", () => {
  it("returns empty everything for an empty body", () => {
    const projected = projectNotionMarkdown({ markdown: "" });
    expect(projected.text).toBe("");
    expect(projected.tree).toEqual([]);
    expect(projected.childPageUrls).toEqual([]);
    expect(projected.gaps).toEqual([]);
    expect(projected.borrowsContent).toBe(false);
  });

  it("keeps plain markdown as a verbatim text run", () => {
    const projected = projectNotionMarkdown({ markdown: "## Heading\n\n- one\n- two" });
    expect(projected.text).toBe("## Heading\n\n- one\n- two");
    expect(projected.tree.length).toBe(1);
    expect(projected.tree[0]?.kind).toBe("text");
  });

  it("keeps a table's ROW structure rather than flattening its cells", () => {
    const markdown = [
      '<table header-row="true">',
      "<tr><td>Control</td><td>Owner</td></tr>",
      "<tr><td>Backups</td><td>Platform</td></tr>",
      "<tr><td>Access review</td><td>Security</td></tr>",
      "</table>",
    ].join("\n");
    const projected = projectNotionMarkdown({ markdown });
    const table = firstOfKind<NotionMdTable>({ kind: "table", nodes: projected.tree });
    expect(table.headerRow).toBe(true);
    expect(table.headerColumn).toBe(false);
    expect(table.rows).toEqual([
      ["Control", "Owner"],
      ["Backups", "Platform"],
      ["Access review", "Security"],
    ]);
    expect(projected.text).toBe("Control | Owner\nBackups | Platform\nAccess review | Security");
  });

  it("types a child page as a reference and never as inlined content", () => {
    const markdown = '<page url="https://notion.so/abc123">Quarterly plan</page>';
    const projected = projectNotionMarkdown({ markdown });
    expect(projected.childPageUrls).toEqual(["https://notion.so/abc123"]);
    expect(projected.text).toBe("Quarterly plan");
    expect(projected.tree[0]?.kind).toBe("childPage");
  });

  it("reads mention-page in BOTH the self-closing and the container shape", () => {
    const projected = projectNotionMarkdown({
      markdown:
        '<mention-page url="https://notion.so/p1"/> and <mention-page url="https://notion.so/p2">Runbook</mention-page>',
    });
    expect(projected.mentionUrls).toEqual(["https://notion.so/p1", "https://notion.so/p2"]);
    const mentions = projected.tree.filter((node): node is NotionMdMention => node.kind === "mention");
    expect(mentions.length).toBe(2);
    expect(mentions[0]?.text).toBe("");
    expect(mentions[1]?.text).toBe("Runbook");
  });

  it("keeps an unknown block as a node instead of swallowing it", () => {
    const projected = projectNotionMarkdown({
      markdown: 'before <unknown url="https://notion.so/blk9" alt="bookmark"/> after',
    });
    expect(projected.unknownUrls).toEqual(["https://notion.so/blk9"]);
    expect(projected.text).toContain("[unreadable bookmark]");
  });

  it("marks a body that inlines a database as borrowing content", () => {
    const projected = projectNotionMarkdown({
      markdown:
        '<database url="https://notion.so/db1" inline="true" data-source-url="https://notion.so/ds1">Risks</database>',
    });
    expect(projected.borrowsContent).toBe(true);
    expect(projected.childDatabaseUrls).toEqual(["https://notion.so/db1"]);
  });

  it("lifts inline discussion urls off a span and drops the wrapper", () => {
    const projected = projectNotionMarkdown({
      markdown: '<span discussion-urls="https://notion.so/d1,https://notion.so/d2">contested sentence</span>',
    });
    expect(projected.discussionUrls).toEqual(["https://notion.so/d1", "https://notion.so/d2"]);
    expect(projected.text).toBe("contested sentence");
  });

  it("records media as a reference carrying its caption", () => {
    const projected = projectNotionMarkdown({ markdown: '<file src="https://files.notion.so/x.pdf">Policy</file>' });
    expect(projected.mediaSrcs).toEqual(["https://files.notion.so/x.pdf"]);
    expect(projected.text).toBe("Policy (https://files.notion.so/x.pdf)");
  });

  it("does not lex a code fence, so markup inside it survives verbatim", () => {
    const markdown = '```ts\nconst html = "<page url=\\"nope\\">";\n```';
    const projected = projectNotionMarkdown({ markdown });
    expect(projected.childPageUrls).toEqual([]);
    expect(projected.tree[0]?.kind).toBe("code");
    expect(projected.text).toBe('const html = "<page url=\\"nope\\">";');
  });

  it("nests containers and still lifts a url from a cell six levels down", () => {
    const markdown = [
      '<callout icon="warn">',
      "<columns><column>",
      "<details><summary>More</summary>",
      '<table><tr><td><page url="https://notion.so/deep">Deep</page></td></tr></table>',
      "</details>",
      "</column></columns>",
      "</callout>",
    ].join("\n");
    const projected = projectNotionMarkdown({ markdown });
    expect(projected.childPageUrls).toEqual(["https://notion.so/deep"]);
    const callout = firstOfKind<NotionMdContainer>({ kind: "callout", nodes: projected.tree });
    expect(callout.label).toBe("warn");
    expect(projected.text).toContain("Deep");
  });

  it("reports an unmodelled tag as a named gap and keeps its text", () => {
    const projected = projectNotionMarkdown({ markdown: "<equation>E=mc2</equation><equation>x</equation>" });
    expect(projected.gaps).toEqual([{ count: 2, tag: "equation" }]);
    expect(projected.text).toBe("E=mc2\n\nx");
  });

  it("survives an unclosed tag rather than losing the rest of the body", () => {
    const projected = projectNotionMarkdown({ markdown: '<callout icon="x">opened and never closed' });
    expect(projected.text).toBe("opened and never closed");
    expect(projected.gaps).toEqual([]);
  });

  it("does not let an unclosed <col> swallow the table that follows it", () => {
    // Notion writes `col` and `br` the HTML way — no closing tag, no self-closing slash. Read as containers
    // they consume the rest of the stream: on one real page this ate 170 of 176 cells and 46 of 48 rows.
    const markdown = [
      '<table header-row="true">',
      '<colgroup><col><col width="200"><col width="120"></colgroup>',
      "<tr><td>Metric</td><td>Value</td></tr>",
      "<tr><td>Latency</td><td>210ms</td></tr>",
      "</table>",
    ].join("");
    const table = firstOfKind<NotionMdTable>({ kind: "table", nodes: projectNotionMarkdown({ markdown }).tree });
    expect(table.rows).toEqual([
      ["Metric", "Value"],
      ["Latency", "210ms"],
    ]);
  });

  it("does not let an unclosed <br> swallow the cells after it", () => {
    const markdown = "<table><tr><td>one<br>two</td><td>three</td></tr><tr><td>four</td><td>five</td></tr></table>";
    const table = firstOfKind<NotionMdTable>({ kind: "table", nodes: projectNotionMarkdown({ markdown }).tree });
    expect(table.rows).toEqual([
      ["one\n\ntwo", "three"],
      ["four", "five"],
    ]);
  });

  it("treats a bare angle bracket in prose as text, not as a tag", () => {
    const projected = projectNotionMarkdown({ markdown: "latency < 200ms and p99 > 1s" });
    expect(projected.text).toBe("latency < 200ms and p99 > 1s");
    expect(projected.gaps).toEqual([]);
  });
});

describe("childrenText", () => {
  it("joins node text with a blank line and drops a whitespace-only node", () => {
    const text = childrenText({
      nodes: [
        { kind: "text", text: "first" },
        { kind: "text", text: "   " },
        { kind: "code", language: "ts", text: "second" },
      ],
    });
    expect(text).toBe("first\n\nsecond");
  });

  it("renders a nameless reference and a nameless mention as named stand-ins", () => {
    const text = childrenText({
      nodes: [
        { dataSourceUrl: undefined, kind: "childPage", title: "", url: undefined },
        { kind: "mention", target: "user", text: "", url: undefined },
      ],
    });
    expect(text).toBe("[unnamed reference]\n\n[unnamed mention]");
  });
});
