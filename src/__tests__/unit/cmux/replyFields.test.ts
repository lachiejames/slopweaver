/** The shared field readers over a decoded cmux reply. */
import { describe, expect, it } from "vitest";

import { optionalString } from "../../../cmux/replyFields.js";

describe("optionalString", () => {
  it("reads a non-empty string field", () => {
    expect(optionalString({ field: "id", value: { id: "U1" } })).toBe("U1");
  });

  it("reads an emptied field as absent, the same as an unset one", () => {
    expect(optionalString({ field: "id", value: { id: "" } })).toBeUndefined();
    expect(optionalString({ field: "id", value: { id: null } })).toBeUndefined();
  });

  it("reads a non-string field, or a node that is not a record, as absent", () => {
    expect(optionalString({ field: "id", value: { id: 7 } })).toBeUndefined();
    expect(optionalString({ field: "id", value: ["U1"] })).toBeUndefined();
  });
});
