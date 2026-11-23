/**
 * The ratchet-gate canon binding.
 *
 * Two describe groups, the shape `staleReferences.test.ts` established: the first drives the pure functions
 * in `../../../canon/ratchetGates.js` on inline fixtures and never touches disk; the last reads THIS
 * repository's real `docs/toolchain/rebaseline-and-lanes.md` against the real refusal registry and fails in
 * both directions — a gate whose `--rebaseline` can refuse that the class block does not name, or a name in
 * the class block the registry no longer declares.
 *
 * Why both directions rather than the obvious one: the finding that produced the paragraph reached the board naming five of the seven gates it applies to, because the list
 * was typed by hand. One direction catches a gate that gains a rebaseline; the other catches a deleted one
 * whose name is still sitting in canon.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateListIn, missingFrom, rebaselineGatesOf, sectionBody } from "../../../canon/ratchetGates.js";
import { DECLARED_LINT_GATES, LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/registry.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

/** The document the canon paragraph lives in, and the exact heading it lives under. */
const CANON_DOC = "docs/toolchain/rebaseline-and-lanes.md";
const CANON_HEADING = "# A `--rebaseline` keeps ONLY the entries your own branch moved";

describe("rebaselineGatesOf", () => {
  it("keeps only the gates whose refusal id ends -rebaseline, deduplicated and sorted", () => {
    const declarations = new Map([
      ["file-size-ratchet-rebaseline", "file-size-ratchet"],
      ["file-size-ratchet-regression", "file-size-ratchet"],
      ["agent-doc-size-rebaseline", "agent-doc-size"],
      ["no-headless-launch", "no-headless"],
    ]);
    expect(rebaselineGatesOf({ declarations })).toEqual(["agent-doc-size", "file-size-ratchet"]);
  });

  it("answers an empty list when no declaration is a rebaseline", () => {
    expect(rebaselineGatesOf({ declarations: new Map([["no-headless-launch", "no-headless"]]) })).toEqual([]);
  });
});

describe("sectionBody", () => {
  it("takes the lines under the heading up to the next same-level heading", () => {
    expect(sectionBody({ content: "# Doc\n\n## One\n\nalpha\nbeta\n\n## Two\n\ngamma\n", heading: "## One" })).toBe(
      "\nalpha\nbeta\n",
    );
  });

  it("stops at a higher-level heading too", () => {
    expect(sectionBody({ content: "## One\n\nalpha\n\n# Top\n\nbeta\n", heading: "## One" })).toBe("\nalpha\n");
  });

  it("runs to the end of the document when nothing follows", () => {
    expect(sectionBody({ content: "## One\n\nalpha\n", heading: "## One" })).toBe("\nalpha\n");
  });

  it("answers undefined for a heading that is not there, rather than an empty body", () => {
    expect(sectionBody({ content: "## One\n\nalpha\n", heading: "## Two" })).toBeUndefined();
  });

  it("does not end the section on a # comment inside a fence", () => {
    expect(
      sectionBody({ content: "## One\n\n```text\n# note\nalpha\n```\n\n## Two\n\nbeta\n", heading: "## One" }),
    ).toBe("\n```text\n# note\nalpha\n```\n");
  });
});

describe("gateListIn", () => {
  it("reads one name per line out of the text fence, dropping comments and blanks", () => {
    const body = "prose\n\n```text\n# the class\nagent-doc-size\n\nfile-size-ratchet\n```\n\nmore prose\n";
    expect(gateListIn({ body })).toEqual(["agent-doc-size", "file-size-ratchet"]);
  });

  it("ignores prose outside the fence, including a backticked span that looks like a gate", () => {
    const body = "covers `no-silent-fallback` and `pre-push`\n\n```text\nagent-doc-size\n```\n";
    expect(gateListIn({ body })).toEqual(["agent-doc-size"]);
  });

  it("answers an empty list when the section carries no text fence", () => {
    expect(gateListIn({ body: "covers `agent-doc-size` in prose only\n" })).toEqual([]);
  });

  it("reads to the end of the body when the fence was never closed", () => {
    expect(gateListIn({ body: "```text\nagent-doc-size\n" })).toEqual(["agent-doc-size"]);
  });
});

describe("missingFrom", () => {
  it("names every expected entry absent from present, in the expected order", () => {
    expect(
      missingFrom({
        expected: ["agent-doc-size", "coverage-ratchet", "file-size-ratchet"],
        present: ["coverage-ratchet"],
      }),
    ).toEqual(["agent-doc-size", "file-size-ratchet"]);
  });

  it("answers an empty list when everything expected is present", () => {
    expect(missingFrom({ expected: ["agent-doc-size"], present: ["agent-doc-size", "no-headless"] })).toEqual([]);
  });
});

describe("this repository's own canon block", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const content = readFileSync(join(root, CANON_DOC), "utf8");
  const declarations = new Map(
    Object.entries(LINT_GATE_DECLARATIONS).map(([id, declaration]) => [id, declaration.gate]),
  );
  const refusing = rebaselineGatesOf({ declarations });

  it("carries the heading the rebaseline rule lives under", () => {
    expect(content.split("\n")).toContain(CANON_HEADING);
  });

  it("enumerates a non-empty refusing ratchet class from the registry", () => {
    expect(refusing.length).toBeGreaterThan(0);
  });

  it("declares a non-empty class block under that heading", () => {
    expect(gateListIn({ body: sectionBody({ content, heading: CANON_HEADING })! }).length).toBeGreaterThan(0);
  });

  it("names every gate whose --rebaseline can refuse", () => {
    const listed = gateListIn({ body: sectionBody({ content, heading: CANON_HEADING })! });
    expect(missingFrom({ expected: refusing, present: listed })).toEqual([]);
  });

  it("names no gate the registry does not declare", () => {
    const listed = gateListIn({ body: sectionBody({ content, heading: CANON_HEADING })! });
    expect(missingFrom({ expected: listed, present: DECLARED_LINT_GATES })).toEqual([]);
  });
});
