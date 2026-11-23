/**
 * `probedAccountCell` — the one join `claude gauge` and the capacity reading both make between a probe's
 * organisation and the standing enrollment — and `codexLiveAccountText`, the Codex side of the same one-slot cell.
 */
import { describe, expect, it } from "vitest";

import { probedAccountCell } from "../../../claude/accountBinding.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { codexLiveAccountText } from "../../../codex/accountDisplay.js";

const ASSERTED = "2026-09-11T21:47:09.338Z";

const PLAN: ClaudeAccount = { alias: "plan-one", email: "typo@example.invalid", storeDir: "/stores/plan-one" };

const ENROLLED: readonly ClaudeIdentityAssertion[] = [
  { alias: "plan-one", assertedAtIso: ASSERTED, email: "admin@example.invalid", organizationId: "org-one" },
];

describe("probedAccountCell", () => {
  it("binds the enrolled address when the probe names the enrolled organisation, the cache named as stale", () => {
    expect(probedAccountCell({ account: PLAN, assertions: ENROLLED, observedOrganizationId: "org-one" })).toEqual({
      address: "admin@example.invalid",
      staleCache: "typo@example.invalid",
      trust: "bound-cache-stale",
    });
  });

  it("calls a different organisation the wrong account, and a probe that named none unread", () => {
    expect(probedAccountCell({ account: PLAN, assertions: ENROLLED, observedOrganizationId: "org-two" })).toEqual({
      trust: "wrong-account",
    });
    expect(probedAccountCell({ account: PLAN, assertions: ENROLLED })).toEqual({ trust: "unread" });
  });

  it("never falls back to the cached address for a store nothing enrolled", () => {
    expect(probedAccountCell({ account: PLAN, assertions: [], observedOrganizationId: "org-one" })).toEqual({
      trust: "unenrolled",
    });
  });
});

describe("codexLiveAccountText", () => {
  it("prints the live address, and both when the register disagrees", () => {
    expect(
      codexLiveAccountText({
        row: { emailCached: "a@example.invalid", liveEmail: "a@example.invalid", liveState: "signed-in" },
      }),
    ).toBe("a@example.invalid");
    expect(
      codexLiveAccountText({
        row: { emailCached: "a@example.invalid", liveEmail: "b@example.invalid", liveState: "signed-in" },
      }),
    ).toBe("b@example.invalid (the register says a@example.invalid)");
    expect(codexLiveAccountText({ row: { emailCached: null, liveEmail: null, liveState: "signed-in" } })).toBe(
      "signed in to an account with no email",
    );
  });

  it("labels the cache as a cache when the live read failed, and says so when nothing is known", () => {
    expect(
      codexLiveAccountText({ row: { emailCached: "a@example.invalid", liveEmail: null, liveState: "unreadable" } }),
    ).toBe("CACHED a@example.invalid");
    expect(codexLiveAccountText({ row: { emailCached: null, liveEmail: null, liveState: "unreadable" } })).toBe(
      "UNREAD",
    );
    expect(
      codexLiveAccountText({ row: { emailCached: "a@example.invalid", liveEmail: null, liveState: "signed-out" } }),
    ).toBe("NOT SIGNED IN");
    expect(
      codexLiveAccountText({ row: { emailCached: "a@example.invalid", liveEmail: null, liveState: "store-missing" } }),
    ).toBe("STORE MISSING");
  });
});
