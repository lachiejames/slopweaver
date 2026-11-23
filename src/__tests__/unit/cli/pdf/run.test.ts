import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { observePdfExtractor, type PdfDeps, runPdfCheck, runPdfRead } from "../../../../cli/commands/pdf/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

/** A plain fake dependency bag — a recorded seam, never a mock. */
function recordingDeps(): { deps: PdfDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      readFile: async ({ path }) => new Uint8Array(readFileSync(path)),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runPdfRead", () => {
  it("prints the document's words on stdout and nothing on stderr", async () => {
    const { deps, out, diagnostics } = recordingDeps();
    const code = await runPdfRead({ deps, rest: [TEXT_SAMPLE] });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(out.join("\n")).toContain("contractors");
  });

  it("emits exactly one JSON document under --json", async () => {
    const { deps, out } = recordingDeps();
    await runPdfRead({ deps, rest: [TEXT_SAMPLE, "--json"] });
    expect(out.length).toBe(1);
    const parsed: unknown = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({ glyphless: false, pages: 1, pagesRead: 1 });
  });

  it("says a scanned document has no text layer rather than printing an empty body", async () => {
    const { deps, out } = recordingDeps();
    const code = await runPdfRead({ deps, rest: [SCANNED_SAMPLE] });
    expect(code).toBe(EXIT_OK);
    expect(out.join("\n")).toContain("scanned or image-only PDF");
  });

  it("reports a file it could not open on stderr and exits non-zero", async () => {
    const { deps, diagnostics } = recordingDeps();
    const code = await runPdfRead({ deps, rest: [join(import.meta.dirname, "absent.pdf")] });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("could not read");
  });

  it("refuses a provider reference with the verb that fetches it", async () => {
    const { deps, diagnostics } = recordingDeps();
    const code = await runPdfRead({ deps, rest: ["https://files.slack.com/a.pdf"] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("fetch it through its provider's own verb first");
  });

  it("prints usage for --help and exits clean", async () => {
    const { deps, out } = recordingDeps();
    const code = await runPdfRead({ deps, rest: ["--help"] });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver pdf read");
  });
});

describe("observePdfExtractor", () => {
  it("reads back the phrase it wrote, so a reader answering whitespace would fail it", async () => {
    const report = await observePdfExtractor();
    expect(report.extractorLoads).toBe(true);
    expect(report.problem).toBe(undefined);
  });
});

describe("runPdfCheck", () => {
  it("exits clean on a host whose extractor works", async () => {
    const { deps, out } = recordingDeps();
    const code = await runPdfCheck({ deps, rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("the text extractor loads and reads a document on this host");
  });

  it("emits exactly one JSON document under --json", async () => {
    const { deps, out } = recordingDeps();
    await runPdfCheck({ deps, rest: ["--json"] });
    expect(out.length).toBe(1);
    const parsed: unknown = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({ extractorLoads: true });
  });
});
