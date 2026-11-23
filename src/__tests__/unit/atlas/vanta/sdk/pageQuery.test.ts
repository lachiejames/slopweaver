/**
 * Vanta's shared cursor-pagination query string: each optional param appears only when set, in a fixed order,
 * URL-encoded, and a read that sets neither keeps the bare path.
 */
import { describe, expect, it } from "vitest";

import { withVantaPageQuery } from "../../../../../atlas/vanta/sdk/pageQuery.js";

const PATH = "/v1/controls/controls-library";

describe("withVantaPageQuery", () => {
  it("returns the bare path when neither param is set", () => {
    expect(withVantaPageQuery({ pageCursor: undefined, pageSize: undefined, path: PATH })).toBe(PATH);
  });

  it("appends only pageSize when the cursor is absent", () => {
    expect(withVantaPageQuery({ pageCursor: undefined, pageSize: 50, path: PATH })).toBe(`${PATH}?pageSize=50`);
  });

  it("appends only pageCursor when the size is absent", () => {
    expect(withVantaPageQuery({ pageCursor: "abc", pageSize: undefined, path: PATH })).toBe(`${PATH}?pageCursor=abc`);
  });

  it("puts pageSize before pageCursor when both are set", () => {
    expect(withVantaPageQuery({ pageCursor: "abc", pageSize: 0, path: PATH })).toBe(
      `${PATH}?pageSize=0&pageCursor=abc`,
    );
  });

  it("URL-encodes a cursor carrying reserved characters", () => {
    expect(withVantaPageQuery({ pageCursor: "a+b/c=d&e", pageSize: undefined, path: PATH })).toBe(
      `${PATH}?pageCursor=a%2Bb%2Fc%3Dd%26e`,
    );
  });
});
