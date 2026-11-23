/**
 * The console half of the `verb` tool: the model's `request` becomes ONE hex token, so nothing it says can be a
 * flag of the gateway, and a malformed call is refused in words the model can read. The gateway decodes the same
 * bytes (`src/cli/commands/talk/verbArgs.ts`), so the round trip is asserted against plain JSON.
 */
import { describe, expect, it } from "vitest";

import { encodeVerbRequest, VERB_REQUEST_MAX_HEX } from "../../lib/verbRequest";

describe("encodeVerbRequest", () => {
  it("encodes noun, verb and args as the lowercase hex of their JSON", () => {
    const encoded = encodeVerbRequest({ value: { args: ["--home", "€"], noun: "store", verb: "query" } });
    const json = JSON.stringify({ args: ["--home", "€"], noun: "store", verb: "query" });
    expect(encoded).toEqual({ hex: Buffer.from(json, "utf8").toString("hex"), kind: "hex" });
  });

  it("refuses a request that is not an object, lacks a noun, or carries non-string args", () => {
    expect(encodeVerbRequest({ value: "github read" })).toEqual({
      kind: "refused",
      why: "request must be an object with noun, verb and args",
    });
    expect(encodeVerbRequest({ value: { args: [], verb: "read" } })).toEqual({
      kind: "refused",
      why: "request needs noun and verb as strings, e.g. github and read",
    });
    expect(encodeVerbRequest({ value: { args: [1], noun: "github", verb: "read" } })).toEqual({
      kind: "refused",
      why: "request.args must be a list of strings, empty when the verb takes none",
    });
  });

  it("refuses a request heavier than the gateway takes", () => {
    const value = { args: ["x".repeat(VERB_REQUEST_MAX_HEX)], noun: "store", verb: "query" };
    expect(encodeVerbRequest({ value })).toEqual({
      kind: "refused",
      why: `request is over ${String(VERB_REQUEST_MAX_HEX / 2)} bytes; ask for less`,
    });
  });
});
