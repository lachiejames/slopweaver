import { describe, expect, it } from "vitest";

import { blockerFor, parseHandoverDoc } from "../../../../handover/doc.js";

describe("the flat and nested readers cannot take each other down", () => {
  /**
   * The measured case, found by running `handover check` on a real doc after retrofitting probes to it:
   * `distil-latest-collapse`'s summary opens with a backtick, a reserved character in a YAML plain scalar. With
   * the whole front-matter handed to YAML, adding `doneWhen:` made the probes silently unloadable AND the doc
   * malformed. Only the nested lines are parsed now.
   */
  it("loads probes from a doc whose summary is not valid YAML", () => {
    const parsed = parseHandoverDoc({
      path: "/h/ticked.md",
      text: "---\nslug: ticked\nsummary: `distil` reads every row: twice\nstatus: ready\ndoneWhen:\n  - path: a/b.ts\n---\n",
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.doneWhen).toEqual([{ kind: "path", path: "a/b.ts" }]);
    expect(parsed.summary).toBe("`distil` reads every row: twice");
  });

  it("still reports a probe block that is itself malformed", () => {
    const parsed = parseHandoverDoc({
      path: "/h/bad.md",
      text: "---\nslug: bad\nsummary: `x` and: y\nstatus: ready\ndoneWhen:\n    - [unclosed\n---\n",
    });

    expect(parsed.doneWhen).toEqual([]);
    expect(parsed.problems.length).toBe(1);
    expect(parsed.problems[0]).toContain("could not be read");
  });

  it("does not let a later top-level key be swallowed into the probe block", () => {
    const parsed = parseHandoverDoc({
      path: "/h/order.md",
      text: "---\nslug: order\ndoneWhen:\n  - path: a\nstatus: ready\nrepo: /r\n---\n",
    });

    expect(parsed.doneWhen).toEqual([{ kind: "path", path: "a" }]);
    expect(parsed.status).toBe("ready");
    expect(parsed.repo).toBe("/r");
  });

  it("reads outputs declared after doneWhen, as separate blocks", () => {
    const parsed = parseHandoverDoc({
      path: "/h/both.md",
      text: "---\nslug: both\nstatus: ready\ndoneWhen:\n  - path: a\nsummary: `noise`\noutputs: [docs/x.md]\n---\n",
    });

    expect(parsed.doneWhen).toEqual([{ kind: "path", path: "a" }]);
    expect(parsed.outputs).toEqual(["docs/x.md"]);
  });
});

describe("the flat reader ignores nested continuation lines", () => {
  /**
   * Found by dogfooding, not by the suite: `  - present: src/a.ts#x` splits on its first colon into a "key"
   * named `- present`, so a doc declaring two probes of the SAME kind was reported as declaring that key twice
   * and became malformed. Every earlier fixture happened to use one probe of each kind.
   */
  it("accepts several probes of the same kind without calling the doc malformed", () => {
    const parsed = parseHandoverDoc({
      path: "/h/many.md",
      text: [
        "---",
        "slug: many",
        "status: ready",
        "doneWhen:",
        "  - present: src/a.ts#one",
        "  - present: src/b.ts#two",
        "  - present: src/c.ts#three",
        "  - path: hooks/x.sh",
        "---",
        "",
      ].join("\n"),
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.doneWhen).toHaveLength(4);
    expect(blockerFor({ all: [parsed], doc: parsed })).toBeUndefined();
  });

  it("still catches a genuinely repeated TOP-LEVEL key", () => {
    const parsed = parseHandoverDoc({
      path: "/h/dup.md",
      text: "---\nslug: dup\nstatus: ready\nrepo: /a\nrepo: /b\n---\n",
    });

    expect(parsed.problems).toEqual(['front-matter declares "repo" more than once — which one is meant?']);
  });
});
