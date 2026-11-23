import { describe, expect, it } from "vitest";

import type { VantaPolicyVersionUpload } from "../../../../../browser/vantaPolicyVersion.js";
import { uploadReportLines } from "../../../../../cli/commands/vanta/policyUploadRun.js";

/** An upload that attached its PDF to a draft — each case below changes one field. */
const ATTACHED: VantaPolicyVersionUpload = {
  attached: true,
  beforeScreenshotPath: "/shots/before.png",
  controls: ["Upload", "Cancel"],
  finalUrl: "https://app.vanta.com/c/acme/policies/access-control",
  refused: null,
  screenshotPath: "/shots/after.png",
  stage: "attached",
  text: "Draft version",
  wrote: true,
};

describe("uploadReportLines", () => {
  it("says the PDF is on a draft, where the browser settled, both shots and every control on screen", () => {
    expect(uploadReportLines({ upload: ATTACHED })).toEqual([
      "upload-policy-version: the PDF is attached to a DRAFT version. It was NOT submitted, approved or published.",
      "  settled on https://app.vanta.com/c/acme/policies/access-control",
      "  before: /shots/before.png",
      "  after:  /shots/after.png",
      "  controls on screen: Upload | Cancel",
    ]);
  });

  it("says none when the screen offered no control", () => {
    expect(uploadReportLines({ upload: { ...ATTACHED, controls: [] } }).at(-1)).toBe("  controls on screen: none");
  });

  it("names the stage a refusal stopped at and that nothing was written when the modal was never confirmed", () => {
    expect(
      uploadReportLines({
        upload: {
          ...ATTACHED,
          attached: false,
          controls: ["Close"],
          refused: "no New version button",
          screenshotPath: null,
          stage: "opened",
          wrote: false,
        },
      }),
    ).toEqual([
      'upload-policy-version did not attach the PDF — it stopped at "opened"',
      "  settled on https://app.vanta.com/c/acme/policies/access-control",
      "  before: /shots/before.png",
      "  refused: no New version button",
      "  Nothing was written at Vanta. The new-version modal was open and was closed unconfirmed.",
      "  controls on screen: Close",
    ]);
  });
});
