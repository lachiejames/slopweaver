/*
 * `GithubAttachErrors`: each refusal says what was measured and what it means, and a missing session reads
 * apart from an expired one.
 */
import { describe, expect, it } from "vitest";

import { GithubAttachErrors } from "../../../../../outbound/github/attach.errors.js";

describe("GithubAttachErrors", () => {
  it("renders a too-large refusal against the ceiling it was measured at", () => {
    const error = GithubAttachErrors.fileTooLarge({
      byteLength: 104857601,
      contentType: "video/mp4",
      limitBytes: 104857600,
    });
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(error.message).toContain("100.00 MiB");
    expect(error.message).toContain("nothing was uploaded");
  });

  it("tells a missing session apart from an expired one", () => {
    expect(GithubAttachErrors.webSessionMissing({ path: "/p" }).code).toBe("WEB_SESSION_MISSING");
    expect(
      GithubAttachErrors.webSessionExpired({ path: "/p", url: "https://github.com/o/r/pull/1?overview=false" }).code,
    ).toBe("WEB_SESSION_EXPIRED");
  });

  it("says the asset URL is unsafe to embed when finalizing failed", () => {
    const error = GithubAttachErrors.finalizeRefused({ assetId: 7, status: 422 });
    expect(error.message).toContain("not safe to embed");
  });
});
