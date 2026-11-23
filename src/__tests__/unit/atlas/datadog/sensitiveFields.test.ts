import { describe, expect, it } from "vitest";

import {
  DATADOG_MANIFEST_SCAN_KIND,
  type DatadogDenialScope,
  datadogFieldDenial,
  isDatadogDenialScope,
} from "../../../../atlas/datadog/fieldDenial.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";
import { DATADOG_FIELD_DENIALS } from "../../../../atlas/datadog/sensitiveFields.js";

describe("datadogFieldDenial", () => {
  it("has at least one entry in DATADOG_FIELD_DENIALS, so the guards below are not vacuously green", () => {
    expect(DATADOG_FIELD_DENIALS.length).toBeGreaterThan(0);
  });

  // The measurement this whole table rests on: `key` carries credential material on six SDK models and is
  // an ordinary identifier on forty-three others. A bare-name denial is wrong in both directions.
  it("denies key in a key kind and admits it in a case, which a bare-name list cannot do", () => {
    expect(datadogFieldDenial({ field: "key", kind: "api_key" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "key", kind: "application_keys" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "key", kind: "cases" })).toBe(null);
    expect(datadogFieldDenial({ field: "key", kind: "feature-flags" })).toBe(null);
  });

  // The sharpest case: the same name is a credential that grants anonymous dashboard access under one kind
  // and a pagination cursor under another.
  it("reads token as a share credential under dashboard and as a cursor under security", () => {
    expect(datadogFieldDenial({ field: "token", kind: "dashboard" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "token", kind: "security" })).toBe("ephemeral-token");
  });

  it("denies hash only where it is the application key value", () => {
    expect(datadogFieldDenial({ field: "hash", kind: "application_key" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "hash", kind: "rum" })).toBe(null);
    expect(datadogFieldDenial({ field: "hash", kind: "security_monitoring" })).toBe(null);
  });

  it("denies the always-secret names in every kind, because none of them is ever posture", () => {
    for (const field of ["clientSecret", "privateKey", "secretAccessKey", "apiKey", "credentials", "webhookSecret"]) {
      expect(datadogFieldDenial({ field, kind: "integrations" })).toBe("secret-material");
      expect(datadogFieldDenial({ field, kind: "monitor" })).toBe("secret-material");
    }
  });

  // Denying these would repeat the JumpCloud false-positive failure: posture is what an ISO question asks
  // for, and a pattern that removes it makes the atlas stop answering its own question.
  it("keeps posture that a keyword pattern would have destroyed", () => {
    for (const field of ["tagKey", "aggregationKey", "keywords", "maxTokens", "certificateLifetimePercent", "author"]) {
      expect(datadogFieldDenial({ field, kind: "monitor" })).toBe(null);
    }
  });

  // Deliberate divergence from the sibling atlas, stated in sensitiveFields.ts: `last4` is what Datadog's
  // own console renders, and it is the only handle left once the value is gone.
  it("keeps last4 and publicPortion, which are the vendor's own non-secret halves", () => {
    expect(datadogFieldDenial({ field: "last4", kind: "api_keys" })).toBe(null);
    expect(datadogFieldDenial({ field: "publicPortion", kind: "personal_access_tokens" })).toBe(null);
  });

  it("drops ephemeral paging handles everywhere, which is housekeeping rather than disclosure", () => {
    expect(datadogFieldDenial({ field: "nextPageToken", kind: "monitor" })).toBe("ephemeral-token");
    expect(datadogFieldDenial({ field: "continuationToken", kind: "logs" })).toBe("ephemeral-token");
  });

  // The R2 counterexample, kept as a test rather than as a resolution: an AWS SigV4 secret on a synthetics
  // test. The value has no recognisable shape, so the pre-publish gate cannot see it and this table is the
  // only layer that can — which is why the SCAN behind the table was fixed, not just this row added.
  it("denies every half of a SigV4 credential a synthetics test signs with", () => {
    for (const field of ["accessKey", "secretKey", "sessionToken"]) {
      expect(datadogFieldDenial({ field, kind: "synthetics" })).toBe("secret-material");
    }
  });

  it("denies the inbound tokens an observability pipeline source ACCEPTS, despite the innocuous name", () => {
    expect(datadogFieldDenial({ field: "validTokens", kind: "obs-pipelines" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "tokens", kind: "integrations" })).toBe("secret-material");
  });

  // The sharpest KEEP: Datadog's own docstring says these hold the NAME of the environment variable or
  // secret that contains the credential, so storing one answers "which secret does this pipeline read".
  it("keeps an observability pipeline's secret REFERENCES, which are not values", () => {
    for (const field of ["passwordKey", "clientSecretKey", "tokenKey", "usernameKey", "storeHecToken"]) {
      expect(datadogFieldDenial({ field, kind: "obs-pipelines" })).toBe(null);
    }
  });

  // The second R2 counterexample, and the class it generalises: a webhook's `customHeaders` reached a kind
  // file carrying `{"Authorization":"Basic dXNlcjpwYXNz"}`. Nothing in the NAME says credential — the field
  // is a free-form blob a person fills in, and that is what makes it one.
  it("denies the free-form fields a person types a credential into", () => {
    expect(datadogFieldDenial({ field: "customHeaders", kind: "integration" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "headers", kind: "synthetics" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "payload", kind: "integration" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "value", kind: "synthetics" })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "body", kind: "synthetics" })).toBe("secret-material");
  });

  // Three review rounds found three credential-bearing fields on ONE model, which is what whack-a-mole
  // looks like from the inside. A synthetic test IS a request a person configured including its auth, so
  // the whole free-form surface of its config goes as a set rather than one round at a time.
  it("denies the WHOLE credential-capable free-form surface of the synthetics kind", () => {
    const denied = [
      "body",
      "bodyCompressed",
      "cacheHeaders",
      "compressedMessage",
      "compressedSteps",
      "cookies",
      "emailMessages",
      "extractedValuesFromScript",
      "form",
      "header",
      "headers",
      "initialApplicationArguments",
      "message",
      "metadata",
      "params",
      "query",
      "receivedMessage",
      "requestHeaders",
      "responseBody",
      "responseHeaders",
      "sentMessage",
      "setCookie",
      "toolArgs",
      "username",
      "value",
      "variables",
      "variablesFromScript",
    ];
    const admitted = denied.filter((field) => datadogFieldDenial({ field, kind: "synthetics" }) === null);

    expect(admitted).toStrictEqual([]);
  });

  it("keeps the posture that makes a synthetic test legible", () => {
    for (const field of ["url", "method", "service", "host", "timeout", "certificateDomains", "followRedirects"]) {
      expect(datadogFieldDenial({ field, kind: "synthetics" })).toBe(null);
    }
  });

  it("denies those names in the synthetics kind ONLY, so a monitor query and message survive", () => {
    expect(datadogFieldDenial({ field: "query", kind: "monitor" })).toBe(null);
    expect(datadogFieldDenial({ field: "message", kind: "monitor" })).toBe(null);
    expect(datadogFieldDenial({ field: "form", kind: "forms" })).toBe(null);
  });

  // The stated residue: these are free-form too and are KEPT, because they are the posture an investigation
  // asks for. A credential pasted into a monitor message reaches a kind file and nothing catches it.
  it("keeps a monitor message and an incident content, and states that cost rather than hiding it", () => {
    expect(datadogFieldDenial({ field: "message", kind: "monitor" })).toBe(null);
    expect(datadogFieldDenial({ field: "content", kind: "incidents" })).toBe(null);
  });

  it("keeps those same names where nobody types a credential into them", () => {
    expect(datadogFieldDenial({ field: "payload", kind: "security_monitoring" })).toBe(null);
    expect(datadogFieldDenial({ field: "value", kind: "monitor" })).toBe(null);
    expect(datadogFieldDenial({ field: "externalId", kind: "security" })).toBe(null);
  });

  it("denies the AWS assume-role external id, which is the confused-deputy defence", () => {
    expect(datadogFieldDenial({ field: "externalId", kind: "integration" })).toBe("secret-material");
  });

  it("answers null for a name nobody has decided about, leaving it to the pre-publish gate", () => {
    expect(datadogFieldDenial({ field: "somethingDatadogAddedNextMonth", kind: "monitor" })).toBe(null);
  });

  it("gives every denial a reason a reviewer can check against the scan", () => {
    expect(DATADOG_FIELD_DENIALS.filter((denial) => denial.detail.length < 10)).toStrictEqual([]);
  });

  it("never scopes a denial to a kind with an empty list, which would deny nothing while looking strict", () => {
    expect(DATADOG_FIELD_DENIALS.filter((denial) => denial.kinds?.length === 0)).toStrictEqual([]);
  });

  it("applies only the unscoped rows to the manifest scope, never a row scoped to a real kind", () => {
    expect(datadogFieldDenial({ field: "clientSecret", kind: DATADOG_MANIFEST_SCAN_KIND })).toBe("secret-material");
    expect(datadogFieldDenial({ field: "key", kind: DATADOG_MANIFEST_SCAN_KIND })).toBe(null);
  });
});

