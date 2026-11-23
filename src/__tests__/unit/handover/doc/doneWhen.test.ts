import { describe, expect, it } from "vitest";

import { blockerFor, parseHandoverDoc } from "../../../../handover/doc.js";

describe("parseHandoverDoc — doneWhen and outputs", () => {
  const WITH_PROBES = `---
slug: probed
status: ready
doneWhen:
  - present: src/gold/distil.ts#latestRecords
  - absent: src/retrieval/askPrompt.ts#.slice(0, 1200)
  - path: docs/probes.md
  - command: yarn test --grep "a,b"
outputs: [https://claude.ai/code/artifact/x, docs/decision.md]
---
`;

  it("reads every probe kind through the front-matter", () => {
    const parsed = parseHandoverDoc({ path: "/h/probed.md", text: WITH_PROBES });

    expect(parsed.doneWhen).toEqual([
      { file: "src/gold/distil.ts", kind: "present", symbol: "latestRecords" },
      { file: "src/retrieval/askPrompt.ts", kind: "absent", symbol: ".slice(0, 1200)" },
      { kind: "path", path: "docs/probes.md" },
      { command: 'yarn test --grep "a,b"', kind: "command" },
    ]);
    expect(parsed.problems).toEqual([]);
  });

  /** The comma-splitting list parser this replaced would have torn this command into two probes. */
  it("keeps a comma inside a command intact", () => {
    const probe = parseHandoverDoc({ path: "/h/probed.md", text: WITH_PROBES }).doneWhen[3]!;

    expect(probe).toEqual({ command: 'yarn test --grep "a,b"', kind: "command" });
  });

  it("reads outputs as a list", () => {
    const parsed = parseHandoverDoc({ path: "/h/probed.md", text: WITH_PROBES });

    expect(parsed.outputs).toEqual(["https://claude.ai/code/artifact/x", "docs/decision.md"]);
  });

  it("leaves both empty for a doc that declares neither", () => {
    const parsed = parseHandoverDoc({ path: "/h/plain.md", text: "---\nslug: plain\nstatus: ready\n---\n" });

    expect(parsed.doneWhen).toEqual([]);
    expect(parsed.outputs).toEqual([]);
  });

  it("carries a malformed probe as a problem, so the board cannot compute off a subset", () => {
    const parsed = parseHandoverDoc({
      path: "/h/bad.md",
      text: "---\nslug: bad\nstatus: ready\ndoneWhen:\n  - present: no-symbol-half\n---\n",
    });

    expect(parsed.doneWhen).toEqual([]);
    expect(parsed.problems).toEqual(["doneWhen[0] must be `file#symbol`, but got `no-symbol-half`"]);
    expect(blockerFor({ all: [parsed], doc: parsed })?.kind).toBe("malformed");
  });

  it("reports unreadable YAML when the probe block ITSELF is malformed", () => {
    const parsed = parseHandoverDoc({
      path: "/h/bad.md",
      text: "---\nslug: x\nstatus: ready\ndoneWhen:\n  - path: [unclosed\n---\n",
    });

    expect(parsed.doneWhen).toEqual([]);
    expect(parsed.problems.length).toBe(1);
    expect(parsed.problems[0]).toContain("could not be read");
  });

  /** A malformed line the probe reader never looks at must not be able to break the probes. */
  it("ignores a malformed line outside the probe block entirely", () => {
    const parsed = parseHandoverDoc({
      path: "/h/messy.md",
      text: "---\nslug: x\nstatus: ready\n  stray: [unclosed\ndoneWhen:\n  - path: a\n---\n",
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.doneWhen).toEqual([{ kind: "path", path: "a" }]);
  });

  /**
   * The measured regression: handing the whole front-matter to strict YAML broke three live docs, because a
   * backtick opens a reserved plain scalar. A doc with no probes has no stake in the YAML parse and must be
   * entirely unaffected by it.
   */
  it("leaves a doc whose summary is not valid YAML completely alone when it declares no probes", () => {
    const parsed = parseHandoverDoc({
      path: "/h/ticked.md",
      text: "---\nslug: ticked\nsummary: `distil` reads every row: twice\nstatus: ready\n---\n",
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.slug).toBe("ticked");
    expect(parsed.status).toBe("ready");
    expect(parsed.summary).toBe("`distil` reads every row: twice");
    expect(blockerFor({ all: [parsed], doc: parsed })).toBeUndefined();
  });

  it("accepts a bare scalar where a list is expected, as the previous parser did", () => {
    const parsed = parseHandoverDoc({
      path: "/h/one.md",
      text: "---\nslug: one\nstatus: ready\nblockedBy: solo\n---\n",
    });

    expect(parsed.blockedBy).toEqual(["solo"]);
  });
});
