/**
 * The `vanta` verbs' refusal lines. A `--form` batch's per-entry issues, a write client's refusal, the
 * dead-host refusal and the PDF renderer's failures are each a list, printed one line per entry; the helper
 * must keep giving them back that way rather than as the joined `message`.
 */
import { describe, expect, it } from "vitest";

import { VantaVerbErrors, vantaVerbErrorLines } from "../../../../../cli/commands/vanta/errors.js";

describe("vantaVerbErrorLines", () => {
  it.each([
    ["formEntriesInvalid", VantaVerbErrors.formEntriesInvalid({ reasons: ["first", "second"] })],
    ["writeFailed", VantaVerbErrors.writeFailed({ reasons: ["first", "second"] })],
    ["policyUploadRefused", VantaVerbErrors.policyUploadRefused({ reasons: ["first", "second"] })],
    ["pdfRenderFailed", VantaVerbErrors.pdfRenderFailed({ reasons: ["first", "second"] })],
  ])("prints each of %s's reasons on its own line", (_name, error) => {
    expect(vantaVerbErrorLines({ error })).toStrictEqual(["first", "second"]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(vantaVerbErrorLines({ error: VantaVerbErrors.pdfUnwritable({ path: "/tmp/p.pdf" }) })).toStrictEqual([
      "could not write the rendered PDF to /tmp/p.pdf",
    ]);
  });

  it("prints an unreadable approved PDF as one line carrying the read's own cause", () => {
    const error = VantaVerbErrors.policyUploadPdfUnreadable({ cause: new Error("ENOENT"), path: "/tmp/p.pdf" });
    expect(error.code).toBe("POLICY_UPLOAD_PDF_UNREADABLE");
    expect(vantaVerbErrorLines({ error })).toStrictEqual([
      "could not re-read the approved PDF at /tmp/p.pdf before attaching it: ENOENT",
    ]);
  });

  it("prints a changed approved PDF as one line naming both hashes", () => {
    const error = VantaVerbErrors.policyUploadPdfChanged({
      actualSha256: "bbb",
      expectedSha256: "aaa",
      path: "/tmp/p.pdf",
    });
    expect(error.code).toBe("POLICY_UPLOAD_PDF_CHANGED");
    expect(vantaVerbErrorLines({ error })).toStrictEqual([
      "the rendered PDF at /tmp/p.pdf changed after it was approved (approved sha256 aaa, now bbb) — nothing was " +
        "attached; render and approve it again",
    ]);
  });

  it("prints each refused flag on its own line", () => {
    const error = VantaVerbErrors.flagsRefused({ reasons: ["--home requires a value", "unknown flag: --nope"] });
    expect(error.code).toBe("FLAGS_REFUSED");
    expect(vantaVerbErrorLines({ error })).toStrictEqual(["--home requires a value", "unknown flag: --nope"]);
  });
});
