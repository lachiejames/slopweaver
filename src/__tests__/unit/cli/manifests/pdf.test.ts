/**
 * The `pdf` noun's manifest, checked for the two properties its rows actually claim.
 *
 * The second one is the reason this file exists rather than being folded into `helpTruth.test.ts`: the
 * manifest is loaded on EVERY `slopweaver` invocation, and `../commands/pdf/core.ts` reaches
 * `pdf/text.ts`, which imports `pdfjs-dist`. Quoting the usage lines from `core.ts` would have put a PDF
 * engine on the load path of `slopweaver --help`. `.claude/rules/area-cli.md` names that class and says
 * "do not add another", so the import path is asserted rather than trusted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PDF_CHECK_USAGE, PDF_READ_USAGE } from "../../../../cli/commands/pdf/usage.js";
import { pdfManifest } from "../../../../cli/manifests/pdf.js";

/** The manifest's own source, read so the eager-import property is checked on what ships. */
const MANIFEST_SOURCE = readFileSync(join(import.meta.dirname, "../../../../cli/manifests/pdf.ts"), "utf8");

describe("pdfManifest", () => {
  it("declares exactly the read and check verbs", () => {
    expect(Object.keys(pdfManifest)).toEqual(["check", "read"]);
  });

  it("declares both verbs effect-free and routed through no door", () => {
    const entries = Object.values(pdfManifest);
    expect(entries.length).toBe(2);
    expect(entries.filter((entry) => entry.meta.effect !== "none")).toEqual([]);
    expect(entries.filter((entry) => entry.meta.doorRouted)).toEqual([]);
  });

  it("marks check as the diagnostic of the pair, and read as the reading act", () => {
    expect(pdfManifest["check"]!.meta.diagnostic).toBe(true);
    expect(pdfManifest["read"]!.meta.diagnostic).toBe(false);
  });

  it("quotes the usage leaf itself, so the manifest and --help cannot drift", () => {
    expect(pdfManifest["check"]!.meta.usage).toBe(PDF_CHECK_USAGE);
    expect(pdfManifest["read"]!.meta.usage).toBe(PDF_READ_USAGE);
  });

  it("says out loud that read is not OCR, because a silent empty body is the one wrong answer", () => {
    expect(pdfManifest["read"]!.meta.summary).toContain("Not OCR");
  });

  it("imports its usage from the leaf and never from the command module", () => {
    expect(MANIFEST_SOURCE).toContain('from "../commands/pdf/usage.js"');
    expect(MANIFEST_SOURCE).not.toContain('from "../commands/pdf/core.js"');
  });
});
