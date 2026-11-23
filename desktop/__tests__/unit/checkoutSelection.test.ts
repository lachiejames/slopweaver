/**
 * The clone picker's answer, read: a chosen folder is the path to validate, and a cancel or an empty answer is no
 * choice at all, which leaves the standing note as it was.
 */
import { describe, expect, it } from "vitest";

import { chosenFolder } from "../../src/checkoutSelection";
import { CheckoutErrors, ConsoleErrors, isCheckoutProblem } from "../../src/errors";

describe("chosenFolder", () => {
  it("is the folder the picker chose", () => {
    expect(chosenFolder({ canceled: false, filePaths: ["/Users/someone/code/slopweaver"] })).toBe(
      "/Users/someone/code/slopweaver",
    );
  });

  it("is no choice when the picker was cancelled, whatever it carried", () => {
    expect(chosenFolder({ canceled: true, filePaths: ["/Users/someone/code/slopweaver"] })).toBe(undefined);
  });

  it("is no choice when the answer names no folder", () => {
    expect(chosenFolder({ canceled: false, filePaths: [] })).toBe(undefined);
  });
});

describe("isCheckoutProblem", () => {
  it("is every checkout failure, the picker's own included", () => {
    expect(isCheckoutProblem({ failure: CheckoutErrors.unset() })).toBe(true);
    expect(isCheckoutProblem({ failure: CheckoutErrors.invalid({ path: "/c/gone" }) })).toBe(true);
    expect(isCheckoutProblem({ failure: CheckoutErrors.selectionFailed({ cause: "denied" }) })).toBe(true);
  });

  it("is not a console that failed to start", () => {
    const failure = ConsoleErrors.processFailed({ command: "docs-site.sh --serve", detail: "Error: <port> in use" });
    expect(isCheckoutProblem({ failure })).toBe(false);
  });
});
