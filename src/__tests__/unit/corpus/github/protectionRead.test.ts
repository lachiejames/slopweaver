/**
 * The protection-read classifier: a 404 and the plan-gated 403 are STATES, every other 403 a permission denial,
 * and everything else (a rate limit included, which GitHub's secondary limit answers with a 403) a read failure.
 * Plus the settling helper that turns those answers into a value or a typed error.
 */
import { describe, expect, it } from "vitest";

import {
  classifyProtectionReadFailure,
  PLAN_CANNOT_PROTECT_SENTENCE,
  settleProtectionRead,
} from "../../../../corpus/github/protectionRead.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { errAsync, okAsync, unwrap, unwrapErr } from "../../../../lib/result.js";

/** One failed read, overridden per case. */
function failure(over: Partial<IngestError>): IngestError {
  return { kind: "http", message: "Forbidden", operation: "github.repos.getBranchProtection", ...over };
}

const PLAN_MESSAGE = `${PLAN_CANNOT_PROTECT_SENTENCE}. - https://docs.github.com/rest/branches/branch-protection`;

describe("classifyProtectionReadFailure", () => {
  it("reads a 404 as unprotected, whatever its body says", () => {
    expect(classifyProtectionReadFailure({ failure: failure({ message: PLAN_MESSAGE, status: 404 }) })).toBe(
      "unprotected",
    );
  });

  it("reads a 403 carrying GitHub's whole plan sentence as plan-unavailable", () => {
    expect(classifyProtectionReadFailure({ failure: failure({ message: PLAN_MESSAGE, status: 403 }) })).toBe(
      "plan-unavailable",
    );
  });

  it("reads any other 403 as a permission denial, an SSO refusal included", () => {
    expect(classifyProtectionReadFailure({ failure: failure({ status: 403 }) })).toBe("permission-denied");
    expect(
      classifyProtectionReadFailure({
        failure: failure({
          message: "Resource protected by organization SAML enforcement. You must grant your token access.",
          status: 403,
        }),
      }),
    ).toBe("permission-denied");
  });

  it("fails CLOSED on a reworded plan sentence, as a permission denial rather than a state", () => {
    expect(
      classifyProtectionReadFailure({
        failure: failure({ message: "Upgrade to GitHub Team to enable this feature.", status: 403 }),
      }),
    ).toBe("permission-denied");
  });

  it("reads a 403 rate limit as a read failure, by its kind, its Retry-After or its words", () => {
    expect(classifyProtectionReadFailure({ failure: failure({ kind: "rate-limit", status: 403 }) })).toBe(
      "read-failed",
    );
    expect(classifyProtectionReadFailure({ failure: failure({ retryAfterMs: 60_000, status: 403 }) })).toBe(
      "read-failed",
    );
    expect(
      classifyProtectionReadFailure({
        failure: failure({ message: "You have exceeded a secondary rate limit.", status: 403 }),
      }),
    ).toBe("read-failed");
  });

  it("never reads the plan sentence without the 403 as a state", () => {
    expect(classifyProtectionReadFailure({ failure: failure({ message: PLAN_MESSAGE, status: 429 }) })).toBe(
      "read-failed",
    );
    expect(classifyProtectionReadFailure({ failure: failure({ message: PLAN_MESSAGE }) })).toBe("read-failed");
  });
});

describe("settleProtectionRead", () => {
  const STATES = { branch: "main", planUnavailable: "plan" as const, unprotected: "none" as const };

  it("passes a successful read through unchanged", async () => {
    const settled = await settleProtectionRead<"read" | "plan" | "none">({ ...STATES, read: okAsync("read") });
    expect(unwrap(settled)).toBe("read");
  });

  it("answers each state's own value", async () => {
    const unprotected = await settleProtectionRead<"plan" | "none">({
      ...STATES,
      read: errAsync(failure({ status: 404 })),
    });
    const plan = await settleProtectionRead<"plan" | "none">({
      ...STATES,
      read: errAsync(failure({ message: PLAN_MESSAGE, status: 403 })),
    });
    expect(unwrap(unprotected)).toBe("none");
    expect(unwrap(plan)).toBe("plan");
  });

  it("names a denial and a failure by their own codes and words", async () => {
    const denied = unwrapErr(
      await settleProtectionRead<"plan" | "none">({ ...STATES, read: errAsync(failure({ status: 403 })) }),
    );
    const failed = unwrapErr(
      await settleProtectionRead<"plan" | "none">({
        ...STATES,
        read: errAsync(failure({ message: "Server Error", status: 500 })),
      }),
    );
    expect(denied.code).toBe("PROTECTION_PERMISSION_DENIED");
    expect(denied.message).toBe(
      "GitHub denied this token permission to read main's branch protection (HTTP 403: Forbidden); nothing about " +
        "what the branch requires is known, so this refuses rather than guessing. Read it with a token that holds " +
        "admin on the repository",
    );
    expect(failed.code).toBe("PROTECTION_READ_FAILED");
    expect(failed.message).toBe("could not read main's branch protection: Server Error");
  });
});
