/**
 * {@link claudeSignIn} and {@link codexSignIn} — the verdicts the report's own tests (`./planUsage.test.ts`) do not
 * reach: a plan never probed, a probe with no verdict, an unreadable `auth.json`, and a sign-in store that refused or
 * could not be read. Pure: every piece of evidence is built here.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanProbeRecord } from "../../../claude/planProbeRecord.js";
import { CodexSignInErrors } from "../../../codex/signInErrors.js";
import type { CodexAuthStamp } from "../../../codex/signInRecord.js";
import { claudeSignIn, codexSignIn } from "../../../plans/planUsageSignIn.js";
import type { CodexStoreFiles } from "../../../plans/planUsageTypes.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const TEN_MIN_AGO = "2026-11-06T11:50:00.000Z";
const STAMP: CodexAuthStamp = { ctimeMs: 1, kind: "present", mtimeMs: 2, size: 300 };
const FILES: CodexStoreFiles = {
  auth: { hasApiKey: false, hasTokens: true, readable: true },
  authFile: { kind: "present" },
  authStamp: STAMP,
  store: { kind: "present" },
};

const PLAN: RegisteredPlan = {
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  storeDir: "/stores/plan-one",
  usageLimitPercent: 100,
};

/** A Claude probe record for `/stores/plan-one`. */
function probe(over: Partial<ClaudePlanProbeRecord> = {}): ClaudePlanProbeRecord {
  return {
    alias: "plan-one",
    fault: undefined,
    latest: "ok",
    observedAtIso: TEN_MIN_AGO,
    storeDir: "/stores/plan-one",
    unmeasuredBecause: undefined,
    ...over,
  };
}

describe("claudeSignIn", () => {
  it("says unknown for a plan no probe has recorded", () => {
    expect(claudeSignIn({ plan: PLAN, probe: { kind: "read", value: undefined } })).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "no probe of this plan is recorded",
      source: "claude-gauge-probe",
    });
  });

  it("says unknown for a probe that reached no verdict, naming why when the record says", () => {
    const why = claudeSignIn({
      plan: PLAN,
      probe: { kind: "read", value: probe({ latest: "unmeasured", unmeasuredBecause: "the budget was spent" }) },
    });
    const bare = claudeSignIn({ plan: PLAN, probe: { kind: "read", value: probe({ latest: "unmeasured" }) } });

    expect(why).toEqual({
      kind: "unknown",
      observedAtIso: TEN_MIN_AGO,
      reason: "the last probe reached no verdict: the budget was spent",
      source: "claude-gauge-probe",
    });
    expect(bare).toMatchObject({ kind: "unknown", reason: "the last probe reached no verdict" });
  });
});

describe("codexSignIn", () => {
  const codexPlan: RegisteredPlan = { ...PLAN, alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" };

  it("says unknown, not needs-sign-in, for an auth.json that is there but unreadable, and an api-key-only one is no gap", () => {
    const unreadable = codexSignIn({
      files: { ...FILES, auth: { hasApiKey: false, hasTokens: false, readable: false } },
      plan: codexPlan,
      signIn: { kind: "read", value: { alias: "codex-one", kind: "absent" } },
    });
    const apiKey = codexSignIn({
      files: { ...FILES, auth: { hasApiKey: true, hasTokens: false, readable: true } },
      plan: codexPlan,
      signIn: { kind: "read", value: { alias: "codex-one", kind: "absent" } },
    });

    expect(unreadable).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "auth.json is there but could not be parsed",
      source: "codex-store-files",
    });
    expect(apiKey).toMatchObject({ kind: "unknown", source: "codex-live-read" });
  });

  it("says unknown, not needs-sign-in, for a store directory that is there but cannot be read", () => {
    const verdict = codexSignIn({
      files: {
        auth: { hasApiKey: false, hasTokens: false, readable: false },
        authFile: { kind: "unreadable", reason: "auth.json could not be read (EACCES)" },
        authStamp: { kind: "absent" },
        store: { kind: "unreadable", reason: "the store directory could not be read (EACCES)" },
      },
      plan: codexPlan,
      signIn: { kind: "read", value: { alias: "codex-one", kind: "absent" } },
    });

    expect(verdict).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "the store directory could not be read (EACCES)",
      source: "codex-store-files",
    });
  });

  it("says unknown, not absent, for an auth.json whose stat failed for any reason but no such file", () => {
    const verdict = codexSignIn({
      files: {
        auth: { hasApiKey: false, hasTokens: false, readable: false },
        authFile: { kind: "unreadable", reason: "auth.json could not be read (ELOOP)" },
        authStamp: { kind: "absent" },
        store: { kind: "present" },
      },
      plan: codexPlan,
      signIn: { kind: "read", value: { alias: "codex-one", kind: "absent" } },
    });

    expect(verdict).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "auth.json could not be read (ELOOP)",
      source: "codex-store-files",
    });
  });

  it("says unknown, with the store's own reason, when the sign-in store cannot be read or refuses the row", () => {
    const refusal = CodexSignInErrors.storedObservationInvalid({ alias: "codex-one", why: "has no state" });
    const down = codexSignIn({ files: FILES, plan: codexPlan, signIn: { kind: "unreadable", reason: "store down" } });
    const refused = codexSignIn({
      files: FILES,
      plan: codexPlan,
      signIn: { kind: "read", value: { alias: "codex-one", error: refusal, kind: "refused" } },
    });

    expect(down).toEqual({ kind: "unknown", observedAtIso: null, reason: "store down", source: "codex-live-read" });
    expect(refused).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "the stored sign-in observation for codex-one has no state",
      source: "codex-live-read",
    });
  });

  it("says a store the last live read found missing needs a sign-in", () => {
    const verdict = codexSignIn({
      files: FILES,
      plan: codexPlan,
      signIn: {
        kind: "read",
        value: {
          alias: "codex-one",
          kind: "record",
          record: {
            alias: "codex-one",
            authStamp: STAMP,
            codexHome: "/stores/codex-one",
            failingSinceIso: TEN_MIN_AGO,
            readAtIso: TEN_MIN_AGO,
            state: "store-missing",
          },
          revision: 3,
        },
      },
    });

    expect(verdict).toEqual({
      kind: "needs-sign-in",
      observedAtIso: TEN_MIN_AGO,
      reason: "the last live read found no store",
      source: "codex-live-read",
    });
  });

  it("trusts no live read filed for another home, even against the same auth.json", () => {
    const verdict = codexSignIn({
      files: FILES,
      plan: codexPlan,
      signIn: {
        kind: "read",
        value: {
          alias: "codex-one",
          kind: "record",
          record: {
            alias: "codex-one",
            authStamp: STAMP,
            codexHome: "/stores/elsewhere",
            failingSinceIso: undefined,
            readAtIso: TEN_MIN_AGO,
            state: "signed-in",
          },
          revision: 1,
        },
      },
    });

    expect(verdict).toMatchObject({ kind: "unknown", reason: "auth.json changed since the last live read" });
  });
});
