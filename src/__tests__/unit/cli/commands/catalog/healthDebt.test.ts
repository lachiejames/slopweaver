/**
 * `slopweaver catalog health`'s debt reader — every row shape standing in `.baselines/` today.
 *
 * Tested directly rather than through the verb because this decoder is where the debt figures come from: a
 * baseline shape it silently skips shows up on the page as a gate whose debt shrank, which is the one
 * reading a health atlas must never invent.
 */
import { describe, expect, it } from "vitest";

import { decodeBaseline } from "../../../../../cli/commands/catalog/healthDebt.js";

describe("decodeBaseline", () => {
  it("weighs a {path,count} list by its counts", () => {
    const decoded = decodeBaseline({
      key: "sites",
      text: '{"sites":[{"path":"src/a.ts","count":3},{"path":"src/b.ts","count":1}]}',
    });
    expect(decoded.total).toBe(4);
    expect(decoded.entries).toEqual([
      { count: 3, path: "src/a.ts" },
      { count: 1, path: "src/b.ts" },
    ]);
  });

  it("weighs a named-symbol row as one site, because a named symbol IS one site", () => {
    const decoded = decodeBaseline({ key: "symbols", text: '{"symbols":[{"path":"src/a.ts","name":"foo"}]}' });
    expect(decoded.total).toBe(1);
    expect(decoded.entries).toEqual([{ count: 1, path: "src/a.ts" }]);
  });

  it("sums the numeric fields of a list that records only a total", () => {
    const decoded = decodeBaseline({ key: undefined, text: '{"filePairs":7,"generatedAtIso":"2026-09-20"}' });
    expect(decoded.total).toBe(7);
    expect(decoded.entries).toEqual([]);
  });

  it("reports an unreadable baseline as empty rather than throwing", () => {
    const decoded = decodeBaseline({ key: "sites", text: "not json at all" });
    expect(decoded.total).toBe(0);
    expect(decoded.entries).toEqual([]);
  });

  it("skips a row carrying no path, so a malformed entry cannot weigh one", () => {
    const decoded = decodeBaseline({ key: "sites", text: '{"sites":[{"count":9},{"path":"src/a.ts"}]}' });
    expect(decoded.total).toBe(1);
    expect(decoded.entries).toEqual([{ count: 1, path: "src/a.ts" }]);
  });

  it("weighs a bare path string as one site, which is how untested-modules records a module", () => {
    const decoded = decodeBaseline({ key: "modules", text: '{"modules":["src/a.ts","src/b.ts"]}' });
    expect(decoded.total).toBe(2);
    expect(decoded.entries).toEqual([
      { count: 1, path: "src/a.ts" },
      { count: 1, path: "src/b.ts" },
    ]);
  });

  it("skips a non-string, non-record row, so a nested array cannot weigh one", () => {
    const decoded = decodeBaseline({ key: "modules", text: '{"modules":[["src/a.ts"],"src/b.ts"]}' });
    expect(decoded.total).toBe(1);
    expect(decoded.entries).toEqual([{ count: 1, path: "src/b.ts" }]);
  });
});
