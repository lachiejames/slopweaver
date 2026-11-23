/**
 * The narrow proto reader's non-http options: a malformed name or value, a missing `;` or a missing `=` is
 * refused where it stands, rather than skipped on into the next option or rpc.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses a service-level option whose name or value is malformed", () => {
    const rpc = 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }';
    const options = ["option (foo = 1;", "option deprecated = true false;"];
    expect(
      options.map(
        (option) =>
          unwrapErr(parseChronicleProto({ document: "rule.proto", text: oneRpc({ rpc: `${option}\n${rpc}` }) }))
            .message,
      ),
    ).toStrictEqual([
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected a well-formed option name, found '(foo'",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected ';', found 'false'",
    ]);
  });

  it("refuses a skipped option missing its ; rather than skipping on past the rpc's } and dropping the next rpc", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
    option (google.api.http) = { get: "/v1/a" };
    option (google.api.method_signature) = "name"
  }
  rpc DeleteRule(DeleteRuleRequest) returns (Empty) {
    option (google.api.http) = { delete: "/v1/a" };
  }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected ';', found '}'",
    );
  });

  it("refuses a skipped option missing its ; rather than folding a following additional_bindings into it", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
    option (google.api.http) = { get: "/v1/a" };
    option (google.api.method_signature) = "name"
    option (google.api.http).additional_bindings = { delete: "/v1/a:purge" };
  }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected ';', found 'option'",
    );
  });

  it("refuses an option with no = or value rather than fusing it with a following additional_bindings", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
    option (google.api.http) = { get: "/v1/a" };
    option deprecated
    option (google.api.http).additional_bindings = { delete: "/v1/a:purge" };
  }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected an option name and '=', found 'option'",
    );
  });

  it("refuses an option with no = rather than running on into the next rpc to find one", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
    option (google.api.http) = { get: "/v1/a" };
    option (google.api.method_signature);
  }
  rpc ListRules(ListRulesRequest) returns (ListRulesResponse) {
    option (google.api.http) = { get: "/v1/b" };
  }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected an option name and '=', found ';'",
    );
  });
});
