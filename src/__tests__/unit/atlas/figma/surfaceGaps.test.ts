/*
 * The gap builders called directly on an empty kind file, with no store and no home: what each one opens,
 * and that a second pass over its own output re-opens nothing under a second id.
 */
import { describe, expect, it } from "vitest";

import { FIGMA_BROWSER_PAGES } from "../../../../atlas/figma/browserPages.js";
import { heldFigmaKindFile } from "../../../../atlas/figma/model.js";
import { methodGapsOnto, routeGapsOnto } from "../../../../atlas/figma/surfaceGaps.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-06T02:00:00.000Z";

describe("the gaps a Figma surface publish opens", () => {
  it("opens the pinned document's five findings on an empty method file, every one open", () => {
    const file = heldFigmaKindFile({ kind: "method", stored: null, updatedAt: AT });

    const result = methodGapsOnto({ at: AT, file });

    expect(result.isOk()).toBe(true);
    const gaps = unwrap(result).gaps;
    expect(gaps.map((gap) => gap.scope).toSorted()).toEqual([
      "api:root-enumeration",
      "endpoint:GET https://www.figma.com/oauth",
      "endpoint:POST https://api.figma.com/v1/oauth/refresh",
      "endpoint:POST https://api.figma.com/v1/oauth/token",
      "tag:Projects",
    ]);
    expect(gaps.map((gap) => gap.status)).toEqual(gaps.map(() => "open"));
  });

  it("opens one gap per prefix-only route on an empty page file, and none for a confirmed one", () => {
    const file = heldFigmaKindFile({ kind: "page", stored: null, updatedAt: AT });
    const prefixOnly = FIGMA_BROWSER_PAGES.filter((page) => page.evidence === "auth-gated-prefix");

    const result = routeGapsOnto({ at: AT, file });

    expect(result.isOk()).toBe(true);
    const gaps = unwrap(result).gaps;
    expect(gaps.map((gap) => gap.scope).toSorted()).toEqual(prefixOnly.map((page) => `route:${page.route}`).toSorted());
    expect(gaps.map((gap) => gap.condition)).toEqual(gaps.map(() => "browser-page-existence-unconfirmed"));
    expect(gaps.map((gap) => gap.scope)).not.toContain("route:/login");
  });

  it("re-opens nothing under a second id when run over its own output", () => {
    const empty = heldFigmaKindFile({ kind: "method", stored: null, updatedAt: AT });
    const first = unwrap(methodGapsOnto({ at: AT, file: empty }));

    const second = unwrap(methodGapsOnto({ at: "2026-09-07T02:00:00.000Z", file: first }));

    expect(second.gaps.map((gap) => gap.id)).toEqual(first.gaps.map((gap) => gap.id));
    expect(second.gaps.length).toBe(5);
  });
});
