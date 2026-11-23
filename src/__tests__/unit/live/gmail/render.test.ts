/**
 * The human renderings of a Gmail document. Pure, so every case is a value in and a string out.
 */
import { describe, expect, it } from "vitest";

import { humanBytes } from "../../../../live/gmail/render.js";

describe("humanBytes", () => {
  it("keeps a small figure in bytes rather than rounding it to zero of a bigger unit", () => {
    expect(humanBytes({ bytes: 512 })).toBe("512 B");
  });

  it("steps up to the largest unit that keeps the number above one", () => {
    expect(humanBytes({ bytes: 2048 })).toBe("2.0 KB");
    expect(humanBytes({ bytes: 56_200_000 })).toBe("53.6 MB");
  });

  it("stops at terabytes rather than inventing a unit past the list", () => {
    expect(humanBytes({ bytes: 1024 ** 5 })).toBe("1024.0 TB");
  });
});
