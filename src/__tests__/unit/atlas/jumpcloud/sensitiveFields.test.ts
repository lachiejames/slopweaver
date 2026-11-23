import { describe, expect, it } from "vitest";

import {
  JUMPCLOUD_EPHEMERAL_TOKEN_FIELDS,
  JUMPCLOUD_SECRET_MATERIAL_FIELDS,
  jumpcloudFieldDenial,
} from "../../../../atlas/jumpcloud/sensitiveFields.js";

/** An endpoint with no endpoint-scoped denial of its own, so these tests exercise the name rules alone. */
const ANY_ENDPOINT = "/api/systems";

/**
 * Every field named here is returned by an ADMITTED endpoint — one the owner's "every family in full"
 * ruling requires syncing — so an endpoint allowlist alone would store all of them.
 */
const SECRET_MATERIAL_ON_ADMITTED_ENDPOINTS = [
  { endpoint: "GET /api/applications", field: "idpPrivateKey" },
  { endpoint: "GET /api/application-templates", field: "idpPrivateKey" },
  { endpoint: "GET /api/radiusservers", field: "sharedSecret" },
  { endpoint: "GET /api/v2/service-accounts", field: "apiKey" },
  { endpoint: "GET /api/v2/service-accounts", field: "clientSecret" },
  { endpoint: "GET /api/v2/notifications/channels", field: "authPassword" },
  { endpoint: "GET /api/v2/notifications/channels", field: "authToken" },
  { endpoint: "GET /api/v2/providers/{id}/administrators", field: "apiKeyHash" },
  { endpoint: "GET /api/v2/google-emm/enterprises/{id}/enrollment-tokens", field: "enrollmentLink" },
  { endpoint: "GET /api/v2/google-emm/enterprises/{id}/enrollment-tokens", field: "qrCodeImage" },
];

/**
 * Posture fields that LOOK secret-shaped and must survive the projection.
 *
 * These are the ISO 27001 answer: strip them and the atlas stops answering the endpoint-compliance question
 * it exists for. `passwordMinimumLength` is included deliberately — the sibling Vanta atlas's pattern-based
 * classifier bucketed exactly that shape as a secret, which is why this repository names denials one at a
 * time instead.
 */
const POSTURE_FIELDS_THAT_MUST_SURVIVE = [
  "mfa",
  "mfaEnrollment",
  "mfaFactors",
  "mfaRegistered",
  "totpStatus",
  "totp_enabled",
  "password_expired",
  "password_status",
  "passwordExpirationInDays",
  "passwordCompliance",
  "passwordStrength",
  "passwordsScore",
  "compromisedPasswords",
  "weakPasswords",
  "hasSecureToken",
  "secureTokenEnabled",
  "allowSshPasswordAuthentication",
  "userPasswordExpirationAction",
  "disallowCommonlyUsedPasswords",
  "idpPrivateKeyUpdatedAt",
  "credentialCount",
  "credentialType",
  "viewSecretCount",
  "secretsCount",
  "backupKeyUuid",
  "passwordMinimumLength",
];

describe("jumpcloudFieldDenial", () => {
  it.each(SECRET_MATERIAL_ON_ADMITTED_ENDPOINTS)("denies $field returned by $endpoint", ({ field }) => {
    expect(jumpcloudFieldDenial({ endpoint: ANY_ENDPOINT, field })).toBe("secret-material");
  });

  it.each(POSTURE_FIELDS_THAT_MUST_SURVIVE)("keeps the posture field %s", (field) => {
    expect(jumpcloudFieldDenial({ endpoint: ANY_ENDPOINT, field })).toBe(null);
  });

  it("names an ephemeral pagination handle as housekeeping rather than a disclosure decision", () => {
    expect(jumpcloudFieldDenial({ endpoint: ANY_ENDPOINT, field: "continuationToken" })).toBe("ephemeral-token");
  });

  it("compares exactly, so a casing variant nobody reviewed is not silently denied", () => {
    expect(jumpcloudFieldDenial({ endpoint: ANY_ENDPOINT, field: "APIKEY" })).toBe(null);
  });

  it("keeps a field that is merely unknown", () => {
    expect(jumpcloudFieldDenial({ endpoint: ANY_ENDPOINT, field: "displayName" })).toBe(null);
  });
});

