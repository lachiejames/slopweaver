/**
 * The http option's value: text-format entries read whole, and the one-binding rule deciding what an rpc
 * is on the wire or refusing it by name.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsInventoryErrors } from "../../../../atlas/googleSecops/errors.js";
import {
  type BindingEntry,
  httpBindingOf,
  readHttpAggregate,
  readHttpSubField,
} from "../../../../atlas/googleSecops/protoBinding.js";
import { lexProto, ProtoCursor } from "../../../../atlas/googleSecops/protoLex.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const METHOD = "google.cloud.chronicle.v1.RuleService.GetRule";

/**
 * Read the aggregate in `text`.
 *
 * @param text an aggregate value, opening on `{`
 * @returns what readHttpAggregate answers
 */
function aggregate({ text }: { text: string }): ReturnType<typeof readHttpAggregate> {
  return readHttpAggregate({ cursor: new ProtoCursor({ tokens: unwrap(lexProto({ text })) }) });
}

/**
 * Decide the binding over these entries.
 *
 * @param entries the http option's entries
 * @returns what httpBindingOf answers
 */
function bindingOver({ entries }: { entries: readonly BindingEntry[] }): ReturnType<typeof httpBindingOf> {
  return httpBindingOf({ document: "rule.proto", entries, method: METHOD });
}

describe("readHttpAggregate", () => {
  it("reads every entry, concatenating adjacent strings and nulling a nested block", () => {
    const text = '{ get: "/v1/a" "/b", body: "*"; additional_bindings { get: "/x" } }';
    expect(unwrap(aggregate({ text }))).toStrictEqual([
      { key: "get", value: "/v1/a/b" },
      { key: "body", value: "*" },
      { key: "additional_bindings", value: null },
    ]);
  });

  it("refuses a key with no string value", () => {
    expect(unwrapErr(aggregate({ text: "{ get: 7 }" })).message).toBe("binding key 'get' carries no string value");
  });

  it("refuses an aggregate the file ends inside", () => {
    expect(unwrapErr(aggregate({ text: '{ get: "/v1/a"' })).code).toBe("PROTO_UNEXPECTED_TOKEN");
  });

  it("refuses an aggregate that opens on anything but {", () => {
    expect(unwrapErr(aggregate({ text: '[ get: "/v1/a" }' })).message).toBe("expected '{', found '['");
  });
});

describe("readHttpSubField", () => {
  it("reads a one-field path as that key's value, and a deeper path as its first field with no string", () => {
    const cursorOn = ({ text }: { text: string }): ProtoCursor =>
      new ProtoCursor({ tokens: unwrap(lexProto({ text })) });
    expect(unwrap(readHttpSubField({ cursor: cursorOn({ text: '"/v1/a"' }), path: "get" }))).toStrictEqual({
      key: "get",
      value: "/v1/a",
    });
    expect(
      unwrap(readHttpSubField({ cursor: cursorOn({ text: '"/v1/a"' }), path: "additional_bindings.get" })),
    ).toStrictEqual({ key: "additional_bindings", value: null });
  });
});

describe("httpBindingOf", () => {
  it("places one verb on one path, ignoring body and response_body", () => {
    const entries = [
      { key: "post", value: "/v1/{parent=projects/*}/rules" },
      { key: "body", value: "rule" },
      { key: "response_body", value: "rule" },
    ];
    expect(unwrap(bindingOver({ entries }))).toStrictEqual({
      httpMethod: "POST",
      pathTemplate: "/v1/{parent=projects/*}/rules",
    });
  });

  it("places each of the five verb keys as its own method", () => {
    const verbs = ["delete", "get", "patch", "post", "put"].map(
      (key) => unwrap(bindingOver({ entries: [{ key, value: "/v1/a" }] })).httpMethod,
    );
    expect(verbs).toStrictEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("refuses a binding that names no verb, as ambiguous", () => {
    expect(unwrapErr(bindingOver({ entries: [{ key: "body", value: "*" }] }))).toStrictEqual(
      GoogleSecopsInventoryErrors.httpBindingAmbiguous({
        detail: "the binding names 0 verbs",
        document: "rule.proto",
        method: METHOD,
      }),
    );
  });

  it("refuses a custom verb before reading anything else", () => {
    const entries = [
      { key: "selector", value: "x" },
      { key: "custom", value: null },
    ];
    expect(unwrapErr(bindingOver({ entries })).message).toBe(
      `rule.proto: ${METHOD} does not carry exactly one placeable HTTP binding — declares custom`,
    );
  });

  it("refuses a verb key carrying a nested block as an unknown binding", () => {
    expect(unwrapErr(bindingOver({ entries: [{ key: "get", value: null }] })).message).toBe(
      `rule.proto could not be parsed: ${METHOD}: unknown binding key 'get'`,
    );
  });
});
