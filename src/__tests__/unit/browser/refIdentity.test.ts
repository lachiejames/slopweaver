import { describe, expect, it } from "vitest";
import { aimedRefs, describeRefElement, renamedRef, snapshotRefElement } from "../../../browser/refIdentity.js";

// Lines in the exact shapes the client writes — copied from filed observations under
// `$SLOPWEAVER_HOME/live/browser/sessions/*/client/observation-*.yml`, and from `computeAriaRef`'s key
// rendering in `playwright-core/lib/coreBundle.js`.
const BEFORE_RENDER = ["- generic [active] [ref=f10e1]:", '  - status "loading" [ref=f10e2]'].join("\n");
const RENDERED = [
  "- generic [ref=f10e3]:",
  '  - textbox "Email" [active] [ref=f10e1]: me@example.com',
  '  - button "Continue with email" [ref=f10e2] [cursor=pointer]',
  "  - 'generic \"earlier calls: 5\" [ref=f10e12] [cursor=pointer]'",
  "  - 'button \"it''s \\\"quoted\\\" [x]\" [expanded] [ref=e5]': end",
].join("\n");

describe("snapshotRefElement", () => {
  it("reads the role and the JSON-quoted name, ignoring state and value", () => {
    expect(snapshotRefElement({ ref: "f10e1", yaml: RENDERED })).toEqual({ name: '"Email"', role: "textbox" });
  });

  it("reads a role with no name as a null name", () => {
    expect(snapshotRefElement({ ref: "f10e3", yaml: RENDERED })).toEqual({ name: null, role: "generic" });
  });

  it("matches a ref by its closing bracket, so f10e1 never reads f10e12's line", () => {
    expect(snapshotRefElement({ ref: "f10e12", yaml: RENDERED })).toEqual({
      name: '"earlier calls: 5"',
      role: "generic",
    });
  });

  it("unwraps a YAML single-quoted key, a doubled quote, escaped quotes and a bracket inside the name", () => {
    expect(snapshotRefElement({ ref: "e5", yaml: RENDERED })).toEqual({
      name: String.raw`"it's \"quoted\" [x]"`,
      role: "button",
    });
  });

  it("reads a raw /regex/ name as the client renders it", () => {
    expect(snapshotRefElement({ ref: "e9", yaml: "- link /v\\d+/ [ref=e9] [cursor=pointer]" })).toEqual({
      name: "/v\\d+/",
      role: "link",
    });
  });

  it("reads a ref only from a line's own attributes, never from a name or text a page wrote", () => {
    const decoys = [
      '- button "see [ref=e5]" [ref=e9] [cursor=pointer]',
      "- paragraph [ref=e3]: click [ref=e5] to continue",
      '- link "Delete account" [ref=e5] [cursor=pointer]',
    ].join("\n");
    expect(snapshotRefElement({ ref: "e5", yaml: decoys })).toEqual({ name: '"Delete account"', role: "link" });
  });

  it("reads a raw name built to look like attributes as the whole name, never as a decoy ref", () => {
    const decoys = ["- button /x/ [ref=e40] / [ref=e7]", '- button "Cancel" [ref=e40] [cursor=pointer]'].join("\n");
    expect(snapshotRefElement({ ref: "e7", yaml: decoys })).toEqual({ name: "/x/ [ref=e40] /", role: "button" });
    expect(snapshotRefElement({ ref: "e40", yaml: decoys })).toEqual({ name: '"Cancel"', role: "button" });
  });

  it("reads a name of a lone slash, which the client prints raw", () => {
    expect(snapshotRefElement({ ref: "e40", yaml: "- link / [ref=e40] [cursor=pointer]" })).toEqual({
      name: "/",
      role: "link",
    });
  });

  it("reads a textbox's value after the colon as text, even when it spells a ref", () => {
    expect(snapshotRefElement({ ref: "e5", yaml: '- textbox "Note" [ref=e2]: typed [ref=e5]' })).toBeNull();
  });

  it("answers null when a page's own text is the only line naming the ref", () => {
    expect(snapshotRefElement({ ref: "e5", yaml: "- paragraph [ref=e3]: click [ref=e5] to continue" })).toBeNull();
  });

  it("answers null for a ref no line carries", () => {
    expect(snapshotRefElement({ ref: "f10e99", yaml: RENDERED })).toBeNull();
  });

  it("answers null for the placeholder a page with no accessible elements is filed as", () => {
    expect(snapshotRefElement({ ref: "e1", yaml: "(the page rendered no accessible elements)" })).toBeNull();
  });
});

