/*
 * The shape-denial run of the Datadog field table: which rows it holds, in which order, and that the composed
 * table carries it whole at the position `datadogFieldDenial`'s first-match `.find` reads it from.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_FREE_FORM_FIELD_DENIALS } from "../../../../atlas/datadog/freeFormFieldDenials.js";
import { DATADOG_FIELD_DENIALS } from "../../../../atlas/datadog/sensitiveFields.js";

const RUN_FIELDS: readonly string[] = [
  "customHeaders",
  "body",
  "form",
  "metadata",
  "toolArgs",
  "setCookie",
  "cookies",
  "requestHeaders",
  "responseHeaders",
  "cacheHeaders",
  "header",
  "responseBody",
  "bodyCompressed",
  "compressedMessage",
  "compressedSteps",
  "variables",
  "variablesFromScript",
  "extractedValuesFromScript",
  "params",
  "samples",
  "description",
  "pattern",
  "sentMessage",
  "receivedMessage",
  "emailMessages",
  "initialApplicationArguments",
  "username",
  "query",
  "message",
  "headers",
  "externalId",
  "payload",
  "value",
];

describe("DATADOG_FREE_FORM_FIELD_DENIALS", () => {
  it("holds the shape-denial run in table order", () => {
    expect(DATADOG_FREE_FORM_FIELD_DENIALS.map((denial) => denial.field)).toStrictEqual(RUN_FIELDS);
  });

  it("is spread into the composed table whole, between credentialsFile and hash", () => {
    const start = DATADOG_FIELD_DENIALS.indexOf(DATADOG_FREE_FORM_FIELD_DENIALS[0]!);
    const end = start + DATADOG_FREE_FORM_FIELD_DENIALS.length;

    expect(DATADOG_FIELD_DENIALS.length).toBe(72);
    expect(start).toBe(19);
    expect(DATADOG_FIELD_DENIALS.slice(start, end)).toStrictEqual(DATADOG_FREE_FORM_FIELD_DENIALS);
    expect(DATADOG_FIELD_DENIALS[end - 1]).toBe(DATADOG_FREE_FORM_FIELD_DENIALS[32]);
    expect(DATADOG_FIELD_DENIALS[start - 1]!.field).toBe("credentialsFile");
    expect(DATADOG_FIELD_DENIALS[end]!.field).toBe("hash");
  });

  it("scopes externalId to the integration kinds and leaves headers unscoped", () => {
    const externalId = DATADOG_FREE_FORM_FIELD_DENIALS.find((denial) => denial.field === "externalId")!;
    const headers = DATADOG_FREE_FORM_FIELD_DENIALS.find((denial) => denial.field === "headers")!;

    expect(externalId.kinds).toStrictEqual(["integration", "integrations"]);
    expect(headers.kinds).toBe(null);
  });
});
