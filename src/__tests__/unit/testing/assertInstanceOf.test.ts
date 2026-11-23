import { describe, expect, it } from "vitest";

import { assertInstanceOf } from "../../assertInstanceOf.js";

class SampleError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`sample: ${code}`);
    this.code = code;
  }
}

describe("assertInstanceOf", () => {
  it("narrows a matching value, so a field can be read with no cast", () => {
    const value: unknown = new SampleError("E1");
    assertInstanceOf(value, SampleError);
    expect(value.code).toBe("E1");
  });

  it("throws vitest's own assertion failure for a value of the wrong class", () => {
    const value: unknown = new Error("plain");
    expect(() => {
      assertInstanceOf(value, SampleError);
    }).toThrow();
  });
});
