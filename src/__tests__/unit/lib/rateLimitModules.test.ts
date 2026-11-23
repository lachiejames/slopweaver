import { describe, expect, it } from "vitest";

import { perMinute } from "#lib/rateLimitQuota.js";
import { PROVIDER_RATE_LIMITS } from "#lib/rateLimits.js";
import { ADMIN_SERVICE_RATE_LIMITS } from "#lib/rateLimitsAdminServices.js";
import { CHAT_AND_DOCS_RATE_LIMITS } from "#lib/rateLimitsChatAndDocs.js";
import { MAIL_AND_WORK_RATE_LIMITS } from "#lib/rateLimitsMailAndWork.js";
import { PLATFORM_RATE_LIMITS } from "#lib/rateLimitsPlatforms.js";

/*
 * The same properties `talkHatches.test.ts` guards for a register cut into category files: a category dropping
 * out of the one table the pacing layer reads, and the table's reading order silently changing. What each
 * quota says stays `rateLimits.test.ts`'s subject for the whole registry.
 */
const CATEGORIES = [
  {
    keys: ["github", "calendar", "drive", "google-admin", "google-secops", "make"],
    name: "PLATFORM_RATE_LIMITS",
    category: PLATFORM_RATE_LIMITS,
  },
  {
    keys: ["gmail", "outlook", "fathom", "linear"],
    name: "MAIL_AND_WORK_RATE_LIMITS",
    category: MAIL_AND_WORK_RATE_LIMITS,
  },
  {
    keys: ["jumpcloud", "knowbe4", "knock", "twilio", "mail-sender"],
    name: "ADMIN_SERVICE_RATE_LIMITS",
    category: ADMIN_SERVICE_RATE_LIMITS,
  },
  {
    keys: ["notion", "slack"],
    name: "CHAT_AND_DOCS_RATE_LIMITS",
    category: CHAT_AND_DOCS_RATE_LIMITS,
  },
] as const;

describe("the provider rate-limit category files", () => {
  it("declares four categories, so every guard below is true of something", () => {
    expect(CATEGORIES.length).toBe(4);
  });

  it.each(CATEGORIES)("$name is non-empty and holds exactly its providers, in order", ({ category, keys }) => {
    expect(Object.keys(category).length).toBeGreaterThan(0);
    expect(Object.keys(category)).toEqual(keys);
  });

  it("is spread into PROVIDER_RATE_LIMITS whole and in order, with no provider in two categories", () => {
    const expected = CATEGORIES.flatMap(({ category }) => Object.entries(category));
    expect(Object.entries(PROVIDER_RATE_LIMITS)).toEqual(expected);
    expect(new Set(expected.map(([provider]) => provider)).size).toBe(expected.length);
  });

  it("builds a one-minute documented quota from perMinute, derated and dated by the shared constants", () => {
    expect(perMinute({ limit: 60, method: "unit-test provenance" })).toEqual({
      documentedLimit: 60,
      intervalMs: 60_000,
      safetyFactor: 0.8,
      verification: { method: "unit-test provenance", onIso: "2026-07-27", status: "documented" },
    });
  });
});
