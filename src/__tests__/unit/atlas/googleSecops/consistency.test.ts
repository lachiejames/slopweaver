/**
 * The consistency checks on their own: one surface passes, and each way the config and the protos can
 * disagree is refused by name.
 */
import { describe, expect, it } from "vitest";

import { checkGoogleSecopsConsistency } from "../../../../atlas/googleSecops/consistency.js";
import { GoogleSecopsInventoryErrors } from "../../../../atlas/googleSecops/errors.js";
import type { ProtoRpc } from "../../../../atlas/googleSecops/protoParse.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const RULES = "google.cloud.chronicle.v1.RuleService";
const OPERATIONS = "google.longrunning.Operations";

/**
 * One method, bound to GET on a fixed path.
 *
 * @param service the fully qualified service
 * @param rpc the method's simple name
 * @param document the file it is declared in
 * @returns the method
 */
function rpcOf({ service, rpc, document }: { service: string; rpc: string; document: string }): ProtoRpc {
  return { document, httpMethod: "GET", id: `${service}.${rpc}`, pathTemplate: "/v1/x", rpc, service };
}

const GET_RULE = rpcOf({ document: "rule.proto", rpc: "GetRule", service: RULES });
const GET_OPERATION = rpcOf({ document: "chronicle_v1.yaml", rpc: "GetOperation", service: OPERATIONS });
const EVERY_RULE = [{ scopes: ["s"], selector: "*" }];

describe("checkGoogleSecopsConsistency", () => {
  it("passes a proto method and a mixin binding that each describe one published service", () => {
    const checked = checkGoogleSecopsConsistency({
      apis: [RULES, OPERATIONS],
      authRules: EVERY_RULE,
      declared: [GET_RULE],
      httpRules: [GET_OPERATION],
    });
    expect(unwrap(checked)).toBeUndefined();
  });

  it("refuses a method or a service declared in two files", () => {
    const twice = [
      [GET_RULE, { ...GET_RULE, document: "other.proto" }],
      [GET_RULE, rpcOf({ document: "other.proto", rpc: "ListRules", service: RULES })],
    ].map((declared) =>
      unwrapErr(checkGoogleSecopsConsistency({ apis: [RULES], authRules: EVERY_RULE, declared, httpRules: [] })),
    );
    expect(twice).toStrictEqual([
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: `declares ${RULES}.GetRule, already declared in rule.proto`,
        document: "other.proto",
      }),
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: `declares service ${RULES}, already declared in rule.proto`,
        document: "other.proto",
      }),
    ]);
  });

  it("refuses a config binding for an unlisted service, a proto's service, or a service no mixin names", () => {
    const stray = rpcOf({ document: "chronicle_v1.yaml", rpc: "GetX", service: "google.cloud.chronicle.v1.X" });
    const found = [
      { apis: [RULES], httpRules: [GET_OPERATION] },
      { apis: [RULES], httpRules: [{ ...GET_RULE, document: "chronicle_v1.yaml", id: `${RULES}.ListRules` }] },
      { apis: [RULES, stray.service], httpRules: [stray] },
    ].map(
      ({ apis, httpRules }) =>
        unwrapErr(checkGoogleSecopsConsistency({ apis, authRules: EVERY_RULE, declared: [GET_RULE], httpRules }))
          .message,
    );
    expect(found).toStrictEqual([
      `chronicle_v1.yaml and the pinned protos disagree: http.rules binds ${OPERATIONS}.GetOperation, whose service apis does not list`,
      `chronicle_v1.yaml and the pinned protos disagree: http.rules binds ${RULES}.ListRules, but rule.proto declares ${RULES} without that method`,
      `chronicle_v1.yaml and the pinned protos disagree: http.rules binds ${stray.id}, but only ${OPERATIONS} is bound by config — a pinned proto must declare ${stray.service}`,
    ]);
  });

  it("refuses a rebound proto method, an orphan published service, and an authentication rule matching nothing", () => {
    const found = [
      { apis: [RULES], authRules: EVERY_RULE, httpRules: [GET_RULE] },
      { apis: [RULES, "google.cloud.chronicle.v1.Gone"], authRules: EVERY_RULE, httpRules: [] },
      { apis: [RULES], authRules: [{ scopes: ["s"], selector: `${RULES}.Missing` }], httpRules: [] },
    ].map(
      ({ apis, authRules, httpRules }) =>
        unwrapErr(checkGoogleSecopsConsistency({ apis, authRules, declared: [GET_RULE], httpRules })).message,
    );
    expect(found).toStrictEqual([
      `chronicle_v1.yaml and the pinned protos disagree: http.rules rebinds ${RULES}.GetRule, which a proto already binds`,
      "chronicle_v1.yaml and the pinned protos disagree: apis lists google.cloud.chronicle.v1.Gone, which no pinned proto or http rule declares",
      `chronicle_v1.yaml and the pinned protos disagree: authentication rule ${RULES}.Missing matches no method`,
    ]);
  });
});
