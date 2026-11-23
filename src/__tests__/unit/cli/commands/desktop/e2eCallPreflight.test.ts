import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transcriptIdsIn } from "../../../../../cli/commands/desktop/e2eCallPreflight.js";
import { unwrap } from "../../../../../lib/result.js";

describe("transcriptIdsIn", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "e2e-preflight-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("lists no transcript in a home whose talk store holds none", () => {
    const result = transcriptIdsIn({ home });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });
});
