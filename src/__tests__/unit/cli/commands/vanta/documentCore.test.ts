/*
 * The two renderer describes left with the renderers, which moved to `documentReport.ts` and are tested
 * there. What stands here is argv parsing, and the cases below close three gaps that were open before the
 * move: only one of the three enum flags had a refusal case, and nothing asserted `--home` or the base
 * defaults of the two verbs that are not `create-document`.
 */
import { describe, expect, it } from "vitest";

import {
  parseVantaCreateDocumentOptions,
  parseVantaSubmitDocumentOptions,
  parseVantaUploadEvidenceOptions,
  VANTA_DEFAULT_CADENCE,
  VANTA_DEFAULT_REMINDER_WINDOW,
  VANTA_DEFAULT_TIME_SENSITIVITY,
} from "../../../../../cli/commands/vanta/documentCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CREATE_MINIMUM = ["--title", "Access review", "--description", "quarterly access review evidence"];

describe("parseVantaCreateDocumentOptions", () => {
  it("requires the two fields this API surface can never change afterwards", () => {
    const problems = unwrapErr(parseVantaCreateDocumentOptions({ defaultHome: "/home", rest: [] })).join("\n");

    expect(problems).toContain("--title names the document");
    expect(problems).toContain("--description says what the document is evidence OF");
  });

  it("defaults the cadence, reminder window and time sensitivity", () => {
    const parsed = unwrap(parseVantaCreateDocumentOptions({ defaultHome: "/home", rest: CREATE_MINIMUM }));

    expect(parsed.write.kind).toBe("create-document");
    expect(parsed.write).toEqual({
      input: {
        cadence: VANTA_DEFAULT_CADENCE,
        description: "quarterly access review evidence",
        isSensitive: false,
        reminderWindow: VANTA_DEFAULT_REMINDER_WINDOW,
        timeSensitivity: VANTA_DEFAULT_TIME_SENSITIVITY,
        title: "Access review",
      },
      kind: "create-document",
    });
    expect(parsed.base.dryRun).toBe(false);
    expect(parsed.base.approve).toBe(null);
  });

  it("refuses a reminder window Vanta does not accept, listing the ones it does", () => {
    const problems = unwrapErr(
      parseVantaCreateDocumentOptions({ defaultHome: "/home", rest: [...CREATE_MINIMUM, "--reminder-window", "P9D"] }),
    ).join("\n");

    expect(problems).toContain("--reminder-window must be one of");
    expect(problems).toContain(VANTA_DEFAULT_REMINDER_WINDOW);
  });

  it("refuses a time sensitivity Vanta does not accept, listing the ones it does", () => {
    const problems = unwrapErr(
      parseVantaCreateDocumentOptions({
        defaultHome: "/home",
        rest: [...CREATE_MINIMUM, "--time-sensitivity", "SOON"],
      }),
    ).join("\n");

    expect(problems).toContain("--time-sensitivity must be one of");
    expect(problems).toContain(VANTA_DEFAULT_TIME_SENSITIVITY);
  });

  it("refuses a cadence Vanta does not accept, listing the ones it does", () => {
    const problems = unwrapErr(
      parseVantaCreateDocumentOptions({ defaultHome: "/home", rest: [...CREATE_MINIMUM, "--cadence", "P4M"] }),
    ).join("\n");

    expect(problems).toContain("--cadence must be one of");
    expect(problems).toContain("P3M");
  });

  it("carries the sensitivity flag and an explicit approval digest", () => {
    const parsed = unwrap(
      parseVantaCreateDocumentOptions({
        defaultHome: "/home",
        rest: [...CREATE_MINIMUM, "--sensitive", "--approve", "abc123", "--dry-run", "--json"],
      }),
    );

    expect(parsed.write).toEqual({
      input: {
        cadence: VANTA_DEFAULT_CADENCE,
        description: "quarterly access review evidence",
        isSensitive: true,
        reminderWindow: VANTA_DEFAULT_REMINDER_WINDOW,
        timeSensitivity: VANTA_DEFAULT_TIME_SENSITIVITY,
        title: "Access review",
      },
      kind: "create-document",
    });
    expect(parsed.base.approve).toBe("abc123");
    expect(parsed.base.dryRun).toBe(true);
    expect(parsed.base.json).toBe(true);
  });
});

describe("parseVantaUploadEvidenceOptions", () => {
  it("requires both the document and the file", () => {
    const problems = unwrapErr(parseVantaUploadEvidenceOptions({ defaultHome: "/home", rest: [] })).join("\n");

    expect(problems).toContain("--document names the document this evidence attaches to");
    expect(problems).toContain("--file names the file to upload");
  });

  it("carries the optional metadata as null when it was not given", () => {
    const parsed = unwrap(
      parseVantaUploadEvidenceOptions({
        defaultHome: "/home",
        rest: ["--document", "d1", "--file", "/tmp/report.pdf"],
      }),
    );

    expect(parsed.write).toEqual({
      input: { description: null, documentId: "d1", effectiveAtDate: null, filePath: "/tmp/report.pdf" },
      kind: "upload-evidence",
    });
  });

  it("takes the home it was given over the default, because a write lands in whichever store resolves", () => {
    const parsed = unwrap(
      parseVantaUploadEvidenceOptions({
        defaultHome: "/home",
        rest: ["--document", "d1", "--file", "/tmp/report.pdf", "--home", "/elsewhere"],
      }),
    );

    expect(parsed.base.home).toBe("/elsewhere");
    expect(parsed.base.dryRun).toBe(false);
    expect(parsed.base.json).toBe(false);
    expect(parsed.base.approve).toBe(null);
  });

  it("carries the metadata it was given", () => {
    const parsed = unwrap(
      parseVantaUploadEvidenceOptions({
        defaultHome: "/home",
        rest: ["--document", "d1", "--file", "/tmp/report.pdf", "--description", "Q1", "--effective-at", "2026-01-01"],
      }),
    );

    expect(parsed.write).toEqual({
      input: { description: "Q1", documentId: "d1", effectiveAtDate: "2026-01-01", filePath: "/tmp/report.pdf" },
      kind: "upload-evidence",
    });
  });
});

describe("parseVantaSubmitDocumentOptions", () => {
  it("requires the document to submit", () => {
    expect(unwrapErr(parseVantaSubmitDocumentOptions({ defaultHome: "/home", rest: [] })).join("\n")).toContain(
      "--document names the document to submit for review",
    );
  });

  it("parses the document and the approval together", () => {
    const parsed = unwrap(
      parseVantaSubmitDocumentOptions({ defaultHome: "/home", rest: ["--document", "d1", "--approve", "deadbeef"] }),
    );

    expect(parsed.write).toEqual({ input: { documentId: "d1" }, kind: "submit-document" });
    expect(parsed.base.approve).toBe("deadbeef");
    expect(parsed.base.home).toBe("/home");
    expect(parsed.base.dryRun).toBe(false);
    expect(parsed.base.json).toBe(false);
  });
});
