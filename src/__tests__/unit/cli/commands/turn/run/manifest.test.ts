/*
 * The `turn` manifest: each verb's declared effect and door routing, and the command the manifest lazily loads.
 */
import { describe, expect, it } from "vitest";

import { runTurnAnswer, turnAnswerCommand } from "../../../../../../cli/commands/turn/run.js";
import { turnManifest } from "../../../../../../cli/manifests/turn.js";

describe("turn manifest", () => {
  it("declares the write so the door-coverage ratchet can see it", () => {
    expect(turnManifest["answer"]!.meta.effect).toBe("external-write");
    expect(turnManifest["answer"]!.meta.doorRouted).toBe(true);
  });

  it("declares brief as local-state and door-free, because it posts nothing", () => {
    expect(turnManifest["brief"]!.meta.effect).toBe("local-state");
    expect(turnManifest["brief"]!.meta.doorRouted).toBe(false);
  });

  it("declares dispatch as external-write and door-routed — its no-response decision deletes a capture checklist through the door", () => {
    expect(turnManifest["dispatch"]!.meta.effect).toBe("external-write");
    expect(turnManifest["dispatch"]!.meta.doorRouted).toBe(true);
  });

  it("declares resume as local-state and door-free — it validates but never posts", () => {
    expect(turnManifest["resume"]!.meta.effect).toBe("local-state");
    expect(turnManifest["resume"]!.meta.doorRouted).toBe(false);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnAnswerCommand).toBe(runTurnAnswer);
  });
});
