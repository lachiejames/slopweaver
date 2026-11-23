/**
 * The proposal-ask classifier and the existence-establishing leg filter — both pure, both tripwires rather
 * than fences, so what matters here is that the incident's own wording fires and that the false positives
 * the phrase list could plausibly generate do not.
 */
import { describe, expect, it } from "vitest";
import {
  classifyProposalAsk,
  EXISTENCE_ESTABLISHING_SOURCE_CLASSES,
  existenceEstablishingLegs,
} from "../../../../live/turn/proposalAsk.js";
import type { SourceCapability } from "../../../../route/profile.js";

/** A capability fixture at one source class — only `id`/`sourceClass` matter to anything under test here. */
function capabilityAt({
  id,
  sourceClass,
}: {
  id: string;
  sourceClass: SourceCapability["sourceClass"];
}): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", id],
    coverage: { detail: "bounded", kind: "bounded" },
    effect: "read",
    freshness: { detail: "live", kind: "live" },
    id,
    owner: "slopweaver",
    sourceClass,
    terms: [id],
    truthMode: "current",
    what: id,
  };
}

describe("classifyProposalAsk", () => {
  it("fires on the wording of the answer the owner marked BAD", () => {
    // The tag, as asked: "…what can you not do yet, what does standing this up cost". The bot costed a
    // repository it was standing inside.
    const proposal = classifyProposalAsk({
      text: "what does the team get on day one, what leaves the machine, what does standing this up cost",
    });

    expect(proposal?.family).toBe("deliberation");
    expect(proposal?.trigger).toBe("what does standing this up cost");
  });

  it("fires on a plain should-we, and quotes exactly the wording that tripped it", () => {
    const proposal = classifyProposalAsk({ text: "should we build a second review queue for this?" });

    expect(proposal?.family).toBe("deliberation");
    expect(proposal?.trigger).toBe("should we");
  });

  it("fires on standing-up wording when the ask is about what WE would do", () => {
    const proposal = classifyProposalAsk({ text: "can we spin up a staging pool for the new service" });

    expect(proposal?.family).toBe("standing-up");
    expect(proposal?.trigger).toBe("spin up");
  });

  it("does NOT fire on standing-up wording in a how-to about someone's own machine", () => {
    // "set up" is the phrase most likely to over-fire, and this is the ask it would over-fire on. Forcing a
    // provider read onto a how-to would be a new defect, not a stricter version of the fix.
    expect(classifyProposalAsk({ text: "how do I set up the Slack app for my own dev install" })).toBeUndefined();
  });

  it("does NOT fire on a plain historical ask", () => {
    expect(classifyProposalAsk({ text: "what did we decide about the ticket format" })).toBeUndefined();
  });

  it("does NOT fire on a bare greeting", () => {
    expect(classifyProposalAsk({ text: "yo" })).toBeUndefined();
  });

  it("does NOT mistake standup for standing something up", () => {
    expect(classifyProposalAsk({ text: "can you post our standup notes" })).toBeUndefined();
  });

  it("reports the deliberation half of an ask that carries both families", () => {
    // Deliberation names the decision being weighed, which is the more useful half to quote back.
    const proposal = classifyProposalAsk({ text: "should we roll out the new gate to every repo" });

    expect(proposal?.family).toBe("deliberation");
    expect(proposal?.trigger).toBe("should we");
  });

  it("matches case-insensitively — a capitalised ask is the same ask", () => {
    expect(classifyProposalAsk({ text: "Should we adopt this?" })?.trigger).toBe("Should we");
  });
});

describe("existenceEstablishingLegs", () => {
  it("keeps provider, repository and atlas legs", () => {
    const capabilities = [
      capabilityAt({ id: "github", sourceClass: "provider" }),
      capabilityAt({ id: "fleet-status", sourceClass: "repository" }),
      capabilityAt({ id: "service-atlas", sourceClass: "atlas" }),
    ];

    expect(
      existenceEstablishingLegs({ capabilities, capabilityIds: ["github", "fleet-status", "service-atlas"] }),
    ).toEqual(["github", "fleet-status", "service-atlas"]);
  });

  it("drops the two legs the BAD answer actually named", () => {
    // `catalog` describes this build; `audit` describes the local corpus. Both are live and current-truth,
    // and neither can say whether a named repository exists.
    const capabilities = [
      capabilityAt({ id: "catalog", sourceClass: "artifact" }),
      capabilityAt({ id: "audit", sourceClass: "corpus" }),
    ];

    expect(existenceEstablishingLegs({ capabilities, capabilityIds: ["catalog", "audit"] })).toEqual([]);
  });

  it("drops an orchestration leg — this installation's own board is not the world", () => {
    const capabilities = [capabilityAt({ id: "handover-list", sourceClass: "orchestration" })];

    expect(existenceEstablishingLegs({ capabilities, capabilityIds: ["handover-list"] })).toEqual([]);
  });

  it("drops an id no capability in the set carries", () => {
    const capabilities = [capabilityAt({ id: "github", sourceClass: "provider" })];

    expect(existenceEstablishingLegs({ capabilities, capabilityIds: ["nothing-offers-this"] })).toEqual([]);
  });

  it("returns nothing for an empty need list", () => {
    expect(existenceEstablishingLegs({ capabilities: [], capabilityIds: [] })).toEqual([]);
  });

  it("names exactly the three classes that read outside this process", () => {
    expect([...EXISTENCE_ESTABLISHING_SOURCE_CLASSES].toSorted()).toEqual(["atlas", "provider", "repository"]);
  });
});
