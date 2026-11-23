/**
 * The zero-references page over a synthetic proof: what it shows on a clean tree and on a dirty one, and that
 * a path carrying a reference never reaches it.
 */
import { describe, expect, it } from "vitest";

import type { ReferenceProof } from "../../../hygiene/referenceExport.js";
import { renderReferencePage } from "../../../hygiene/referencePage.js";
import type { ReferenceSummary } from "../../../hygiene/referenceSummary.js";

const NONE = { codeFiles: 0, docsFiles: 0, files: 0, hits: 0 };

const CLEAN: ReferenceSummary = {
  acceptance: NONE,
  binaryFiles: 0,
  classes: [
    { className: "map:people", codeFiles: 0, docsFiles: 0, files: 0, hits: 0, section: "acceptance", source: "map" },
    { className: "map:owner", codeFiles: 0, docsFiles: 0, files: 0, hits: 0, section: "own-name", source: "map" },
  ],
  codeFiles: 0,
  docsFiles: 0,
  filesScanned: 1200,
  ownName: NONE,
  residue: [],
  totalHits: 0,
};

/** A proof around a summary. */
const proof = ({ summary }: { summary: ReferenceSummary }): ReferenceProof => ({
  committedIso: "2026-10-30T09:00:00Z",
  ref: "main",
  sha: "abcdef0123456789abcdef0123456789abcdef01",
  summary,
  zipBytes: 3 * 1024 * 1024,
  zipPath: "/tmp/zr/slopweaver-abcdef012345.zip",
});

/** Render one proof with fixed labels. */
const render = ({ summary }: { summary: ReferenceSummary }): string =>
  renderReferencePage({
    committedLabel: "30 Oct 2026, 8:00 pm",
    proof: proof({ summary }),
    scannedLabel: "30 Oct 2026, 9:00 pm",
  });

describe("renderReferencePage", () => {
  it("leads a clean tree with zero, lists every class at zero, and names the commit and the zip", () => {
    const page = render({ summary: CLEAN });
    expect(page).toContain(`<p class="zr-big zr-ok">0 references to the organisation</p>`);
    expect(page).toContain("<code>map:people</code>");
    expect(page).toContain("<h2>The owner's own name</h2>\n<p>0 places in 0 files");
    expect(page).toContain("<code>abcdef012345</code>");
    expect(page).toContain("1,200 files, 3.0 MB");
    expect(page).toContain("$SLOPWEAVER_HOME/proof/zero-references/slopweaver-abcdef012345.zip");
    expect(page).not.toContain("/tmp/zr");
    expect(page).not.toContain("<details>");
  });

  it("leads a dirty tree with the count and lists the residue, withholding a path that carries a reference", () => {
    const page = render({
      summary: {
        ...CLEAN,
        acceptance: { codeFiles: 1, docsFiles: 1, files: 2, hits: 3 },
        classes: [
          {
            className: "map:people",
            codeFiles: 1,
            docsFiles: 1,
            files: 2,
            hits: 3,
            section: "acceptance",
            source: "map",
          },
        ],
        codeFiles: 1,
        docsFiles: 1,
        residue: [
          { area: "docs", classes: ["map:people"], path: "docs/zorblatt.md", pathCarriesReference: true },
          { area: "code", classes: ["map:people"], path: "src/b.ts", pathCarriesReference: false },
        ],
        totalHits: 3,
      },
    });
    expect(page).toContain(`<p class="zr-big zr-bad">3 references to the organisation in 2 files</p>`);
    expect(page).toContain("Code: 1 files still carry one. Docs: 1 files.");
    expect(page).toContain("<code>src/b.ts</code>");
    expect(page).toContain("(path withheld: it carries a reference itself)");
    expect(page).not.toContain("zorblatt");
  });

  it("reads zero when only the owner's own name remains, counting it in its own section and listing none of its files", () => {
    const page = render({
      summary: {
        ...CLEAN,
        classes: [
          { className: "map:owner", codeFiles: 2, docsFiles: 0, files: 2, hits: 5, section: "own-name", source: "map" },
        ],
        codeFiles: 2,
        ownName: { codeFiles: 2, docsFiles: 0, files: 2, hits: 5 },
        residue: [
          { area: "code", classes: ["map:owner"], path: "src/a.ts", pathCarriesReference: false },
          { area: "code", classes: ["map:owner"], path: "src/b.ts", pathCarriesReference: false },
        ],
        totalHits: 5,
      },
    });
    expect(page).toContain(`<p class="zr-big zr-ok">0 references to the organisation</p>`);
    expect(page).toContain("<h2>The owner's own name</h2>\n<p>5 places in 2 files");
    expect(page).not.toContain("<details>");
    expect(page).not.toContain("src/a.ts");
  });
});
