/**
 * Which login `claude reset` may present for a plan. The property that matters: a login is chosen ONLY when a probe
 * over it names the organisation enrolled for the plan — never for where it sits, and never when the probe names
 * nothing — and its token never appears in anything returned.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { credentialHasScope, readClaudeCredential } from "../../../claude/credentialDocument.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import {
  bindingVerdict,
  candidateStaticReason,
  type ResetLoginDeps,
  type ResetProbeOutcome,
  resolveResetLogin,
} from "../../../claude/resetCredential.js";

const NOW = "2026-09-30T08:00:00.000Z";
const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const OTHER_ORG = "a0000075-0000-4000-8000-000000000081";
const LATER_MS = Date.parse("2026-09-30T16:00:00.000Z");

const ASSERTION: ClaudeIdentityAssertion = {
  alias: "plan-five",
  assertedAtIso: "2026-09-01T00:00:00.000Z",
  email: "five@example.test",
  organizationId: ORG,
};

/** A keychain document holding one OAuth login with the given token and scopes. */
function oauthDocument({ accessToken, scopes }: { accessToken: string; scopes: readonly string[] }): unknown {
  return { claudeAiOauth: { accessToken, expiresAt: LATER_MS, scopes } };
}

/** Deps whose store and default slot hold the given documents, and whose probe answers per token. */
function depsOf({
  defaultSlot,
  outcomes,
  store,
}: {
  defaultSlot: unknown;
  outcomes: Readonly<Record<string, ResetProbeOutcome>>;
  store: unknown;
}): ResetLoginDeps & { readonly probed: string[] } {
  const probed: string[] = [];
  return {
    probe: async ({ accessToken }) => {
      probed.push(accessToken);
      return outcomes[accessToken]!;
    },
    probed,
    read: ({ storeDir }) => (storeDir === undefined ? defaultSlot : store),
  };
}

describe("credentialHasScope", () => {
  it("reads the scopes list, and a credential with none has none", () => {
    const slice = readClaudeCredential({ document: oauthDocument({ accessToken: "t", scopes: ["user:profile"] }) });

    expect(credentialHasScope({ scope: "user:profile", slice })).toBe(true);
    expect(credentialHasScope({ scope: "user:inference", slice })).toBe(false);
    expect(credentialHasScope({ scope: "user:profile", slice: { credential: { accessToken: "t" } } })).toBe(false);
  });
});

describe("candidateStaticReason", () => {
  it("passes a live profile-scoped login", () => {
    const facts = {
      expiresAtIso: "2026-09-30T16:00:00.000Z",
      hasAccessToken: true,
      hasProfileScope: true,
      source: "store" as const,
    };

    expect(candidateStaticReason({ facts, nowIso: NOW })).toBeUndefined();
  });

  it("names an empty slot, a missing scope and an expired login", () => {
    const base = { hasAccessToken: true, hasProfileScope: true, source: "default-slot" as const };

    expect(candidateStaticReason({ facts: { ...base, hasAccessToken: false }, nowIso: NOW })).toBe(
      "the default slot holds no login",
    );
    expect(candidateStaticReason({ facts: { ...base, hasProfileScope: false }, nowIso: NOW })).toBe(
      "the default slot's login lacks the user:profile scope",
    );
    expect(candidateStaticReason({ facts: { ...base, expiresAtIso: "2026-09-30T07:00:00.000Z" }, nowIso: NOW })).toBe(
      "the default slot's login expired at 2026-09-30T07:00:00.000Z; a Claude Code session on it refreshes it",
    );
  });
});

