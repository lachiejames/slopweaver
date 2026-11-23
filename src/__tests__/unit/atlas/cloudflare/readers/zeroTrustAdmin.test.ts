import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { CloudflareClientErrors } from "../../../../../atlas/cloudflare/errors.js";
import { readCloudflareAccessAuthenticationLog } from "../../../../../atlas/cloudflare/readers/accessAuthenticationLog.js";
import {
  readCloudflareAccessCertificates,
  readCloudflareAccessGatewayCas,
  readCloudflareAccessKeyConfiguration,
  readCloudflareAccessTags,
} from "../../../../../atlas/cloudflare/readers/zeroTrustAccessAdmin.js";
import {
  readCloudflareDexFleetStatus,
  readCloudflareDexTests,
  readCloudflareRiskScore,
  readCloudflareRiskScoreSummary,
} from "../../../../../atlas/cloudflare/readers/zeroTrustPosture.js";
import { isRecord } from "../../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/**
 * A client answering each path suffix with its own body, and an EMPTY page 2 for every V4-paginated
 * surface — `readers/zeroTrust.test.ts`'s header records what a stub that never empties does to the worker.
 *
 * Per-path rather than one fixed body, because every reader here reads more than one surface: the two
 * certificate families, the two log streams, the identity providers the SCIM read needs first.
 */
function routedClient({ routes, status = 200 }: { routes: readonly [string, unknown][]; status?: number }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const page = requestedPage({ url });
      if (page > 1) {
        return jsonResponse({ body: { result: [], result_info: { count: 0, page }, success: true }, status: 200 });
      }
      const route = routes.find(([suffix]) => url.pathname.endsWith(suffix));
      if (route === undefined) {
        return jsonResponse({ body: { result: [], result_info: { count: 0, page }, success: true }, status: 200 });
      }
      return jsonResponse({ body: { result: route[1], success: true }, status });
    },
    maxRetries: 0,
  });
}

/** The `requestBody` a stored SCIM entity carries, or `null` when its detail is not one. Its own function
 * so the assertion above stays a plain value comparison, the way `ruleset.test.ts` reads a typed detail. */
function storedRequestBody({ entity }: { entity: { detail: unknown } }): unknown {
  return storedDetailField({ entity, field: "requestBody" });
}

/** One field of a stored entity's detail, or `null` when its detail is not a record. */
function storedDetailField({ entity, field }: { entity: { detail: unknown }; field: string }): unknown {
  return isRecord(entity.detail) ? entity.detail[field] : null;
}

/** A client whose authentication-event surface answers `events` and whose one SCIM-enabled provider's
 * update surface answers `updates`, for the identity refusals below. */
function accessLogClient({
  events,
  updates,
}: {
  events: readonly unknown[];
  updates: readonly unknown[];
}): ReturnType<typeof routedClient> {
  return routedClient({
    routes: [
      ["/access/logs/access_requests", events],
      ["/access/identity_providers", [{ id: "idp-1", name: "Okta", scim_config: { enabled: true } }]],
      ["/access/logs/scim/updates", updates],
    ],
  });
}

const SCIM_IDENTITY = {
  cf_resource_id: "res-1",
  http_method: "PATCH",
  idp_id: "idp-1",
  logged_at: "2026-01-02T00:00:00Z",
};

