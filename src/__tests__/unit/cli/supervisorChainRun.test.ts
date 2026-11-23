import { describe, expect, it } from "vitest";

import { parseChainOptions } from "../../../cli/commands/supervisor/chainRun.js";
import { unwrap } from "../../../lib/result.js";

describe("supervisor chain flags", () => {
  it("defaults to listing the journal without touching the transcripts", () => {
    expect(unwrap(parseChainOptions({ rest: [] }))).toEqual({ home: undefined, json: false, rescan: false });
  });

  it("takes the rescan, an explicit home and machine output", () => {
    expect(unwrap(parseChainOptions({ rest: ["--rescan", "--home", "/h", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      rescan: true,
    });
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    const result = parseChainOptions({ rest: ["--resacn"] });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("--resacn");
  });
});
