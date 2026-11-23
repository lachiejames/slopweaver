/**
 * The approval of a policy upload binds the bytes the browser attaches: a staged PDF that no longer hashes to
 * the approved `pdfSha256` is refused, naming both hashes.
 */
import { describe, expect, it } from "vitest";

import { verifyPolicyUploadPdf } from "../../../../../cli/commands/vanta/policyUploadIntegrity.js";
import { sha256Hex } from "../../../../../lib/hash.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** The bytes the approval was hashed from. */
const APPROVED = new TextEncoder().encode("%PDF-1.7 approved policy");
/** The hash the approved plan carries for {@link APPROVED}. */
const APPROVED_SHA256 = sha256Hex({ bytes: APPROVED });
/** The SHA-256 of zero bytes: `shasum -a 256 /dev/null`. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("verifyPolicyUploadPdf", () => {
  it("hands back the very bytes it read when they hash to the approved value", () => {
    const result = verifyPolicyUploadPdf({
      bytes: APPROVED,
      expectedSha256: APPROVED_SHA256,
      path: "/atlas/_policy-version/p.pdf",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(APPROVED);
  });

  it("refuses a file replaced after approval, naming the path and both hashes", () => {
    const replaced = new TextEncoder().encode("%PDF-1.7 something else");
    const result = verifyPolicyUploadPdf({
      bytes: replaced,
      expectedSha256: APPROVED_SHA256,
      path: "/atlas/_policy-version/p.pdf",
    });
    expect(result.isErr()).toBe(true);
    const error = unwrapErr(result);
    expect(error.code).toBe("POLICY_UPLOAD_PDF_CHANGED");
    expect(error.path).toBe("/atlas/_policy-version/p.pdf");
    expect(error.expectedSha256).toBe(APPROVED_SHA256);
    expect(error.actualSha256).toBe(sha256Hex({ bytes: replaced }));
    expect(error.message).toBe(
      `the rendered PDF at /atlas/_policy-version/p.pdf changed after it was approved (approved sha256 ` +
        `${APPROVED_SHA256}, now ${sha256Hex({ bytes: replaced })}) — nothing was attached; render and approve it again`,
    );
  });

  it("refuses a file truncated to nothing", () => {
    const result = verifyPolicyUploadPdf({
      bytes: new Uint8Array(0),
      expectedSha256: APPROVED_SHA256,
      path: "/atlas/_policy-version/p.pdf",
    });
    expect(unwrapErr(result).actualSha256).toBe(EMPTY_SHA256);
  });
});
