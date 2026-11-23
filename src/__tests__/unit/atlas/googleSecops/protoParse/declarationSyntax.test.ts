/**
 * The narrow proto reader's declaration syntax: an rpc signature, a service, a request type or a package opened,
 * named or closed on the wrong token is refused with the token it found, never read as a row.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses an rpc whose signature is cut short as PROTO_UNPARSEABLE, naming the method", () => {
    const text = oneRpc({ rpc: "rpc GetRule(GetRuleRequest) yields (Rule);" });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected 'returns', found 'yields'",
    );
  });

  it("refuses an rpc whose signature, body or statements open on the wrong token, never reading a row from it", () => {
    const http = 'option (google.api.http) = { get: "/v1/a" };';
    const rpcs = [
      `rpc GetRule(GetRuleRequest) returns (Rule) { opton ${http.slice("option ".length)} }`,
      `rpc GetRule("GetRuleRequest") returns (Rule) { ${http} }`,
      `rpc GetRule(;) returns (Rule) { ${http} }`,
      `rpc GetRule(GetRuleRequest) returns Rule { ${http} }`,
      `rpc GetRule(GetRuleRequest) returns (Rule] { ${http} }`,
      `rpc GetRule(GetRuleRequest) returns (Rule) [ ${http} }`,
    ];
    expect(
      rpcs.map((rpc) => unwrapErr(parseChronicleProto({ document: "rule.proto", text: oneRpc({ rpc }) })).message),
    ).toStrictEqual(
      [
        "expected 'option', found 'opton'",
        'expected an identifier, found a string "GetRuleRequest"',
        "expected an identifier, found ';'",
        "expected '(', found 'Rule'",
        "expected ')', found ']'",
        "expected '{', found '['",
      ].map((detail) => `rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: ${detail}`),
    );
  });

  it("refuses an rpc whose name holds a dot, which would read as a method of some other service", () => {
    const text = oneRpc({
      rpc: 'rpc v1.GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }',
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected a name, found 'v1.GetRule'",
    );
  });

  it("refuses an rpc whose name opens with a digit, which protobuf does not read as a name", () => {
    const text = oneRpc({
      rpc: 'rpc 9GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }',
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected a name, found '9GetRule'",
    );
  });

  it("refuses a service, a request type or a package opened by anything but its own punctuation or a name", () => {
    const rpc = 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }';
    const texts = [
      `package google.cloud.chronicle.v1;\nservice RuleService X ${rpc} }\n`,
      `package google.cloud.chronicle.v1;\nservice RuleService ( ${rpc} }\n`,
      oneRpc({ rpc: 'rpc GetRule [GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }' }),
      `package "google.cloud.chronicle.v1";\nservice RuleService {\n${rpc}\n}\n`,
    ];
    expect(texts.map((text) => unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message)).toStrictEqual(
      [
        "rule.proto could not be parsed: service RuleService: expected '{', found 'X'",
        "rule.proto could not be parsed: service RuleService: expected '{', found '('",
        "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected '(', found '['",
        'rule.proto could not be parsed: package: expected an identifier, found a string "google.cloud.chronicle.v1"',
      ],
    );
  });

  it("refuses a request type whose ) never comes", () => {
    const text = oneRpc({
      rpc: 'rpc GetRule(GetRuleRequest returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }',
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected ')', found 'returns'",
    );
  });

  it("refuses a dotted service name, which would move the package boundary of every selector", () => {
    const text = `package google.cloud.chronicle;\nservice v1.RuleService {\n  rpc GetRule(A) returns (B) { option (google.api.http) = { get: "/v1/a" }; }\n}\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: service: expected a name, found 'v1.RuleService'",
    );
  });
});
