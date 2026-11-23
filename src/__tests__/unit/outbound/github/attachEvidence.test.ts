import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import {
  type AttachEvidence,
  type AttachTextScan,
  attachEvidenceFindings,
  MAX_PROVES_CHARS,
  provesProblem,
  publicationAttachScan,
  resolveAttachEvidence,
} from "../../../../outbound/github/attachEvidence.js";
import { writeCaptureRecord } from "../../../../visualEvidence/captureRecord.js";
import { transcriptFrameText } from "../../../../visualEvidence/frameText.js";
import { ImageTextErrors } from "../../../../visualEvidence/imageTextRecognition.js";
import { appendImageRecord } from "../../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../../visualEvidence/types.js";
import {
  type AttachablePicture,
  fileAttachableEvidence,
  passedRecordFor,
  recordedCassette,
  renderAttachablePicture,
} from "../../../attachEvidenceFixture.js";

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-attach-evidence-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

let PICTURE: AttachablePicture;

beforeAll(async () => {
  PICTURE = await renderAttachablePicture();
});

const CLEAN: AttachTextScan = () => [];

/** A scan that flags one word, on whichever surface it appears, so a test names where the scan looked. */
function flagging({ word }: { word: string }): AttachTextScan {
  return ({ surface, text }) => (text.includes(word) ? [`${surface} carries ${word}`] : []);
}

function foundEvidence({ home }: { home: string }): AttachEvidence {
  fileAttachableEvidence({ home, picture: PICTURE });
  return resolveAttachEvidence({ bytes: PICTURE.bytes, home });
}

describe("provesProblem", () => {
  it("accepts one short line", () => {
    expect(provesProblem({ proves: "the unit suite passes" })).toBeNull();
  });

  it("refuses an empty or blank line", () => {
    expect(provesProblem({ proves: "   " })).toBe("--proves must say what the picture proves, in one line");
  });

  it("refuses more than one line", () => {
    expect(provesProblem({ proves: "it passes\nand more" })).toBe(
      "--proves is one line; put anything longer in the description, not beside the picture",
    );
  });

  it("refuses a line one character past the limit and accepts one at it", () => {
    expect(provesProblem({ proves: "a".repeat(MAX_PROVES_CHARS) })).toBeNull();
    expect(provesProblem({ proves: "a".repeat(MAX_PROVES_CHARS + 1) })).toBe("--proves is 201 characters; at most 200");
  });
});

