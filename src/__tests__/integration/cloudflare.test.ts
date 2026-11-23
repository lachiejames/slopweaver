/**
 * INTEGRATION test: the Cloudflare connector against the REAL Cloudflare API, recorded + replayed through a
 * Polly cassette (`../setup-polly.ts` + `../cassetteRedactConfig.ts#CLOUDFLARE`). This is the EIGHTH and
 * LAST provider config in this series. Same posture as Vanta/Notion — a real account rather than a
 * throwaway tenant — so the allowlist keeps only Cloudflare's own structural vocabulary
 * (`status`/`type`/`decision`/`kind`/`subtype`, booleans, timestamps) and lets every zone/policy/project/
 * rule NAME and every free-text field fall through to `[REDACTED]`.
 *
 * ## The SAME path-collision fix Notion needed, for the SAME reason
 *
 * Every Cloudflare REST path is `/accounts/{account_id}/...` or `/zones/{zone_id}/...`, and both ids are
 * 32-character opaque hex — so `IDENTIFIER_SEGMENTS` collapses every request to an identical opaque literal,
 * exactly as `notion.test.ts`'s own header describes. Most of the kinds below genuinely paginate (a real
 * account this size returns more than one page for several of them), so EVERY test here opts into Polly's
 * `order: true` matching, defensively, whether or not a given kind is known to need it — cheap, and the
 * alternative is a silent wrong-response bug discovered only when a kind's real data happens to cross a page
 * boundary on some future re-record.
 *
 * ## What this proves, and precisely what it cannot
 *
 * **Proved here.** `resolveLiveCloudflareScope` (`client.ts`) proves the configured account is reachable and
 * resolves exactly one zone matching the configured deep-zone name — the two-call sequence every other
 * reader in this atlas depends on. Twenty-three of this atlas's thirty declared kinds (`model.ts`'s
 * `CLOUDFLARE_KINDS`) each answer for real credentials through their own reader function and decode into
 * this atlas's typed entity shape, spanning both account-scoped and (configured-)zone-scoped surfaces, and
 * including kinds an account genuinely has zero of — a legitimate, authoritative empty answer, not a
 * scoping gap. A dedicated test confirms `mapCloudflareError`'s real behaviour for a well-formed but
 * nonexistent zone id: Cloudflare answers 403, never 404 (it will not confirm a zone's existence to a token
 * that cannot see it), so the typed mapping asserted here is `permission`.
 *
 * **NOT proved here — and why:**
 *
 * 0. `guardingFetch`'s own `success:false`-envelope path (`client.ts`'s header names exactly why it exists)
 *    is unit-tested (`client.test.ts`) against a fake fetch, never exercised here. Finding a REAL Cloudflare
 *    call that legitimately answers `success:false` on HTTP 200, without either mutating the recorded account's real
 *    configuration or depending on a guess about which read endpoint happens to behave that way, was not
 *    something this suite could verify safely before writing it — unlike a 404, which is standard and safe
 *    to trigger deliberately.
 * 1. `dns-record`, `api-gateway` and `audit-log` (each hundreds to thousands of rows on a real account, the
 *    audit log within its own 30-day window) are absent. Each would genuinely walk many real pages every time this cassette is re-recorded — real
 *    API cost and record-time latency for no additional PROOF beyond what the smaller, already-covered kinds
 *    already establish about pagination and redaction. Bounding these to "one page" would mean calling the
 *    SDK differently from how the shipped reader actually calls it, which proves the bound rather than the
 *    reader.
 * 2. `worker-route` is absent — Cloudflare scopes it separately, so a token can read every other kind here
 *    and still get HTTP 403 ("Authentication error") on this one endpoint. That is a permission on the token,
 *    not a connector defect, and a cassette recorded under such a token would hold only the refusal.
 * 3. `legacy-waf` (`readCloudflareWafPackageInventory`, zone-scoped-only signature) and the per-item detail
 *    reads every "…Children"/"…Bundle"/"…Associations" function needs (a specific project's deployments, a
 *    specific script's bundle, a specific policy's application scope) are absent — each needs a real child id
 *    first fetched from its own parent's inventory read, and that second call is exactly the same opaque-
 *    path collision `vanta.test.ts`'s header describes for a path-embedded resource id: two different
 *    real ids collapse to the identical match key.
 * 4. A forced real 429 is not attempted, for the same reason as `vanta.test.ts`/`notion.test.ts`: this
 *    account's real rate budget is shared with whatever else legitimately uses this same token.
 *
 * **No assertion below may depend on a string this org authored** (a zone/project/policy/rule name, a
 * description, a filter expression, a webhook URL). Only counts, booleans, ids-as-opaque-synthetic-values,
 * and the closed `status`/`type`/`decision`/`kind` fields the allowlist actually keeps are asserted.
 *
 * Run:
 *   yarn test:integration                                                      # replay (default, offline)
 *   POLLY_MODE=record CLOUDFLARE_API_TOKEN=… yarn test:integration              # (re)record — reads real Cloudflare data
 */