describe("readCloudflareAccessTags", () => {
  it("keys a tag on its NAME, which is the provider's own addressing", async () => {
    const client = routedClient({ routes: [["/access/tags", [{ app_count: 2, name: "prod" }]]] });
    const entities = unwrap(await readCloudflareAccessTags({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["prod"]);
  });

  it("refuses a tag whose response omits the name it is keyed on", async () => {
    const client = routedClient({ routes: [["/access/tags", [{ app_count: 2 }]]] });
    expect(unwrapErr(await readCloudflareAccessTags({ accountId: ACCOUNT_ID, at: AT, client })).kind).toBe("schema");
  });
});

describe("readCloudflareAccessCertificates", () => {
  it("folds the mTLS and SAML families into one kind, mapping the SAML set's uid and expiry", async () => {
    const client = routedClient({
      routes: [
        ["/access/certificates", [{ id: "mtls-1", name: "client CA" }]],
        [
          "/access/saml_certificates",
          [
            {
              created_at: "2026-01-01T00:00:00Z",
              current_certificate: { not_after: "2027-01-01T00:00:00Z" },
              uid: "saml-1",
              updated_at: "2026-02-01T00:00:00Z",
            },
          ],
        ],
      ],
    });
    const entities = unwrap(await readCloudflareAccessCertificates({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["mtls-1", "saml-1"]);
    expect(entities.map((entity) => storedDetailField({ entity, field: "expiresOn" }))).toEqual([
      null,
      "2027-01-01T00:00:00Z",
    ]);
  });

  it("stores a null expiry for a SAML set with no active certificate", async () => {
    const client = routedClient({
      routes: [
        ["/access/certificates", []],
        [
          "/access/saml_certificates",
          [{ created_at: "2026-01-01T00:00:00Z", uid: "saml-2", updated_at: "2026-02-01T00:00:00Z" }],
        ],
      ],
    });
    const entities = unwrap(await readCloudflareAccessCertificates({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.detail)).toEqual([
      {
        associatedHostnames: [],
        certificateKind: "saml",
        createdAt: "2026-01-01T00:00:00Z",
        expiresOn: null,
        fingerprint: null,
        kind: "access-certificate",
        name: null,
        updatedAt: "2026-02-01T00:00:00Z",
      },
    ]);
  });

  it("refuses a SAML certificate set whose response omits the uid it is keyed on", async () => {
    const client = routedClient({
      routes: [
        ["/access/certificates", []],
        ["/access/saml_certificates", [{ created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]],
      ],
    });
    const result = await readCloudflareAccessCertificates({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).operation).toBe("access-saml-certificates-list");
  });
});

describe("readCloudflareAccessGatewayCas", () => {
  it("reads a configured SSH certificate authority", async () => {
    const client = routedClient({ routes: [["/access/gateway_ca", [{ id: "ca-1", public_key: "ssh-rsa AAAA" }]]] });
    const entities = unwrap(await readCloudflareAccessGatewayCas({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["ca-1"]);
  });

  it("reads NO CA as zero entities rather than a failure, because the provider says 404 for none", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { errors: [{ code: 12112, message: "access.api.error.gateway_ca_not_found" }], success: false },
          status: 404,
        }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareAccessGatewayCas({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("still fails on a refusal that is not a not-found", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccessGatewayCas({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareAccessKeyConfiguration", () => {
  it("projects the key-rotation singleton under its fixed provider id", async () => {
    const client = routedClient({ routes: [["/access/keys", { key_rotation_interval_days: 90 }]] });
    const entities = unwrap(await readCloudflareAccessKeyConfiguration({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["access-key-configuration"]);
  });
});

describe("readCloudflareAccessAuthenticationLog", () => {
  it("folds authentication events and SCIM updates into one kind, keyed on composites", async () => {
    const client = routedClient({
      routes: [
        ["/access/logs/access_requests", [{ created_at: "2026-01-01T00:00:00Z", ray_id: "ray-1" }]],
        ["/access/identity_providers", [{ id: "idp-1", name: "Okta", scim_config: { enabled: true } }]],
        [
          "/access/logs/scim/updates",
          [{ cf_resource_id: "res-1", http_method: "PATCH", idp_id: "idp-1", logged_at: "2026-01-02T00:00:00Z" }],
        ],
      ],
    });
    const entities = unwrap(await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client }));
    // The SCIM half's key carries a SHA-1 prefix of the request body — see `projection/zeroTrustAccessLog.ts`
    // on the genuinely-different updates a body-less key merged away.
    expect(entities.map((entity) => entity.providerId)).toEqual([
      "auth:2026-01-01T00:00:00Z:ray-1",
      `scim:2026-01-02T00:00:00Z:idp-1:res-1:PATCH:${createHash("sha1").update(JSON.stringify(null)).digest("hex").slice(0, 16)}`,
    ]);
  });

  // The third regression the first live sync found. Two SCIM updates for one group, one second and one
  // method differ ONLY in their request body — the live stream carried such groups — and a key without the body
  // merged them, which `merge.ts` refuses as a repeated entity id. Drop the body digest from the key in
  // `projection/zeroTrustAccessLog.ts` and this test reports one entity instead of two.
  it("tells two SCIM updates apart when only their request body differs", async () => {
    const shared = {
      cf_resource_id: "res-1",
      http_method: "PATCH",
      idp_id: "idp-1",
      logged_at: "2026-01-02T00:00:00Z",
      resource_type: "GROUP",
    };
    const client = routedClient({
      routes: [
        ["/access/logs/access_requests", []],
        ["/access/identity_providers", [{ id: "idp-1", name: "Okta", scim_config: { enabled: true } }]],
        [
          "/access/logs/scim/updates",
          [
            { ...shared, request_body: '{"members":["alice"]}' },
            { ...shared, request_body: '{"members":["bob"]}' },
            // The byte-identical repeat the same measurement also found: this one MUST collapse.
            { ...shared, request_body: '{"members":["bob"]}' },
          ],
        ],
      ],
    });
    const entities = unwrap(await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client }));
    // Two records, not one and not three: the body keeps the two real updates apart, and the reader's own
    // guard collapses the redelivery. Both halves of the class, in one assertion.
    expect(entities.map((entity) => storedRequestBody({ entity }))).toEqual([
      '{"members":["alice"]}',
      '{"members":["bob"]}',
    ]);
  });

  it("returns the authentication half alone when no identity provider exists to ask SCIM about", async () => {
    const client = routedClient({
      routes: [
        ["/access/logs/access_requests", [{ created_at: "2026-01-01T00:00:00Z", ray_id: "ray-1" }]],
        ["/access/identity_providers", []],
      ],
    });
    const entities = unwrap(await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["auth:2026-01-01T00:00:00Z:ray-1"]);
  });

  // The regression the FIRST LIVE SYNC found, after every test above it passed. Asking about a provider
  // whose `scim_config.enabled` is false answers `400 access.api.error.idp_not_scim_enabled` and fails the
  // whole kind, so the fixture's SCIM route refuses unless every requested id is the enabled one. Delete the
  // `scim_config` filter in the reader and this test fails on that refusal.
  it("asks only the SCIM-ENABLED providers, because a disabled one refuses the whole read", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        if (page > 1) {
          return jsonResponse({ body: { result: [], result_info: { count: 0, page }, success: true }, status: 200 });
        }
        if (url.pathname.endsWith("/access/identity_providers")) {
          return jsonResponse({
            body: {
              result: [
                { id: "idp-off", name: "GitHub", scim_config: { enabled: false } },
                { id: "idp-on", name: "Okta", scim_config: { enabled: true } },
              ],
              success: true,
            },
            status: 200,
          });
        }
        if (url.pathname.endsWith("/access/logs/scim/updates")) {
          const asked = url.searchParams.getAll("idp_id");
          if (asked.some((id) => id !== "idp-on")) {
            return jsonResponse({
              body: { errors: [{ code: 12161, message: "access.api.error.idp_not_scim_enabled" }], success: false },
              status: 400,
            });
          }
          return jsonResponse({
            body: {
              result: [
                { cf_resource_id: "res-1", http_method: "PATCH", idp_id: "idp-on", logged_at: "2026-01-02T00:00:00Z" },
              ],
              result_info: { count: 1, page },
              success: true,
            },
            status: 200,
          });
        }
        return jsonResponse({ body: { result: [], success: true }, status: 200 });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual([
      `scim:2026-01-02T00:00:00Z:idp-on:res-1:PATCH:${createHash("sha1").update(JSON.stringify(null)).digest("hex").slice(0, 16)}`,
    ]);
  });

  // A log line carries no id, so every component of its composite key must be there. Before these refusals
  // an absent one was keyed as the literal "unknown", which two different lines would have shared.
  it("refuses an authentication event without created_at", async () => {
    const client = accessLogClient({ events: [{ ray_id: "ray-1" }], updates: [] });
    const result = await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause:
          "an Access authentication event had no created_at in the response, and created_at is part of the key that identifies it",
        operation: "access-authentication-events-list",
      }),
    );
  });

  it("refuses an authentication event without ray_id", async () => {
    const client = accessLogClient({ events: [{ created_at: "2026-01-01T00:00:00Z", ray_id: null }], updates: [] });
    const result = await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause:
          "an Access authentication event had no ray_id in the response, and ray_id is part of the key that identifies it",
        operation: "access-authentication-events-list",
      }),
    );
  });

  it.each([
    ["an empty", { created_at: "", ray_id: "ray-1" }, "created_at"],
    ["a numeric", { created_at: "2026-01-01T00:00:00Z", ray_id: 42 }, "ray_id"],
  ])("refuses a malformed authentication identity field (%s %s)", async (_label, event, field) => {
    const client = accessLogClient({ events: [event], updates: [] });
    const result = await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause: `an Access authentication event's ${field} was not a non-empty string in the response, so no key can be formed from it`,
        operation: "access-authentication-events-list",
      }),
    );
  });

  it.each(["logged_at", "idp_id", "cf_resource_id", "http_method"])(
    "refuses a SCIM update without %s needed for identity",
    async (field) => {
      const update = Object.fromEntries(Object.entries(SCIM_IDENTITY).filter(([key]) => key !== field));
      const client = accessLogClient({ events: [], updates: [update] });
      const result = await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client });
      expect(unwrapErr(result)).toEqual(
        CloudflareClientErrors.schema({
          cause: `an Access SCIM update had no ${field} in the response, and ${field} is part of the key that identifies it`,
          operation: "access-scim-updates-list",
        }),
      );
    },
  );

  it("refuses a SCIM update whose identity field is an empty string", async () => {
    const client = accessLogClient({ events: [], updates: [{ ...SCIM_IDENTITY, idp_id: "" }] });
    const result = await readCloudflareAccessAuthenticationLog({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause:
          "an Access SCIM update's idp_id was not a non-empty string in the response, so no key can be formed from it",
        operation: "access-scim-updates-list",
      }),
    );
  });
});