describe("publicationAttachScan", () => {
  /** Nothing private configured: the denylist and the private terms both empty. */
  const NONE = { denylist: [], ownRepository: "acme/app", privateTerms: [] } as const;

  it("passes clean text and flags a denylisted term", () => {
    const scan = publicationAttachScan({ ...NONE, denylist: ["zorblaxfixture"] });
    expect(scan({ surface: "proves", text: "the unit suite passes" })).toStrictEqual([]);
    expect(scan({ surface: "proves", text: "the zorblaxfixture suite passes" }).length).toBe(1);
  });

  it("flags a private term in quoted frame text by class only", () => {
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
    );
    const scan = publicationAttachScan({ ...NONE, privateTerms });
    expect(scan({ surface: "frame-text", text: "from Quillfeather" })).toStrictEqual([
      "captured frame text line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });

  it("flags a private term in text read off the pixels by class only, under its own label", () => {
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\norganisation\ti\tacme widgets\tsynthetic\n" }),
    );
    const scan = publicationAttachScan({ ...NONE, privateTerms });
    expect(scan({ surface: "pixel-text", text: "Dashboard\nTicket ABC-1 for Acme Widgets" })).toStrictEqual([
      "text read from the picture's pixels line 2: a private organisation term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });

  it("lets first person through in text read off the pixels, a quotation of a screen", () => {
    const scan = publicationAttachScan(NONE);
    expect(scan({ surface: "pixel-text", text: "We could not sign you in" })).toStrictEqual([]);
  });

  it("refuses first person in an authored line and lets it through in quoted frame text", () => {
    const scan = publicationAttachScan(NONE);
    expect(scan({ surface: "proves", text: "we fixed the sign-in" })).toHaveLength(1);
    expect(scan({ surface: "alt", text: "my terminal" })).toHaveLength(1);
    expect(scan({ surface: "frame-text", text: "We could not sign you in" })).toStrictEqual([]);
  });

  it("refuses an absolute home path even in quoted frame text", () => {
    const scan = publicationAttachScan(NONE);
    expect(scan({ surface: "frame-text", text: "wrote /Users/someone/.slopweaver/x" })).toHaveLength(1);
  });
});

describe("resolveAttachEvidence", () => {
  it("finds the receipt and the passed record by the bytes' digest", () => {
    const evidence = foundEvidence({ home: freshHome() });
    expect(evidence.kind).toBe("found");
    expect(evidence.digest).toBe(PICTURE.receipt.final.artifact.digest);
  });

  it("names the missing receipt when no capture verb wrote these bytes", () => {
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home: freshHome() });
    expect(evidence).toMatchObject({ kind: "missing", why: "no capture receipt names these bytes" });
  });

  it("refuses bytes edited after capture, whose digest no receipt names", () => {
    const home = freshHome();
    fileAttachableEvidence({ home, picture: PICTURE });
    const edited = Uint8Array.from([...PICTURE.bytes, 0]);
    expect(resolveAttachEvidence({ bytes: edited, home })).toMatchObject({
      kind: "missing",
      why: "no capture receipt names these bytes",
    });
  });

  it("refuses a receipt file edited out of its schema rather than believing it", () => {
    const home = freshHome();
    const path = unwrap(writeCaptureRecord({ home, record: PICTURE.receipt }));
    writeFileSync(path, JSON.stringify({ ...PICTURE.receipt, frameText: { kind: "nothing" } }));
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home });
    expect(evidence.kind).toBe("missing");
    expect(evidence).toMatchObject({ correction: "repair or remove the receipt file it names" });
  });
});

describe("attachEvidenceFindings", () => {
  const base = {
    alt: "a terminal pane",
    contentType: "image/png",
    pixelText: undefined,
    proves: "the unit suite passes",
  } as const;

  it("raises nothing for a receipted, viewed, cropped, stripped PNG", () => {
    const evidence = foundEvidence({ home: freshHome() });
    expect(attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, scan: CLEAN })).toStrictEqual([]);
  });

  it("raises nothing for pixels whose recognised text the scan passes", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const pixelText = ok({ lines: ["12 passed"] });
    const findings = attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, pixelText, scan: CLEAN });
    expect(findings).toStrictEqual([]);
  });

  it("holds pixels that show what the scan refuses, under the pixel-text surface", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const pixelText = ok({ lines: ["Dashboard", "Acme Widgets"] });
    const findings = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      evidence,
      pixelText,
      scan: flagging({ word: "Acme" }),
    });
    expect(findings).toStrictEqual([
      {
        code: "attach.scan.pixel-text",
        correction: "re-capture without it, or burn it out with `slopweaver browser redact` and attach that file",
        severity: "hold",
        summary: "the picture's pixels show pixel-text carries Acme",
      },
    ]);
  });

  it("holds pixels showing a private term through the real scan, naming its class and never the term", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\norganisation\ti\tquillfeather\tsynthetic\n" }),
    );
    const scan = publicationAttachScan({ denylist: [], ownRepository: "acme/app", privateTerms });
    const pixelText = ok({ lines: ["Dashboard", "Quillfeather"] });
    const findings = attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, pixelText, scan });
    expect(findings).toStrictEqual([
      {
        code: "attach.scan.pixel-text",
        correction: "re-capture without it, or burn it out with `slopweaver browser redact` and attach that file",
        severity: "hold",
        summary:
          "the picture's pixels show text read from the picture's pixels line 2: a private organisation term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
      },
    ]);
  });

  it("holds pixels whose text could not be read, naming only the cause", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const pixelText = err(ImageTextErrors.timedOut({ timeoutMs: 150_000 }));
    const findings = attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, pixelText, scan: CLEAN });
    expect(findings).toStrictEqual([
      {
        code: "attach.pixel-text-unread",
        correction: "attach it from macOS, where Vision reads the picture's text; retry once if it timed out",
        severity: "hold",
        summary:
          "the text the picture shows could not be read, so it cannot be checked: the text recogniser did not " +
          "finish within 150s",
      },
    ]);
  });

  it("holds pixels that show what the scan refuses even when no receipt names the bytes", () => {
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home: freshHome() });
    const pixelText = ok({ lines: ["Acme Widgets"] });
    const codes = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      evidence,
      pixelText,
      scan: flagging({ word: "Acme" }),
    }).map((finding) => finding.code);
    expect(codes).toStrictEqual(["attach.capture-receipt", "attach.scan.pixel-text"]);
  });

  it("holds a missing receipt and still scans the words beside the picture", () => {
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home: freshHome() });
    const codes = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      evidence,
      proves: "acme passes",
      scan: flagging({ word: "acme" }),
    }).map((finding) => finding.code);
    expect(codes).toStrictEqual(["attach.capture-receipt", "attach.scan.proves"]);
  });

  it("holds a picture declared as the type another verb writes", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const findings = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      contentType: "video/mp4",
      evidence,
      scan: CLEAN,
    });
    expect(findings.map((finding) => finding.summary)).toStrictEqual([
      "the upload would be declared video/mp4, and `browser terminal-shot` wrote an image/png",
    ]);
  });

  it("holds a receipt-less GIF on its type as well as its receipt, and a receipt-less MP4 on its receipt alone", () => {
    const home = freshHome();
    const gif = resolveAttachEvidence({ bytes: Uint8Array.from([71, 73, 70]), home });
    const codesFor = ({ contentType }: { contentType: string }): readonly string[] =>
      attachEvidenceFindings({
        ...base,
        bytes: Uint8Array.from([71, 73, 70]),
        contentType,
        evidence: gif,
        scan: CLEAN,
      }).map((finding) => finding.code);
    expect(codesFor({ contentType: "image/gif" })).toStrictEqual(["attach.content-type", "attach.capture-receipt"]);
    expect(codesFor({ contentType: "video/mp4" })).toStrictEqual(["attach.capture-receipt"]);
  });

  it("admits a recording proof cassette wrote, through the same checks, with no crop or PNG chunk rule", () => {
    const home = freshHome();
    const cassette = recordedCassette();
    fileAttachableEvidence({ home, picture: cassette });
    const evidence = resolveAttachEvidence({ bytes: cassette.bytes, home });
    expect(evidence.kind).toBe("found");
    const findings = attachEvidenceFindings({
      ...base,
      bytes: cassette.bytes,
      contentType: "video/mp4",
      evidence,
      scan: CLEAN,
    });
    expect(findings).toStrictEqual([]);
  });

  it("scans a recording's transcript, and holds one nobody recorded watching", () => {
    const home = freshHome();
    const cassette = recordedCassette({ transcript: "$ cat .env\nTOKEN=FIXTURE\n" });
    fileAttachableEvidence({ home, picture: cassette, viewed: false });
    const evidence = resolveAttachEvidence({ bytes: cassette.bytes, home });
    const findings = attachEvidenceFindings({
      ...base,
      bytes: cassette.bytes,
      contentType: "video/mp4",
      evidence,
      scan: flagging({ word: "TOKEN=" }),
    });
    expect(findings.map((finding) => [finding.code, finding.summary])).toStrictEqual([
      ["attach.scan.frame-text", "the recording shows frame-text carries TOKEN="],
      ["attach.image-check.viewed", expect.stringContaining("no record says anybody opened these bytes")],
    ]);
  });

  it("holds a recording whose recorder wrote no transcript", () => {
    const home = freshHome();
    const bytes = recordedCassette().bytes;
    const receipt = {
      ...recordedCassette().receipt,
      frameText: transcriptFrameText({ frame: { heightPx: 1, widthPx: 1 }, transcript: null }),
    };
    fileAttachableEvidence({ home, picture: { bytes, receipt } });
    const evidence = resolveAttachEvidence({ bytes, home });
    const findings = attachEvidenceFindings({ ...base, bytes, contentType: "video/mp4", evidence, scan: CLEAN });
    expect(findings.map((finding) => finding.summary)).toStrictEqual([
      "the receipt could not record every word in the frame: the recorder wrote no transcript beside the video",
    ]);
  });

  it("scans the frame text the receipt recorded, and says the picture shows the problem", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const findings = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      evidence,
      scan: flagging({ word: "12 passed" }),
    });
    expect(findings.map((finding) => [finding.code, finding.summary])).toStrictEqual([
      ["attach.scan.frame-text", "the picture shows frame-text carries 12 passed"],
    ]);
  });

  it("scans the alt text a reader meets beside the picture", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const findings = attachEvidenceFindings({
      ...base,
      alt: "acme pane",
      bytes: PICTURE.bytes,
      evidence,
      scan: flagging({ word: "acme pane" }),
    });
    expect(findings.map((finding) => finding.code)).toStrictEqual(["attach.scan.alt"]);
  });

  it("holds the viewed check when nobody recorded opening the bytes", () => {
    const home = freshHome();
    fileAttachableEvidence({ home, picture: PICTURE, viewed: false });
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home });
    const findings = attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, scan: CLEAN });
    expect(findings.map((finding) => finding.code)).toStrictEqual(["attach.image-check.viewed"]);
  });

  it("holds the unobstructed check when the passed record does not say nothing covers it", () => {
    const home = freshHome();
    fileAttachableEvidence({ home, picture: PICTURE, viewed: false });
    const passed = passedRecordFor({ picture: PICTURE }) as Extract<ImageRecord, { outcome: "passed" }>;
    unwrap(appendImageRecord({ home, record: { ...passed, obstruction: undefined } }));
    const evidence = resolveAttachEvidence({ bytes: PICTURE.bytes, home });
    const findings = attachEvidenceFindings({ ...base, bytes: PICTURE.bytes, evidence, scan: CLEAN });
    expect(findings.map((finding) => finding.code)).toStrictEqual(["attach.image-check.unobstructed"]);
  });

  it("holds a whole-frame crop and incomplete frame text from the receipt", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const receipt = {
      ...PICTURE.receipt,
      cropRect: { height: PICTURE.receipt.source.heightPx, width: PICTURE.receipt.source.widthPx, x: 0, y: 0 },
      frameText: {
        items: [],
        kind: "incomplete",
        origin: "terminal-screen",
        reasons: ["a canvas the page could not read"],
      },
    } as typeof PICTURE.receipt;
    const findings = attachEvidenceFindings({
      ...base,
      bytes: PICTURE.bytes,
      evidence: { ...evidence, receipt } as AttachEvidence,
      scan: CLEAN,
    });
    expect(findings.map((finding) => finding.code)).toStrictEqual([
      "attach.frame-text-incomplete",
      "attach.whole-frame",
    ]);
  });

  it("holds bytes that are not a PNG at all, naming the metadata check", () => {
    const evidence = foundEvidence({ home: freshHome() });
    const findings = attachEvidenceFindings({ ...base, bytes: Uint8Array.from([1, 2, 3]), evidence, scan: CLEAN });
    expect(findings.map((finding) => finding.summary)).toStrictEqual([
      "the bytes carry chunks that are not pixels: not a PNG",
    ]);
  });
});
