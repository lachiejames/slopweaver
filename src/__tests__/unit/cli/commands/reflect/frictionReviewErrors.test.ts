import { describe, expect, it } from "vitest";

import { FrictionReviewRunErrors } from "../../../../../cli/commands/reflect/frictionReviewErrors.js";
import { FrictionReviewPageErrors } from "../../../../../reflect/frictionReviewPageErrors.js";

describe("FrictionReviewRunErrors", () => {
  it("names the page a failed stamp leaves published, so the recovery knows it exists", () => {
    const failure = FrictionReviewRunErrors.stampUnwritable({
      cause: new Error("EACCES"),
      pageUrl: "file:///h/pages/friction-review-13oct/index.html",
    });
    expect(failure.message).toBe(
      "reflect friction-review: could not write the stamp: EACCES — the page itself was published at file:///h/pages/friction-review-13oct/index.html",
    );
  });

  it("names no page for a failed stamp under --mark-published", () => {
    const failure = FrictionReviewRunErrors.stampUnwritable({ cause: new Error("EACCES"), pageUrl: null });
    expect(failure.message).toBe("reflect friction-review: could not write the stamp: EACCES");
  });

  it("says nothing was stamped on a refused page, carrying the renderer's own refusal", () => {
    const refusal = FrictionReviewPageErrors.noReportHeading();
    const failure = FrictionReviewRunErrors.pageRefused({ path: "/h/morning/self-improvement-2026-10-13.md", refusal });
    expect(failure.refusal).toStrictEqual(refusal);
    expect(failure.message).toBe(
      "reflect friction-review --republish: /h/morning/self-improvement-2026-10-13.md: the report has no `# ` heading, so the page has no title — is this a self-improvement report? — nothing was stamped",
    );
  });
});
