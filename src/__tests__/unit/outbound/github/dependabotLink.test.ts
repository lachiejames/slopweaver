import { describe, expect, it } from "vitest";

import {
  dependabotAlertLink,
  dependabotAlertLinks,
  dependabotAlertUrl,
  isDependabotAlertUrl,
} from "../../../../outbound/github/dependabotLink.js";

describe("dependabotAlertUrl", () => {
  it("builds the security path, not the issue path", () => {
    expect(dependabotAlertUrl({ number: 583, owner: "acme", repo: "widget" })).toBe(
      "https://github.com/acme/widget/security/dependabot/583",
    );
  });
});

describe("isDependabotAlertUrl", () => {
  it("accepts an alert URL", () => {
    expect(isDependabotAlertUrl({ url: "https://github.com/acme/widget/security/dependabot/583" })).toBe(true);
  });

  it("refuses the pull-request URL of the same number", () => {
    expect(isDependabotAlertUrl({ url: "https://github.com/acme/widget/pull/583" })).toBe(false);
  });

  it("refuses the issue URL the bare-reference resolver used to build", () => {
    expect(isDependabotAlertUrl({ url: "https://github.com/acme/widget/issues/583" })).toBe(false);
  });
});

describe("dependabotAlertLink", () => {
  it("labels the run with the number and points it at the alert", () => {
    expect(dependabotAlertLink({ number: 583, owner: "acme", repo: "widget" })).toEqual({
      kind: "link",
      text: "#583",
      url: "https://github.com/acme/widget/security/dependabot/583",
    });
  });
});

describe("dependabotAlertLinks", () => {
  it("separates several alerts with a comma run between the links", () => {
    expect(dependabotAlertLinks({ numbers: [583, 640], owner: "acme", repo: "widget" })).toEqual([
      { kind: "link", text: "#583", url: "https://github.com/acme/widget/security/dependabot/583" },
      { kind: "text", text: ", " },
      { kind: "link", text: "#640", url: "https://github.com/acme/widget/security/dependabot/640" },
    ]);
  });

  it("emits one link and no separator for a single alert", () => {
    expect(dependabotAlertLinks({ numbers: [7], owner: "acme", repo: "widget" })).toEqual([
      { kind: "link", text: "#7", url: "https://github.com/acme/widget/security/dependabot/7" },
    ]);
  });

  it("emits nothing at all for an empty list", () => {
    expect(dependabotAlertLinks({ numbers: [], owner: "acme", repo: "widget" })).toEqual([]);
  });
});
