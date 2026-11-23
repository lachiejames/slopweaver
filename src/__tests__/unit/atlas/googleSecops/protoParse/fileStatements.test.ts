/**
 * The narrow proto reader's file-level statements: unbalanced braces, an opener that is no proto keyword, a
 * service or rpc outside the place it can be read, and a stray } are refused rather than hiding a service.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../../atlas/googleSecops/errors.js";
import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("refuses a file whose braces never balance", () => {
    const text = "package a.b;\nmessage M {\n";
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      "rule.proto could not be parsed: unbalanced braces",
    );
  });

  it("refuses a file-level statement opening with no proto keyword, which would hide a whole service", () => {
    // The last ends in a Cyrillic е, which the lexer does not fold into the name.
    const openers = [".service", "service_", "rpc_", "servicе"];
    const messages = openers.map(
      (opener) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: `${oneRpc({ rpc: 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }' })}${opener} Hidden {\n  rpc PurgeRule(PurgeRuleRequest) returns (Rule) { option (google.api.http) = { delete: "/v1/a:purge" }; }\n}\n`,
          }),
        ).message,
    );
    expect(messages).toStrictEqual(
      [".service", "service_", "rpc_", "servic"].map(
        (opener) =>
          `rule.proto could not be parsed: a file-level statement opens with '${opener}', which is no proto keyword`,
      ),
    );
  });

  it("refuses a file-level statement opening with a quoted keyword, which is a string and no keyword", () => {
    const text = `package google.cloud.chronicle.v1;\n"service" RuleService {\n  rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }\n}\n`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      'rule.proto could not be parsed: a file-level statement opens with a string "service", which is no proto keyword',
    );
  });

  it("refuses a service nested in a message and an rpc outside any service, but reads a field named service", () => {
    const nested = `package google.cloud.chronicle.v1;\nmessage M {\n  service Inner { rpc X(A) returns (B) { option (google.api.http) = { delete: "/v1/x" }; } }\n}\n`;
    const looseRpc = `package google.cloud.chronicle.v1;\nrpc X(A) returns (B) { option (google.api.http) = { delete: "/v1/x" }; }\n`;
    // Inside a message, and a message within it, the top-level keyword gate never sees the rpc: only the
    // misplaced-rpc check refuses it, rather than the parser skipping a binding protoc would also reject.
    const rpcInMessage = `package google.cloud.chronicle.v1;\nmessage M {\n  rpc Y(A) returns (B) { option (google.api.http) = { delete: "/v1/y" }; }\n}\n`;
    const rpcDeeper = `package google.cloud.chronicle.v1;\nmessage M {\n  message N {\n    rpc Z(A) returns (B) { option (google.api.http) = { delete: "/v1/z" }; }\n  }\n}\n`;
    const field = `package google.cloud.chronicle.v1;\nmessage M {\n  string service = 1;\n}\n`;
    expect(
      [nested, looseRpc, rpcInMessage, rpcDeeper].map(
        (text) => unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message,
      ),
    ).toStrictEqual([
      "rule.proto could not be parsed: service Inner is declared outside the place it can be read",
      "rule.proto could not be parsed: rpc X is declared outside the place it can be read",
      "rule.proto could not be parsed: rpc Y is declared outside the place it can be read",
      "rule.proto could not be parsed: rpc Z is declared outside the place it can be read",
    ]);
    expect(unwrap(parseChronicleProto({ document: "rule.proto", text: field }))).toStrictEqual([]);
  });

  it("refuses a } that closes nothing at file level, rather than a stray pair hiding the service between them", () => {
    const text = `package google.cloud.chronicle.v1;
}
service RuleService { rpc DeleteAll(X) returns (Y) { option (google.api.http) = { delete: "/v1/x" }; } }
{
`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text }))).toStrictEqual(
      GoogleSecopsInventoryErrors.protoUnparseable({ detail: "a } closes no open block", document: "rule.proto" }),
    );
  });
});
