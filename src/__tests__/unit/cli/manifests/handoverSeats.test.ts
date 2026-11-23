/**
 * The seat verbs' manifest entries. Declared metadata only — the entries are lazy, so nothing here loads a
 * command module. What this guards is that both seat verbs reach the one folded manifest, that park's usage names
 * the flags that pick a seat and a wake, and that wake does not claim a bare invocation is a dry parse.
 */
import { describe, expect, it } from "vitest";

import { handoverManifest } from "../../../../cli/manifests/handover.js";
import { handoverSeatManifest } from "../../../../cli/manifests/handoverSeats.js";

describe("handoverSeatManifest", () => {
  it("holds exactly the verb that closes a seat and the verb that reseats a waking one", () => {
    expect(Object.keys(handoverSeatManifest)).toEqual(["park", "wake"]);
  });

  it("reaches the one folded manifest, so the split did not drop either", () => {
    expect(handoverManifest["park"]).toBe(handoverSeatManifest["park"]);
    expect(handoverManifest["wake"]).toBe(handoverSeatManifest["wake"]);
  });

  it("advertises --workspace and both wake flags on park", () => {
    const usage = handoverSeatManifest["park"]!.meta.usage;
    expect(usage).toContain("[--workspace <value>]");
    expect(usage).toContain("[--wake-at <value>] [--wake-on-checks <value>]");
  });

  it("declares wake as a local-state verb whose bare run acts, so it is not dry-parse safe", () => {
    const meta = handoverSeatManifest["wake"]!.meta;
    expect(meta.usage).toBe(
      "usage: slopweaver handover wake [--retry <nonce> | --settle-only] [--dry-run] [--home <dir>] [--json]",
    );
    expect(meta.effect).toBe("local-state");
    expect(meta.dryParseSafe).toBe(false);
    expect(meta.parseRejectIsIoFree).toBe(true);
  });
});
