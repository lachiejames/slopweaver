import { describe, expect, it } from "vitest";
import { classifyOpportunityToken, isConcreteRefToken } from "../../../silver/opportunityToken.js";

describe("classifyOpportunityToken", () => {
  it("classes an issue/PR number and a ticket key as concrete", () => {
    expect(classifyOpportunityToken({ token: "#123" })).toBe("concrete");
    expect(classifyOpportunityToken({ token: "TEAM-123" })).toBe("concrete");
  });

  it("classes a URL with a real path as concrete, a bare host as generic", () => {
    expect(classifyOpportunityToken({ token: "https://demo.example.com/web/pull/101" })).toBe("concrete");
    expect(classifyOpportunityToken({ token: "https://demo.example.com/" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "https://www.apache.org/licenses/LICENSE-2.0" })).toBe("generic");
  });

  it("classes a real handle as a mention — a person, not a shared artifact", () => {
    expect(classifyOpportunityToken({ token: "@octo-dev" })).toBe("mention");
  });

  it("classes an email-provider domain fragment as generic (the `@gmail` frequency artifact)", () => {
    expect(classifyOpportunityToken({ token: "@gmail" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "@icloud" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "@example" })).toBe("generic");
  });

  it("classes an integration handle and a JSDoc tag as generic", () => {
    expect(classifyOpportunityToken({ token: "@integration" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "@githubcopilot" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "@param" })).toBe("generic");
  });

  it("is case-insensitive on the generic set but exact on the token shape", () => {
    expect(classifyOpportunityToken({ token: "@GMail" })).toBe("generic");
    expect(classifyOpportunityToken({ token: "team-123" })).toBe("other");
    expect(classifyOpportunityToken({ token: "just words" })).toBe("other");
    expect(classifyOpportunityToken({ token: "" })).toBe("other");
  });

  it("admits only the concrete class as a cross-container signal", () => {
    expect(isConcreteRefToken({ token: "TEAM-7" })).toBe(true);
    expect(isConcreteRefToken({ token: "@octo-dev" })).toBe(false);
    expect(isConcreteRefToken({ token: "@gmail" })).toBe(false);
  });
});
