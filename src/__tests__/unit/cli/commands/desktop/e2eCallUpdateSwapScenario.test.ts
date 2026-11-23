import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readOwedSinceIso } from "../../../../../cli/commands/desktop/e2eCallUpdateSwapScenario.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("readOwedSinceIso", () => {
  let userData = "";

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), "sw-swap-owed-"));
  });

  afterEach(() => {
    rmSync(userData, { force: true, recursive: true });
  });

  it("reads the instant the test instance saved for the call it ended", () => {
    writeFileSync(join(userData, "state.json"), '{"resumeVoice":{"sinceIso":"2026-11-01T05:32:00.000Z"}}');
    expect(unwrap(readOwedSinceIso({ userData }))).toBe("2026-11-01T05:32:00.000Z");
  });

  it("says the file owes no restart when the shell saved none", () => {
    writeFileSync(join(userData, "state.json"), "{}");
    expect(unwrapErr(readOwedSinceIso({ userData }))).toEqual([
      "the test instance's state.json owes no restart after the shell ended its call for the update",
    ]);
  });

  it("names the file it could not read", () => {
    const [message] = unwrapErr(readOwedSinceIso({ userData }));
    expect(message).toContain(`could not read ${join(userData, "state.json")}`);
  });
});
