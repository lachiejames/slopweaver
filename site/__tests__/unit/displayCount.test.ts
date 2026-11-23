/*
 * A counter pill's text: the number in full up to the cap, `max+` past it, and a negative printed as it is.
 */
import { describe, expect, it } from "vitest";

import { formatDisplayCount } from "../../lib/displayCount";

describe("formatDisplayCount", () => {
  it("prints zero as zero", () => {
    expect(formatDisplayCount({ count: 0, max: 99 })).toBe("0");
  });

  it("prints the cap itself in full", () => {
    expect(formatDisplayCount({ count: 99, max: 99 })).toBe("99");
  });

  it("prints one past the cap as the cap and a plus", () => {
    expect(formatDisplayCount({ count: 100, max: 99 })).toBe("99+");
    expect(formatDisplayCount({ count: 10, max: 9 })).toBe("9+");
  });

  it("prints a measured count above 99 in full when the cap is raised to it", () => {
    expect(formatDisplayCount({ count: 301, max: 301 })).toBe("301");
  });

  it("prints a negative count rather than clamping it to zero", () => {
    expect(formatDisplayCount({ count: -1, max: 99 })).toBe("-1");
  });
});