describe("the denied sets", () => {
  it("keeps secret material and ephemeral handles disjoint, so the secret list says what it protects", () => {
    const overlap = JUMPCLOUD_SECRET_MATERIAL_FIELDS.filter((f) => JUMPCLOUD_EPHEMERAL_TOKEN_FIELDS.includes(f));
    expect(overlap).toStrictEqual([]);
  });

  it("names 23 secret-material fields", () => {
    expect(JUMPCLOUD_SECRET_MATERIAL_FIELDS.length).toBe(23);
  });

  it("holds every entry sorted, so a review diff shows an addition in place", () => {
    expect(JUMPCLOUD_SECRET_MATERIAL_FIELDS.toSorted()).toStrictEqual([...JUMPCLOUD_SECRET_MATERIAL_FIELDS]);
  });
});

describe("the endpoint-scoped denial on a Windows service's command line", () => {
  const SERVICES = "/api/v2/systeminsights/services";

  it("withholds `path` under the services endpoint, where it is an ImagePath command line", () => {
    expect(jumpcloudFieldDenial({ endpoint: SERVICES, field: "path" })).toBe("secret-material");
  });

  it("keeps `path` everywhere else, because a device inventory is mostly paths", () => {
    expect(jumpcloudFieldDenial({ endpoint: "/api/v2/systeminsights/apps", field: "path" })).toBe(null);
    expect(jumpcloudFieldDenial({ endpoint: "/api/v2/systeminsights/launchd", field: "path" })).toBe(null);
    expect(jumpcloudFieldDenial({ endpoint: "/api/v2/systeminsights/mounts", field: "path" })).toBe(null);
  });

  it("withholds nothing else under that endpoint", () => {
    expect(jumpcloudFieldDenial({ endpoint: SERVICES, field: "name" })).toBe(null);
    expect(jumpcloudFieldDenial({ endpoint: SERVICES, field: "start_type" })).toBe(null);
  });

  it("matches through a query string, so a paged call is judged the same way", () => {
    expect(jumpcloudFieldDenial({ endpoint: `${SERVICES}?limit=100&skip=200`, field: "path" })).toBe("secret-material");
  });

  it("does not match an endpoint that merely CONTAINS the scoped path", () => {
    expect(jumpcloudFieldDenial({ endpoint: `${SERVICES}/detail`, field: "path" })).toBe(null);
  });

  it("applies every scoped denial when the endpoint is unknown, rather than none", () => {
    // A stored entity whose channel lost its source produces this. Failing open would carry a withheld
    // field forward forever behind a document nobody re-read.
    expect(jumpcloudFieldDenial({ endpoint: undefined, field: "path" })).toBe("secret-material");
  });

  it("still denies a name-listed field under an unknown endpoint", () => {
    expect(jumpcloudFieldDenial({ endpoint: undefined, field: "idpPrivateKey" })).toBe("secret-material");
  });
});

describe("a managed-policy value is withheld only where its sibling name says so", () => {
  const POLICIES = "/api/v2/systeminsights/managed_policies";

  it("withholds the agent's own enrolment secret", () => {
    const record = { domain: "com.jumpcloud.agent.install.bootstrap", name: "ConnectKey", value: "x" };
    expect(jumpcloudFieldDenial({ endpoint: POLICIES, field: "value", record })).toBe("secret-material");
  });

  it("keeps every other policy value, any whose sibling name is not a secret's", () => {
    const record = { domain: "com.apple.screensaver", name: "idleTime", value: "300" };
    expect(jumpcloudFieldDenial({ endpoint: POLICIES, field: "value", record })).toBe(null);
  });

  it("keeps the sibling `name` itself, which is the posture half", () => {
    const record = { name: "ConnectKey", value: "x" };
    expect(jumpcloudFieldDenial({ endpoint: POLICIES, field: "name", record })).toBe(null);
  });

  it("does NOT withhold when the sibling is missing, so the gate refuses and a human looks", () => {
    expect(jumpcloudFieldDenial({ endpoint: POLICIES, field: "value", record: { value: "x" } })).toBe(null);
  });

  it("does not withhold a `value` returned by any other endpoint", () => {
    const record = { name: "ConnectKey", value: "x" };
    expect(jumpcloudFieldDenial({ endpoint: "/api/v2/policytemplates", field: "value", record })).toBe(null);
  });

  it("still withholds a services path with no sibling clause to satisfy", () => {
    const record = { name: "acme-worker", path: "C:\\x.exe" };
    expect(jumpcloudFieldDenial({ endpoint: "/api/v2/systeminsights/services", field: "path", record })).toBe(
      "secret-material",
    );
  });
});
