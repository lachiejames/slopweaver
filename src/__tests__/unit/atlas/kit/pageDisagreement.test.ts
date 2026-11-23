/**
 * Where an atlas's API and browser channels disagree about a page — reported, never resolved, and each of the
 * three findings carrying its own reason.
 */
import { describe, expect, it } from "vitest";

import { type AtlasPageEntity, atlasPageDisagreementReport } from "../../../../atlas/kit/pageDisagreement.js";

const UNWITNESSED = "no walk of the example console has landed here yet";

/** A channel view carrying `link` as its deep link and `detail` as its opaque platform detail. */
const view = ({ link, detail = {} }: { link: string | null; detail?: unknown }): AtlasPageEntity["declared"] => ({
  detail,
  source: { deepLink: link },
});

describe("atlasPageDisagreementReport", () => {
  it("reports nothing for a page both channels hold and the walk reached", () => {
    const report = atlasPageDisagreementReport({
      pages: [
        {
          declared: view({ link: "https://example.test/a" }),
          providerId: "a",
          witnessed: view({ detail: { unreachableBecause: null }, link: "https://example.test/a" }),
        },
      ],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report).toEqual({ declaredCount: 1, disagreements: [], witnessedCount: 1 });
  });

  it("reports a declared page no walk has seen with the caller's reason and the declared address", () => {
    const report = atlasPageDisagreementReport({
      pages: [{ declared: view({ link: "https://example.test/b" }), providerId: "b", witnessed: null }],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report).toEqual({
      declaredCount: 1,
      disagreements: [
        { finding: "declared-and-unwitnessed", providerId: "b", reason: UNWITNESSED, url: "https://example.test/b" },
      ],
      witnessedCount: 0,
    });
  });

  it("reports a declared page the walk could not open with the walk's own reason", () => {
    const report = atlasPageDisagreementReport({
      pages: [
        {
          declared: view({ link: "https://example.test/c" }),
          providerId: "c",
          witnessed: view({ detail: { unreachableBecause: "the role cannot reach it" }, link: null }),
        },
      ],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report.disagreements).toEqual([
      {
        finding: "declared-and-unreachable",
        providerId: "c",
        reason: "the role cannot reach it",
        url: "https://example.test/c",
      },
    ]);
  });

  it("reports a page only the walk saw, addressed by the witnessed link", () => {
    const report = atlasPageDisagreementReport({
      pages: [{ declared: null, providerId: "d", witnessed: view({ link: "https://example.test/d" }) }],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report).toEqual({
      declaredCount: 0,
      disagreements: [
        { finding: "witnessed-and-undeclared", providerId: "d", reason: null, url: "https://example.test/d" },
      ],
      witnessedCount: 1,
    });
  });

  it("reports nothing, and counts nothing, for a page neither channel holds", () => {
    const report = atlasPageDisagreementReport({
      pages: [{ declared: null, providerId: "e", witnessed: null }],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report).toEqual({ declaredCount: 0, disagreements: [], witnessedCount: 0 });
  });

  it("reads an empty or non-string unreachableBecause as a page the walk reached", () => {
    const report = atlasPageDisagreementReport({
      pages: [
        {
          declared: view({ link: "/f" }),
          providerId: "f",
          witnessed: view({ detail: { unreachableBecause: "" }, link: "/f" }),
        },
        {
          declared: view({ link: "/g" }),
          providerId: "g",
          witnessed: view({ detail: { unreachableBecause: 3 }, link: "/g" }),
        },
        { declared: view({ link: "/h" }), providerId: "h", witnessed: view({ detail: "opaque", link: "/h" }) },
      ],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report).toEqual({ declaredCount: 3, disagreements: [], witnessedCount: 3 });
  });

  it("falls back to the witnessed address when the declared channel carries no link", () => {
    const report = atlasPageDisagreementReport({
      pages: [
        {
          declared: view({ link: null }),
          providerId: "i",
          witnessed: view({
            detail: { unreachableBecause: "it redirected to sign-in" },
            link: "https://example.test/i",
          }),
        },
      ],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report.disagreements.map((disagreement) => disagreement.url)).toEqual(["https://example.test/i"]);
  });

  it("sorts disagreements by provider id so a printed report is stable", () => {
    const report = atlasPageDisagreementReport({
      pages: [
        { declared: view({ link: "/z" }), providerId: "z", witnessed: null },
        { declared: view({ link: "/m" }), providerId: "m", witnessed: null },
        { declared: view({ link: "/a" }), providerId: "a", witnessed: null },
      ],
      unwitnessedReason: UNWITNESSED,
    });

    expect(report.disagreements.map((disagreement) => disagreement.providerId)).toEqual(["a", "m", "z"]);
  });

  it("reports an empty generation as empty", () => {
    expect(atlasPageDisagreementReport({ pages: [], unwitnessedReason: UNWITNESSED })).toEqual({
      declaredCount: 0,
      disagreements: [],
      witnessedCount: 0,
    });
  });
});
