/**
 * One service block read on its own: every rpc placed under the package it was given, and a service with no
 * package to place it under refused before its block is read.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors, GoogleSecopsProtoSyntaxErrors } from "../../../../atlas/googleSecops/errors.js";
import { lexProto, ProtoCursor } from "../../../../atlas/googleSecops/protoLex.js";
import { readServiceDecl, unparseable } from "../../../../atlas/googleSecops/protoService.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const BLOCK =
  'RuleService { option (google.api.default_host) = "x"; rpc GetRule(A) returns (B) { option (google.api.http) = { get: "/v1/{name=rules/*}" }; } ; } rpc';

/**
 * A cursor just past a `service` keyword.
 *
 * @param text what follows the keyword
 * @returns a cursor on its first token
 */
function cursorOver({ text }: { text: string }): ProtoCursor {
  return new ProtoCursor({ tokens: unwrap(lexProto({ text })) });
}

describe("readServiceDecl", () => {
  it("reads every rpc under the package it is given, and stops just past the closing brace", () => {
    const cursor = cursorOver({ text: BLOCK });
    expect(unwrap(readServiceDecl({ cursor, document: "rule.proto", packageName: "p.v1" }))).toStrictEqual([
      {
        document: "rule.proto",
        httpMethod: "GET",
        id: "p.v1.RuleService.GetRule",
        pathTemplate: "/v1/{name=rules/*}",
        rpc: "GetRule",
        service: "p.v1.RuleService",
      },
    ]);
    expect(cursor.peek()).toStrictEqual({ kind: "ident", value: "rpc" });
  });

  it("refuses a service with no package to place it under, before reading its block", () => {
    const cursor = cursorOver({ text: BLOCK });
    expect(unwrapErr(readServiceDecl({ cursor, document: "rule.proto", packageName: null }))).toStrictEqual(
      GoogleSecopsInventoryErrors.protoUnparseable({
        detail: "service RuleService is declared before any package statement",
        document: "rule.proto",
      }),
    );
    // Refused on the name alone: the block's `{` is still the next token, unread.
    expect(cursor.peek()).toStrictEqual({ kind: "punct", value: "{" });
  });

  it("refuses a package-less service as package-less even when its block never opens", () => {
    const cursor = cursorOver({ text: "RuleService rpc" });
    expect(unwrapErr(readServiceDecl({ cursor, document: "rule.proto", packageName: null })).message).toBe(
      "rule.proto could not be parsed: service RuleService is declared before any package statement",
    );
  });
});

describe("unparseable", () => {
  it("places a syntax refusal on the service or method it was found in", () => {
    const error = GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: "'{'", found: "'['" });
    expect(unparseable({ document: "rule.proto", error, where: "p.v1.RuleService" }).message).toBe(
      `rule.proto could not be parsed: p.v1.RuleService: expected '{', found '['`,
    );
  });
});