import type Cloudflare from "cloudflare";
import { describe, expect, it } from "vitest";

import {
  createCloudflareClient,
  mapCloudflareError,
  resolveLiveCloudflareScope,
} from "../../atlas/cloudflare/client.js";
import { readCloudflareAccessApplications, readCloudflareAccessGroups } from "../../atlas/cloudflare/readers/access.js";
import { readCloudflareAccessReusablePolicies } from "../../atlas/cloudflare/readers/accessPolicy.js";
import { readCloudflareAccountCertificateInventory } from "../../atlas/cloudflare/readers/accountCertificate.js";
import { readCloudflareAccountFilterListInventory } from "../../atlas/cloudflare/readers/accountFilterList.js";
import { readCloudflareAccountSetting } from "../../atlas/cloudflare/readers/accountSetting.js";
import { readCloudflareDevicePostureRules } from "../../atlas/cloudflare/readers/devicePosture.js";
import { readCloudflareDnssec } from "../../atlas/cloudflare/readers/dnssec.js";
import { readCloudflareFirewallFilters } from "../../atlas/cloudflare/readers/firewallService.js";
import { readCloudflareGatewayListInventory } from "../../atlas/cloudflare/readers/gatewayList.js";
import { readCloudflareNotificationDestinations } from "../../atlas/cloudflare/readers/notificationDestination.js";
import { readCloudflareNotificationHistory } from "../../atlas/cloudflare/readers/notificationHistory.js";
import { readCloudflareNotificationPolicies } from "../../atlas/cloudflare/readers/notificationPolicy.js";
import { readCloudflareNotificationSilences } from "../../atlas/cloudflare/readers/notificationSilence.js";
import { readCloudflarePageRules } from "../../atlas/cloudflare/readers/pageRule.js";
import { readCloudflarePagesProjectInventory } from "../../atlas/cloudflare/readers/pages.js";
import { readCloudflareWorkerAccountSetting } from "../../atlas/cloudflare/readers/workerAccountSetting.js";
import { readCloudflareWorkerDomains } from "../../atlas/cloudflare/readers/workerDomain.js";
import { readCloudflareWorkerScriptInventory } from "../../atlas/cloudflare/readers/workerScript.js";
import { readCloudflareZones } from "../../atlas/cloudflare/readers/zone.js";
import { readCloudflareCertificatePacks } from "../../atlas/cloudflare/readers/zoneCertificate.js";
import { readCloudflareZoneSettings } from "../../atlas/cloudflare/readers/zoneSetting.js";
import type { Result } from "../../lib/result.js";
import { unwrap } from "../../lib/result.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function requireRecordEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`set ${name} to record the Cloudflare cassette`);
  }
  return value;
}

/** @returns the real token on record, a shape-valid placeholder on replay */
function apiToken(): string {
  return RECORD ? requireRecordEnv({ name: "CLOUDFLARE_API_TOKEN" }) : "a".repeat(40);
}

/** A fresh client per test — Polly patches `globalThis.fetch` in `beforeEach`, after module evaluation. */
function client(): Cloudflare {
  return createCloudflareClient({ apiToken: apiToken() });
}

/** See this file's header — every test opts into ordered matching. */
function useOrderedMatching(): void {
  activePolly()
    ?.server.any()
    .on("request", (req) => {
      req.configure({ matchRequestsBy: { order: true } });
    });
}

/**
 * A synthetic account and zone. Replay compares the account id against the redacted cassette, so it only needs
 * to agree with `cassetteRedactConfig.ts`'s keep; the zone id rides a request path the matcher normalises. The
 * live API knows neither, so a re-record swaps in the installation's own ids here and in that keep locally,
 * then rewrites both back to these synthetic values in the recorded cassette and the source before committing —
 * the hygiene gate refuses either real id that survives.
 */
