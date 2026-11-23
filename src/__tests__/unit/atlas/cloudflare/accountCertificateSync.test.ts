import { describe, expect, it } from "vitest";

import { syncAccountCertificateKind } from "../../../../atlas/cloudflare/accountCertificateSync.js";
import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { cloudflareEntityId, cloudflareGapId } from "../../../../atlas/cloudflare/identity.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../atlas/cloudflare/model.js";
import {
  type CloudflareRawAccountCertificate,
  type CloudflareRawAccountCertificateAssociation,
  normalizeCloudflareAccountCertificateAssociation,
  projectCloudflareAccountCertificate,
} from "../../../../atlas/cloudflare/projection/accountCertificate.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedCursor } from "./requestedPage.js";

const AT = "2026-02-01T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const SCOPE = `account/${ACCOUNT_ID}/account-certificate`;
const BASE = `/client/v4/accounts/${ACCOUNT_ID}/mtls_certificates`;
const INVENTORY_KEY = `${BASE}@-`;

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
const TOKEN_REMEDY =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** What the SDK's own error text says for a 403 carrying `{ message: "denied" }`, as the typed error wraps it. */
const INVENTORY_DENIED =
  "cloudflare account-certificates-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';
const ASSOCIATIONS_DENIED =
  "cloudflare account-certificate-associations-get: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

const CERT_A: CloudflareRawAccountCertificate = {
  ca: false,
  expires_on: "2027-01-01T00:00:00Z",
  id: "cert-a",
  issuer: "O=Example CA",
  name: "edge client",
  serial_number: "1111",
  signature: "ECDSAWithSHA256",
  type: "custom",
  uploaded_on: "2026-01-01T00:00:00Z",
};
const CERT_B: CloudflareRawAccountCertificate = {
  ca: true,
  id: "cert-b",
  name: "gateway root",
  type: "gateway_managed",
};

/** One routed response: a refusal at `status`, or a page of `result`. */
type Route = { readonly status: number } | { readonly result: readonly unknown[] };

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
 * A real client over a routing fetch. Routes are keyed `<path>@<cursor>` (`-` for no cursor); an unrouted
 * request answers 404 naming the key, so a wrongly-shaped request surfaces as a gap rather than a hang. Every
 * request key is recorded. Both endpoints this kind reads are `SinglePage`s, so no response advertises a
 * further page.
 */
function servedClient({ routes }: { routes: Readonly<Record<string, Route>> }) {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const cursor = requestedCursor({ url });
      const key = cursor === null ? `${url.pathname}@-` : `${url.pathname}@${cursor}`;
      requests.push(key);
      const route = routes[key];
      if (route === undefined) {
        return jsonResponse({ body: { errors: [{ message: `unrouted ${key}` }], success: false }, status: 404 });
      }
      if ("status" in route) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: route.status });
      }
      return jsonResponse({ body: { result: route.result, success: true }, status: 200 });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

/** A stored entity, projected by the module's own projection at the earlier timestamp. */
function storedCertificate({
  raw,
  associations,
}: {
  raw: CloudflareRawAccountCertificate;
  associations: readonly CloudflareRawAccountCertificateAssociation[];
}): CloudflareEntity {
  return projectCloudflareAccountCertificate({
    accountId: ACCOUNT_ID,
    associations: associations.map((association) =>
      normalizeCloudflareAccountCertificateAssociation({ raw: association }),
    ),
    at: OLD,
    raw,
  });
}

/** A stored kind file holding the given entities and the kind's earlier synced coverage cell. */
function storedFile({ entities }: { entities: readonly CloudflareEntity[] }): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "account-certificate", updatedAt: OLD }),
    coverage: [
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: false,
        reason: "reconciled earlier",
        scope: SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ],
    entities: [...entities],
  };
}

/** The entity this run is expected to publish, written out field by field rather than projected. */
function expectedEntity({
  providerId,
  detail,
  firstSeenAt = AT,
}: {
  providerId: string;
  detail: Record<string, unknown>;
  /** One already stored keeps the `firstSeenAt` it was first stored with; a new one is first seen now. */
  firstSeenAt?: string;
}) {
  return {
    detail: { kind: "account-certificate", ...detail },
    firstSeenAt,
    id: cloudflareEntityId({ components: { accountId: ACCOUNT_ID, providerId }, kind: "account-certificate" }),
    kind: "account-certificate",
    lastSeenAt: AT,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: AT, operation: "account-certificates-fanout" },
    state: "observed",
  };
}

/** Sort as `reconcileParentFanout` does: by hashed entity id, not by inventory order. */
function byId<T extends { id: string }>({ entities }: { entities: readonly T[] }): readonly T[] {
  return entities.toSorted((left, right) => left.id.localeCompare(right.id));
}

function openPermissionGap({ scope, reason }: { scope: string; reason: string }) {
  return {
    condition: "permission-refused",
    firstDetectedAt: AT,
    id: cloudflareGapId({ condition: "permission-refused", scope }),
    kind: "account-certificate",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
  };
}

