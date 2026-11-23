/**
 * How the narrow proto reader treats string literals: adjacent ones concatenate, an unterminated one is refused,
 * and only the escapes that stand for themselves decode.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("concatenates adjacent string literals, so a path wrapped across lines reads whole", () => {
    const text = oneRpc({
      rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {
        option (google.api.http) = {
          get: "/v1/{name=projects/*/locations/*/"
               "instances/*/rules/*}"
        };
      }`,
    });
    const rpcs = unwrap(parseChronicleProto({ document: "rule.proto", text }));
    expect(rpcs.map((rpc) => rpc.pathTemplate)).toStrictEqual([
      "/v1/{name=projects/*/locations/*/instances/*/rules/*}",
    ]);
  });

  it("refuses an unterminated string as PROTO_UNPARSEABLE", () => {
    const text = 'package google.cloud.chronicle.v1;\noption java_package = "com.google\n;';
    const error = unwrapErr(parseChronicleProto({ document: "rule.proto", text }));
    expect(error.code).toBe("PROTO_UNPARSEABLE");
    expect(error.message).toContain("unterminated string");
  });

  it("decodes only the escapes that stand for themselves, and refuses a hex, octal or control escape", () => {
    const binding = ({ path }: { path: string }): string =>
      oneRpc({
        rpc: `rpc GetRule(GetRuleRequest) returns (Rule) {\n  option (google.api.http) = { get: "${path}" };\n}`,
      });
    const read = unwrap(
      parseChronicleProto({ document: "rule.proto", text: binding({ path: String.raw`/v1/a\"b\\c` }) }),
    );
    expect(read.map((rpc) => rpc.pathTemplate)).toStrictEqual([String.raw`/v1/a"b\c`]);
    const refused = [String.raw`/v1/\x7bname}`, String.raw`/v1/a\175`, String.raw`/v1/a\n`].map(
      (path) => unwrapErr(parseChronicleProto({ document: "rule.proto", text: binding({ path }) })).message,
    );
    expect(refused).toStrictEqual([
      String.raw`rule.proto could not be parsed: expected one of the escapes \\ \" \' in a string, found \x`,
      String.raw`rule.proto could not be parsed: expected one of the escapes \\ \" \' in a string, found \1`,
      String.raw`rule.proto could not be parsed: expected one of the escapes \\ \" \' in a string, found \n`,
    ]);
  });
});
