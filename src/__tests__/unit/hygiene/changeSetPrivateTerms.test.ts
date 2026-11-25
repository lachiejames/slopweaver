/**
 * The landing verbs' private-terms verdict over a merged change set — pure, over synthetic terms only. Every case
 * that asserts a value is never printed feeds that value IN, so the assertion can fail.
 */

import { describe, expect, it } from "vitest";
import { reviewedLineSha256 } from "../../../freshCut/reviewedLines.js";
import type { ReviewedResidueEntry } from "../../../freshCut/reviewedResidue.js";
import {
  type ChangeSetFile,
  changeSetLocus,
  changeSetPrivateTermsLines,
  judgeChangeSetPrivateTerms,
  uncheckedChangeSet,
} from "../../../hygiene/changeSetPrivateTerms.js";
import { type PrivateTermsLoad, parsePrivateTerms } from "../../../hygiene/privateTerms.js";
import { unwrap } from "../../../lib/result.js";

/** The synthetic private value: every case that says it never prints carries it in its input. */
const SYNTHETIC_VALUE = "acmefixtureword";

const TERMS = unwrap(
  parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-address\ti\t${SYNTHETIC_VALUE}\tsynthetic\n` }),
);
const TERMS_PATH = "/state/hygiene/private-terms.tsv";
const LOADED: PrivateTermsLoad = { kind: "loaded", path: TERMS_PATH, terms: TERMS };
const READ_NONE = { entries: [], kind: "read" } as const;

/** One changed file with these exact contents. */
function file({ path, text }: { path: string; text: string }): ChangeSetFile {
  return { bytes: Buffer.from(text), path };
}

/** A version-1 reviewed-residue entry accepting line 2 of `docs/a.md` at exactly these bytes. */
function residueEntry({ bytes }: { bytes: Buffer }): ReviewedResidueEntry {
  return {
    className: "owner-address",
    entryId: "00000000-0000-4000-8000-000000000001",
    judgement: "placeholder",
    lineNumberAtReview: 2,
    lineSha256: unwrap(reviewedLineSha256({ bytes, line: 2 })),
    path: "docs/a.md",
    reviewedAtIso: "2026-11-20T00:00:00.000Z",
    reviewedBySessionId: "synthetic-session",
    reviewedRecordId: "00000000-0000-4000-8000-000000000002",
    reviewedTreeSha: "0".repeat(40),
    schemaVersion: 1,
  };
}

describe("judgeChangeSetPrivateTerms", () => {
  it("is unchecked, naming the path, when the terms file is absent", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [file({ path: "a.ts", text: SYNTHETIC_VALUE })],
      load: { kind: "absent", path: TERMS_PATH },
      residue: READ_NONE,
    });
    expect(verdict).toEqual({
      detail: `the private terms file is not present at ${TERMS_PATH}, so no file this landing changes was checked for them`,
      kind: "unchecked",
      terms: [],
    });
  });

  it("holds when the terms file will not read, whatever the change set holds", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [],
      load: { kind: "unreadable", path: TERMS_PATH, reason: "mode 0644" },
      residue: READ_NONE,
    });
    expect(verdict.kind).toBe("hold");
    expect(changeSetPrivateTermsLines({ verdict })[0]).toBe("private terms: HOLD — this landing is refused");
  });

  it("is clean over changed text with no term, counting a binary file as skipped", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [file({ path: "a.ts", text: "plain\n" }), file({ path: "b.bin", text: `x\u0000${SYNTHETIC_VALUE}` })],
      load: LOADED,
      residue: READ_NONE,
    });
    expect(verdict).toEqual({ accepted: 0, binaryFiles: 1, kind: "clean", terms: TERMS, textFiles: 1 });
  });

  it("holds on a term in changed text, naming path, line and class and never the value", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [file({ path: "src/a.ts", text: `one\ntwo ${SYNTHETIC_VALUE}\n` })],
      load: LOADED,
      residue: READ_NONE,
    });
    const lines = changeSetPrivateTermsLines({ verdict });
    expect(lines).toContain("  src/a.ts:2: [private-term] owner-address");
    expect(lines).toContain("  1 private-term finding(s) stand on lines this landing would merge");
    expect(lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("prints a path the term matches by its place in the change set", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [
        file({ path: "ok.ts", text: "fine\n" }),
        file({ path: `docs/${SYNTHETIC_VALUE}.md`, text: SYNTHETIC_VALUE }),
      ],
      load: LOADED,
      residue: READ_NONE,
    });
    expect(changeSetPrivateTermsLines({ verdict })).toContain("  (changed file 2):1: [private-term] owner-address");
  });

  it("sets aside a line the reviewed residue accepted by its exact bytes", () => {
    const bytes = Buffer.from(`first\nan example ${SYNTHETIC_VALUE} here\n`);
    const verdict = judgeChangeSetPrivateTerms({
      files: [{ bytes, path: "docs/a.md" }],
      load: LOADED,
      residue: { entries: [residueEntry({ bytes })], kind: "read" },
    });
    expect(verdict).toEqual({ accepted: 1, binaryFiles: 0, kind: "clean", terms: TERMS, textFiles: 1 });
  });

  it("accepts nothing, and says so, when the reviewed residue will not read", () => {
    const verdict = judgeChangeSetPrivateTerms({
      files: [file({ path: "docs/a.md", text: `first\nan example ${SYNTHETIC_VALUE} here\n` })],
      load: LOADED,
      residue: { kind: "unreadable" },
    });
    expect(changeSetPrivateTermsLines({ verdict })).toContain(
      "  the reviewed-residue list could not be read, so no accepted line was set aside and every finding stands",
    );
  });
});

describe("changeSetLocus", () => {
  it("keeps a plain path, and replaces one carrying a control character", () => {
    const paths = ["a.ts", "b\nc.ts"];
    expect(changeSetLocus({ path: "a.ts", paths, terms: TERMS })).toBe("a.ts");
    expect(changeSetLocus({ path: "b\nc.ts", paths, terms: TERMS })).toBe("(changed file 2)");
  });
});

describe("uncheckedChangeSet", () => {
  it("withholds a detail line the loaded terms match", () => {
    const verdict = uncheckedChangeSet({ detail: `the merge of ${SYNTHETIC_VALUE} failed`, load: LOADED });
    const lines = changeSetPrivateTermsLines({ verdict });
    expect(lines).toHaveLength(1);
    expect(lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });
});
