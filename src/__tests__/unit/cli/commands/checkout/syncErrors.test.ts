import { describe, expect, it } from "vitest";
import { CheckoutSyncErrors } from "../../../../../cli/commands/checkout/syncErrors.js";

describe("CheckoutSyncErrors", () => {
  it("says 'needs a human' only for a genuine divergence", () => {
    const error = CheckoutSyncErrors.diverged({ upstream: "origin/main" });
    expect(error.code).toBe("DIVERGED");
    expect(error.upstream).toBe("origin/main");
    expect(error.message).toBe("`git merge --ff-only origin/main` refused — the branch has diverged and needs a human");
  });

  it("names a busy fast-forward as transient, with its attempt count, and never as a human's job", () => {
    const error = CheckoutSyncErrors.fastForwardBusy({ attempts: 3, upstream: "origin/main" });
    expect(error.code).toBe("FAST_FORWARD_BUSY");
    expect(error.attempts).toBe(3);
    expect(error.message).toContain("failed 3 time(s) while the branch is still a clean fast-forward");
    expect(error.message).not.toContain("needs a human");
  });

  it("says an unreadable drift leaves divergence unknown, and never as a human's job", () => {
    const error = CheckoutSyncErrors.driftUnreadable({ upstream: "origin/main" });
    expect(error.code).toBe("DRIFT_UNREADABLE");
    expect(error.message).toContain("whether it diverged is unknown");
    expect(error.message).not.toContain("needs a human");
  });

  it("distinguishes an unreadable HEAD before the fast-forward from one after it", () => {
    expect(CheckoutSyncErrors.headUnreadable({ when: "before" }).message).toBe("HEAD could not be read");
    expect(CheckoutSyncErrors.headUnreadable({ when: "after" }).message).toBe(
      "HEAD could not be read after the fast-forward",
    );
  });
});
