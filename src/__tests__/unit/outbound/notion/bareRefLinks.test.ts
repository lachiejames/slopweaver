import { describe, expect, it } from "vitest";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import { linkifyPageBody } from "../../../../outbound/notion/bareRefLinks.js";

const CONTEXT: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };
const NO_CONTEXT: BareRefContext = { repos: [] };

describe("linkifyPageBody", () => {
  it("rewrites a resolvable reference into a markdown link", () => {
    const result = linkifyPageBody({ context: CONTEXT, markdown: "fixed in #42 today" });
    expect(result.markdown).toBe("fixed in [#42](https://github.com/acme/widget/issues/42) today");
    expect(result.issues.length).toBe(0);
  });

  it("reports every reference still bare, addressed to body", () => {
    const result = linkifyPageBody({ context: NO_CONTEXT, markdown: "closed: 100, 200" });
    expect(result.markdown).toBe("closed: 100, 200");
    expect(result.issues.length).toBe(2);
    expect(result.issues[0]!.path).toEqual(["body"]);
  });
});

describe("linkifyPageBody leaves text that is ALREADY a link alone", () => {
  it("does not re-linkify a reference used as a link's own label", () => {
    const markdown = "[#42](https://github.com/acme/widget/issues/42)";
    expect(linkifyPageBody({ context: CONTEXT, markdown }).markdown).toBe(markdown);
  });

  it("does not rewrite a reference sitting inside a link's URL", () => {
    const markdown = "[the fix](https://github.com/acme/widget/issues/42)";
    expect(linkifyPageBody({ context: CONTEXT, markdown }).markdown).toBe(markdown);
  });

  it("does not rewrite a reference inside a naked URL typed in prose", () => {
    const markdown = "see https://github.com/acme/widget/issues/42 for the numbers";
    expect(linkifyPageBody({ context: CONTEXT, markdown }).markdown).toBe(markdown);
  });

  it("does not rewrite a reference inside a markdown autolink", () => {
    const markdown = "<https://github.com/acme/widget/issues/42>";
    expect(linkifyPageBody({ context: CONTEXT, markdown }).markdown).toBe(markdown);
  });

  it("still linkifies a bare reference that sits outside every link on the same line", () => {
    const result = linkifyPageBody({
      context: CONTEXT,
      markdown: "[the fix](https://github.com/acme/widget/issues/42) supersedes #7",
    });
    expect(result.markdown).toBe(
      "[the fix](https://github.com/acme/widget/issues/42) supersedes [#7](https://github.com/acme/widget/issues/7)",
    );
  });

  it("does not report an already-linked reference as still bare", () => {
    const result = linkifyPageBody({
      context: NO_CONTEXT,
      markdown: "[#42](https://github.com/acme/widget/issues/42)",
    });
    expect(result.issues.length).toBe(0);
  });
});