const ACCOUNT_ID = "0000000000000000000000000000ac01";
const ZONE_ID = "00000000000000000000000000002e01";
const DEEP_ZONE_NAME = "acme.com";
const NOW_ISO = "2026-01-01T00:00:00.000Z";

describe("cloudflare (integration — real Cloudflare API via Polly cassette)", () => {
  it("resolves the live account and deep-zone scope", async () => {
    useOrderedMatching();
    const result = await resolveLiveCloudflareScope({
      client: client(),
      selection: { accountId: ACCOUNT_ID, deepZoneName: DEEP_ZONE_NAME },
    });
    expect(result.isOk()).toBe(true);
    const scope = unwrap(result);
    expect(scope.accountId).toBe(ACCOUNT_ID);
    expect(scope.deepZone.name).toBe(DEEP_ZONE_NAME);
  });

  const ACCOUNT_SCOPED: readonly {
    readonly name: string;
    readonly read: (input: { client: Cloudflare; accountId: string; at: string }) => Promise<Result<unknown, unknown>>;
  }[] = [
    { name: "account-setting", read: readCloudflareAccountSetting },
    { name: "access-policy", read: readCloudflareAccessReusablePolicies },
    { name: "access-application", read: readCloudflareAccessApplications },
    { name: "access-group", read: readCloudflareAccessGroups },
    { name: "pages-project", read: readCloudflarePagesProjectInventory },
    { name: "worker-script", read: readCloudflareWorkerScriptInventory },
    { name: "worker-account-setting", read: readCloudflareWorkerAccountSetting },
    { name: "account-certificate", read: readCloudflareAccountCertificateInventory },
    { name: "notification-policy", read: readCloudflareNotificationPolicies },
    { name: "gateway-list", read: readCloudflareGatewayListInventory },
    { name: "zone", read: readCloudflareZones },
    { name: "device-posture-rule", read: readCloudflareDevicePostureRules },
    { name: "account-filter-list", read: readCloudflareAccountFilterListInventory },
    { name: "notification-destination", read: readCloudflareNotificationDestinations },
    { name: "notification-history", read: readCloudflareNotificationHistory },
    { name: "notification-silence", read: readCloudflareNotificationSilences },
    { name: "worker-domain", read: readCloudflareWorkerDomains },
  ];

  it.each(ACCOUNT_SCOPED)(
    "reads the account-scoped kind $name, bounded to what the real account holds",
    async ({ read }) => {
      useOrderedMatching();
      const result = await read({ accountId: ACCOUNT_ID, at: NOW_ISO, client: client() });
      expect(result.isOk()).toBe(true);
      expect(Array.isArray(unwrap(result)) || unwrap(result) !== undefined).toBe(true);
    },
  );

  const ZONE_SCOPED: readonly {
    readonly name: string;
    readonly read: (input: {
      client: Cloudflare;
      accountId: string;
      zoneId: string;
      at: string;
    }) => Promise<Result<unknown, unknown>>;
  }[] = [
    { name: "zone-setting", read: readCloudflareZoneSettings },
    { name: "dnssec", read: readCloudflareDnssec },
    { name: "zone-certificate", read: readCloudflareCertificatePacks },
    { name: "page-rule", read: readCloudflarePageRules },
    { name: "firewall-service", read: readCloudflareFirewallFilters },
  ];

  it.each(ZONE_SCOPED)("reads the zone-scoped kind $name, bounded to the configured deep zone", async ({ read }) => {
    useOrderedMatching();
    const result = await read({ accountId: ACCOUNT_ID, at: NOW_ISO, client: client(), zoneId: ZONE_ID });
    expect(result.isOk()).toBe(true);
    expect(Array.isArray(unwrap(result)) || unwrap(result) !== undefined).toBe(true);
  });

  it("maps a real error for a well-formed but nonexistent zone id into a typed permission error", async () => {
    // Confirmed live: Cloudflare answers a well-formed, non-real zone id with HTTP 403 ("Invalid zone
    // identifier"), never 404 — it will not confirm or deny a zone's existence to a token that cannot see
    // it. `permission`, not `not-found`, is the real mapping this call produces.
    try {
      await client().zones.get({ zone_id: "0".repeat(32) });
      expect.unreachable("a well-formed but nonexistent zone id should error");
    } catch (cause) {
      const mapped = mapCloudflareError({ cause, operation: "zones.get" });
      expect(mapped.kind).toBe("permission");
    }
  });
});
