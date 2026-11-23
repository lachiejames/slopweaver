import { describe, expect, it } from "vitest";

import {
  type CloudflareWorkerScriptDetail,
  extractCloudflareWorkerScriptBundle,
  isCloudflareWorkerScriptDetail,
  normalizeCloudflareWorkerScriptBundle,
  projectCloudflareWorkerScript,
} from "../../../../../atlas/cloudflare/projection/workerScript.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

const EMPTY_RAW_BUNDLE = {
  bindings: [],
  content: null,
  deployments: [],
  schedules: [],
  secrets: [],
  settings: {},
  subdomainEnabled: null,
  subdomainPreviewsEnabled: null,
  versions: [],
};

describe("normalizeCloudflareWorkerScriptBundle", () => {
  it("normalizes every collection's fields, defaulting missing optional ones to null", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: {
        ...EMPTY_RAW_BUNDLE,
        deployments: [{ id: "dep-1" }],
        schedules: [{ cron: "0 0 * * *" }],
        secrets: [{ name: "API_KEY", type: "secret_text" }],
        versions: [{ id: "ver-1" }],
      },
    });
    expect(bundle.deployments).toEqual([
      {
        authorEmail: null,
        createdOn: null,
        id: "dep-1",
        message: null,
        source: null,
        strategy: null,
        triggeredBy: null,
        versions: [],
      },
    ]);
    expect(bundle.schedules).toEqual([{ createdOn: null, cron: "0 0 * * *", modifiedOn: null }]);
    expect(bundle.secrets).toEqual([{ name: "API_KEY", type: "secret_text" }]);
    expect(bundle.versions).toEqual([{ authorEmail: null, createdOn: null, id: "ver-1", number: null }]);
  });

  it("keeps every present deployment, schedule and version field, including nested annotations and metadata", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: {
        ...EMPTY_RAW_BUNDLE,
        deployments: [
          {
            annotations: { "workers/message": "ship it", "workers/triggered_by": "upload" },
            author_email: "dev@example.test",
            created_on: "2026-01-01T00:00:00Z",
            id: "dep-1",
            source: "api",
            strategy: "percentage",
            versions: [{ percentage: 100, version_id: "ver-1" }],
          },
        ],
        schedules: [{ created_on: "2026-01-02T00:00:00Z", cron: "0 0 * * *", modified_on: "2026-01-03T00:00:00Z" }],
        versions: [
          {
            id: "ver-1",
            metadata: { author_email: "dev@example.test", created_on: "2026-01-01T00:00:00Z" },
            number: 0,
          },
        ],
      },
    });
    expect(bundle.deployments).toEqual([
      {
        authorEmail: "dev@example.test",
        createdOn: "2026-01-01T00:00:00Z",
        id: "dep-1",
        message: "ship it",
        source: "api",
        strategy: "percentage",
        triggeredBy: "upload",
        versions: [{ percentage: 100, versionId: "ver-1" }],
      },
    ]);
    expect(bundle.schedules).toEqual([
      { createdOn: "2026-01-02T00:00:00Z", cron: "0 0 * * *", modifiedOn: "2026-01-03T00:00:00Z" },
    ]);
    expect(bundle.versions).toEqual([
      { authorEmail: "dev@example.test", createdOn: "2026-01-01T00:00:00Z", id: "ver-1", number: 0 },
    ]);
  });

  it("stores empty nested annotations and metadata as null fields", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: {
        ...EMPTY_RAW_BUNDLE,
        deployments: [{ annotations: {}, id: "dep-1", versions: [] }],
        versions: [{ metadata: {} }],
      },
    });
    expect(bundle.deployments).toEqual([
      {
        authorEmail: null,
        createdOn: null,
        id: "dep-1",
        message: null,
        source: null,
        strategy: null,
        triggeredBy: null,
        versions: [],
      },
    ]);
    expect(bundle.versions).toEqual([{ authorEmail: null, createdOn: null, id: null, number: null }]);
  });

  it("redacts a secret-text binding's value at any nesting depth", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: { ...EMPTY_RAW_BUNDLE, bindings: [{ name: "API_KEY", text: "shh", type: "secret_text" }] },
    });
    expect(bundle.bindings).toEqual([{ name: "API_KEY", type: "secret_text" }]);
  });

  it("redacts a secret-key binding's key material", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: {
        ...EMPTY_RAW_BUNDLE,
        bindings: [{ format: "raw", key_base64: "shh", name: "SIGNING_KEY", type: "secret_key" }],
      },
    });
    expect(bundle.bindings).toEqual([{ format: "raw", name: "SIGNING_KEY", type: "secret_key" }]);
  });

  it("keeps a non-secret binding untouched", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: { ...EMPTY_RAW_BUNDLE, bindings: [{ name: "CONFIG", text: "prod", type: "plain_text" }] },
    });
    expect(bundle.bindings).toEqual([{ name: "CONFIG", text: "prod", type: "plain_text" }]);
  });

  it("keeps the raw source content verbatim", () => {
    const bundle = normalizeCloudflareWorkerScriptBundle({
      raw: { ...EMPTY_RAW_BUNDLE, content: "export default { fetch() {} }" },
    });
    expect(bundle.content).toBe("export default { fetch() {} }");
  });
});

