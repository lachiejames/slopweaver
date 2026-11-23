/**
 * How `parseChronicleServiceConfig` refuses an authentication rule it would misread: a selector pattern with a
 * misplaced `*`, or two scopes run together without the comma between them.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses an authentication pattern with a * anywhere but alone or as the last component", () => {
    // `v1.*.*` ends in .* too, so only a pattern allowing ONE trailing .* refuses it.
    const patterns = ["google.cloud.chronicle.v1.*.GetRule", "google.cloud.chronicle.v1.*.*"];
    const errors = patterns.map((pattern) => {
      const selector = `google.cloud.chronicle.v1.RuleService.ListRules, ${pattern}`;
      const text = CONFIG.replace("'google.cloud.chronicle.v1.RuleService.*'", `'${selector}'`);
      return unwrapErr(parseChronicleServiceConfig({ text }));
    });
    expect(errors).toStrictEqual(
      patterns.map((pattern) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `authentication rule selector google.cloud.chronicle.v1.RuleService.ListRules, ${pattern} holds the pattern '${pattern}', which is not *, a name, or a name ending .*`,
        }),
      ),
    );
  });

  it("refuses two scopes written one per line without the comma, rather than one scope holding a newline", () => {
    const text = CONFIG.replace(
      "https://www.googleapis.com/auth/chronicle,",
      "https://www.googleapis.com/auth/chronicle",
    );
    expect(text).not.toContain("auth/chronicle,");
    expect(unwrapErr(parseChronicleServiceConfig({ text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: `authentication rule google.cloud.chronicle.v1.RuleService.* grants "https://www.googleapis.com/auth/chronicle\\nhttps://www.googleapis.com/auth/cloud-platform", which holds whitespace — a missing comma between two scopes`,
      }),
    );
  });

  it("refuses two scopes written on one line with a space and no comma", () => {
    const text = CONFIG.replace(
      "https://www.googleapis.com/auth/chronicle,",
      "https://www.googleapis.com/auth/chronicle https://www.googleapis.com/auth/chronicle.readonly,",
    );
    expect(text).toContain("auth/chronicle https://");
    expect(unwrapErr(parseChronicleServiceConfig({ text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: `authentication rule google.cloud.chronicle.v1.RuleService.* grants "https://www.googleapis.com/auth/chronicle https://www.googleapis.com/auth/chronicle.readonly", which holds whitespace — a missing comma between two scopes`,
      }),
    );
  });
});
