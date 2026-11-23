/**
 * How `parseChronicleServiceConfig` holds the config to its schema: a key it does not name is refused rather
 * than stripped, and an absent or empty apis list is refused.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("refuses an http rule key it does not name rather than stripping it", () => {
    const text = CONFIG.replace(
      "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'",
      "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'\n    additionalBindings:\n    - post: '/v1/x'",
    );
    const error = unwrapErr(parseChronicleServiceConfig({ text }));
    expect(error.code).toBe("SERVICE_CONFIG_UNPARSEABLE");
    expect(error.message).toContain("http.rules.0: Unrecognized key");
    expect(error.message).toContain("additionalBindings");
  });

  it("refuses mixins or methods under an apis entry rather than stripping them", () => {
    const text = CONFIG.replace(
      "- name: google.longrunning.Operations\n",
      "- name: google.longrunning.Operations\n  mixins:\n  - name: google.iam.v1.IAMPolicy\n",
    );
    expect(text).toContain("mixins:");
    const error = unwrapErr(parseChronicleServiceConfig({ text }));
    expect(error.code).toBe("SERVICE_CONFIG_UNPARSEABLE");
    expect(error.message).toContain("apis.1: Unrecognized key");
    expect(error.message).toContain("mixins");
  });

  it("refuses a config with no apis list as SERVICE_CONFIG_UNPARSEABLE", () => {
    const text = CONFIG.replace(/apis:\n(- name: .*\n)+/u, "");
    const error = unwrapErr(parseChronicleServiceConfig({ text }));
    expect(error.code).toBe("SERVICE_CONFIG_UNPARSEABLE");
    expect(error.message).toContain("apis");
  });

  it("refuses an authentication rule or its oauth carrying a key it does not name, rather than stripping it", () => {
    const texts = [
      CONFIG.replace("    oauth:\n", "    requirements:\n    - provider_id: x\n    oauth:\n"),
      CONFIG.replace("      canonical_scopes:", "      audiences: x\n      canonical_scopes:"),
    ];
    const messages = texts.map((text) => unwrapErr(parseChronicleServiceConfig({ text })).message);
    expect(messages).toStrictEqual([
      'chronicle_v1.yaml could not be read: authentication.rules.0: Unrecognized key: "requirements"',
      'chronicle_v1.yaml could not be read: authentication.rules.0.oauth: Unrecognized key: "audiences"',
    ]);
  });

  it("refuses an empty apis list, which would publish no service at all", () => {
    const text = CONFIG.replace(/apis:\n(- name: .*\n)+/u, "apis: []\n");
    expect(text).toContain("apis: []");
    expect(unwrapErr(parseChronicleServiceConfig({ text })).message).toBe(
      "chronicle_v1.yaml could not be read: apis: Too small: expected array to have >=1 items",
    );
  });

  it("refuses a key beside rules under http or authentication rather than stripping it", () => {
    const texts = [
      CONFIG.replace("http:\n  rules:\n", "http:\n  fully_decode_reserved_expansion: true\n  rules:\n"),
      CONFIG.replace("authentication:\n  rules:\n", "authentication:\n  providers: x\n  rules:\n"),
    ];
    const messages = texts.map((text) => unwrapErr(parseChronicleServiceConfig({ text })).message);
    expect(messages).toStrictEqual([
      'chronicle_v1.yaml could not be read: http: Unrecognized key: "fully_decode_reserved_expansion"',
      'chronicle_v1.yaml could not be read: authentication: Unrecognized key: "providers"',
    ]);
  });
});
