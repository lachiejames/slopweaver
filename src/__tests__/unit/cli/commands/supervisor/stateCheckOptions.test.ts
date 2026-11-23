import { describe, expect, it } from "vitest";

import { parseStateCheckOptions } from "../../../../../cli/commands/supervisor/run.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseStateCheckOptions", () => {
  it("refuses an empty --path as a missing flag, so it exits as usage and never reaches the read", () => {
    expect(unwrapErr(parseStateCheckOptions({ rest: ["--path", ""] })).code).toBe("FLAG_MISSING");
  });

  it("accepts a named path", () => {
    expect(unwrap(parseStateCheckOptions({ rest: ["--path", "/s.md"] })).path).toBe("/s.md");
  });
});
