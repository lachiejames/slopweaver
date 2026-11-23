/**
 * The narrow proto reader's package scope: a declared google or a package holding a second google would shadow
 * what (google.api.http) resolves through, and a missing, unterminated or second package statement is refused.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses a declared google, which would make (google.api.http) resolve to some other extension", () => {
    const shadows = [
      "message google { message api { extend .google.protobuf.MethodOptions { .google.api.HttpRule http = 98765; } } }",
      "enum Shadow { google = 0; }",
    ];
    const rpc = 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }';
    const errors = shadows.map((shadow) =>
      unwrapErr(parseChronicleProto({ document: "rule.proto", text: `${oneRpc({ rpc })}${shadow}\n` })),
    );
    const expected = GoogleSecopsInventoryErrors.protoUnparseable({
      detail: "declares the name google, which would shadow the package (google.api.http) resolves through",
      document: "rule.proto",
    });
    expect(errors).toStrictEqual([expected, expected]);
  });

  it("refuses a package with a google past its first segment, wherever it sits, as a shadowing scope", () => {
    const packages = ["google.google.cloud", "google.cloud.google.v1", "google.cloud.google"];
    const errors = packages.map((name) =>
      unwrapErr(
        parseChronicleProto({
          document: "rule.proto",
          text: `package ${name};\nservice RuleService {\n  rpc GetRule(A) returns (B) { option (google.api.http) = { get: "/v1/a" }; }\n}\n`,
        }),
      ),
    );
    expect(errors).toStrictEqual(
      packages.map((name) =>
        GoogleSecopsInventoryErrors.protoUnparseable({
          detail: `package ${name} holds a second google, which would shadow the package (google.api.http) resolves through`,
          document: "rule.proto",
        }),
      ),
    );
  });

  it("refuses a service declared before any package statement as PROTO_UNPARSEABLE", () => {
    const text = "service RuleService {\n}\n";
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toBe(
      "rule.proto could not be parsed: service RuleService is declared before any package statement",
    );
  });

  it("refuses a package name that does not end at its ;", () => {
    const text = `package google.cloud.chronicle .v1;\nservice RuleService {\n}\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: package: expected ';', found '.v1'",
    );
  });

  it("refuses a second package statement, which would move every later service's selector", () => {
    const text = `package google.cloud.chronicle.v1;\npackage other.v1;\nservice RuleService {\n}\n`;
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toBe(
      "rule.proto could not be parsed: a second package statement after package google.cloud.chronicle.v1",
    );
  });
});
