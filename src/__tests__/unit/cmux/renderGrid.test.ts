/** The `terminal.replay` parse — asserted over one frozen real reply, and over the shapes it must refuse. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseRenderGrid } from "../../../cmux/renderGrid.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const FIXTURE = join(import.meta.dirname, "../../fixtures/composer/suggestion.json");

describe("parseRenderGrid over a real reply", () => {
  it("reads the grid's size and its cursor", () => {
    const grid = unwrap(parseRenderGrid({ value: JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown }));
    expect(grid.rows).toBe(37);
    expect(grid.columns).toBe(132);
    expect(grid.cursor).toStrictEqual({ column: 2, row: 34, visible: true });
  });

  it("resolves the composer span's style to the faint attribute the suggestion is drawn with", () => {
    const grid = unwrap(parseRenderGrid({ value: JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown }));
    const span = grid.spans.find((entry) => entry.text.startsWith("it's probably"))!;
    expect(span.row).toBe(34);
    const style = grid.styles.find((entry) => entry.id === span.styleId)!;
    expect(style.faint).toBe(true);
    expect(style.foreground).toBe("#FFFFFF");
  });
});

describe("parseRenderGrid refuses what it cannot use", () => {
  it("refuses a reply that is not an object", () => {
    expect(unwrapErr(parseRenderGrid({ value: "nope" })).code).toBe("MALFORMED_REPLY");
  });

  it("refuses a reply carrying no render_grid", () => {
    expect(unwrapErr(parseRenderGrid({ value: { rows: 37 } })).message).toBe(
      "cmux terminal.replay replied with an unusable shape: the reply carried no `render_grid`",
    );
  });

  it("drops an unusable span rather than failing the whole read", () => {
    const grid = unwrap(
      parseRenderGrid({
        value: {
          render_grid: {
            columns: 4,
            row_spans: [{ column: 0, row: 0, style_id: 0, text: "ok" }, { row: 1 }],
            rows: 2,
            styles: [{ faint: true, foreground: "#888888", id: 0 }],
          },
        },
      }),
    );
    expect(grid.spans).toStrictEqual([{ column: 0, row: 0, styleId: 0, text: "ok" }]);
    expect(grid.styles).toStrictEqual([{ bold: false, faint: true, foreground: "#888888", id: 0, italic: false }]);
    expect(grid.cursor).toBe(undefined);
  });
});
