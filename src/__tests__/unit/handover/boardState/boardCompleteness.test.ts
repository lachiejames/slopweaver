/*
 * `boardCompleteness` — every scanned root produced a model, across every section, and a dropped root is named by
 * slug. It moved here when `boardState.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { boardCompleteness } from "../../../../handover/boardState.js";
import { compose, doc } from "./harness.js";

describe("boardCompleteness", () => {
  it("is complete when every scanned root produced a model — a finished, no-probe doc included", () => {
    // The exact shape that went missing from a real listing: authored `done`, no `doneWhen:`/`outputs:`,
    // no `blockedBy` — see handover-list-omits-a-fresh-doc.
    const finished = doc({ slug: "notion-update-break-glass-over-external-edit", status: "done" });
    const models = compose({ roots: [finished] });
    expect(boardCompleteness({ models, roots: [finished] })).toEqual({ complete: true, missing: [] });
  });

  it("is complete across every section a real board prints, not only DONE", () => {
    const roots = [
      doc({ slug: "a", status: "ready" }),
      doc({ slug: "b", status: "draft" }),
      doc({ slug: "c", status: "cancelled" }),
      doc({ slug: "d", status: "done" }),
    ];
    const models = compose({ roots });
    expect(boardCompleteness({ models, roots })).toEqual({ complete: true, missing: [] });
  });

  it("names the slug when a root scanned by the board produced no model", () => {
    const roots = [doc({ slug: "a" }), doc({ slug: "b" })];
    const models = compose({ roots: [roots[0]!] }); // "b" never composed — the drop this guards against
    expect(boardCompleteness({ models, roots })).toEqual({ complete: false, missing: ["b"] });
  });
});
