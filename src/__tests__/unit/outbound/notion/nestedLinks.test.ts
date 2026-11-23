import { describe, expect, it } from "vitest";

import { nestedLinkIssues } from "../../../../outbound/notion/nestedLinks.js";

describe("nestedLinkIssues", () => {
  it("finds a link whose label is itself a link", () => {
    const issues = nestedLinkIssues({
      markdown: "| a | [[DDDD-839](https://linear.app/x/DDDD-839)](https://linear.app/x/DDDD-839) |",
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(1);
    expect(issues[0]!.message).toContain("whose LABEL is itself a link");
  });

  it("finds a link with another link spliced into its URL", () => {
    const issues = nestedLinkIssues({
      markdown: "see [the thread](https://linear.app/x/[DDDD-839](https://linear.app/x/DDDD-839)) for detail",
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain("whose URL has another link spliced into it");
  });

  it("reports the line number of each offending line", () => {
    const issues = nestedLinkIssues({
      markdown: ["intro", "| a | b |", "| [[x](https://e.com/x)](https://e.com/x) | b |"].join("\n"),
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(3);
  });

  it("passes an ordinary lone link", () => {
    expect(nestedLinkIssues({ markdown: "| [DDDD-839](https://linear.app/x/DDDD-839) |" }).length).toBe(0);
  });

  it("passes a cell that mixes prose with a link, which renders correctly", () => {
    expect(nestedLinkIssues({ markdown: "| see [the thread](https://linear.app/x) for detail |" }).length).toBe(0);
  });

  it("passes a link whose label equals its URL's last path segment", () => {
    expect(nestedLinkIssues({ markdown: "| [acme](https://www.notion.so/acme) |" }).length).toBe(0);
  });

  it("passes two separate links on one line", () => {
    expect(nestedLinkIssues({ markdown: "[a](https://e.com/a) and [b](https://e.com/b)" }).length).toBe(0);
  });

  it("passes a body with no links at all", () => {
    expect(nestedLinkIssues({ markdown: "just prose\n\nand more prose" }).length).toBe(0);
  });

  it("passes an empty body", () => {
    expect(nestedLinkIssues({ markdown: "" }).length).toBe(0);
  });
});
