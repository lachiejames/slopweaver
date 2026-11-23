/**
 * The visual-evidence default, and the ceiling that keeps it from becoming a review round.
 *
 * The two halves are asserted against each other on purpose: a pre-flight that raises the composer's default
 * without a reviewer ceiling is how a soft default turns into a fail-closed loop, which is precisely what the
 * owner's instruction ruled out.
 */
import { describe, expect, it } from "vitest";

import { classifyBrowserUrl } from "../../../../admit/browserSurface.js";
import {
  visualEvidencePreflightLines,
  visualEvidenceReviewLines,
} from "../../../../live/turn/visualEvidenceGuidance.js";

const PREFLIGHT = visualEvidencePreflightLines().join("\n");
const REVIEW = visualEvidenceReviewLines().join("\n");

describe("visualEvidencePreflightLines", () => {
  it("names the field the composer actually fills, and that a path is absolute", () => {
    expect(PREFLIGHT).toContain("`images`");
    expect(PREFLIGHT).toContain("absolute path");
  });

  it("leads with the default rather than an option", () => {
    expect(PREFLIGHT).toContain(
      "VISUAL EVIDENCE — when the proof IS a picture, attach the picture. Default, not a nicety:",
    );
  });

  it("leaves the judgement with the composer, so a one-line answer is not pushed to attach one", () => {
    expect(PREFLIGHT).toContain("The judgement stays YOURS");
    expect(PREFLIGHT).toContain("attaching one is noise");
  });

  it("names every doored provider a browser must not be pointed at, and the door verbs that replace it", () => {
    for (const provider of ["Slack", "GitHub", "Linear", "Notion", "Vanta"]) {
      expect(PREFLIGHT).toContain(provider);
    }
    for (const door of ["github checks", "github read", "slack read-thread", "linear read", "notion read"]) {
      expect(PREFLIGHT).toContain(door);
    }
  });

  // The retraction. A later change stopped `browser shot` refusing a page for having a
  // door and left this brief saying it still did; `shotCore.ts` leaves the refusing arm uninhabited. The
  // positive half is the witness testing.md asks for: without it, deleting every provider name from the
  // brief would satisfy the negative on its own.
  it("does not tell a composer the capture verb refuses a doored page, because it does not", () => {
    expect(PREFLIGHT).toContain("have doors and the verb does NOT refuse them");
    expect(PREFLIGHT.includes("have doors and the verb refuses them")).toBe(false);
  });

  it("keeps the evidence-quality preference for the door verbs, which the retraction does not touch", () => {
    expect(PREFLIGHT).toContain("Reach for the door verb FIRST anyway, on evidence");
    expect(PREFLIGHT).toContain("beats a photograph of text");
  });

  // Vanta is the only doored provider with a picture route of its own, and the per-control
  // verb shipped without telling any composing surface — which is what this test guards.
  it("names Vanta's own picture routes, and says what render does NOT reach", () => {
    expect(PREFLIGHT).toContain("`atlas vanta shot");
    expect(PREFLIGHT).toContain("--control <id>` photographs ONE control at its own address");
    expect(PREFLIGHT).toContain("atlas vanta vulnerabilities --html");
    expect(PREFLIGHT).toContain("publishes what the atlas ALREADY STORED");
    expect(PREFLIGHT).toContain("`atlas vanta walk` is what puts a live");
  });

  it("says out loud that DOORLESS surfaces are untouched, so the rule is not read as no screenshots", () => {
    expect(PREFLIGHT).toContain("Doorless");
    expect(PREFLIGHT).toContain("are where the pictures live");
  });

  it("keeps the fold discipline that doctrine rule 7 enforces", () => {
    expect(PREFLIGHT).toContain("BELOW the fold");
  });

  it("routes a failed capture to the answer's own blind-spot field instead of holding the answer", () => {
    expect(PREFLIGHT).toContain("grounding.evidence.couldNotSee");
  });

  it("never names a browser profile — that rule is device-local, not repo canon", () => {
    expect(PREFLIGHT.toLowerCase().includes("work profile")).toBe(false);
    expect(PREFLIGHT).toContain("this device's own instructions set");
  });

  it("names the relay verb as THE capture route, so a disconnected extension is not a blocked leg", () => {
    expect(PREFLIGHT).toContain("`slopweaver browser shot --url <address> --out <file.png>`");
    expect(PREFLIGHT).toContain("does NOT need the Claude-in-Chrome");
    expect(PREFLIGHT).toContain("`list_connected_browsers` returning [] is not a blocked screenshot leg");
  });

  it("lists the named states a capture leg reports, so a composer never reports a silence", () => {
    for (const state of ["photographed", "relay-unavailable", "session-lost", "doored-provider"]) {
      expect(PREFLIGHT).toContain(state);
    }
  });

  // The count is the composer's call, so the pre-flight carries the judgement and no number.
  it("leaves HOW MANY pictures to judgement, with the eleven-control case and no cap", () => {
    expect(PREFLIGHT).toContain("HOW MANY is yours too, and there is no count cap");
    expect(PREFLIGHT).toContain("An answer naming eleven controls sends the eleven captures it names");
    expect(PREFLIGHT.includes("(cap above)")).toBe(false);
    expect(PREFLIGHT.includes("IMAGES_MAX")).toBe(false);
    expect(/at most \d+ (images|pictures|screenshots)/.test(PREFLIGHT)).toBe(false);
  });
});

