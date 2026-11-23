import { describe, expect, it } from "vitest";

import { ONEPASSWORD_SYNC_USAGE, runOnepasswordSync } from "../../../../../cli/commands/onepassword/syncRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { SYNC_USAGE } from "../../../../../cli/manifests/onepassword.js";

describe("runOnepasswordSync", () => {
  it("the manifest's usage string matches this verb's own copy", () => {
    expect(SYNC_USAGE).toBe(ONEPASSWORD_SYNC_USAGE);
  });

  it("--help prints usage and exits EXIT_OK without touching a credential", async () => {
    expect(await runOnepasswordSync(["node", "slopweaver", "onepassword", "sync", "--help"])).toBe(EXIT_OK);
  });
});
