import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareAccountCertificateAssociations,
  readCloudflareAccountCertificateInventory,
} from "../../../../../atlas/cloudflare/readers/accountCertificate.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflareAccountCertificateInventory", () => {
  it("reads every certificate's metadata", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ id: "cert-1" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const certificates = unwrap(await readCloudflareAccountCertificateInventory({ accountId: ACCOUNT_ID, client }));
    expect(certificates.map((certificate) => certificate.id)).toEqual(["cert-1"]);
  });

  it("skips a certificate whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ name: "My Cert" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareAccountCertificateInventory({ accountId: ACCOUNT_ID, client }))).toEqual([]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccountCertificateInventory({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareAccountCertificateAssociations", () => {
  it("reads every association for one certificate", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { result: [{ service: "access", status: "active" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const associations = unwrap(
      await readCloudflareAccountCertificateAssociations({ accountId: ACCOUNT_ID, certificateId: "cert-1", client }),
    );
    expect(associations).toEqual([{ service: "access", status: "active" }]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccountCertificateAssociations({
      accountId: ACCOUNT_ID,
      certificateId: "cert-1",
      client,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
