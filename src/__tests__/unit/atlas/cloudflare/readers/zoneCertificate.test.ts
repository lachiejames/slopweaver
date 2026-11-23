import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { CloudflareClientErrors } from "../../../../../atlas/cloudflare/errors.js";
import {
  readCloudflareAopHostnameCertificates,
  readCloudflareAopSetting,
  readCloudflareAopZoneCertificates,
  readCloudflareCertificatePacks,
  readCloudflareClientCertificates,
  readCloudflareCustomCertificates,
  readCloudflareCustomHostnames,
  readCloudflareKeylessCertificates,
  readCloudflareOriginCaCertificates,
} from "../../../../../atlas/cloudflare/readers/zoneCertificate.js";
import {
  readCloudflareUniversalSslSetting,
  readCloudflareUniversalSslVerification,
} from "../../../../../atlas/cloudflare/readers/zoneCertificateUniversal.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function listPage({ page, items }: { page: number; items: readonly unknown[] }) {
  const result = page === 1 ? items : [];
  return { result, result_info: { count: result.length, page }, success: true };
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

function pagedClient({ items }: { items: readonly unknown[] }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const page = requestedPage({ url: requestUrl({ input }) });
      return jsonResponse({ body: listPage({ items, page }), status: 200 });
    },
    maxRetries: 0,
  });
}

function errorClient({ status }: { status: number }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status }),
    maxRetries: 0,
  });
}

describe("readCloudflareCertificatePacks", () => {
  it("reads every pack", async () => {
    const client = pagedClient({ items: [{ id: "pack-1" }] });
    const entities = unwrap(
      await readCloudflareCertificatePacks({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["certificate-pack:pack-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareCertificatePacks({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 401 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareUniversalSslSetting", () => {
  it("reads the singleton", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: { enabled: true }, success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareUniversalSslSetting({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["universal-ssl-setting"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareUniversalSslSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 403 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

function verificationClient({ entries }: { entries: readonly unknown[] }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async () => jsonResponse({ body: { result: entries, success: true }, status: 200 }),
    maxRetries: 0,
  });
}

describe("readCloudflareUniversalSslVerification", () => {
  it("reads every entry from the plain array response", async () => {
    const client = verificationClient({ entries: [{ cert_pack_uuid: "uuid-1", certificate_status: "active" }] });
    const entities = unwrap(
      await readCloudflareUniversalSslVerification({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["universal-ssl-verification:uuid-1"]);
  });

  it("readCloudflareUniversalSslVerification refuses an entry without cert_pack_uuid instead of using its position", async () => {
    const client = verificationClient({
      entries: [{ cert_pack_uuid: "uuid-1", certificate_status: "active" }, { certificate_status: "active" }],
    });
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause:
          "a Universal SSL verification entry had no cert_pack_uuid in the response, and it is the entry's provider id",
        operation: "zone-certificate-universal-ssl-verification-get",
      }),
    );
    expect(unwrapErr(result).message).toBe(
      "cloudflare zone-certificate-universal-ssl-verification-get: response failed local schema validation: a Universal SSL verification entry had no cert_pack_uuid in the response, and it is the entry's provider id",
    );
  });

  it("readCloudflareUniversalSslVerification refuses a malformed cert_pack_uuid", async () => {
    const client = verificationClient({ entries: [{ cert_pack_uuid: "", certificate_status: "active" }] });
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry's cert_pack_uuid was not a non-empty string in the response",
        operation: "zone-certificate-universal-ssl-verification-get",
      }),
    );
    expect(unwrapErr(result).kind).toBe("schema");
  });

  it("refuses a cert_pack_uuid of the wrong runtime type as malformed", async () => {
    const client = verificationClient({ entries: [{ cert_pack_uuid: 7, certificate_status: "active" }] });
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).message).toContain("cert_pack_uuid was not a non-empty string");
  });

  it("readCloudflareUniversalSslVerification refuses an entry without the SDK-required certificate_status", async () => {
    const client = verificationClient({ entries: [{ cert_pack_uuid: "uuid-1" }] });
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry had no certificate_status in the response, which the SDK requires",
        operation: "zone-certificate-universal-ssl-verification-get",
      }),
    );
    expect(unwrapErr(result).message).toBe(
      "cloudflare zone-certificate-universal-ssl-verification-get: response failed local schema validation: a Universal SSL verification entry had no certificate_status in the response, which the SDK requires",
    );
  });

  it("readCloudflareUniversalSslVerification refuses a malformed certificate_status", async () => {
    const client = verificationClient({ entries: [{ cert_pack_uuid: "uuid-1", certificate_status: 3 }] });
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result)).toEqual(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry's certificate_status was not a string in the response",
        operation: "zone-certificate-universal-ssl-verification-get",
      }),
    );
    expect(unwrapErr(result).kind).toBe("schema");
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 429 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("rate-limit");
  });
});

describe("readCloudflareCustomCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "cert-1" }] });
    const entities = unwrap(
      await readCloudflareCustomCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["custom-certificate:cert-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareCustomCertificates({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 404 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});

describe("readCloudflareClientCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "cc-1" }] });
    const entities = unwrap(
      await readCloudflareClientCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["client-certificate:cc-1"]);
  });
});

describe("readCloudflareKeylessCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "kl-1" }] });
    const entities = unwrap(
      await readCloudflareKeylessCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["keyless-certificate:kl-1"]);
  });
});

describe("readCloudflareOriginCaCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "ca-1" }] });
    const entities = unwrap(
      await readCloudflareOriginCaCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["origin-ca-certificate:ca-1"]);
  });
});

describe("readCloudflareAopSetting", () => {
  it("reads the singleton", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: { enabled: false }, success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAopSetting({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["aop-setting"]);
  });
});

describe("readCloudflareAopZoneCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "aop-1" }] });
    const entities = unwrap(
      await readCloudflareAopZoneCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["aop-zone-certificate:aop-1"]);
  });

  it("maps a 410-gone response to the typed provider error", async () => {
    const result = await readCloudflareAopZoneCertificates({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 410 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("provider");
  });
});

describe("readCloudflareAopHostnameCertificates", () => {
  it("reads every certificate", async () => {
    const client = pagedClient({ items: [{ id: "aophc-1" }] });
    const entities = unwrap(
      await readCloudflareAopHostnameCertificates({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["aop-hostname-certificate:aophc-1"]);
  });
});

describe("readCloudflareCustomHostnames", () => {
  it("reads every hostname", async () => {
    const client = pagedClient({ items: [{ hostname: "shop.customer.test", id: "ch-1" }] });
    const entities = unwrap(
      await readCloudflareCustomHostnames({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["custom-hostname:ch-1"]);
  });

  it("skips a hostname whose response omits an id", async () => {
    const client = pagedClient({ items: [{ hostname: "shop.customer.test" }] });
    expect(
      unwrap(await readCloudflareCustomHostnames({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID })),
    ).toEqual([]);
  });
});
