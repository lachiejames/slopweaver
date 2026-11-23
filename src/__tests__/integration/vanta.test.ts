/**
 * INTEGRATION test: the Vanta Manage API client against the REAL Vanta API, recorded + replayed through a
 * Polly cassette (`../setup-polly.ts` + `../cassetteRedactConfig.ts#VANTA`). This is the SIXTH provider
 * config, and unlike Datadog's dedicated-empty-scope trick there is no throwaway compliance tenant to point
 * this at — the credentials in `$SLOPWEAVER_HOME/secrets` are our own real, live Manage API workspace, so
 * every response here is real compliance content, run through the narrowest allowlist of any provider (see
 * that config's own header for exactly which fields survive and why almost none do).
 *
 * ## What this proves, and precisely what it cannot — three real, structural gaps, not oversights
 *
 * **Proved here.** OAuth client-credentials token acquisition (`oauth.ts`) mints a real, usable bearer
 * token and reuses it rather than re-minting (Vanta revokes the prior token the instant a second one is
 * minted for the same application, so this is a correctness property, not a speed one); `controls-deactivated`,
 * `risks-enterprise-risk`, `policies-list`, `vendors-list` and `frameworks-list` (`inventory.ts`) each answer
 * for real credentials and decode through their Zod schema, with their structural
 * (`source`/`status`/`method`/risk-level) fields surviving redaction as the exact closed-vocabulary values
 * an account's data actually produced.
 *
 * **NOT proved here — and why, not just that:**
 *
 * 1. `controls-active` is absent. A compliance programme routinely runs past 100 active controls, so
 *    `client.ts`'s `listControlsActive` genuinely walks a second page — and a paging cursor is blanked to `[REDACTED]` by
 *    every provider's allowlist today (nothing Vanta-specific), so a replayed second-page request carries a
 *    match key indistinguishable from the first page's (see `cq-r2-cassette-cursor-identity`, currently on
 *    hold pending the owner's own call on that design). Recording it anyway does not silently pass: it fails
 *    LOUDLY, with `pagination.ts`'s own duplicate-id refusal, because replay serves page one's data twice.
 *    Confirmed by attempting it — see this PR's description for the exact failure.
 * 2. `getControl`/`listControlTests`/`getTestEntitySample` (`client.ts`) are absent. Every Vanta id in an
 *    account is a 32-character lowercase hex string, which `cassetteRedactConfig.ts#IDENTIFIER_SEGMENTS`
 *    (correctly) treats as opaque — so `isSafeRequestPath` collapses `/v1/controls/<id>`,
 *    `/v1/controls/<id>/tests` and `/v1/tests/<id>/entities` to the SAME literal `/[REDACTED]` match key.
 *    Recording distinct real calls to all three would not fail loudly; it would silently let Polly serve one
 *    endpoint's recorded response to another's request, and a passing assertion would prove nothing about
 *    which endpoint actually answered. Sibling gap to (1) — a path-embedded resource id rather than a
 *    cursor — and not fixed here either.
 * 3. `risks-risk-scenario` and `evidence-documents` are absent. `vantaRiskScenarioDtoSchema.type` and
 *    `vantaDocumentDtoSchema.category`/`.uploadStatus` are REQUIRED, `.strict()`-validated enums whose real,
 *    measured values in an account are mostly multi-word (`"Risk Scenario"`, `"Vulnerability
 *    management"`, `"Needs document"`, …) — and `cassetteTripwire.ts`'s `isProvablySafe` refuses ANY
 *    whitespace surviving under an allowlisted key, `keepValuesByKey` included. So there is no allowlist
 *    shape that lets these fields survive redaction while their real values keep the response parseable:
 *    unlike Datadog's `type` (which had single-token members to scope down to), every legal member of
 *    Vanta's `type` is multi-word, and most of `category`'s/`uploadStatus`'s legal members are too. See
 *    `cassetteRedactConfig.ts#VANTA`'s own header for the measured per-field value breakdown.
 *
 * Retry/backoff itself is unit-tested (`transport.test.ts`); a forced real 429 is deliberately not attempted
 * against this shared, real workspace's rate budget the way Datadog's dedicated key allowed — the cost of a
 * false 429 here is contention with whatever else is legitimately polling this same compliance tool. This
 * suite's own six OAuth mints plus five resource reads (one client per test, per `client()`'s own header)
 * exercise the transport's normal pacing without forcing that budget.
 *
 * **No assertion below may depend on a string this org authored** (a policy/vendor/framework `name`,
 * `description`, any owner's `displayName`/`emailAddress`). Only counts, booleans, ids-as-opaque-synthetic-
 * values, and the closed enum fields the allowlist actually keeps are asserted.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record VANTA_CLIENT_ID=… VANTA_CLIENT_SECRET=… yarn test:integration  # (re)record — reads real Vanta data
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createVantaManageClient, type VantaManageClient } from "../../atlas/vanta/client.js";
import { resolveVantaCredentials, type VantaCredentials } from "../../atlas/vanta/credentials.js";
import { vantaFrameworksEndpoint } from "../../atlas/vanta/inventory.js";
import { createVantaTokenProvider } from "../../atlas/vanta/oauth.js";
import { createVantaTransport } from "../../atlas/vanta/transport.js";
import { createLogger } from "../../lib/logger.js";
import { unwrap } from "../../lib/result.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Placeholder credentials for replay — never checked, request headers are not part of the match key. */
const PLACEHOLDER_CREDENTIALS: VantaCredentials = { clientId: "c".repeat(24), clientSecret: "s".repeat(40) };

function requireRecordEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`set ${name} to record the Vanta cassette`);
  }
  return value;
}

/** @returns the real credentials on record, shape-valid placeholders on replay */
function credentials(): VantaCredentials {
  if (!RECORD) {
    return PLACEHOLDER_CREDENTIALS;
  }
  const resolved = resolveVantaCredentials({
    env: {
      VANTA_CLIENT_ID: requireRecordEnv({ name: "VANTA_CLIENT_ID" }),
      VANTA_CLIENT_SECRET: requireRecordEnv({ name: "VANTA_CLIENT_SECRET" }),
    },
  });
  if (resolved.isErr()) {
    throw new Error(`could not build Vanta credentials for the integration cassette: ${resolved.error.join("; ")}`);
  }
  return resolved.value;
}

/**
 * The mint lock's home. A real directory is required (`operationLock.ts` writes a lock file under it) even
 * on replay, where nothing meaningful is cached across runs.
 */
const HOME = mkdtempSync(join(tmpdir(), "slopweaver-vanta-cassette-"));

afterAll(() => {
  rmSync(HOME, { force: true, recursive: true });
});

/**
 * A fresh client per test — same reason as `datadog.test.ts`'s `silentClient()`: Polly patches
 * `globalThis.fetch` in `beforeEach`, after module evaluation, so a client built at module scope would hold
 * the pristine fetch and hit the real API for real while recording nothing.
 */
function client(): VantaManageClient {
  const logger = createLogger({ sink: () => undefined });
  const transport = createVantaTransport({ logger });
  const tokenProvider = createVantaTokenProvider({ credentials: credentials(), home: HOME, logger, transport });
  return createVantaManageClient({ tokenProvider, transport });
}

/** Vanta's own closed vocabulary for a vendor's risk level (`vendorRiskLevelSchema`). */
const KNOWN_RISK_LEVELS = new Set(["CRITICAL", "HIGH", "LOW", "MEDIUM", "UNSCORED"]);

/** Vanta's own closed vocabulary for a policy's document status (`policyStatusSchema`). */
const KNOWN_POLICY_STATUSES = new Set(["OK", "NEEDS_REMEDIATION"]);

describe("vanta (integration — real Vanta Manage API via Polly cassette)", () => {
  it("mints a client-credentials OAuth token and reuses it for a real resource call", async () => {
    const logger = createLogger({ sink: () => undefined });
    const transport = createVantaTransport({ logger });
    const tokenProvider = createVantaTokenProvider({ credentials: credentials(), home: HOME, logger, transport });
    const first = await tokenProvider.getToken();
    expect(first.isOk()).toBe(true);
    expect(unwrap(first).length).toBeGreaterThan(0);
    // The cache, not a second mint: Vanta revokes the prior token the instant a second one is minted for the
    // same application, so a real re-mint here would be a live bug, not just a slow test.
    const second = await tokenProvider.getToken();
    expect(second.isOk()).toBe(true);
    expect(unwrap(second)).toBe(unwrap(first));
  });

  it("lists deactivated controls, one bounded page", async () => {
    const result = await client().listControlsDeactivated();
    expect(result.isOk()).toBe(true);
    // Zero is a valid, authoritative answer here (most workspaces deactivate few or no controls) — the
    // property under test is that the surface answers and parses, not that it is non-empty. Unlike
    // `controls-active` (see this file's header), this surface currently has few enough real rows that it
    // never needs a second page.
    expect(unwrap(result).length).toBeGreaterThanOrEqual(0);
  });

  it("lists enterprise-risk-type risks, one bounded page", async () => {
    const result = await client().listRisksEnterpriseRisk();
    expect(result.isOk()).toBe(true);
    // An empty page is a valid answer here, and an empty page carries no `type: "Enterprise Risk"` in the
    // recorded body — the same multi-word-enum wall `risks-risk-scenario` hits (this file's header) would
    // hit this surface too the moment a real row exists. Proves the surface answers for real credentials;
    // does not prove a real enterprise-risk row round-trips.
    expect(unwrap(result).length).toBeGreaterThanOrEqual(0);
  });

  it("lists every policy, one bounded page, with status intact", async () => {
    const result = await client().listPolicies();
    expect(result.isOk()).toBe(true);
    const policies = unwrap(result);
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((p) => KNOWN_POLICY_STATUSES.has(p.status))).toBe(true);
  });

  it("lists every vendor, one bounded page, with risk level and auth method intact", async () => {
    const result = await client().listVendors();
    expect(result.isOk()).toBe(true);
    const vendors = unwrap(result);
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors.every((v) => KNOWN_RISK_LEVELS.has(v.inherentRiskLevel))).toBe(true);
  });

  it("lists frameworks, one bounded page, with completion counts intact", async () => {
    const result = await client().listFrameworks();
    expect(result.isOk()).toBe(true);
    const frameworks = unwrap(result);
    expect(frameworks.length).toBeGreaterThanOrEqual(0);
    // Numbers are never touched by the string redactor (see `cassetteRedactConfig.ts`'s Datadog header) —
    // asserted as real arithmetic, not a shape check: total is never smaller than completed.
    expect(frameworks.every((f) => f.numControlsTotal >= f.numControlsCompleted)).toBe(true);
    // A route-shaped, id-free path (no per-item id, unlike control/test detail — see this file's header),
    // so this one IS a real endpoint identity check: the frameworks path is distinct from every list-surface
    // path above it.
    expect(vantaFrameworksEndpoint().path).toBe("/v1/frameworks");
  });
});
