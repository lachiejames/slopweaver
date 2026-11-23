/**
 * Unit: a platform-authored table on an atlas page — rows capped with the true count kept, every cell
 * escaped, an empty table saying so, and no section at all when no atlas draws one.
 */
import { describe, expect, it } from "vitest";

import {
  type AtlasPageDetailTable,
  detailTablesSection,
  escapeHtml,
  pageDetailTables,
} from "../../../../atlas/kit/pageTable.js";

const TABLE: AtlasPageDetailTable = {
  columns: ["name", "what"],
  id: "things",
  note: "Notes <b>are</b> escaped",
  rows: [
    ["one", "<script>"],
    ["two", "a & b"],
    ["three", "'q'"],
  ],
  title: "Things",
};

describe("escapeHtml", () => {
  it("replaces every HTML-significant character", () => {
    expect(escapeHtml({ value: `<a href="x">'&'</a>` })).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("pageDetailTables", () => {
  it("carries nothing for an atlas that draws no table", () => {
    expect(pageDetailTables({ rowCap: 10, tables: undefined })).toStrictEqual([]);
  });

  it("caps the rows and keeps the whole count", () => {
    const [view] = pageDetailTables({ rowCap: 2, tables: [TABLE] });
    expect(view!.rowCount).toBe(3);
    expect(view!.rows).toStrictEqual([
      ["one", "<script>"],
      ["two", "a & b"],
    ]);
  });
});

describe("detailTablesSection", () => {
  it("draws nothing when there are no tables", () => {
    expect(detailTablesSection({ tables: [] })).toBe("");
  });

  it("draws a capped table collapsed, escaped, saying how many it shows", () => {
    const html = detailTablesSection({ tables: pageDetailTables({ rowCap: 2, tables: [TABLE] }) });
    expect(html).toContain("<h2>From the platform</h2>");
    expect(html).toContain("<details><summary>Things (3)</summary>");
    expect(html).toContain("<p>Notes &lt;b&gt;are&lt;/b&gt; escaped</p>");
    expect(html).toContain("Showing 2 of 3; the atlas holds them all.");
    expect(html).toContain("<td>one</td><td>&lt;script&gt;</td>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("three");
  });

  it("says an empty table holds no rows", () => {
    const html = detailTablesSection({ tables: pageDetailTables({ rowCap: 2, tables: [{ ...TABLE, rows: [] }] }) });
    expect(html).toContain("No rows: the atlas holds none.");
    expect(html).not.toContain("Showing");
  });
});
