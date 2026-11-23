/**
 * `connectCodexFleetCapRows` refusing, rather than answering empty, when the home selects no store. The statements
 * themselves need a real database and are proven in `integration/codexFleetCapStore.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connectCodexFleetCapRows } from "../../../codex/fleetCapStoreRows.js";
import { unwrapErr } from "../../../lib/result.js";

describe("connectCodexFleetCapRows", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "codex-fleet-cap-rows-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses with the typed store failure when the home selects no store", async () => {
    const failure = unwrapErr(await connectCodexFleetCapRows({ home }));
    expect(failure.code).toBe("CODEX_FLEET_CAP_STORE_UNAVAILABLE");
    expect(failure.message).toContain("the store could not open the Codex fleet-cap record: ");
  });
});