/**
 * The brief and the door register are two independent copies of "what can photograph a Vanta page", and
 * they have drifted apart twice: one change altered the verb and not the brief, another
 * added `atlas vanta shot` to neither the brief nor the door string. Asserting either copy against
 * its own literal would restate it; asserting them against EACH OTHER fails whenever one moves alone,
 * which is the failure that actually happened.
 */
describe("the brief's Vanta picture route and the browser door register name the same verbs", () => {
  const vantaDoor = (): string => {
    const provider = classifyBrowserUrl({ url: "https://app.vanta.com/controls" });
    expect(provider?.provider).toBe("Vanta");
    return provider!.door!;
  };

  it("names atlas vanta shot in both", () => {
    expect(vantaDoor()).toContain("atlas vanta shot --control <id>");
    expect(PREFLIGHT).toContain("atlas vanta shot");
  });

  it("names every Vanta picture verb the door offers in the brief too", () => {
    const door = vantaDoor();
    for (const verb of ["atlas vanta shot", "atlas vanta vulnerabilities", "atlas vanta render", "atlas vanta walk"]) {
      expect(door).toContain(verb);
      expect(PREFLIGHT).toContain(verb);
    }
  });

  it("carries the same caveat on render in both, so neither can over-claim alone", () => {
    expect(vantaDoor()).toContain("ALREADY STORED");
    expect(PREFLIGHT).toContain("ALREADY STORED");
  });
});

describe("visualEvidenceReviewLines", () => {
  it("caps a missing screenshot at a low-impact note", () => {
    expect(REVIEW).toContain("`low`-impact");
    expect(REVIEW).toContain("A screenshot that is NOT THERE is a note, never a round");
  });

  it("says the ceiling covers ABSENCE only, and hands a present picture to section 1c", () => {
    // This clause alone was once the only image clause in the packet, so its ceiling
    // applied to a 4032px-wide unreadable screenshot as readily as to a missing one — which is why round
    // 4's reviewer, having opened the file, could not escalate on what it saw.
    expect(REVIEW).toContain("This ceiling is about ABSENCE and nothing else.");
    expect(REVIEW).toContain("A picture the answer DOES attach is section 1c");
    expect(REVIEW).toContain("marks this verdict `broken`");
  });

  it("rules out both verdicts that would buy another round", () => {
    expect(REVIEW).toContain("never `broken` and never `incomplete`");
  });

  it("hands the ASKED-FOR case back to the deliverable gate rather than duplicating it", () => {
    expect(REVIEW).toContain("already checked by the door");
  });

  it("sorts after the packet's own section 1 so the ceiling reads with the check it bounds", () => {
    expect(visualEvidenceReviewLines()[0]).toBe("## 1b. A screenshot that is NOT THERE is a note, never a round");
  });
});
