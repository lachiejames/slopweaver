import { describe, expect, it } from "vitest";

import {
  accountCell,
  type ClaudeAccountCell,
  cachedAccountCell,
  loginHintAddress,
  loginHintFor,
  namesAnAccount,
  renderAccountCell,
} from "../../../claude/accountBinding.js";
import type { ClaudeIdentityStatus } from "../../../claude/identityAssertions.js";

const ASSERTED = "2026-09-11T21:47:09.338Z";

const BOUND = "admin@example.invalid";
const CACHED = "typo@example.invalid";

const match: ClaudeIdentityStatus = { alias: "plan-one", assertedAtIso: ASSERTED, kind: "match" };
const changed: ClaudeIdentityStatus = { alias: "plan-one", assertedAtIso: ASSERTED, kind: "changed" };
const unobserved: ClaudeIdentityStatus = { alias: "plan-one", assertedAtIso: ASSERTED, kind: "unobserved" };
const unbound: ClaudeIdentityStatus = { alias: "plan-one", kind: "unbound" };

describe("accountCell", () => {
  it("names the bound address when the token still holds the enrolled account", () => {
    expect(accountCell({ cachedEmail: BOUND, enrolledEmail: BOUND, status: match })).toEqual({
      address: BOUND,
      trust: "bound",
    });
  });

  it("names the bound address even when accounts.json maps nothing at all", () => {
    expect(accountCell({ enrolledEmail: BOUND, status: match })).toEqual({ address: BOUND, trust: "bound" });
  });

  it("keeps the BOUND address and reports the drift when the cache disagrees", () => {
    expect(accountCell({ cachedEmail: CACHED, enrolledEmail: BOUND, status: match })).toEqual({
      address: BOUND,
      staleCache: CACHED,
      trust: "bound-cache-stale",
    });
  });

  it("calls an address a cache when the enrollment bound none — every row written before addresses were recorded", () => {
    expect(accountCell({ cachedEmail: CACHED, status: match })).toEqual({ address: CACHED, trust: "cached" });
  });

  it("says UNMAPPED only when nothing anywhere names an address", () => {
    expect(accountCell({ status: match })).toEqual({ trust: "unmapped" });
  });

  // The three below are the whole point: both candidate addresses are supplied, and the cell must still
  // carry NEITHER. A test that omitted them would pass over a renderer that leaks one.
  it("carries no address at all when the token is not the enrolled account", () => {
    expect(accountCell({ cachedEmail: CACHED, enrolledEmail: BOUND, status: changed })).toEqual({
      trust: "wrong-account",
    });
  });

  it("carries no address at all when nothing has been enrolled for the store", () => {
    expect(accountCell({ cachedEmail: CACHED, enrolledEmail: BOUND, status: unbound })).toEqual({
      trust: "unenrolled",
    });
  });

  it("carries no address at all when the store could not be read this pass", () => {
    expect(accountCell({ cachedEmail: CACHED, enrolledEmail: BOUND, status: unobserved })).toEqual({
      trust: "unread",
    });
  });
});

describe("cachedAccountCell", () => {
  it("can only ever produce a cache, however confident the caller is", () => {
    expect(cachedAccountCell({ cachedEmail: CACHED })).toEqual({ address: CACHED, trust: "cached" });
  });

  it("says UNMAPPED when the plan maps no address", () => {
    expect(cachedAccountCell({})).toEqual({ trust: "unmapped" });
  });
});

