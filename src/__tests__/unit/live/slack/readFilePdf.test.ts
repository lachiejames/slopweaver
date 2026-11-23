/**
 * `slack read-file` over a PDF — the whole point of the verb for the commonest attachment in the owner's Slack.
 *
 * MEASURED: this read downloaded a 321,706-byte pentest report, reported its local path, and
 * left `text` undefined, because the decoder admitted a fixed list of text filetypes and `pdf` was not one
 * of them. A session that had been asked what the report SAID got told where it was. These cases drive the
 * real `readSlackFile` over the committed fixtures, so what is under test is the shipped path.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "../../../../lib/result.js";
import { renderFileText } from "../../../../live/slack/fileDocument.js";
import { type ReadSlackFileDeps, readSlackFile } from "../../../../live/slack/readFile.js";

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../fixtures/pdf/scanned-sample.pdf");

/** A PDF header over a body no parser can read — the bytes ARRIVE, and the extraction is what fails. */
const CORRUPT_BYTES = Buffer.from("%PDF-1.4\nnot actually a pdf body\n", "latin1");

/**
 * The corrupt bytes on disk, in a throwaway directory this file removes.
 *
 * @returns the path the scripted download serves from
 */
function corruptSample(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-corrupt-pdf-"));
  fixtureDirs.push(dir);
  const path = join(dir, "corrupt.pdf");
  writeFileSync(path, CORRUPT_BYTES);
  return path;
}

/** One ordinary PDF upload, as `files.info` returns one. */
const PDF_FILE: Record<string, unknown> = {
  filetype: "pdf",
  id: "F0PDF0001",
  mimetype: "application/pdf",
  name: "pentest-report.pdf",
  permalink: "https://example.slack.com/files/U1/F0PDF0001/pentest-report.pdf",
  title: "Pentest report",
  url_private_download: "https://files.slack.com/files-pri/T1-F0PDF0001/download/pentest-report.pdf",
};

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The injected edges: one scripted `files.info`, and a download that serves a committed fixture's bytes. */
function deps({ fixture }: { fixture: string }): ReadSlackFileDeps {
  return {
    api: { filesInfo: () => Promise.resolve({ file: PDF_FILE }) },
    downloadFile: ({ filename, destinationDir }) => {
      const bytes = readFileSync(fixture);
      const localPath = join(destinationDir, filename);
      writeFileSync(localPath, bytes);
      return Promise.resolve(ok({ bytes: bytes.byteLength, localPath }));
    },
    nowIso: () => "2026-09-22T02:00:00.000Z",
  };
}

/** Read the PDF into a throwaway files root. */
async function read({ fixture }: { fixture: string }) {
  const filesRoot = mkdtempSync(join(tmpdir(), "sw-read-pdf-"));
  fixtureDirs.push(filesRoot);
  return unwrap(
    await readSlackFile({
      deps: deps({ fixture }),
      filesRoot,
      followTranscript: false,
      reference: "F0PDF0001",
      token: "xoxp-test",
    }),
  );
}

describe("readSlackFile — a PDF's text layer", () => {
  it("extracts the document's words even though `pdf` is not a text filetype", async () => {
    const document = await read({ fixture: TEXT_SAMPLE });
    expect(document.body!.text).toContain("personnel and contractors");
  });

  it("reports the page count beside the bytes, which is what decides whether to open the file", async () => {
    const document = await read({ fixture: TEXT_SAMPLE });
    expect(document.body!.pdf).toEqual({ glyphless: false, pages: 1, pagesRead: 1 });
  });

  it("still leaves the bytes on disk, so a caller that wants the file itself has a path", async () => {
    const document = await read({ fixture: TEXT_SAMPLE });
    expect(readFileSync(document.body!.localPath).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("prints the words under a heading that names the page count", async () => {
    const rendered = renderFileText({ document: await read({ fixture: TEXT_SAMPLE }) });
    expect(rendered).toContain("1 page(s) →");
    expect(rendered).toContain("personnel and contractors");
  });

  it("names the kind from `filetype`, else the older `mode`, else prints no kind line", async () => {
    const document = await read({ fixture: TEXT_SAMPLE });
    const modeOnly = { ...document, file: { ...document.file, filetype: undefined, mode: "hosted" } };
    const neither = { ...document, file: { ...document.file, filetype: undefined, mode: undefined } };
    const canvas = { ...document, file: { ...document.file, isHuddleCanvas: true } };

    expect(renderFileText({ document })).toContain("\n- kind: pdf\n");
    expect(renderFileText({ document: modeOnly })).toContain("\n- kind: hosted\n");
    expect(renderFileText({ document: neither })).not.toContain("- kind:");
    expect(renderFileText({ document: canvas })).toContain("\n- kind: huddle notes (canvas)\n");
  });

  it("says a scanned document has no text layer rather than printing a blank body", async () => {
    const document = await read({ fixture: SCANNED_SAMPLE });
    expect(document.body!.text).toBe(undefined);
    expect(document.body!.pdf).toEqual({ glyphless: true, pages: 2, pagesRead: 2 });
    expect(renderFileText({ document })).toContain("no extractable text");
  });
});

describe("readSlackFile — a PDF the extractor cannot parse", () => {
  // The failure arm answered `err`, so a corrupt PDF whose bytes had
  // ALREADY landed came back with no body at all — no path, no byte count — and the caller could not tell
  // it apart from a download that never happened. `fileDownloads.ts` had always made the opposite choice.
  it("keeps the body, so the caller still learns where the bytes are", async () => {
    const document = await read({ fixture: corruptSample() });
    expect(document.body!.bytes).toBe(CORRUPT_BYTES.byteLength);
    expect(readFileSync(document.body!.localPath).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(document.body!.text).toBe(undefined);
  });

  it("names the reason in the residue rather than staying silent about it", async () => {
    const document = await read({ fixture: corruptSample() });
    expect(document.residue.join(" ")).toContain("bytes retrieved to");
    expect(document.residue.join(" ")).toContain("text not");
  });

  it("says so under the Body heading too, where a bare heading would read as an empty document", async () => {
    const rendered = renderFileText({ document: await read({ fixture: corruptSample() }) });
    expect(rendered).toContain("could not read this file's text —");
  });
});
