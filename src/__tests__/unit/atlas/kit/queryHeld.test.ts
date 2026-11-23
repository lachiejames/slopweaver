/** `requestedQueryHeld`: a multiset containment of the requested query in the settled one. */
import { describe, expect, it } from "vitest";

import { requestedQueryHeld } from "../../../../atlas/kit/queryHeld.js";

/** Compare two addresses' queries. */
function held({ requested, settled }: { requested: string; settled: string }): boolean {
  return requestedQueryHeld({ requested: new URL(requested), settled: new URL(settled) });
}

describe("requestedQueryHeld", () => {
  it("holds a repeated parameter value for value, and ignores a parameter the client appended", () => {
    expect(
      held({ requested: "https://a.test/x?status=A&status=B", settled: "https://a.test/x?status=B&tab=1&status=A" }),
    ).toBe(true);
  });

  it("refuses when the settled address kept one fewer copy of a repeated value", () => {
    expect(held({ requested: "https://a.test/x?s=A&s=A", settled: "https://a.test/x?s=A" })).toBe(false);
  });

  it("keeps a name and value apart even when their concatenation collides", () => {
    expect(held({ requested: "https://a.test/x?ab=c", settled: "https://a.test/x?a=bc" })).toBe(false);
  });
});
