/**
 * The narrow proto reader's service blocks: a service the file ends inside, one declared twice, one holding a
 * member that is neither rpc nor option, or one declaring no rpc at all is refused.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses a service the file ends inside, before its closing }", () => {
    const text = `package google.cloud.chronicle.v1;\nservice RuleService {\n  rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected 'rpc' or 'option', found the end of the file",
    );
  });

  it("refuses a second block for a service already declared, rather than merging its methods", () => {
    const text = `${oneRpc({ rpc: 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }' })}service RuleService {\n  rpc PurgeRule(PurgeRuleRequest) returns (Rule) { option (google.api.http) = { delete: "/v1/a:purge" }; }\n}\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: "service google.cloud.chronicle.v1.RuleService is declared twice",
        document: "rule.proto",
      }),
    );
  });

  it("refuses a statement inside a service that is neither rpc nor option as PROTO_UNPARSEABLE", () => {
    const text = oneRpc({ rpc: "message Nested { string a = 1; }" });
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toContain("expected 'rpc' or 'option', found 'message'");
  });

  it("refuses a quoted ;, option or rpc inside a service, which is a string and no statement", () => {
    const members = [
      '";"',
      '"option" deprecated = true;',
      '"rpc" GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }',
    ];
    const messages = members.map(
      (rpc) => unwrapErr(parseChronicleProto({ document: "rule.proto", text: oneRpc({ rpc }) })).message,
    );
    expect(messages).toStrictEqual(
      [";", "option", "rpc"].map(
        (quoted) =>
          `rule.proto could not be parsed: google.cloud.chronicle.v1.RuleService: expected 'rpc' or 'option', found a string "${quoted}"`,
      ),
    );
  });

  it("refuses a service that declares no rpc", () => {
    const text = `package google.cloud.chronicle.v1;\nservice RuleService {\n  option (google.api.default_host) = "x";\n}\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: "service google.cloud.chronicle.v1.RuleService declares no rpc",
        document: "rule.proto",
      }),
    );
  });
});
