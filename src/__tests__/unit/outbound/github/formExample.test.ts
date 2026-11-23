/**
 * The printed example is the object a caller copies, so it has to clear every check a real write runs: the
 * write schema, the render, the CI gate over the rendered bytes and the above-the-fold packing rules.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { prAboveFoldCells } from "../../../../outbound/github/aboveFold.js";
import { descriptionWordIssues } from "../../../../outbound/github/descriptionWords.js";
import { EXAMPLE_PR_FORM } from "../../../../outbound/github/formExample.js";
import { renderPrBody } from "../../../../outbound/github/render.js";
import { prFormEditSchema } from "../../../../outbound/github/schema.js";
import { stampForWrite } from "../../../../outbound/github/stamp.js";
import { prFormWriteSchema } from "../../../../outbound/github/writeSchema.js";
import { aboveFoldFindings } from "../../../../outbound/voice/aboveFold.js";
import { gatePrBody } from "../../../../prformat/prBodyGate.js";

describe("EXAMPLE_PR_FORM", () => {
  it("passes the write schema exactly as printed", () => {
    expect(prFormWriteSchema.safeParse(EXAMPLE_PR_FORM).success).toBe(true);
  });

  it("renders a description the CI gate accepts as C3 on an owned pull request", () => {
    const form = unwrap(stampForWrite({ draft: EXAMPLE_PR_FORM, today: "2026-10-01" }));
    expect(gatePrBody({ body: unwrap(renderPrBody({ form })), owned: true })).toStrictEqual({
      errors: [],
      shape: "c3",
    });
  });

  it("clears the above-the-fold packing rules", () => {
    const findings = aboveFoldFindings({ cells: prAboveFoldCells({ form: EXAMPLE_PR_FORM }), rules: [] });
    expect(findings.map((finding) => `${finding.path}: ${finding.code}`)).toStrictEqual([]);
  });

  it("models a top risk that names what breaks and what checked it, never a placeholder", () => {
    expect(EXAMPLE_PR_FORM.risk.items[0]).toStrictEqual({
      check: { check: "The round-trip test covers a sheet ending on a blank line", kind: "checked" },
      worst: "an export refuses a sheet it used to read",
      worstKind: "something-working-breaks",
    });
  });

  it("models words a teammate reads, so the content rules find nothing in it", () => {
    expect(descriptionWordIssues({ body: EXAMPLE_PR_FORM, title: EXAMPLE_PR_FORM.title })).toStrictEqual([]);
  });

  it("carries no retired field, so a copied example never models a refused shape", () => {
    expect(
      ["origin", "review", "goldAnchor", "reviewers", "reviewLeftovers", "writtenOn"].filter((key) =>
        Object.hasOwn(EXAMPLE_PR_FORM, key),
      ),
    ).toStrictEqual([]);
  });

  it("names no first person anywhere in its prose", () => {
    const prose = prAboveFoldCells({ form: EXAMPLE_PR_FORM })
      .map((cell) => cell.text)
      .join(" ");
    expect(prose.match(/\b(?:I|me|my|we|our|us)\b/gi)).toBe(null);
  });

  it("the example's explainer is a valid edit on its own", () => {
    expect(prFormEditSchema.safeParse({ explainer: EXAMPLE_PR_FORM.explainer }).success).toBe(true);
  });
});
