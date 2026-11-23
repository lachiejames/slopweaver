/**
 * The six Zero Trust POSTURE entity shapes and their projections — DLP datasets, CASB findings, risk
 * scoring, its summary, DEX tests and DEX fleet status.
 *
 * The five other than the summary are held by the owner's ruling (see `model.ts`), not deferred. Each
 * could carry a reason that is REJECTED, and naming which is
 * the point: three might be declared out as "a churning judgement, not state" or "a time series, not
 * configuration", and risk scoring because its summary surface can answer a token 403 — which is why that
 * summary is now a kind of its own. None of those is volume, and volume is the only surviving ground.
 *
 * ## A churning surface is not a reason, and the store already handles churn
 *
 * `merge.ts` stales a stored entity absent from a fresh read rather than deleting it, so a finding that is
 * resolved between two syncs becomes a `stale` row that still says it once existed. That is strictly more
 * useful than not holding it, which is what "it churns" was really an argument against.
 *
 * ## `dex-fleet-status` is the one with a real cost, and it is stated rather than used as a reason
 *
 * MEASURED over the provider's whole documented 7-day retention at hourly granularity — its rows, its bytes
 * and the API time the read took — against the terabyte the owner named as a qualifying volume, and nowhere
 * near it, so it is held. Two consequences a reader should know rather than discover: the window ROLLS, so
 * each sync re-reads a moved seven days and rows aging out of it become `stale` and accumulate with every
 * day; and its read time scales with the fleet and adds directly to a full sync's wall time. Reproduce both with
 * `slopweaver cloudflare sync` and `wc -c "$SLOPWEAVER_HOME"/atlas/cloudflare/kinds/dex-fleet-status.jsonl`.
 *
 * A fleet-status row is a per-device TELEMETRY sample and carries the person's email, the device name, its
 * local addresses and its battery, CPU and disk state. Cloudflare redacts the ISP address itself. It is held
 * because that is what the surface is, it lands in `$SLOPWEAVER_HOME` and never in this repository, and no
 * fixture here is built from a real one.
 */
import { absentAsNull, unsetFieldAsNull } from "#lib/absent.js";
import type { CloudflareEntity } from "../model.js";
import { accountScopedEntity } from "./accountScopedEntity.js";

/** The fixed provider id the risk-scoring singleton is stored under. Not exported, for the reason
 * `zeroTrustAccessAdmin.ts`'s own fixed id gives. */
const RISK_SCORE_ID = "risk-score";

/** The fixed provider id the risk-scoring SUMMARY singleton is stored under. */
const RISK_SCORE_SUMMARY_ID = "risk-score-summary";

/**
 * Project one DLP dataset. Its uploaded CELLS are not returned by any read API, so what is stored is the
 * dataset's own state — which is the fact a `dlp-profile` entry referencing it needs to be interpretable.
 *
 * @param dataset the raw dataset, already validated to carry a non-empty `id`
 * @param accountId the account this dataset was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDlpDataset({
  dataset,
  accountId,
  at,
}: {
  dataset: {
    readonly id: string;
    readonly name?: string | null;
    readonly status?: string | null;
    readonly description?: string | null;
    readonly num_cells?: number | null;
    readonly secret?: boolean | null;
    readonly encoding_version?: number | null;
    readonly columns?: unknown;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      columns: absentAsNull({ value: dataset.columns }),
      createdAt: absentAsNull({ value: dataset.created_at }),
      description: unsetFieldAsNull({ record: dataset, key: "description" }),
      encodingVersion: absentAsNull({ value: dataset.encoding_version }),
      kind: "dlp-dataset",
      name: absentAsNull({ value: dataset.name }),
      /** How many cells were uploaded. The cells themselves are never returned by a read. */
      numCells: absentAsNull({ value: dataset.num_cells }),
      secret: absentAsNull({ value: dataset.secret }),
      status: absentAsNull({ value: dataset.status }),
      updatedAt: absentAsNull({ value: dataset.updated_at }),
    },
    kind: "dlp-dataset",
    operation: "dlp-datasets-list",
    providerId: dataset.id,
  });
}

/**
 * Project one CASB posture finding.
 *
 * @param finding the raw finding, already validated to carry a non-empty `id`
 * @param accountId the account this finding was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareCasbFinding({
  finding,
  accountId,
  at,
}: {
  finding: {
    readonly id: string;
    readonly active_count?: number | null;
    readonly archived_count?: number | null;
    readonly instance_count?: number | null;
    readonly latest_affliction_date?: string | null;
    readonly finding?: unknown;
    readonly integration?: unknown;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      activeCount: absentAsNull({ value: finding.active_count }),
      archivedCount: absentAsNull({ value: finding.archived_count }),
      /** The finding's own definition: name, vendor, severity, category and remediation guide. */
      finding: absentAsNull({ value: finding.finding }),
      instanceCount: absentAsNull({ value: finding.instance_count }),
      integration: absentAsNull({ value: finding.integration }),
      kind: "casb-finding",
      latestAfflictionDate: absentAsNull({ value: finding.latest_affliction_date }),
    },
    kind: "casb-finding",
    operation: "casb-posture-findings-list",
    providerId: finding.id,
  });
}

