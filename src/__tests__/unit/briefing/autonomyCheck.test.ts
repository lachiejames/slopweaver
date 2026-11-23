import { describe, expect, it } from "vitest";

import { checkAutonomy } from "../../../briefing/autonomyCheck.js";
import { AUTONOMY_MAX_ROWS } from "../../../briefing/caps.js";

/** One rendered act, in exactly the bytes `../../../outbound/briefing/render.ts` emits. */
function renderedAct({
  actionId = "16644-enqueue",
  stamp = "2026-09-12 12:06:09 AEST",
  session = "workspace:123",
}: {
  actionId?: string;
  stamp?: string;
  session?: string;
} = {}): string {
  return (
    '<div class="act"><p class="q">press merge when ready — ' +
    '<a href="https://github.com/acme/acme-admin/pull/16644">acme/acme-admin#16644</a> ' +
    `<span class="bg">${stamp} · ${session}</span></p>` +
    "<details><summary>why, and what witnesses it</summary><div>" +
    "<p><strong>Why:</strong> CI green, mergeable, no code-owner request outstanding</p>" +
    "<p><strong>Witness:</strong> <code>slopweaver github enqueue --pr 16644</code></p>" +
    `<p class="bg">workspace:123 act-on-open-acme-admin-prs · act ${actionId}</p>` +
    "</div></details></div>"
  );
}

/** A page carrying the given rendered rows under the section heading. */
function page({ rows }: { rows: readonly string[] }): string {
  return `<main><h2 id="autonomy-ledger">done for you, without asking</h2>${rows.join("")}</main>`;
}

describe("a clean section", () => {
  it("counts the acts it read and finds nothing wrong", () => {
    const result = checkAutonomy({
      html: page({
        rows: [
          renderedAct({ actionId: "a-new", stamp: "2026-09-12 12:18:27 AEST" }),
          renderedAct({ actionId: "a-old", stamp: "2026-09-12 12:06:09 AEST" }),
        ],
      }),
    });
    expect(result.rowsChecked).toBe(2);
    expect(result.defects.length).toBe(0);
  });

  it("reads each row to its balanced close, so the fold's own div does not truncate it", () => {
    const result = checkAutonomy({ html: page({ rows: [renderedAct()] }) });
    expect(result.rowsChecked).toBe(1);
    expect(result.defects.length).toBe(0);
  });

  it("reports a page with no section at all as zero acts and no defects", () => {
    const result = checkAutonomy({ html: "<main><h2>react now</h2></main>" });
    expect(result.rowsChecked).toBe(0);
    expect(result.defects.length).toBe(0);
  });
});

describe("a row with no act id", () => {
  it("is a defect, because there is nothing for a steer to name", () => {
    const stripped = renderedAct().replace(" · act 16644-enqueue", "");
    const result = checkAutonomy({ html: page({ rows: [stripped] }) });
    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.rule).toBe("row-without-id");
    expect(result.defects[0]!.reason).toContain("1 act(s)");
  });
});

describe("an out-of-order section", () => {
  it("is a defect, because the owner reads the top row as the last thing the fleet did", () => {
    const result = checkAutonomy({
      html: page({
        rows: [
          renderedAct({ actionId: "a-old", stamp: "2026-09-12 12:06:09 AEST" }),
          renderedAct({ actionId: "a-new", stamp: "2026-09-12 12:18:27 AEST" }),
        ],
      }),
    });
    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.rule).toBe("out-of-order");
  });

  it("accepts two acts stamped at the same instant", () => {
    const result = checkAutonomy({
      html: page({
        rows: [
          renderedAct({ actionId: "a-one", stamp: "2026-09-12 12:15:51 AEST" }),
          renderedAct({ actionId: "a-two", stamp: "2026-09-12 12:15:51 AEST" }),
        ],
      }),
    });
    expect(result.defects.length).toBe(0);
  });
});

describe("too many rows", () => {
  it("is a defect once the section runs past the cap", () => {
    const rows = Array.from({ length: AUTONOMY_MAX_ROWS + 1 }, (_unused, index) =>
      renderedAct({ actionId: `a-${String(index)}`, stamp: "2026-09-12 12:06:09 AEST" }),
    );
    const result = checkAutonomy({ html: page({ rows }) });
    expect(result.defects.length).toBe(1);
    expect(result.defects[0]!.rule).toBe("too-many-rows");
  });

  it("accepts exactly the cap", () => {
    const rows = Array.from({ length: AUTONOMY_MAX_ROWS }, (_unused, index) =>
      renderedAct({ actionId: `a-${String(index)}`, stamp: "2026-09-12 12:06:09 AEST" }),
    );
    expect(checkAutonomy({ html: page({ rows }) }).defects.length).toBe(0);
  });
});