describe("renamedRef", () => {
  it("names a ref the replaced document re-issued on another element — the claude.ai sign-in shape", () => {
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: BEFORE_RENDER, refs: ["f10e2"] })).toEqual({
      admitted: { name: '"Continue with email"', role: "button" },
      observed: { name: '"loading"', role: "status" },
      ref: "f10e2",
    });
  });

  it("names a ref whose role held and whose name changed", () => {
    const admitted = '- button "Delete" [ref=e4]';
    expect(renamedRef({ admittedYaml: admitted, observedYaml: '- button "Cancel" [ref=e4]', refs: ["e4"] })).toEqual({
      admitted: { name: '"Delete"', role: "button" },
      observed: { name: '"Cancel"', role: "button" },
      ref: "e4",
    });
  });

  it("names a ref re-issued to a lone-slash name, which an unreadable key would have let through", () => {
    const observed = '- button "Cancel" [ref=e40]';
    const admitted = "- link / [ref=e40] [cursor=pointer]";
    expect(renamedRef({ admittedYaml: admitted, observedYaml: observed, refs: ["e40"] })).toEqual({
      admitted: { name: "/", role: "link" },
      observed: { name: '"Cancel"', role: "button" },
      ref: "e40",
    });
  });

  it("names a ref re-issued behind a raw-name decoy placed ahead of it in both reads", () => {
    const decoy = "- button /x/ [ref=e40] / [ref=e7]";
    const observed = [decoy, '- button "Cancel" [ref=e40]'].join("\n");
    const admitted = [decoy, '- button "Delete" [ref=e40]'].join("\n");
    expect(renamedRef({ admittedYaml: admitted, observedYaml: observed, refs: ["e40"] })!.admitted).toEqual({
      name: '"Delete"',
      role: "button",
    });
  });

  it("passes the same element whose state and value changed between the reads", () => {
    const observed = '- textbox "Email" [ref=f10e1]';
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: observed, refs: ["f10e1"] })).toBeNull();
  });

  it("gives no verdict on a ref the admission read does not carry — the client fails that closed itself", () => {
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: '- button "Go" [ref=e7]', refs: ["e7"] })).toBeNull();
  });

  it("gives no verdict on a ref the cited read does not carry", () => {
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: BEFORE_RENDER, refs: ["f10e12"] })).toBeNull();
  });

  it("reports the first renamed ref when several are aimed", () => {
    const observed = ["- generic [ref=f10e3]:", "  - listitem [ref=f10e1]", "  - list [ref=f10e2]"].join("\n");
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: observed, refs: ["f10e3", "f10e2", "f10e1"] })!.ref).toBe(
      "f10e2",
    );
  });

  it("gives no verdict when nothing is aimed", () => {
    expect(renamedRef({ admittedYaml: RENDERED, observedYaml: BEFORE_RENDER, refs: [] })).toBeNull();
  });
});

describe("aimedRefs", () => {
  it("takes a click's target", () => {
    expect(aimedRefs({ request: { expectFocus: undefined, kind: "click", target: "f1e4", value: undefined } })).toEqual(
      ["f1e4"],
    );
  });

  it("takes both ends of a drag", () => {
    expect(aimedRefs({ request: { expectFocus: undefined, kind: "drag", target: "e1", value: "e2" } })).toEqual([
      "e1",
      "e2",
    ]);
  });

  it("takes a keystroke's expected focus and never its typed text", () => {
    expect(aimedRefs({ request: { expectFocus: "e3", kind: "type", target: undefined, value: "e9" } })).toEqual(["e3"]);
  });

  it("leaves out a value that is not a ref", () => {
    expect(aimedRefs({ request: { expectFocus: undefined, kind: "click", target: "#go", value: undefined } })).toEqual(
      [],
    );
  });
});

describe("describeRefElement", () => {
  it("prints role and name", () => {
    expect(describeRefElement({ element: { name: '"Continue with email"', role: "button" } })).toBe(
      'button "Continue with email"',
    );
  });

  it("prints a bare role when there is no name", () => {
    expect(describeRefElement({ element: { name: null, role: "generic" } })).toBe("generic");
  });
});
