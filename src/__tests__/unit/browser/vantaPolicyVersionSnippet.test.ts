/**
 * The Vanta policy-version snippets' SOURCE: the closed name lists they embed, how every caller value is
 * escaped, and which controls the fixed source can and cannot reach. Source generation only — no browser
 * workflow is exercised here.
 */
import { describe, expect, it } from "vitest";

import {
  ALREADY_APPROVED_LABEL,
  APPROVAL_NEEDED_LABEL,
  CONFIRM_VERSION_NAMES,
  DISCLOSURE_PREFIXES,
  DRAFT_UPLOAD_NAMES,
  IMPORT_EXISTING_NAME,
  POLICY_MENU_NAMES,
  PUBLISHING_CONTROL_NAMES,
  RENEW_WITH_UPDATES_NAME,
  UPLOAD_CARD_NAMES,
  vantaPolicyVersionObserveSnippet,
  vantaPolicyVersionUploadSnippet,
} from "../../../browser/vantaPolicyVersionSnippet.js";

/** How many times `needle` appears in `text`. */
function occurrences({ text, needle }: { text: string; needle: string }): number {
  return text.split(needle).length - 1;
}

const URL_IN = 'https://app.vanta.com/c/acme/policies/p"1\nx';
const URL_OUT = '"https://app.vanta.com/c/acme/policies/p\\"1\\nx"';

describe("the closed name lists", () => {
  it("carry exactly the measured names", () => {
    expect(POLICY_MENU_NAMES).toEqual(["Policy actions", "Policy options", "More actions"]);
    expect(DISCLOSURE_PREFIXES).toEqual(["Renew before"]);
    expect(RENEW_WITH_UPDATES_NAME).toBe("Renew and make updates");
    expect(IMPORT_EXISTING_NAME).toBe("Import an existing policy");
    expect(UPLOAD_CARD_NAMES).toEqual(["Upload a file from computer"]);
    expect(DRAFT_UPLOAD_NAMES).toEqual(["Upload"]);
    expect(APPROVAL_NEEDED_LABEL).toBe("Yes, needs approval");
    expect(ALREADY_APPROVED_LABEL).toBe("No, already approved");
    expect(CONFIRM_VERSION_NAMES).toEqual([
      "Create in policy editor",
      "Import policy",
      "Upload",
      "Continue",
      "Create version",
    ]);
    expect(PUBLISHING_CONTROL_NAMES).toEqual([
      "Assign approver and submit",
      "Submit for approval",
      "Publish",
      "Approve",
    ]);
  });
});

describe("vantaPolicyVersionObserveSnippet source", () => {
  const source = vantaPolicyVersionObserveSnippet({
    screenshotPath: '/tmp/menu"1.png',
    settleMs: 1500,
    url: URL_IN,
  });

  it("embeds the URL, settle time and screenshot path escaped as JSON literals", () => {
    expect(source).toContain(`  const url = ${URL_OUT};\n`);
    expect(source).toContain(`await page.goto(${URL_OUT}, { timeout: 45000, waitUntil: "load" });`);
    expect(source).toContain("  const settleMs = 1500;\n");
    expect(source).toContain('  const screenshotPath = "/tmp/menu\\"1.png";\n');
  });

  it("embeds the closed menu name list, and the allowlisted card prefix and the twelve-card cap once each", () => {
    expect(source).toContain('  const names = ["Policy actions","Policy options","More actions"];\n');
    expect(occurrences({ needle: '{ prefixes: ["Renew before"] }', text: source })).toBe(1);
    expect(occurrences({ needle: "index < marked && index < 12", text: source })).toBe(1);
  });

  it("names no renewal, publishing or approval control anywhere in its source", () => {
    for (const name of [
      "Renew without updates",
      RENEW_WITH_UPDATES_NAME,
      ...PUBLISHING_CONTROL_NAMES,
      APPROVAL_NEEDED_LABEL,
      ALREADY_APPROVED_LABEL,
    ]) {
      expect(occurrences({ needle: name, text: source })).toBe(0);
    }
  });
});

describe("vantaPolicyVersionUploadSnippet source", () => {
  const withPdf = vantaPolicyVersionUploadSnippet({
    beforeScreenshotPath: '/tmp/before"1.png',
    pdfPath: '/tmp/policy"v2\n.pdf',
    screenshotPath: '/tmp/after"1.png',
    settleMs: 2000,
    url: URL_IN,
  });
  const withoutPdf = vantaPolicyVersionUploadSnippet({
    beforeScreenshotPath: "/tmp/before.png",
    pdfPath: null,
    screenshotPath: "/tmp/after.png",
    settleMs: 2000,
    url: URL_IN,
  });

  it("embeds every caller value escaped as a JSON literal", () => {
    expect(withPdf).toContain(`  const url = ${URL_OUT};\n`);
    expect(withPdf).toContain("  const settleMs = 2000;\n");
    expect(withPdf).toContain('  const screenshotPath = "/tmp/after\\"1.png";\n');
    expect(withPdf).toContain('  const beforeScreenshotPath = "/tmp/before\\"1.png";\n');
    expect(withPdf).toContain('  const pdfPath = "/tmp/policy\\"v2\\n.pdf";\n');
  });

  it("embeds a null pdfPath as the literal null", () => {
    expect(withoutPdf).toContain("  const pdfPath = null;\n");
  });

  it("carries the publishing names once, as the refusal list, and never Renew without updates", () => {
    expect(withPdf).toContain(
      '  const publishing = ["Assign approver and submit","Submit for approval","Publish","Approve"];\n',
    );
    for (const name of PUBLISHING_CONTROL_NAMES) {
      expect(occurrences({ needle: name, text: withPdf })).toBe(1);
    }
    expect(occurrences({ needle: "Renew without updates", text: withPdf })).toBe(0);
  });

  it("embeds the allowlisted card prefix and the twelve-card cap once each", () => {
    expect(occurrences({ needle: '{ prefixes: ["Renew before"] }', text: withPdf })).toBe(1);
    expect(occurrences({ needle: "index < marked && index < 12", text: withPdf })).toBe(1);
  });

  it("guards on the approval-needed label and never names the already-approved one", () => {
    expect(occurrences({ needle: '{ needed: "Yes, needs approval" }', text: withPdf })).toBe(1);
    expect(
      occurrences({ needle: "approvalGuard.radioCount > 0 && !approvalGuard.confirmedNeedsApproval", text: withPdf }),
    ).toBe(1);
    expect(occurrences({ needle: ALREADY_APPROVED_LABEL, text: withPdf })).toBe(0);
  });

  it("returns at the opened stage with wrote false before the import modal is confirmed", () => {
    const opened = withPdf.indexOf('stage: "opened", text: opened.text, wrote: false');
    expect(opened).toBeGreaterThan(withPdf.indexOf('const renewName = "Renew and make updates";'));
    expect(opened).toBeLessThan(withPdf.indexOf('page.locator("[data-slopweaver-confirm]")'));
  });
});