describe("bindingVerdict", () => {
  it("binds only the enrolled organisation, a throttled probe included", () => {
    const verdict = bindingVerdict({
      alias: "plan-five",
      assertion: ASSERTION,
      outcome: { organizationId: ORG, status: 429 },
      source: "store",
    });

    expect(verdict).toEqual({ kind: "bound" });
  });

  it("rejects another organisation, and leaves a probe naming none unestablished", () => {
    expect(
      bindingVerdict({
        alias: "plan-five",
        assertion: ASSERTION,
        outcome: { organizationId: OTHER_ORG, status: 200 },
        source: "store",
      }),
    ).toEqual({ kind: "rejected", reason: "its own store's login belongs to a different account from plan-five's" });
    expect(
      bindingVerdict({ alias: "plan-five", assertion: ASSERTION, outcome: { status: 200 }, source: "store" }),
    ).toEqual({
      kind: "unestablished",
    });
  });

  it("rejects a probe that failed on the network, and a login the provider refused", () => {
    expect(
      bindingVerdict({ alias: "plan-five", assertion: ASSERTION, outcome: { failed: "network" }, source: "store" }),
    ).toEqual({ kind: "rejected", reason: "the probe over its own store failed on the network" });
    expect(
      bindingVerdict({ alias: "plan-five", assertion: ASSERTION, outcome: { status: 401 }, source: "store" }),
    ).toEqual({ kind: "rejected", reason: "its own store's login was refused (401)" });
  });
});

describe("resolveResetLogin", () => {
  it("falls through a signed-out store to the default slot, and hands the token only to the request", async () => {
    const deps = depsOf({
      defaultSlot: oauthDocument({ accessToken: "fake-default", scopes: ["user:inference", "user:profile"] }),
      outcomes: { "fake-default": { organizationId: ORG, status: 200 } },
      store: undefined,
    });

    const login = unwrap(
      await resolveResetLogin({
        alias: "plan-five",
        assertion: ASSERTION,
        deps,
        nowIso: NOW,
        storeDir: "/stores/five",
      }),
    );

    expect(login.source).toBe("default-slot");
    expect(JSON.stringify(login)).not.toContain("fake-default");
    expect(await login.withBearer(async ({ accessToken }) => accessToken)).toBe("fake-default");
    expect(deps.probed).toEqual(["fake-default"]);
  });

  it("prefers the store's own login and never probes the default slot once it binds", async () => {
    const deps = depsOf({
      defaultSlot: oauthDocument({ accessToken: "fake-default", scopes: ["user:profile"] }),
      outcomes: { "fake-store": { organizationId: ORG, status: 200 } },
      store: oauthDocument({ accessToken: "fake-store", scopes: ["user:profile"] }),
    });

    const login = unwrap(
      await resolveResetLogin({
        alias: "plan-five",
        assertion: ASSERTION,
        deps,
        nowIso: NOW,
        storeDir: "/stores/five",
      }),
    );

    expect(login.source).toBe("store");
    expect(deps.probed).toEqual(["fake-store"]);
  });

  it("refuses a default slot signed in as another plan, naming each candidate's reason", async () => {
    const deps = depsOf({
      defaultSlot: oauthDocument({ accessToken: "fake-default", scopes: ["user:profile"] }),
      outcomes: { "fake-default": { organizationId: OTHER_ORG, status: 200 } },
      store: oauthDocument({ accessToken: "fake-store", scopes: ["user:inference"] }),
    });

    const error = unwrapErr(
      await resolveResetLogin({
        alias: "plan-five",
        assertion: ASSERTION,
        deps,
        nowIso: NOW,
        storeDir: "/stores/five",
      }),
    );

    expect(error).toEqual({
      alias: "plan-five",
      code: "NO_QUALIFYING_LOGIN",
      message:
        "plan-five: no profile-scoped sign-in proven to be this plan's (its own store's login lacks the user:profile " +
        "scope; the default slot's login belongs to a different account from plan-five's)",
      reasons: [
        "its own store's login lacks the user:profile scope",
        "the default slot's login belongs to a different account from plan-five's",
      ],
    });
    expect(deps.probed).toEqual(["fake-default"]);
  });

  it("fails closed when a probe names no organisation", async () => {
    const deps = depsOf({
      defaultSlot: undefined,
      outcomes: { "fake-store": { status: 200 } },
      store: oauthDocument({ accessToken: "fake-store", scopes: ["user:profile"] }),
    });

    const error = unwrapErr(
      await resolveResetLogin({
        alias: "plan-five",
        assertion: ASSERTION,
        deps,
        nowIso: NOW,
        storeDir: "/stores/five",
      }),
    );

    expect(error.code).toBe("BINDING_UNESTABLISHED");
  });
});
