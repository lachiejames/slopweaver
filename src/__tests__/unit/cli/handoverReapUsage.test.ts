import { describe, expect, it } from "vitest";

import { HANDOVER_REAP_FLAG_NAMES, HANDOVER_REAP_USAGE } from "../../../cli/commands/handover/reapRun.js";
import { handoverManifest } from "../../../cli/manifests/handover.js";

/**
 * The help-truth ratchet for `handover reap`: the manifest's `usage` is a LITERAL, written so `--help` can be
 * answered without loading the command module, and a literal drifts from the flags the module actually parses
 * the moment someone adds one. These assertions are what stop that drift being invisible.
 */
describe("handover reap usage", () => {
  it("declares every flag the command actually parses", () => {
    expect(HANDOVER_REAP_FLAG_NAMES).toEqual(["--dry-run", "--home", "--json", "--now"]);
  });

  it("names each of those flags in its own usage line", () => {
    HANDOVER_REAP_FLAG_NAMES.forEach((flag) => {
      expect(HANDOVER_REAP_USAGE).toContain(flag);
    });
  });

  it("is registered on the handover manifest, whose usage matches the module's own", () => {
    const entry = handoverManifest["reap"]!;

    expect(entry.meta.usage).toBe(HANDOVER_REAP_USAGE);
  });

  it("is local-state and not door-routed, because it reads journals and appends to them", () => {
    const entry = handoverManifest["reap"]!;

    expect(entry.meta.effect).toBe("local-state");
    expect(entry.meta.doorRouted).toBe(false);
  });
});
