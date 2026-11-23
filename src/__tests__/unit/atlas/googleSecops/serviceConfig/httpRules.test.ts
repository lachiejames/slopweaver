/**
 * How `parseChronicleServiceConfig` refuses an http rule it cannot place as exactly one binding: two verbs, an
 * empty verb, an extra binding, a selector that is not one fully qualified rpc, or one selector bound twice.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses an http rule naming two verbs as HTTP_BINDING_AMBIGUOUS", () => {
    const text = CONFIG.replace("    body: '*'", "    get: '/v1/x'");
    const error = unwrapErr(parseChronicleServiceConfig({ text }));
    expect(error.code).toBe("HTTP_BINDING_AMBIGUOUS");
    expect(error.message).toContain("google.longrunning.Operations.CancelOperation");
  });

  it("refuses an http rule with an empty verb beside a real one, never reading the empty one as absent", () => {
    const text = CONFIG.replace("    body: '*'", "    get: |-\n      \n    body: '*'");
    expect(unwrapErr(parseChronicleServiceConfig({ text })).message).toBe(
      "chronicle_v1.yaml: google.longrunning.Operations.CancelOperation does not carry exactly one placeable HTTP binding — the rule names 2 verbs",
    );
  });

  it("refuses an http rule binding custom or additional_bindings beside its verb, never dropping the extra", () => {
    const extras = ["additional_bindings:\n    - delete: '/v1/x'", "custom:\n      kind: HEAD\n      path: '/v1/x'"];
    const errors = extras.map((extra) =>
      unwrapErr(
        parseChronicleServiceConfig({
          text: CONFIG.replace("    body: '*'", `    body: '*'\n    ${extra}`),
        }),
      ),
    );
    const expected = GoogleSecopsInventoryErrors.httpBindingAmbiguous({
      detail: "declares custom or additional_bindings",
      document: "chronicle_v1.yaml",
      method: "google.longrunning.Operations.CancelOperation",
    });
    expect(errors).toStrictEqual([expected, expected]);
  });

  it("refuses an http rule selecting a list, a wildcard or a name too short to hold a package", () => {
    const selectors = [
      "google.cloud.chronicle.v1.RuleService.DeleteRule, google.cloud.chronicle.v1.RuleService.ListRules",
      "google.cloud.chronicle.v1.RuleService.*",
      "google.cloud.chronicle.v1.*",
      "Operations.CancelOperation",
    ];
    const errors = selectors.map((selector) =>
      unwrapErr(
        parseChronicleServiceConfig({
          text: CONFIG.replace("selector: google.longrunning.Operations.CancelOperation", `selector: '${selector}'`),
        }),
      ),
    );
    expect(errors).toStrictEqual(
      selectors.map((selector) =>
        GoogleSecopsInventoryErrors.serviceConfigUnparseable({
          detail: `http rule selector ${selector} is not one fully qualified <package>.<Service>.<Rpc>`,
        }),
      ),
    );
  });

  it("refuses two http rules for one selector, because the later one silently wins", () => {
    const text = CONFIG.replace(
      "  - selector: google.longrunning.Operations.CancelOperation",
      "  - selector: google.longrunning.Operations.GetOperation\n    delete: '/v1/x'\n  - selector: google.longrunning.Operations.CancelOperation",
    );
    expect(unwrapErr(parseChronicleServiceConfig({ text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.serviceConfigUnparseable({
        detail: "http.rules binds google.longrunning.Operations.GetOperation twice",
      }),
    );
  });
});
