/**
 * What `parseChronicleServiceConfig` reads from a well-formed config: the published services, the http bindings
 * with each verb, the authentication selectors, and every line form the pinned file uses.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleServiceConfig } from "../../../../../atlas/googleSecops/serviceConfig.js";
import { unwrap } from "../../../../../lib/result.js";
import { CONFIG } from "./harness.js";

describe("parseChronicleServiceConfig", () => {
  it("reads the published services, the config's own bindings and the auth rules", () => {
    const config = unwrap(parseChronicleServiceConfig({ text: CONFIG }));
    expect(config.name).toBe("chronicle.googleapis.com");
    expect(config.apis).toStrictEqual(["google.cloud.chronicle.v1.RuleService", "google.longrunning.Operations"]);
    expect(config.httpRules).toStrictEqual([
      {
        document: "chronicle_v1.yaml",
        httpMethod: "GET",
        id: "google.longrunning.Operations.GetOperation",
        pathTemplate: "/v1/{name=projects/*/locations/*/instances/*/operations/*}",
        rpc: "GetOperation",
        service: "google.longrunning.Operations",
      },
      {
        document: "chronicle_v1.yaml",
        httpMethod: "POST",
        id: "google.longrunning.Operations.CancelOperation",
        pathTemplate: "/v1/{name=projects/*/locations/*/instances/*/operations/*}:cancel",
        rpc: "CancelOperation",
        service: "google.longrunning.Operations",
      },
    ]);
    expect(config.authRules).toStrictEqual([
      {
        scopes: ["https://www.googleapis.com/auth/chronicle", "https://www.googleapis.com/auth/cloud-platform"],
        selector: "google.cloud.chronicle.v1.RuleService.*",
      },
    ]);
  });

  it("reads each of the five verb keys of an http rule as its own method", () => {
    const verbs = ["delete", "get", "patch", "post", "put"].map((key) => {
      const text = CONFIG.replace(
        "    get: '/v1/{name=projects/*/locations/*/instances/*/operations/*}'",
        `    ${key}: '/v1/x'`,
      );
      return unwrap(parseChronicleServiceConfig({ text })).httpRules[0]!.httpMethod;
    });
    expect(verbs).toStrictEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("reads an authentication selector that is a bare *, and a list with a space after its comma", () => {
    const selectors = ["*", "google.cloud.chronicle.v1.RuleService.*, google.longrunning.Operations.*"].map(
      (selector) => {
        const text = CONFIG.replace("'google.cloud.chronicle.v1.RuleService.*'", `'${selector}'`);
        return unwrap(parseChronicleServiceConfig({ text })).authRules[0]!.selector;
      },
    );
    expect(selectors).toStrictEqual(["*", "google.cloud.chronicle.v1.RuleService.*, google.longrunning.Operations.*"]);
  });

  it("reads every line form the pinned file uses exactly as it reads the config without them", () => {
    // Each line the pinned file writes outside the three decoded keys, plus |- blocks indented one column past
    // their key (one under a dash) and holding a blank line — the edges of what the line grammar lets through.
    const name = "- name: google.cloud.chronicle.v1.RuleService";
    const dashed = CONFIG.replace(name, "- name: |-\n   google.cloud.chronicle.v1.RuleService");
    const extra = [
      "  new_issue_uri: https://issuetracker.google.com/issues/new?component=1387895",
      "  github_label: 'api: chronicle'",
      "  library_settings:",
      "  - version: google.cloud.chronicle.v1",
      "    java_settings:",
      "      common:",
      "        destinations:",
      "        - PACKAGE_MANAGER",
      "documentation:",
      "  summary: |-",
      "   The Google Cloud Security Operations API",
      "",
      "   their lifecycle.",
      "",
    ].join("\n");
    expect(dashed).not.toBe(CONFIG);
    expect(unwrap(parseChronicleServiceConfig({ text: `${dashed}${extra}` }))).toStrictEqual(
      unwrap(parseChronicleServiceConfig({ text: CONFIG })),
    );
  });
});
