/**
 * The narrow proto reader's `(google.api.http)` binding: the one placeable binding it reads per rpc, and every
 * missing, doubled, ambiguous, misspelt or malformed binding it refuses rather than skipping.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses an rpc with no body at all as HTTP_BINDING_MISSING", () => {
    const text = oneRpc({ rpc: "rpc DeleteRule(DeleteRuleRequest) returns (google.protobuf.Empty);" });
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error).toStrictEqual(
      GoogleSecopsInventoryErrors.httpBindingMissing({
        document: "rule.proto",
        method: "google.cloud.chronicle.v1.RuleService.DeleteRule",
      }),
    );
    expect(error.message).toBe(
      "rule.proto: google.cloud.chronicle.v1.RuleService.DeleteRule declares no option (google.api.http) binding",
    );
  });

  it("refuses an http option given twice in one rpc", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = { get: "/v1/a" };
        option (google.api.http) = { get: "/v1/b" };
      }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: declares option (google.api.http) twice",
    );
  });

  it("refuses an rpc whose body carries options but no http binding as HTTP_BINDING_MISSING", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.method_signature) = "name";
      }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).code).toBe("HTTP_BINDING_MISSING");
  });

  it("refuses additional_bindings as HTTP_BINDING_AMBIGUOUS", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = {
          get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}"
          additional_bindings { get: "/v1/{name=rules/*}" }
        };
      }`,
    });
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("HTTP_BINDING_AMBIGUOUS");
    expect(error.message).toBe(
      "rule.proto: google.cloud.chronicle.v1.RuleService.GetRule does not carry exactly one placeable HTTP binding — declares additional_bindings",
    );
  });

  it("refuses additional_bindings written as a sub-field option as HTTP_BINDING_AMBIGUOUS, not skipping it", () => {
    const forms = [
      'option (google.api.http).additional_bindings = { get: "/v1/{name=rules/*}" };',
      'option (google.api.http).additional_bindings.get = "/v1/{name=rules/*}";',
    ];
    const errors = forms.map((form) =>
      unwrapErr(
        parseChronicleProto({
          document: "rule.proto",
          text: oneRpc({
            rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
              option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}" };
              ${form}
            }`,
          }),
        }),
      ),
    );
    const expected = GoogleSecopsInventoryErrors.httpBindingAmbiguous({
      detail: "declares additional_bindings",
      document: "rule.proto",
      method: "google.cloud.chronicle.v1.RuleService.GetRule",
    });
    expect(errors).toStrictEqual([expected, expected]);
  });

  it("refuses additional_bindings in either order beside a sub-field verb, whichever option comes last", () => {
    const binding = 'option (google.api.http).additional_bindings = { get: "/v1/{name=rules/*}" };';
    const verb = 'option (google.api.http).get = "/v1/{name=projects/*/locations/*/instances/*/rules/*}";';
    const errors = [`${binding}\n${verb}`, `${verb}\n${binding}`].map((body) =>
      unwrapErr(
        parseChronicleProto({
          document: "rule.proto",
          text: oneRpc({ rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {\n${body}\n}` }),
        }),
      ),
    );
    const expected = GoogleSecopsInventoryErrors.httpBindingAmbiguous({
      detail: "declares additional_bindings",
      document: "rule.proto",
      method: "google.cloud.chronicle.v1.RuleService.GetRule",
    });
    expect(errors).toStrictEqual([expected, expected]);
  });

  it("refuses a malformed body beside a real verb, which no later check reads", () => {
    const verb = 'option (google.api.http).get = "/v1/a";';
    const bodies = [
      `${verb} option (google.api.http).body = ;`,
      `${verb} option (google.api.http).body.x = ;`,
      'option (google.api.http) = { get: "/v1/a" body { "x" } };',
    ];
    expect(
      bodies.map(
        (body) =>
          unwrapErr(
            parseChronicleProto({
              document: "rule.proto",
              text: oneRpc({ rpc: `rpc GetRule(GetRuleRequest) returns (Rule) { ${body} }` }),
            }),
          ).message,
      ),
    ).toStrictEqual(
      [
        "binding key 'body' carries no string value",
        "binding key 'body' carries no string value",
        'expected an identifier, found a string "x"',
      ].map((detail) => `rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: ${detail}`),
    );
  });

  it("refuses the http option spelled any other way than (google.api.http), not skipping it", () => {
    const spellings = ["(.google.api.http)", "(api.http)"];
    const messages = spellings.map(
      (spelling) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: oneRpc({
              rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
                option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}" };
                option ${spelling}.additional_bindings = { post: "/v1/x:list" body: "*" };
              }`,
            }),
          }),
        ).message,
    );
    expect(messages).toStrictEqual([
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: spells the http option as (.google.api.http).additional_bindings; only (google.api.http) is read",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: spells the http option as (api.http).additional_bindings; only (google.api.http) is read",
    ]);
  });

  it("refuses a binding hidden behind a plain name or folded into another option's value", () => {
    const options = [
      'option deprecated.(google.api.http).additional_bindings = { delete: "/v1/a:purge" };',
      'option (google.api.method_signature).(google.api.http).additional_bindings = { delete: "/v1/a:purge" };',
      'option (google.api.method_signature) = { a: 1\n option (google.api.http) = { delete: "/v1/a:purge" }; }',
    ];
    const messages = options.map(
      (option) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: oneRpc({
              rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
                option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}" };
                ${option}
              }`,
            }),
          }),
        ).message,
    );
    expect(messages).toStrictEqual([
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: spells the http option as deprecated.(google.api.http).additional_bindings; only (google.api.http) is read",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: spells the http option as (google.api.method_signature).(google.api.http).additional_bindings; only (google.api.http) is read",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected one option value, found 'option'",
    ]);
  });

  it("refuses an http option entry with no value before its ;", () => {
    const text = oneRpc({
      rpc: "rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: ; }; }",
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: binding key 'get' carries no string value",
    );
  });

  it("refuses an http option missing its ;, in either spelling", () => {
    const options = ['option (google.api.http) = { get: "/v1/a" }', 'option (google.api.http).get = "/v1/a"'];
    const messages = options.map(
      (option) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: oneRpc({ rpc: `rpc GetRule(GetRuleRequest) returns (Rule) { ${option} }` }),
          }),
        ).message,
    );
    const expected =
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected ';', found '}'";
    expect(messages).toStrictEqual([expected, expected]);
  });

  it("refuses a binding whose parentheses are unclosed, doubled or misplaced, never skipping it", () => {
    const names = [
      "(google.api.http.additional_bindings",
      "((google.api.http))",
      "(google.api.http.additional_bindings)",
    ];
    const messages = names.map(
      (name) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: oneRpc({
              rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
                option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}" };
                option ${name} = { delete: "/v1/a:purge" };
              }`,
            }),
          }),
        ).message,
    );
    expect(messages).toStrictEqual([
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected a well-formed option name, found '(google.api.http.additional_bindings'",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: expected a well-formed option name, found '((google.api.http))'",
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService.GetRule: spells the http option as (google.api.http.additional_bindings); only (google.api.http) is read",
    ]);
  });

  it("still skips an unrelated option whose name merely contains http", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = { get: "/v1/{name=projects/*/locations/*/instances/*/rules/*}" };
        option (google.longrunning.http_info) = { metadata_type: "M" };
      }`,
    });
    expect(unwrap(parseChronicleProto({ document: "rule.proto", text })).map((rpc) => rpc.httpMethod)).toStrictEqual([
      "GET",
    ]);
  });

  it("reads a lone sub-field verb as the rpc's one binding", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http).get = "/v1/{name=projects/*/locations/*/instances/*/rules/*}";
      }`,
    });
    const rpcs = unwrap(parseChronicleProto({ document: "rule.proto", text }));
    expect(rpcs.map((rpc) => [rpc.httpMethod, rpc.pathTemplate])).toStrictEqual([
      ["GET", "/v1/{name=projects/*/locations/*/instances/*/rules/*}"],
    ]);
  });

  it("refuses a binding naming two verbs as HTTP_BINDING_AMBIGUOUS", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = { get: "/v1/a" post: "/v1/b" };
      }`,
    });
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("HTTP_BINDING_AMBIGUOUS");
    expect(error.message).toContain("the binding names 2 verbs");
  });

  it("refuses a custom verb as HTTP_BINDING_AMBIGUOUS", () => {
    const text = oneRpc({
      rpc: `rpc Watch(WatchRequest) returns (WatchResponse) {
        option (google.api.http) = { custom { kind: "HEAD" path: "/v1/x" } };
      }`,
    });
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).code).toBe("HTTP_BINDING_AMBIGUOUS");
  });

  it("refuses an unknown binding key rather than skipping it", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = { get: "/v1/a" selector: "x" };
      }`,
    });
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toContain("unknown binding key 'selector'");
  });
});