describe("projectCloudflareWorkerScript", () => {
  it("projects a script's stable fields and folds the rest into the open config bucket", () => {
    const entity = projectCloudflareWorkerScript({
      accountId: ACCOUNT_ID,
      at: AT,
      bundle: normalizeCloudflareWorkerScriptBundle({ raw: EMPTY_RAW_BUNDLE }),
      raw: { id: "my-worker", production_branch: "main", usage_model: "standard" },
    });
    expect(entity.providerId).toBe("my-worker");
    const detail = entity.detail as CloudflareWorkerScriptDetail;
    expect(detail.name).toBe("my-worker");
    expect(detail.usageModel).toBe("standard");
    expect(detail.config).toEqual({ production_branch: "main" });
  });

  it("stores a minimal script's optional fields as null and its lists as empty", () => {
    const entity = projectCloudflareWorkerScript({
      accountId: ACCOUNT_ID,
      at: AT,
      bundle: normalizeCloudflareWorkerScriptBundle({ raw: EMPTY_RAW_BUNDLE }),
      raw: { id: "my-worker" },
    });
    expect(entity.detail).toEqual({
      bindings: [],
      compatibilityDate: null,
      compatibilityFlags: [],
      config: {},
      content: null,
      createdOn: null,
      deployments: [],
      hasAssets: null,
      hasModules: null,
      kind: "worker-script",
      lastDeployedFrom: null,
      logpush: null,
      migrationTag: null,
      modifiedOn: null,
      name: "my-worker",
      schedules: [],
      secrets: [],
      settings: {},
      subdomainEnabled: null,
      subdomainPreviewsEnabled: null,
      tag: null,
      tags: [],
      usageModel: null,
      versions: [],
    });
  });

  it("stores a null tags list as an empty one and keeps every present field out of the open config", () => {
    const entity = projectCloudflareWorkerScript({
      accountId: ACCOUNT_ID,
      at: AT,
      bundle: normalizeCloudflareWorkerScriptBundle({ raw: EMPTY_RAW_BUNDLE }),
      raw: {
        compatibility_date: "2026-01-01",
        compatibility_flags: ["nodejs_compat"],
        created_on: "2026-01-02T00:00:00Z",
        has_assets: false,
        has_modules: true,
        id: "my-worker",
        last_deployed_from: "wrangler",
        logpush: false,
        migration_tag: "v1",
        modified_on: "2026-01-03T00:00:00Z",
        tag: "tag-1",
        tags: null,
        usage_model: "standard",
      },
    });
    const detail = entity.detail as CloudflareWorkerScriptDetail;
    expect(detail.tags).toEqual([]);
    expect(detail.compatibilityFlags).toEqual(["nodejs_compat"]);
    expect(detail.config).toEqual({});
    expect(detail.compatibilityDate).toBe("2026-01-01");
    expect(detail.createdOn).toBe("2026-01-02T00:00:00Z");
    expect(detail.hasAssets).toBe(false);
    expect(detail.hasModules).toBe(true);
    expect(detail.lastDeployedFrom).toBe("wrangler");
    expect(detail.logpush).toBe(false);
    expect(detail.migrationTag).toBe("v1");
    expect(detail.modifiedOn).toBe("2026-01-03T00:00:00Z");
    expect(detail.tag).toBe("tag-1");
  });
});

describe("extractCloudflareWorkerScriptBundle", () => {
  it("round-trips a stored detail's bundle back into the one-element list reconcileParentFanout expects", () => {
    const entity = projectCloudflareWorkerScript({
      accountId: ACCOUNT_ID,
      at: AT,
      bundle: normalizeCloudflareWorkerScriptBundle({
        raw: { ...EMPTY_RAW_BUNDLE, schedules: [{ cron: "0 0 * * *" }] },
      }),
      raw: { id: "my-worker" },
    });
    const detail = entity.detail as CloudflareWorkerScriptDetail;
    expect(extractCloudflareWorkerScriptBundle({ detail })).toEqual([
      {
        bindings: [],
        content: null,
        deployments: [],
        schedules: [{ createdOn: null, cron: "0 0 * * *", modifiedOn: null }],
        secrets: [],
        settings: {},
        subdomainEnabled: null,
        subdomainPreviewsEnabled: null,
        versions: [],
      },
    ]);
  });
});

describe("isCloudflareWorkerScriptDetail", () => {
  it("accepts a genuine detail", () => {
    const entity = projectCloudflareWorkerScript({
      accountId: ACCOUNT_ID,
      at: AT,
      bundle: normalizeCloudflareWorkerScriptBundle({ raw: EMPTY_RAW_BUNDLE }),
      raw: { id: "my-worker" },
    });
    expect(isCloudflareWorkerScriptDetail(entity.detail)).toBe(true);
  });

  it("rejects a detail from a different kind", () => {
    expect(isCloudflareWorkerScriptDetail({ kind: "zone" })).toBe(false);
  });

  it("rejects a non-object value", () => {
    expect(isCloudflareWorkerScriptDetail("not an object")).toBe(false);
  });
});
