import { describe, expect, it } from "vitest";
import { reviewedLineSha256 } from "../../../freshCut/reviewedLines.js";
import type { ReviewedResidueEntry } from "../../../freshCut/reviewedResidue.js";
import { SOURCE_REPOSITORY } from "../../../hygiene/ownRepository.js";
import { type PrivateTermsLoad, parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../hygiene/privateTerms.js";
import { scanReportLines } from "../../../hygiene/repoScan.js";
import {
  privateTermHitsInFile,
  privateTermLocus,
  repositoryPrivateTermsStatusLine,
  unacceptedPrivateTermHits,
  unreadableDenylistLines,
} from "../../../hygiene/repositoryPrivateTerms.js";
import { denylistStatusLine, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { unwrap } from "../../../lib/result.js";

/** The synthetic private value every case carries in its INPUT, so a test that it is never printed can fail. */
const SYNTHETIC_VALUE = "zorblaxquent";

const TERMS = unwrap(
  parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nperson\ti\t${SYNTHETIC_VALUE}\tsynthetic fixture\n` }),
);

/** An owner-address row, the one class a version-1 reviewed-residue entry can accept. */
const ADDRESS_TERMS = unwrap(
  parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-address\t-\t${SYNTHETIC_VALUE}\tsynthetic\n` }),
);

const TERMS_PATH = "/state/hygiene/private-terms.tsv";
const LOADED: PrivateTermsLoad = { kind: "loaded", path: TERMS_PATH, terms: TERMS };
const DENYLIST = { kind: "absent" } as const;

/** One reviewed-residue entry for line 2 of `docs/a.md`, either shape, every other field synthetic. */
function residueEntry({ bytes, schemaVersion }: { bytes: Buffer; schemaVersion: 1 | 2 }): ReviewedResidueEntry {
  const shared = {
    entryId: "00000000-0000-4000-8000-000000000001",
    lineNumberAtReview: 2,
    lineSha256: unwrap(reviewedLineSha256({ bytes, line: 2 })),
    path: "docs/a.md",
    reviewedAtIso: "2026-11-20T00:00:00.000Z",
    reviewedBySessionId: "synthetic-session",
    reviewedRecordId: "00000000-0000-4000-8000-000000000002",
    reviewedTreeSha: "0".repeat(40),
  };
  if (schemaVersion === 1) {
    return { ...shared, className: "owner-address", judgement: "placeholder", schemaVersion: 1 };
  }
  return {
    ...shared,
    className: "person",
    ownerAnchor: "transcript:00000000-0000-4000-8000-000000000003#00000000-0000-4000-8000-000000000004",
    schemaVersion: 2,
  };
}