/**
 * Project the account's Zero Trust risk-scoring configuration into its singleton entity — the behaviour
 * definitions and the integrations that feed them, folded into one record.
 *
 * The SUMMARY surface is deliberately not a field here: it can answer 403 to an API token that reads the
 * configuration beside it, so a slot for it would be permanently null and read as "there is nothing", which is the opposite of true. It
 * is its own kind instead, {@link projectCloudflareRiskScoreSummary}, whose refusal is that kind's open gap.
 *
 * @param behaviours the raw behaviour definitions
 * @param integrations the raw risk-scoring integrations
 * @param accountId the account this was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareRiskScore({
  behaviours,
  integrations,
  accountId,
  at,
}: {
  behaviours: unknown;
  integrations: readonly unknown[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      /** Each named risk behaviour, its level and whether it is enabled. */
      behaviours,
      integrations: [...integrations],
      kind: "risk-score",
    },
    kind: "risk-score",
    operation: "risk-scoring-get",
    providerId: RISK_SCORE_ID,
  });
}

/**
 * Project the account's Zero Trust risk-scoring SUMMARY — the per-user scores themselves — into its
 * singleton entity.
 *
 * A kind of its own rather than a field on {@link projectCloudflareRiskScore}, because this surface can answer
 * 403 to an API token while the configuration beside it answers 200: a permission boundary is
 * recorded as a kind that says it could not be read, never as a null slot on a kind that could. See
 * `readers/zeroTrustPosture.ts` for the measurement and the owner's ruling behind that.
 *
 * @param summary the raw summary payload, kept whole because its shape is only observable where the token
 *   can read it
 * @param accountId the account this summary was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareRiskScoreSummary({
  summary,
  accountId,
  at,
}: {
  summary: unknown;
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: { kind: "risk-score-summary", summary },
    kind: "risk-score-summary",
    operation: "risk-scoring-summary-get",
    providerId: RISK_SCORE_SUMMARY_ID,
  });
}

/**
 * Project one DEX synthetic test.
 *
 * @param test the raw test, already validated to carry a non-empty `id`
 * @param accountId the account this test was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDexTest({
  test,
  accountId,
  at,
}: {
  test: {
    readonly id: string;
    readonly name?: string | null;
    readonly description?: string | null;
    readonly enabled?: boolean | null;
    readonly interval?: string | null;
    readonly kind?: string | null;
    readonly host?: string | null;
    readonly method?: string | null;
    readonly target_policies?: unknown;
    readonly targeted?: boolean | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      description: absentAsNull({ value: test.description }),
      enabled: absentAsNull({ value: test.enabled }),
      host: absentAsNull({ value: test.host }),
      interval: absentAsNull({ value: test.interval }),
      kind: "dex-test",
      method: unsetFieldAsNull({ record: test, key: "method" }),
      name: absentAsNull({ value: test.name }),
      /** Which WARP profiles this test runs under, and whether it is targeted at all. */
      targetPolicies: unsetFieldAsNull({ record: test, key: "target_policies" }),
      targeted: unsetFieldAsNull({ record: test, key: "targeted" }),
      testKind: absentAsNull({ value: test.kind }),
    },
    kind: "dex-test",
    operation: "dex-tests-list",
    providerId: test.id,
  });
}

/**
 * Project one DEX fleet-status sample. Keyed on the device plus the sample's own instant, because a device
 * has one row per hour and the pair is what makes a sample unique.
 *
 * @param sample the raw fleet-status row
 * @param accountId the account this sample was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDexFleetStatus({
  sample,
  accountId,
  at,
}: {
  /** The row as the SDK returns it. Only `deviceId` and `timestamp` are named, because they are the only
   * two this projection reads — the rest of the forty telemetry columns are carried through the index
   * signature, and restating them here would be a second declaration of the provider's shape to keep in
   * step. There is deliberately NO index signature either: the SDK's row is an `interface`, and TypeScript
   * gives an interface no implicit index signature, so declaring one here would refuse the very value this
   * projection exists to take. The whole row is stored regardless — see the `detail` below. */
  sample: {
    readonly deviceId: string;
    readonly timestamp: string;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  // Both are required by the provider's schema, and the reader refuses a row missing either before this
  // runs, so the pair is always a real identity rather than a placeholder two rows could share.
  const providerId = `${sample.deviceId}@${sample.timestamp}`;
  return accountScopedEntity({
    accountId,
    at,
    /** The whole sample, kept as read: the row IS the measurement, and a projection that picked fields
     * would decide for a later reader which of forty telemetry columns mattered. */
    detail: { kind: "dex-fleet-status", sample },
    kind: "dex-fleet-status",
    operation: "dex-fleet-status-devices-list",
    providerId,
  });
}
