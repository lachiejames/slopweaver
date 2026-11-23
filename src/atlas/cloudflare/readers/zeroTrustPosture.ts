/**
 * The six Zero Trust POSTURE readers — DLP datasets, CASB findings, risk-scoring configuration, the
 * risk-scoring SUMMARY, DEX tests and DEX fleet status.
 *
 * All of them but the summary are held, never `deferred`, by the owner's ruling; see
 * `model.ts` for the ruling and `projection/zeroTrustPosture.ts` for what each row holds and why churn is
 * not a reason to hold nothing. Three things belong here rather than being discovered.
 *
 * **`risk-score-summary` is a PERMISSION BOUNDARY held as a kind, and it is meant to fail.** MEASURED:
 * `zero_trust/risk_scoring/summary` can answer `403 Authentication error` to an API token while the
 * behaviour and integration surfaces beside it answer 200. The owner's ruling is that a kind the
 * credential cannot see is recorded as a permission boundary — first-class and visible, never a silent
 * exclusion — so it is a kind of its own rather than a permanently-null field inside `risk-score`. The
 * ordinary failed-read fold then does the whole job: coverage `unreadable` carrying the provider's own
 * refusal, an open `permission-refused` gap, and a failed attempt stamped on the manifest, all of which
 * close by themselves the day the token gains the scope. `legacy-waf` holds two permanently-refused
 * surfaces the same way.
 *
 * **`dex-fleet-status` reads the provider's whole documented retention**, seven days at hourly granularity,
 * because a shorter window would be this code choosing what the surface is. It is the one read here with a
 * real cost — in rows, bytes and API time, all three scaling with the fleet — and that is stated in
 * `projection/zeroTrustPosture.ts` rather than used as a reason not to hold it.
 *
 * **DEX reads are WINDOWED, so they need an instant.** Each takes `from`/`to` derived from this run's own
 * `at` rather than a fresh `Date.now()`, so a run's window is the same instant everything else in that run
 * is stamped with.
 *
 * **The fleet-status surface REPEATS a sample, and the first live sync is what found that.** MEASURED
 * over the 7-day hourly window: the rows returned outnumbered the distinct `(deviceId, timestamp)` pairs
 * they carried, a pair coming back more than once — a device answering more than once for the same
 * hour. The repeats are BYTE-IDENTICAL, checked field by field over the union of their own keys, so there
 * is nothing to widen the key with: they are one measurement delivered several times, not several
 * measurements. So the reader drops a pair it has already seen. Without that, `merge.ts` refuses the whole
 * generation — _"this run produced the same entity id twice … refusing to merge"_ — which is exactly how
 * this was found, on the first live sync, after every unit test passed. `readers/zeroTrustDevice.ts`
 * records the same class for `device-policy`, discovered the same way.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareCasbFinding,
  projectCloudflareDexFleetStatus,
  projectCloudflareDexTest,
  projectCloudflareDlpDataset,
  projectCloudflareRiskScore,
  projectCloudflareRiskScoreSummary,
} from "../projection/zeroTrustPosture.js";
import { singletonEntities } from "./singleton.js";

/** The provider's documented DEX retention, and so the widest window a fleet-status read may ask for. */
const DEX_RETENTION_DAYS = 7;

/**
 * The `from`/`to` window a DEX read asks for, derived from this run's own instant — the same
 * calendar-arithmetic idiom `readers/auditLog.ts` uses for its own window, rather than epoch scaling.
 *
 * @param at this run's ISO timestamp
 * @returns the window's ISO bounds
 */
function dexWindow({ at }: { at: string }): { from: string; to: string } {
  const to = new Date(at);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - DEX_RETENTION_DAYS);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Read every DLP dataset under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every dataset's entity, or the reason the read failed
 */
