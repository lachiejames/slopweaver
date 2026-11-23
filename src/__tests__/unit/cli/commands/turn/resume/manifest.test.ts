/**
 * `turn resume`'s manifest row — its declared effect and door routing, and the command the manifest lazily loads.
 */
import { describe, expect, it } from "vitest";

import { runTurnResume, turnResumeCommand } from "../../../../../../cli/commands/turn/resume.js";
import { turnManifest } from "../../../../../../cli/manifests/turn.js";

describe("turn manifest — resume", () => {
  it("declares resume as local-state and door-free — it validates but never posts", () => {
    expect(turnManifest["resume"]!.meta.effect).toBe("local-state");
    expect(turnManifest["resume"]!.meta.doorRouted).toBe(false);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnResumeCommand).toBe(runTurnResume);
  });
});
