/**
 * The destination-facing proposal verbs' usage text: each string opens on its own verb's usage line, and the
 * `destination` and `publish` text name the store-held destination rather than a flag repeated per run.
 */
import { describe, expect, it } from "vitest";

import {
  DESTINATION_USAGE,
  DRIFT_USAGE,
  PUBLISH_USAGE,
  SYNC_USAGE,
} from "../../../../../cli/commands/proposal/publishUsage.js";

describe("publishUsage", () => {
  it("opens each string on its own verb's usage line", () => {
    expect(PUBLISH_USAGE.split("\n")[0]!.startsWith("usage: slopweaver proposal publish <path-to-draft.md>")).toBe(
      true,
    );
    expect(DESTINATION_USAGE.split("\n")[0]!.startsWith("usage: slopweaver proposal destination set notion-page")).toBe(
      true,
    );
    expect(DRIFT_USAGE.split("\n")[0]).toBe("usage: slopweaver proposal drift [--slug <s>] [--json] [--home <dir>]");
    expect(SYNC_USAGE.split("\n")[0]!.startsWith("usage: slopweaver proposal sync --source")).toBe(true);
  });

  it("points publish at the stored destination, and offers no --parent of its own", () => {
    expect(PUBLISH_USAGE).toContain("`proposal destination set`");
    expect(PUBLISH_USAGE).not.toContain("--parent");
    expect(DESTINATION_USAGE).toContain("slopweaver proposal destination show [--json] [--home <dir>]");
  });
});