describe("readCloudflareDexFleetStatus", () => {
  // The other regression the first live sync found: the provider returns a byte-identical sample more than
  // once for one `(deviceId, timestamp)` pair — measured across the live fleet-status window — and
  // `merge.ts` refuses the WHOLE generation for a repeated entity id. Delete the `seen` guard in the reader
  // and this test reports three entities instead of two.
  it("drops a sample the provider returned twice for one device-hour", async () => {
    const sample = {
      colo: "MEL",
      deviceId: "device-1",
      mode: "warp",
      status: "connected",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const items = page === 1 ? [sample, sample, { ...sample, deviceId: "device-2" }] : [];
        return jsonResponse({
          body: { result: items, result_info: { count: items.length, page }, success: true },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDexFleetStatus({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual([
      "device-1@2026-01-01T00:00:00Z",
      "device-2@2026-01-01T00:00:00Z",
    ]);
  });

  // The pair is required by the provider's schema. Before this refusal, two rows missing `deviceId` at one
  // instant were both keyed `unknown@<instant>` and the dedup above silently kept one of them.
  it.each([
    ["no deviceId", { colo: "MEL", timestamp: "2026-01-01T00:00:00Z" }],
    ["an empty deviceId", { colo: "MEL", deviceId: "", timestamp: "2026-01-01T00:00:00Z" }],
    ["no timestamp", { colo: "MEL", deviceId: "device-1" }],
    ["a numeric deviceId", { colo: "MEL", deviceId: 123, timestamp: "2026-01-01T00:00:00Z" }],
  ])("refuses a sample with %s rather than keying it on a placeholder", async (_label, sample) => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const items = page === 1 ? [sample, { ...sample, colo: "SYD" }] : [];
        return jsonResponse({
          body: { result: items, result_info: { count: items.length, page }, success: true },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const result = await readCloudflareDexFleetStatus({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause: "a DEX fleet-status sample's deviceId or timestamp was not a non-empty string in the response",
        operation: "dex-fleet-status-devices-list",
      }),
    );
  });
});

describe("readCloudflareDexTests", () => {
  it("reads a test from TWO levels down — the page's items each carry their own tests array", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const items = page === 1 ? [{ overviewMetrics: {}, tests: [{ id: "dex-1", name: "http" }] }] : [];
        return jsonResponse({
          body: { result: { items }, result_info: { count: items.length, page }, success: true },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDexTests({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["dex-1"]);
  });
});

describe("readCloudflareRiskScore", () => {
  it("folds the behaviour definitions and the integrations into one singleton", async () => {
    const client = routedClient({
      routes: [
        ["/zt_risk_scoring/behaviors", { behaviors: { malware: { enabled: false } } }],
        ["/zt_risk_scoring/integrations", [{ id: "integration-1" }]],
      ],
    });
    const entities = unwrap(await readCloudflareRiskScore({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["risk-score"]);
  });
});

describe("readCloudflareRiskScoreSummary", () => {
  it("reads the summary where the token may see it", async () => {
    const client = routedClient({ routes: [["/zt_risk_scoring/summary", { users: [] }]] });
    const entities = unwrap(await readCloudflareRiskScoreSummary({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["risk-score-summary"]);
  });

  it("returns the provider's own refusal where it may not — the permission boundary this kind exists for", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { errors: [{ code: 10000, message: "Authentication error" }], success: false },
          status: 403,
        }),
      maxRetries: 0,
    });
    const result = await readCloudflareRiskScoreSummary({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
    expect(unwrapErr(result).operation).toBe("risk-scoring-summary-get");
  });
});