describe("privateTermHitsInFile", () => {
  it("names each matching line once by path, line and class, never the matched text", () => {
    const content = `first\nsay ${SYNTHETIC_VALUE} and ${SYNTHETIC_VALUE}\n${SYNTHETIC_VALUE.toUpperCase()}\n`;
    expect(content).toContain(SYNTHETIC_VALUE);
    expect(privateTermHitsInFile({ content, path: "docs/a.md", terms: TERMS })).toEqual([
      { className: "person", line: 2, path: "docs/a.md" },
      { className: "person", line: 3, path: "docs/a.md" },
    ]);
  });

  it("finds nothing with no term loaded, which is every CI run", () => {
    expect(privateTermHitsInFile({ content: SYNTHETIC_VALUE, path: "docs/a.md", terms: [] })).toEqual([]);
  });

  it("forgives the repository's own address as the fresh cut does, while the bare owner still hits", () => {
    const owner = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
    const ownerTerms = unwrap(
      parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-handle\ti\t${owner}\tsynthetic\n` }),
    );
    const content = `see ${SOURCE_REPOSITORY}\nby ${owner}\n`;
    expect(privateTermHitsInFile({ content, path: "docs/a.md", terms: ownerTerms })).toEqual([
      { className: "owner-handle", line: 2, path: "docs/a.md" },
    ]);
  });
});

describe("unacceptedPrivateTermHits", () => {
  const bytes = Buffer.from(`first\nan example ${SYNTHETIC_VALUE} here\n`);
  const hits = privateTermHitsInFile({ content: bytes.toString("utf8"), path: "docs/a.md", terms: ADDRESS_TERMS });

  it("sets aside a line an owner-address entry accepted, by its exact bytes", () => {
    expect(hits).toEqual([{ className: "owner-address", line: 2, path: "docs/a.md" }]);
    expect(
      unacceptedPrivateTermHits({
        bytesByPath: new Map([["docs/a.md", bytes]]),
        entries: [residueEntry({ bytes, schemaVersion: 1 })],
        hits,
      }),
    ).toEqual({ accepted: 1, standing: [] });
  });

  it("keeps the finding once the accepted line's bytes change", () => {
    const edited = Buffer.from(`first\nan edited ${SYNTHETIC_VALUE} here\n`);
    const editedHits = privateTermHitsInFile({
      content: edited.toString("utf8"),
      path: "docs/a.md",
      terms: ADDRESS_TERMS,
    });
    expect(
      unacceptedPrivateTermHits({
        bytesByPath: new Map([["docs/a.md", edited]]),
        entries: [residueEntry({ bytes, schemaVersion: 1 })],
        hits: editedHits,
      }),
    ).toEqual({ accepted: 0, standing: [{ className: "owner-address", line: 2, path: "docs/a.md" }] });
  });

  it("sets aside a line an owner-anchored entry accepted at the public cut, by its path and exact bytes", () => {
    const personHits = privateTermHitsInFile({ content: bytes.toString("utf8"), path: "docs/a.md", terms: TERMS });
    expect(personHits).toEqual([{ className: "person", line: 2, path: "docs/a.md" }]);
    expect(
      unacceptedPrivateTermHits({
        bytesByPath: new Map([["docs/a.md", bytes]]),
        entries: [residueEntry({ bytes, schemaVersion: 2 })],
        hits: personHits,
      }),
    ).toEqual({ accepted: 1, standing: [] });
  });

  it("still fails a NEW copy of a line an owner-anchored entry accepted", () => {
    const copied = Buffer.from(`first\nan example ${SYNTHETIC_VALUE} here\nan example ${SYNTHETIC_VALUE} here\n`);
    const copiedHits = privateTermHitsInFile({ content: copied.toString("utf8"), path: "docs/a.md", terms: TERMS });
    expect(copiedHits).toEqual([
      { className: "person", line: 2, path: "docs/a.md" },
      { className: "person", line: 3, path: "docs/a.md" },
    ]);
    expect(
      unacceptedPrivateTermHits({
        bytesByPath: new Map([["docs/a.md", copied]]),
        entries: [residueEntry({ bytes, schemaVersion: 2 })],
        hits: copiedHits,
      }),
    ).toEqual({ accepted: 1, standing: [{ className: "person", line: 3, path: "docs/a.md" }] });
  });

  it("keeps an owner-anchored finding once the accepted line's bytes change", () => {
    const edited = Buffer.from(`first\nan edited ${SYNTHETIC_VALUE} here\n`);
    const editedHits = privateTermHitsInFile({ content: edited.toString("utf8"), path: "docs/a.md", terms: TERMS });
    expect(
      unacceptedPrivateTermHits({
        bytesByPath: new Map([["docs/a.md", edited]]),
        entries: [residueEntry({ bytes, schemaVersion: 2 })],
        hits: editedHits,
      }),
    ).toEqual({ accepted: 0, standing: [{ className: "person", line: 2, path: "docs/a.md" }] });
  });
});

describe("privateTermLocus", () => {
  const files = ["docs/a.md", `docs/${SYNTHETIC_VALUE}.md`];

  it("prints a path no term matches as itself", () => {
    expect(privateTermLocus({ files, path: "docs/a.md", terms: TERMS })).toBe("docs/a.md");
  });

  it("prints a path a term matches as its place in the file list", () => {
    expect(files[1]).toContain(SYNTHETIC_VALUE);
    expect(privateTermLocus({ files, path: files[1]!, terms: TERMS })).toBe("(working-tree file 2)");
  });
});

describe("repositoryPrivateTermsStatusLine", () => {
  it("says an absent file was not applied, rather than that every write refuses", () => {
    expect(repositoryPrivateTermsStatusLine({ accepted: 0, load: { kind: "absent", path: TERMS_PATH } })).toBe(
      `hygiene: private terms NOT PRESENT at ${TERMS_PATH} — not applied to this repository scan`,
    );
  });

  it("counts the loaded terms and the accepted lines set aside", () => {
    expect(repositoryPrivateTermsStatusLine({ accepted: 2, load: LOADED })).toBe(
      "hygiene: private terms LOADED 1, 2 accepted line(s) set aside",
    );
  });

  it("reports an explicit none as EMPTY", () => {
    expect(
      repositoryPrivateTermsStatusLine({ accepted: 0, load: { kind: "loaded", path: TERMS_PATH, terms: [] } }),
    ).toBe("hygiene: private terms EMPTY — the file says there are none");
  });
});

describe("unreadableDenylistLines", () => {
  it("withholds an unreadable denylist's lines when its path carries a term", () => {
    const load = {
      kind: "unreadable",
      path: `/state/${SYNTHETIC_VALUE}/hygiene-denylist.txt`,
      reason: "EISDIR",
    } as const;
    expect(load.path).toContain(SYNTHETIC_VALUE);
    expect(unreadableDenylistLines({ load, terms: TERMS })).toEqual([WITHHELD_REFUSAL_LINE, WITHHELD_REFUSAL_LINE]);
  });

  it("prints them whole when no term matches", () => {
    const load = { kind: "unreadable", path: "/state/hygiene-denylist.txt", reason: "EISDIR" } as const;
    expect(unreadableDenylistLines({ load, terms: TERMS })).toEqual([
      denylistStatusLine({ load }),
      unreadableDenylistMessage({ load }),
    ]);
  });
});

describe("scanReportLines with private terms", () => {
  const empty = {
    accepted: 0,
    files: ["docs/a.md"],
    load: DENYLIST,
    refusedIdentifiers: [],
    reportedIdentifiers: [],
    secrets: [],
    unreadable: [],
  };

  it("fails a private-term finding under its own heading as locus, line and class, never the value", () => {
    const lines = scanReportLines({
      ...empty,
      failing: true,
      privateTermHits: [{ className: "person", line: 4, path: "docs/a.md" }],
      termsLoad: LOADED,
    });
    expect(lines).toEqual([
      denylistStatusLine({ load: DENYLIST }),
      "hygiene: private terms LOADED 1, 0 accepted line(s) set aside",
      "hygiene: 1 PRIVATE TERM hit(s) — these fail (reword the line, or ask the chair whether the terms row is " +
        "too wide; the matched text is never printed):",
      "  docs/a.md:4: [private-term] person",
    ]);
  });

  it("withholds any report line a term matches, whatever built it", () => {
    const secret = { excerpt: SYNTHETIC_VALUE, label: "denylist", line: 1, path: "docs/a.md" };
    expect(secret.excerpt).toContain(SYNTHETIC_VALUE);
    const lines = scanReportLines({
      ...empty,
      failing: true,
      privateTermHits: [],
      secrets: [secret],
      termsLoad: LOADED,
    });
    expect(lines).toEqual([
      denylistStatusLine({ load: DENYLIST }),
      "hygiene: private terms LOADED 1, 0 accepted line(s) set aside",
      "hygiene: 1 SECRET hit(s) — these fail:",
      WITHHELD_REFUSAL_LINE,
    ]);
    expect(lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("passes with the terms absent and says they were not applied", () => {
    const absent: PrivateTermsLoad = { kind: "absent", path: TERMS_PATH };
    expect(scanReportLines({ ...empty, failing: false, privateTermHits: [], termsLoad: absent })).toEqual([
      denylistStatusLine({ load: DENYLIST }),
      `hygiene: private terms NOT PRESENT at ${TERMS_PATH} — not applied to this repository scan`,
      "hygiene: clean (1 files scanned)",
    ]);
  });
});
