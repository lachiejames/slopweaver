/**
 * The `fathom` noun's manifest, checked for what its rows claim: three verbs, two local-state writes routed
 * through no door and `clear-inbox`, whose mailbox archive goes through the Gmail door, quoting the usage leaf
 * rather than the command module the manifest must never load.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FATHOM_CLEAR_INBOX_USAGE,
  FATHOM_DISCOVER_USAGE,
  FATHOM_SHARE_USAGE,
} from "../../../../cli/commands/fathom/usage.js";
import { fathomManifest } from "../../../../cli/manifests/fathom.js";

/** The manifest's own source, read so the eager-import property is checked on what ships. */
const MANIFEST_SOURCE = readFileSync(join(import.meta.dirname, "../../../../cli/manifests/fathom.ts"), "utf8");

describe("fathomManifest", () => {
  it("declares exactly the clear-inbox, discover and share verbs", () => {
    expect(Object.keys(fathomManifest)).toEqual(["clear-inbox", "discover", "share"]);
  });

  it("declares discover and share local-state writes that no door routes", () => {
    expect(fathomManifest["discover"]!.meta.effect).toBe("local-state");
    expect(fathomManifest["share"]!.meta.effect).toBe("local-state");
    expect(fathomManifest["discover"]!.meta.doorRouted).toBe(false);
    expect(fathomManifest["share"]!.meta.doorRouted).toBe(false);
  });

  it("declares clear-inbox an external write the door routes, because it archives the owner's mail", () => {
    expect(fathomManifest["clear-inbox"]!.meta.effect).toBe("external-write");
    expect(fathomManifest["clear-inbox"]!.meta.doorRouted).toBe(true);
  });

  it("keeps a bare discover and clear-inbox out of the no-args dry parse, because each reads a real mailbox", () => {
    expect(fathomManifest["discover"]!.meta.dryParseSafe).toBe(false);
    expect(fathomManifest["clear-inbox"]!.meta.dryParseSafe).toBe(false);
    expect(fathomManifest["share"]!.meta.dryParseSafe).toBe(true);
  });

  it("quotes the usage leaf itself, so the manifest and --help cannot drift", () => {
    expect(fathomManifest["discover"]!.meta.usage).toBe(FATHOM_DISCOVER_USAGE);
    expect(fathomManifest["share"]!.meta.usage).toBe(FATHOM_SHARE_USAGE);
    expect(fathomManifest["clear-inbox"]!.meta.usage).toBe(FATHOM_CLEAR_INBOX_USAGE);
  });

  it("imports its usage from the leaf and never from the command module", () => {
    expect(MANIFEST_SOURCE).toContain('from "../commands/fathom/usage.js"');
    expect(MANIFEST_SOURCE).not.toContain('from "../commands/fathom/run.js"');
  });
});