describe("renderAccountCell", () => {
  it("renders the healthy case as the bare address, exactly as the column read before this change", () => {
    expect(renderAccountCell({ cell: { address: BOUND, trust: "bound" } })).toBe(BOUND);
  });

  it("renders the drift with the bound address first", () => {
    expect(renderAccountCell({ cell: { address: BOUND, staleCache: CACHED, trust: "bound-cache-stale" } })).toBe(
      `${BOUND} (accounts.json says ${CACHED})`,
    );
  });

  it("marks an unbound address as a cache", () => {
    expect(renderAccountCell({ cell: { address: CACHED, trust: "cached" } })).toBe(`CACHED ${CACHED}`);
  });

  it("says what is wrong rather than leaving the column blank", () => {
    expect(renderAccountCell({ cell: { trust: "wrong-account" } })).toBe("WRONG ACCOUNT");
    expect(renderAccountCell({ cell: { trust: "unenrolled" } })).toBe("NOT ENROLLED");
    expect(renderAccountCell({ cell: { trust: "unread" } })).toBe("UNREAD");
    expect(renderAccountCell({ cell: { trust: "unmapped" } })).toBe("UNMAPPED");
  });

  it("never renders an `@` for a trust that earned no address", () => {
    const unearned: readonly ClaudeAccountCell[] = [
      { trust: "wrong-account" },
      { trust: "unenrolled" },
      { trust: "unread" },
      { trust: "unmapped" },
    ];
    expect(unearned.length).toBeGreaterThan(0);
    expect(unearned.filter((cell) => renderAccountCell({ cell }).includes("@"))).toEqual([]);
  });
});

describe("namesAnAccount", () => {
  it("is true for exactly the two trusts an enrollment bound", () => {
    expect(namesAnAccount({ cell: { address: BOUND, trust: "bound" } })).toBe(true);
    expect(namesAnAccount({ cell: { address: BOUND, staleCache: CACHED, trust: "bound-cache-stale" } })).toBe(true);
  });

  it("is false for a cache, which is the distinction the whole mechanism rests on", () => {
    expect(namesAnAccount({ cell: { address: CACHED, trust: "cached" } })).toBe(false);
    expect(namesAnAccount({ cell: { trust: "wrong-account" } })).toBe(false);
    expect(namesAnAccount({ cell: { trust: "unenrolled" } })).toBe(false);
    expect(namesAnAccount({ cell: { trust: "unread" } })).toBe(false);
    expect(namesAnAccount({ cell: { trust: "unmapped" } })).toBe(false);
  });
});

describe("loginHintAddress — what a login may pre-fill", () => {
  it("pre-fills the address the enrollment bound, over a cache that disagrees", () => {
    expect(loginHintAddress({ cachedEmail: CACHED, enrolledEmail: BOUND })).toEqual({
      address: BOUND,
      source: "enrolled",
    });
  });

  it("offers the cache, SAID TO BE the cache, when nothing was bound", () => {
    expect(loginHintAddress({ cachedEmail: CACHED })).toEqual({ address: CACHED, source: "cache" });
  });

  it("pre-fills the bound address when no cache is configured at all", () => {
    expect(loginHintAddress({ enrolledEmail: BOUND })).toEqual({ address: BOUND, source: "enrolled" });
  });

  it("pre-fills nothing when neither string exists", () => {
    expect(loginHintAddress({})).toBeUndefined();
  });
});

describe("loginHintFor — one configured plan's pre-fill", () => {
  const account = { alias: "plan-one", email: CACHED, storeDir: "/stores/plan-one" };

  it("reads the plan's own enrollment, and prefers its bound address", () => {
    const assertions = [
      { alias: "plan-two", assertedAtIso: ASSERTED, email: "other@example.invalid", organizationId: "org-two" },
      { alias: "plan-one", assertedAtIso: ASSERTED, email: BOUND, organizationId: "org-one" },
    ];
    expect(loginHintFor({ account, assertions })).toEqual({ address: BOUND, source: "enrolled" });
  });

  it("falls to the cache, said to be the cache, when the enrollment bound no address", () => {
    const assertions = [{ alias: "plan-one", assertedAtIso: ASSERTED, organizationId: "org-one" }];
    expect(loginHintFor({ account, assertions })).toEqual({ address: CACHED, source: "cache" });
  });

  it("pre-fills nothing for an unenrolled plan with no cache", () => {
    expect(
      loginHintFor({ account: { alias: "plan-one", storeDir: "/stores/plan-one" }, assertions: [] }),
    ).toBeUndefined();
  });
});