describe("syncAccountCertificateKind", () => {
  it("keeps the stored entities, marks coverage unreadable and opens the permission gap when the inventory is refused", async () => {
    const stored = storedFile({
      entities: [
        storedCertificate({ associations: [{ service: "access", status: "active" }], raw: CERT_A }),
        storedCertificate({ associations: [], raw: CERT_B }),
      ],
    });
    const served = servedClient({ routes: { [INVENTORY_KEY]: { status: 403 } } });

    const folded = unwrap(
      await syncAccountCertificateKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(served.requests).toEqual([INVENTORY_KEY]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "account-certificate",
      permissionBlocked: { detail: INVENTORY_DENIED, unblockedBy: TOKEN_REMEDY },
      reasons: [INVENTORY_DENIED],
    });
    expect(folded.file.entities).toEqual(stored.entities);
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason: INVENTORY_DENIED,
        scope: SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: INVENTORY_DENIED, scope: SCOPE })]);
    expect(folded.file.updatedAt).toBe(AT);
  });

  it("embeds each certificate's { service, status } associations, and stores neither the PEM body nor a hostname", async () => {
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: {
          // The wire carries the public PEM body and (on some endpoints) hostnames; neither is stored.
          result: [
            { ...CERT_A, associated_hostnames: ["a.example.com"], certificates: "-----BEGIN CERTIFICATE-----\nAAAA" },
            CERT_B,
          ],
        },
        [`${BASE}/cert-a/associations@-`]: {
          result: [{ service: "access", status: "active" }, { service: "api_gateway" }],
        },
        [`${BASE}/cert-b/associations@-`]: { result: [{ status: "pending_deployment" }] },
      },
    });
    const stored = emptyCloudflareKindFile({ kind: "account-certificate", updatedAt: OLD });

    const folded = unwrap(
      await syncAccountCertificateKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(served.requests.toSorted()).toEqual(
      [INVENTORY_KEY, `${BASE}/cert-a/associations@-`, `${BASE}/cert-b/associations@-`].toSorted(),
    );
    expect(served.requests[0]).toBe(INVENTORY_KEY);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "account-certificate", reasons: [] });
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              associations: [
                { service: "access", status: "active" },
                { service: "api_gateway", status: null },
              ],
              ca: false,
              expiresOn: "2027-01-01T00:00:00Z",
              issuer: "O=Example CA",
              name: "edge client",
              serialNumber: "1111",
              signature: "ECDSAWithSHA256",
              type: "custom",
              uploadedOn: "2026-01-01T00:00:00Z",
            },
            providerId: "cert-a",
          }),
          expectedEntity({
            detail: {
              associations: [{ service: null, status: "pending_deployment" }],
              ca: true,
              expiresOn: null,
              issuer: null,
              name: "gateway root",
              serialNumber: null,
              signature: null,
              type: "gateway_managed",
              uploadedOn: null,
            },
            providerId: "cert-b",
          }),
        ],
      }),
    );
    expect(JSON.stringify(folded.file.entities)).not.toContain("BEGIN CERTIFICATE");
    expect(JSON.stringify(folded.file.entities)).not.toContain("a.example.com");
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 2 certificate(s)",
        scope: SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([]);
  });

  it("costs only the refused certificate its fresh associations: it keeps its stored ones under fresh metadata, the other updates", async () => {
    const renamedB: CloudflareRawAccountCertificate = { ...CERT_B, name: "gateway root v2" };
    const stored = storedFile({
      entities: [
        storedCertificate({ associations: [{ service: "old-service", status: "gone" }], raw: CERT_A }),
        storedCertificate({ associations: [{ service: "access", status: "active" }], raw: CERT_B }),
      ],
    });
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: { result: [CERT_A, renamedB] },
        [`${BASE}/cert-a/associations@-`]: { result: [{ service: "fresh-service", status: "active" }] },
        [`${BASE}/cert-b/associations@-`]: { status: 403 },
      },
    });

    const folded = unwrap(
      await syncAccountCertificateKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    const parentScope = `${SCOPE}/cert-b`;
    const reason = `cert-b: ${ASSOCIATIONS_DENIED}`;
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "account-certificate",
      permissionBlocked: { detail: `${parentScope}: ${ASSOCIATIONS_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              associations: [{ service: "fresh-service", status: "active" }],
              ca: false,
              expiresOn: "2027-01-01T00:00:00Z",
              issuer: "O=Example CA",
              name: "edge client",
              serialNumber: "1111",
              signature: "ECDSAWithSHA256",
              type: "custom",
              uploadedOn: "2026-01-01T00:00:00Z",
            },
            firstSeenAt: OLD,
            providerId: "cert-a",
          }),
          expectedEntity({
            detail: {
              associations: [{ service: "access", status: "active" }],
              ca: true,
              expiresOn: null,
              issuer: null,
              name: "gateway root v2",
              serialNumber: null,
              signature: null,
              type: "gateway_managed",
              uploadedOn: null,
            },
            firstSeenAt: OLD,
            providerId: "cert-b",
          }),
        ],
      }),
    );
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason,
        scope: SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: ASSOCIATIONS_DENIED, scope: parentScope })]);
  });

  it("prunes a stored certificate the successful inventory no longer carries", async () => {
    const stored = storedFile({
      entities: [
        storedCertificate({ associations: [], raw: CERT_A }),
        storedCertificate({ associations: [], raw: CERT_B }),
        storedCertificate({ associations: [{ service: "access", status: "active" }], raw: { id: "cert-gone" } }),
      ],
    });
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: { result: [CERT_A, CERT_B] },
        [`${BASE}/cert-a/associations@-`]: { result: [] },
        [`${BASE}/cert-b/associations@-`]: { result: [] },
      },
    });

    const folded = unwrap(
      await syncAccountCertificateKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(folded.file.entities.map((entity) => entity.providerId).toSorted()).toEqual(["cert-a", "cert-b"]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "account-certificate", reasons: [] });
    expect(served.requests.toSorted()).toEqual(
      [INVENTORY_KEY, `${BASE}/cert-a/associations@-`, `${BASE}/cert-b/associations@-`].toSorted(),
    );
  });
});
