import { describe, expect, it } from "vitest";

import { JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";

describe("JumpcloudReadErrors", () => {
  it("distinguishes an unknown surface from an inventoried-and-refused one", () => {
    const unknown = JumpcloudReadErrors.surfaceRefused({ surface: "v2-not-a-thing" });
    const refused = JumpcloudReadErrors.surfaceRefused({
      excludedBecause: "returns a full-disk-encryption recovery key",
      surface: "v2-systems-fdekey",
    });
    expect(unknown.excludedBecause).toBe(undefined);
    expect(refused.excludedBecause).toBe("returns a full-disk-encryption recovery key");
    expect(refused.message).toContain("inventoried and deliberately never called");
  });

  it("says why a redirect is refused rather than followed", () => {
    const error = JumpcloudReadErrors.redirectRefused({ status: 302, surface: "v1-systems-list" });
    expect(error.code).toBe("REDIRECT_REFUSED");
    expect(error.message).toContain("the allowlist checked the request that was sent");
  });

  it("frames a 403 as a permission boundary rather than a broken credential", () => {
    const error = JumpcloudReadErrors.permissionRefused({ status: 403, surface: "v2-password-vault-folders" });
    expect(error.code).toBe("PERMISSION_REFUSED");
    expect(error.message).toContain("permission boundary");
  });

  it("keeps a rejected credential apart from a refused permission, because only one of them clears", () => {
    const rejected = JumpcloudReadErrors.credentialRejected({ status: 401, surface: "v1-systems-list" });
    expect(rejected.code).toBe("CREDENTIAL_REJECTED");
    expect(rejected.message).toContain("Replacing the key is what clears this");
  });

  it("carries a transport cause forward instead of flattening it to a string", () => {
    const cause = new Error("socket hang up");
    const error = JumpcloudReadErrors.transportFailed({ cause, surface: "v1-systems-list" });
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("socket hang up");
  });

  it("handles a non-Error cause without throwing", () => {
    expect(JumpcloudReadErrors.transportFailed({ cause: 42, surface: "s" }).message).toContain("42");
  });

  it("names the surface on every variant, so a failure is always attributable", () => {
    const all = [
      JumpcloudReadErrors.surfaceRefused({ surface: "a" }),
      JumpcloudReadErrors.redirectRefused({ status: 301, surface: "b" }),
      JumpcloudReadErrors.credentialRejected({ status: 401, surface: "c" }),
      JumpcloudReadErrors.unexpectedShape({ detail: "d", surface: "d" }),
      JumpcloudReadErrors.transportFailed({ cause: "x", surface: "e" }),
    ];
    expect(all.map((e) => e.surface)).toStrictEqual(["a", "b", "c", "d", "e"]);
  });

  it("gives each variant a distinct code, so a caller can branch exhaustively", () => {
    const codes = [
      JumpcloudReadErrors.surfaceRefused({ surface: "a" }).code,
      JumpcloudReadErrors.redirectRefused({ status: 301, surface: "b" }).code,
      JumpcloudReadErrors.credentialRejected({ status: 401, surface: "c" }).code,
      JumpcloudReadErrors.unexpectedShape({ detail: "d", surface: "d" }).code,
      JumpcloudReadErrors.transportFailed({ cause: "x", surface: "e" }).code,
    ];
    expect(new Set(codes).size).toBe(5);
  });
});