describe("isDatadogDenialScope", () => {
  it("admits every published kind and the manifest scan kind", () => {
    expect(DATADOG_KINDS.length).toBeGreaterThan(0);
    expect(DATADOG_KINDS.filter((kind) => !isDatadogDenialScope(kind))).toStrictEqual([]);
    expect(isDatadogDenialScope(DATADOG_MANIFEST_SCAN_KIND)).toBe(true);
  });

  // The defect this narrows: a typo'd kind matched no scoped row, so `key` in an api_keys document was admitted.
  it("refuses a misspelled kind, at compile time for a literal and at run time for a decoded string", () => {
    // @ts-expect-error -- "api_keyz" is not a DatadogKind, so a literal scope cannot be misspelled
    const misspelled: DatadogDenialScope = "api_keyz";
    expect(isDatadogDenialScope(misspelled)).toBe(false);
    expect(isDatadogDenialScope("constructor")).toBe(false);
    expect(isDatadogDenialScope("")).toBe(false);
  });

  it("keeps the manifest scan kind out of the published kinds, so no scoped row can apply to it", () => {
    expect((DATADOG_KINDS as readonly string[]).includes(DATADOG_MANIFEST_SCAN_KIND)).toBe(false);
  });

  it("scopes every denial row only to published kinds, so a misspelled scope cannot deny in no kind at all", () => {
    const scoped = DATADOG_FIELD_DENIALS.flatMap((denial) => {
      if (denial.kinds === null) {
        // An unscoped row denies in every kind, so it carries no scope to check.
        return [];
      }
      return denial.kinds;
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.filter((kind) => !isDatadogDenialScope(kind) || kind === DATADOG_MANIFEST_SCAN_KIND)).toEqual([]);
  });
});
