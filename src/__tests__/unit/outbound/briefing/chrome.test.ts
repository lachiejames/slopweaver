/**
 * The chrome's two load-bearing properties, read back off the bytes it ships.
 *
 * A card fold carrying a 1,661-byte scope line was hard to read and overflowed. Both halves of the fix live in a stylesheet and a script, which no schema and no
 * page check can see — `../../../../briefing/pageBudget.ts` and `../../../../briefing/shape.ts` both strip
 * `<style>` and `<script>` before they measure anything, deliberately. So the gate on them is this file: the
 * chrome is DATA shipped in the repository, and a test that reads it is the only thing standing between a
 * restyle and the page scrolling sideways again.
 */
import { describe, expect, it } from "vitest";

import { BRIEFING_CHROME } from "../../../../outbound/briefing/chrome.js";

/**
 * The one declaration block for `selector`, as it appears in the sheet.
 *
 * Found by string search rather than by a regex built from the selector: a selector carries `.` and `,`,
 * which a regex would have to escape, and an escape that silently fails produces a pattern that still
 * matches and an assertion that no longer means what it says.
 */
function rule({ selector }: { selector: string }): string {
  const open = BRIEFING_CHROME.indexOf(`\n  ${selector} {`);
  const close = BRIEFING_CHROME.indexOf("}", open);
  return open < 0 ? "" : BRIEFING_CHROME.slice(open + selector.length + 6, close).trim();
}

describe("the briefing chrome never lets the page scroll sideways", () => {
  it("lets a long code run break rather than widening the page body", () => {
    const code = rule({ selector: "code, .sha" });

    expect(code).toContain("overflow-wrap: break-word;");
    expect(code).not.toContain("white-space: nowrap");
  });

  it("wraps a paste block's pre and contains its own scrolling vertically", () => {
    const pre = rule({ selector: ".paste pre" });

    expect(pre).toContain("white-space: pre-wrap;");
    expect(pre).toContain("overflow-wrap: anywhere;");
    expect(pre).toContain("overflow-x: hidden;");
    expect(pre).toContain("overflow-y: auto;");
  });

  it("styles the copy control and the label the renderer emits", () => {
    expect(rule({ selector: ".paste-copy" })).toContain("cursor: pointer;");
    expect(rule({ selector: ".paste-label" })).toContain("text-transform: uppercase;");
  });
});

describe("the briefing chrome wires every copy button with one delegated listener", () => {
  /** The script's body, without its surrounding tags. */
  const script = BRIEFING_CHROME.slice(
    BRIEFING_CHROME.lastIndexOf("<script>") + "<script>".length,
    BRIEFING_CHROME.lastIndexOf("</script>"),
  );

  it("listens on the document rather than on a button, so the renderer emits no id and no handler", () => {
    expect(script).toContain('document.addEventListener("click"');
    expect(script).toContain('target.closest("button.paste-copy")');
    expect(script).not.toContain("getElementById");
  });

  it("reads the pre inside the same paste block the button was clicked through", () => {
    expect(script).toContain('button.closest(".paste").querySelector("pre")');
    expect(script).toContain("navigator.clipboard.writeText(pre.textContent)");
  });

  it("selects the text instead when there is no clipboard, and says so on the button", () => {
    expect(script).toContain("if (navigator.clipboard === undefined) { select(); return; }");
    expect(script).toContain("range.selectNodeContents(pre)");
    expect(script).toContain('button.textContent = "selected — copy it";');
  });

  it("says copied and goes back to copy, so a click is never silent", () => {
    expect(script).toContain('button.textContent = "copied";');
    expect(script).toContain('setTimeout(() => { button.textContent = "copy"; }, 1500);');
  });

  it("is the only script the page carries", () => {
    expect(BRIEFING_CHROME.match(/<script\b/g)!.length).toBe(1);
    expect(BRIEFING_CHROME).not.toContain("<script src");
  });
});

describe("the briefing chrome carries the readability rules the check cannot see", () => {
  it("lays the options out as one row per option, the letter in its own column", () => {
    expect(rule({ selector: "ul.opts" })).toContain("list-style: none;");
    expect(rule({ selector: "ul.opts > li" })).toContain("grid-template-columns: 1.6rem 1fr;");
  });

  it("lets an auto-linked URL break rather than widening the page", () => {
    expect(rule({ selector: "a.raw" })).toContain("overflow-wrap: anywhere;");
  });

  it("indents a fold inside a fold, so the second level reads as a level", () => {
    expect(rule({ selector: "details details" })).toContain("margin-left: .6rem;");
  });
});