export async function readCloudflareDlpDatasets({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const dataset of client.zeroTrust.dlp.datasets.list({ account_id: accountId })) {
      if (typeof dataset.id !== "string" || dataset.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a DLP dataset named "${dataset.name}" had no id in the response`,
            operation: "dlp-datasets-list",
          }),
        );
      }
      entities.push(projectCloudflareDlpDataset({ accountId, at, dataset: { ...dataset, id: dataset.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dlp-datasets-list" }));
  }
  return ok(entities);
}

/**
 * Read every CASB posture finding under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every finding's entity, or the reason the read failed
 */
export async function readCloudflareCasbFindings({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const finding of client.zeroTrust.casb.posture.findings.list({ account_id: accountId })) {
      if (typeof finding.id !== "string" || finding.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a CASB posture finding had no id in the response",
            operation: "casb-posture-findings-list",
          }),
        );
      }
      entities.push(projectCloudflareCasbFinding({ accountId, at, finding: { ...finding, id: finding.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "casb-posture-findings-list" }));
  }
  return ok(entities);
}

/**
 * Read the account's Zero Trust risk-scoring configuration — behaviour definitions plus the integrations
 * that feed them — into one singleton entity.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, or the reason the read failed
 */
export async function readCloudflareRiskScore({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  let behaviours: unknown;
  try {
    behaviours = await client.zeroTrust.riskScoring.behaviours.get({ account_id: accountId });
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "risk-scoring-behaviours-get" }));
  }
  const integrations: unknown[] = [];
  try {
    for await (const integration of client.zeroTrust.riskScoring.integrations.list({ account_id: accountId })) {
      integrations.push(integration);
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "risk-scoring-integrations-list" }));
  }
  return ok([projectCloudflareRiskScore({ accountId, at, behaviours, integrations })]);
}

/**
 * Read the account's Zero Trust risk-scoring SUMMARY — the per-user scores themselves.
 *
 * Expected to be refused on a token without risk-scoring read; see this file's header on why that refusal
 * is the point of the kind rather than a failure to hide.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, or the provider's own refusal
 */
export async function readCloudflareRiskScoreSummary({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const summary = await client.zeroTrust.riskScoring.summary.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareRiskScoreSummary({ accountId, at, summary: value }),
        value: summary,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "risk-scoring-summary-get" }));
  }
}

/**
 * Read every DEX synthetic test under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every test's entity, or the reason the read failed
 */
export async function readCloudflareDexTests({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    // Doubly nested: a PAGE of `dex.tests.list` is one object carrying an overview plus its own `tests`
    // array, so the tests are one level below the page rather than being the page's items.
    for await (const page of client.zeroTrust.dex.tests.list({ account_id: accountId })) {
      for (const test of page.tests) {
        if (typeof test.id !== "string" || test.id.length === 0) {
          return err(
            CloudflareClientErrors.schema({
              cause: `a DEX test named "${test.name}" had no id in the response`,
              operation: "dex-tests-list",
            }),
          );
        }
        entities.push(projectCloudflareDexTest({ accountId, at, test: { ...test, id: test.id } }));
      }
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dex-tests-list" }));
  }
  return ok(entities);
}

/**
 * Read every DEX fleet-status sample over the provider's whole documented retention.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every sample's entity, or the reason the read failed
 */
export async function readCloudflareDexFleetStatus({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  const seen = new Set<string>();
  const window = dexWindow({ at });
  try {
    for await (const sample of client.zeroTrust.dex.fleetStatus.devices.list({
      account_id: accountId,
      from: window.from,
      per_page: 50,
      source: "hourly",
      to: window.to,
    })) {
      // The pair is the sample's identity, and the provider's schema types both as strings, so a row where
      // either is absent, empty or not a string has none: refused rather than keyed as a placeholder, which
      // the dedup below would silently fold into another such row.
      const hasDevice = typeof sample.deviceId === "string" && sample.deviceId.length > 0;
      const hasInstant = typeof sample.timestamp === "string" && sample.timestamp.length > 0;
      if (!hasDevice || !hasInstant) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a DEX fleet-status sample's deviceId or timestamp was not a non-empty string in the response",
            operation: "dex-fleet-status-devices-list",
          }),
        );
      }
      // The provider repeats a sample — see this file's header for the measurement and why the repeat is
      // dropped rather than keyed around.
      const key = `${sample.deviceId}@${sample.timestamp}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entities.push(projectCloudflareDexFleetStatus({ accountId, at, sample }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dex-fleet-status-devices-list" }));
  }
  return ok(entities);
}
